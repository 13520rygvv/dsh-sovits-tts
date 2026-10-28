"""so-vits-svc-32k inference engine + text-to-character-voice pipeline.

Text -> (edge-tts or Windows SAPI) -> source wav 16k mono -> so-vits-svc
(HuBERT-Soft content + parselmouth f0) -> 32k wav of the chosen character.

The upstream repo is a *voice conversion* model, so a neutral TTS supplies the
prosody and the so-vits model re-voices it into the selected character.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hashlib
import io
import logging
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unicodedata
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
if str(VENDOR) not in sys.path:
    sys.path.insert(0, str(VENDOR))

import numpy as np
import parselmouth
import soundfile as sf
import torch
from scipy.signal import resample_poly

import utils as sovits_utils  # noqa: E402  (vendor shim)
from hubert import hubert_model  # noqa: E402
from models import SynthesizerTrn  # noqa: E402

LOG = logging.getLogger("sovits.engine")

# ---------------------------------------------------------------- voice database
MODELS_ROOT = Path(os.environ.get("SOVITS_MODELS", r"E:\TOOL\AI\碧蓝档案sovits\0303"))
HUBERT_FALLBACK = ROOT / "models" / "hubert-soft-0d54a1f4.pt"

# folder name -> (voice id, display name, default f0 shift in semitones)
VOICE_META = OrderedDict(
    [
        ("AI优香", ("yuuka", "优香", 0)),
        ("AI和纱", ("kazusa", "和纱", 0)),
        ("AI小绿", ("midori", "小绿", 0)),
        ("AI桃井", ("momoi", "桃井", 0)),
        ("AI星野", ("hoshino", "星野", 0)),
        ("AI爱丽丝", ("alice", "爱丽丝", 0)),
        ("AI纱织", ("saori", "纱织", 0)),
    ]
)


def _pick(paths, pattern):
    hits = []
    for p in paths:
        hits.extend(Path(p).glob(pattern))
    hits.sort()
    return hits[-1] if hits else None


def discover_voices():
    """Scan the model folder for usable (config.json + G_*.pth) voices."""
    voices = []
    if not MODELS_ROOT.is_dir():
        return voices
    seen = set()
    for folder, (vid, name, pitch) in VOICE_META.items():
        d = MODELS_ROOT / folder
        if not d.is_dir():
            continue
        cfg = d / "config.json"
        ckpt = _pick([d], "G_*.pth")
        if not cfg.is_file() or ckpt is None:
            LOG.warning("skip %s: config/checkpoint missing", d)
            continue
        hubert = _pick([d], "hubert-soft-*.pt") or (HUBERT_FALLBACK if HUBERT_FALLBACK.is_file() else None)
        if hubert is None:
            LOG.warning("skip %s: no hubert checkpoint", d)
            continue
        voices.append(
            {
                "id": vid,
                "name": name,
                "dir": str(d),
                "config": str(cfg),
                "checkpoint": str(ckpt),
                "hubert": str(hubert),
                "pitch": pitch,
            }
        )
        seen.add(folder)
    # anything else in the folder that looks loadable, keyed by folder name
    for d in sorted(MODELS_ROOT.iterdir()):
        if not d.is_dir() or d.name in seen:
            continue
        cfg = d / "config.json"
        ckpt = _pick([d], "G_*.pth")
        hubert = _pick([d], "hubert-soft-*.pt") or HUBERT_FALLBACK
        if cfg.is_file() and ckpt is not None and Path(hubert).is_file():
            voices.append(
                {
                    "id": re.sub(r"[^a-z0-9]+", "-", d.name.lower()) or d.name,
                    "name": d.name,
                    "dir": str(d),
                    "config": str(cfg),
                    "checkpoint": str(ckpt),
                    "hubert": str(hubert),
                    "pitch": 0,
                }
            )
    return voices


# ------------------------------------------------------------------- text rules
FENCE_RE = re.compile(r"```.*?(?:```|$)", re.S)
INLINE_CODE_RE = re.compile(r"`([^`]*)`")
IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
URL_RE = re.compile(r"https?://\S+|www\.\S+")
HTML_RE = re.compile(r"<[^>]{1,80}>")
MD_MARKS_RE = re.compile(r"[*_~#>|]+")
EMOJI_RE = re.compile(
    "[" "\U0001f300-\U0001faff" "\U00002600-\U000027bf" "\U0001f000-\U0001f2ff" "\ufe0f\u200d" "]"
)
SPEAKABLE = re.compile(r"[\w\u4e00-\u9fff]")
CJK = re.compile(r"[\u4e00-\u9fff]")


def clean_markdown(text: str) -> str:
    """Turn an assistant markdown answer into plain speakable text."""
    t = text or ""
    t = FENCE_RE.sub(" 代码略 ", t)
    t = IMAGE_RE.sub(" ", t)
    t = LINK_RE.sub(r"\1", t)
    t = URL_RE.sub(" ", t)
    t = INLINE_CODE_RE.sub(r"\1", t)
    t = HTML_RE.sub(" ", t)
    t = re.sub(r"^\s{0,3}(?:[-+*]|\d+[.)])\s+", "", t, flags=re.M)
    t = MD_MARKS_RE.sub(" ", t)
    t = EMOJI_RE.sub("", t)
    t = unicodedata.normalize("NFKC", t)
    t = re.sub(r"[ \t\u00a0]+", " ", t)
    t = re.sub(r"\n{2,}", "\n", t)
    return t.strip()


def split_text(text: str, max_chars: int = 90) -> list[str]:
    """Split into speakable chunks so long answers stay stable on a 6 GB GPU."""
    pieces: list[str] = []
    for para in re.split(r"\n+", text):
        para = para.strip()
        if not para:
            continue
        buf = ""
        for sent in re.split(r"(?<=[。！？!?；;…：:，,])", para):
            if not sent:
                continue
            if len(buf) + len(sent) <= max_chars:
                buf += sent
            else:
                if buf:
                    pieces.append(buf)
                while len(sent) > max_chars:
                    pieces.append(sent[:max_chars])
                    sent = sent[max_chars:]
                buf = sent
        if buf:
            pieces.append(buf)
    return [p for p in pieces if SPEAKABLE.search(p)]


# Target source-audio length per chunk. Keeping one chunk near 20 s of neutral
# speech leaves the hifigan intermediate tensors well inside 6 GB of VRAM even
# when the voice is slowed down, while still being long enough that a whole
# answer needs only a couple of network round trips.
CHUNK_SECONDS = 20.0
SECONDS_PER_CHAR = 0.21


def chunk_chars_for(rate: int, ceiling: int = 170) -> int:
    """Characters per chunk that keep roughly CHUNK_SECONDS of source audio."""
    factor = 100.0 / max(50.0, 100.0 + float(rate or 0))
    chars = int(round(CHUNK_SECONDS / (SECONDS_PER_CHAR * factor)))
    return max(40, min(ceiling, chars))


# ------------------------------------------------------------------ source TTS
EDGE_VOICES = [
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunjianNeural",
    "ja-JP-NanamiNeural",
]
SAPI_VOICE = "Microsoft Huihui Desktop"
DEFAULT_SOURCE_VOICE = "zh-CN-XiaoxiaoNeural"


def _ffmpeg() -> str | None:
    cand = os.environ.get("FFMPEG")
    if cand and Path(cand).is_file():
        return cand
    found = shutil.which("ffmpeg")
    if found:
        return found
    known = Path(r"E:\TOOL\AI\environment\ffmpeg\ffmpeg-5.1.2-essentials_build\bin\ffmpeg.exe")
    return str(known) if known.is_file() else None


def edge_tts_to_bytes(
    text: str,
    voice: str = DEFAULT_SOURCE_VOICE,
    rate: int = 0,
    timeout: float = 15.0,
) -> bytes:
    """Synthesize the neutral source voice and return the mp3 in memory.

    Deliberately no temporary file: the audio is only ever needed as decoded
    samples, and temp files were both a privacy question and a source of
    leftovers on Windows (a racing hedge keeps the handle open, so rmtree
    silently fails)."""
    import edge_tts

    speed = f"{int(rate):+d}%"
    buffer = bytearray()

    async def run():
        comm = edge_tts.Communicate(
            text,
            voice,
            rate=speed,
            connect_timeout=8,
            receive_timeout=int(timeout),
        )
        async for chunk in comm.stream():
            if chunk.get("type") == "audio":
                buffer.extend(chunk["data"])

    asyncio.run(asyncio.wait_for(run(), timeout=timeout + 5))
    if len(buffer) < 512:
        raise RuntimeError(f"edge-tts returned {len(buffer)} bytes of audio")
    return bytes(buffer)


def edge_tts_to_mp3(
    text: str,
    out_path: str,
    voice: str = DEFAULT_SOURCE_VOICE,
    rate: int = 0,
    timeout: float = 15.0,
) -> None:
    data = edge_tts_to_bytes(text, voice, rate, timeout)
    Path(out_path).write_bytes(data)


def edge_tts_with_retry(
    text: str,
    out_path: str,
    voice: str = DEFAULT_SOURCE_VOICE,
    rate: int = 0,
    attempts: int = 4,
    timeout: float = 15.0,
) -> None:
    """edge-tts drops chunks now and then ("No audio was received"); retry them.

    That error can also arrive after a ~40 s stall, so every attempt is bounded
    by `timeout`: a stuck request is abandoned and retried instead of holding the
    whole answer hostage.
    """
    last: Exception | None = None
    for attempt in range(1, attempts + 1):
        started = time.time()
        try:
            edge_tts_to_mp3(text, out_path, voice, rate, timeout)
            size = Path(out_path).stat().st_size if Path(out_path).is_file() else 0
            if size < 512:
                raise RuntimeError(f"edge-tts produced {size} bytes")
            return
        except Exception as exc:  # network, throttling, empty audio
            last = exc
            LOG.warning(
                "edge-tts attempt %d/%d failed after %.1fs: %s",
                attempt,
                attempts,
                time.time() - started,
                exc,
            )
            if attempt < attempts:
                time.sleep(0.4 + 0.6 * attempt)
    raise RuntimeError(f"edge-tts failed after {attempts} attempts: {last}")


def _pick_sapi_voice(voice) -> object | None:
    """Pick the best installed SAPI voice: Chinese first, English as a last resort."""
    try:
        tokens = list(voice.GetVoices())
    except Exception:
        return None
    if not tokens:
        return None

    def score(token) -> int:
        try:
            desc = token.GetDescription() or ""
        except Exception:
            return 0
        low = desc.lower()
        if "huihui" in low:
            return 3
        if "chinese" in low or "zh-cn" in low or "中文" in desc:
            return 2
        return 0

    best = max(tokens, key=score)
    return best if score(best) > 0 else None


def _sapi_com(text: str, out_path: str, rate: int = 0) -> None:
    """Speak through SAPI in-process (comtypes): no window, real Unicode."""
    import comtypes.client as cc

    voice = cc.CreateObject("SAPI.SpVoice")
    stream = cc.CreateObject("SAPI.SpFileStream")
    stream.Open(str(out_path), 3, False)  # 3 = SSFMCreateForWrite
    try:
        voice.AudioOutputStream = stream
        token = _pick_sapi_voice(voice)
        if token is not None:
            voice.Voice = token
            try:
                LOG.info("sapi voice: %s", token.GetDescription())
            except Exception:
                pass
        voice.Rate = max(-10, min(10, int(round(rate / 10))))
        voice.Speak(text)
    finally:
        try:
            stream.Close()
        except Exception:
            pass
    size = Path(out_path).stat().st_size if Path(out_path).is_file() else 0
    if size < 1024:
        raise RuntimeError(f"SAPI wrote {size} bytes")


def _sapi_powershell(text: str, out_path: str, rate: int = 0) -> None:
    """Last resort: hidden PowerShell (no console window) reading UTF-8 from a file.

    The text travels through a UTF-8 file instead of stdin so PowerShell cannot
    mis-decode Chinese into mojibake, and CREATE_NO_WINDOW keeps the flash away.
    """
    sapi_rate = max(-10, min(10, int(round(rate / 10))))
    tmpdir = Path(tempfile.mkdtemp(prefix="sovits-sapi-"))
    txt_path = tmpdir / "say.txt"
    txt_path.write_text(text, encoding="utf-8")
    script = (
        "Add-Type -AssemblyName System.Speech;"
        "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
        "try{$s.SelectVoice($env:SOVITS_SAPI_VOICE)}catch{};"
        "$s.Rate=[int]$env:SOVITS_SAPI_RATE;"
        "$s.SetOutputToWaveFile($env:SOVITS_SAPI_OUT);"
        "$t=Get-Content -Raw -Encoding UTF8 -LiteralPath $env:SOVITS_SAPI_TXT;"
        "$s.Speak($t);"
        "$s.Dispose()"
    )
    env = dict(os.environ)
    env["SOVITS_SAPI_VOICE"] = SAPI_VOICE
    env["SOVITS_SAPI_RATE"] = str(sapi_rate)
    env["SOVITS_SAPI_OUT"] = str(out_path)
    env["SOVITS_SAPI_TXT"] = str(txt_path)
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand",
             base64.b64encode(script.encode("utf-16-le")).decode("ascii")],
            capture_output=True,
            env=env,
            creationflags=flags,
        )
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    if proc.returncode != 0 or not Path(out_path).is_file():
        raise RuntimeError("SAPI failed: " + proc.stderr.decode("utf-8", "replace")[:400])


def sapi_to_wav(text: str, out_path: str, rate: int = 0) -> None:
    """Offline fallback: Windows SAPI (Huihui) writes a wav file, silently."""
    errors: list[str] = []
    try:
        _sapi_com(text, out_path, rate)
        return
    except Exception as exc:
        errors.append(f"comtypes: {exc}")
        LOG.warning("SAPI via comtypes failed (%s); trying hidden PowerShell", exc)
    try:
        _sapi_powershell(text, out_path, rate)
        return
    except Exception as exc:
        errors.append(f"powershell: {exc}")
    raise RuntimeError("SAPI failed: " + " | ".join(errors))



def decode_mono16k_bytes(data: bytes) -> np.ndarray:
    """Decode in-memory audio (mp3/wav) into float32 mono @16 kHz."""
    try:
        samples, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except Exception:
        ff = _ffmpeg()
        if not ff:
            raise
        proc = subprocess.run(
            [ff, "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", "16000",
             "-f", "wav", "pipe:1"],
            input=data,
            capture_output=True,
            check=True,
        )
        samples, sr = sf.read(io.BytesIO(proc.stdout), dtype="float32", always_2d=True)
    return _finish_mono(samples, sr)


def _finish_mono(data: np.ndarray, sr: int) -> np.ndarray:
    mono = data.mean(axis=1) if data.ndim > 1 else data
    if sr != 16000:
        g = math.gcd(int(sr), 16000)
        mono = resample_poly(mono, 16000 // g, int(sr) // g).astype(np.float32)
    peak = float(np.max(np.abs(mono))) if mono.size else 1.0
    if peak > 1.0:
        mono = (mono / peak).astype(np.float32)
    return mono


def _rmtree_retry(path: Path, attempts: int = 6) -> None:
    """Windows keeps a directory locked while a racing writer still holds it."""
    for attempt in range(attempts):
        try:
            shutil.rmtree(path)
            return
        except FileNotFoundError:
            return
        except OSError:
            if attempt == attempts - 1:
                LOG.debug("could not remove temp dir %s, leaving it to the janitor", path)
                return
            time.sleep(0.15 * (attempt + 1))


TEMP_PREFIXES = ("sovits-src-", "sovits-sapi-")


def cleanup_temp(max_age: float = 600.0) -> int:
    """Delete temp work dirs older than `max_age` seconds (best effort)."""
    root = Path(tempfile.gettempdir())
    removed = 0
    cutoff = time.time() - max_age
    try:
        entries = list(os.scandir(root))
    except OSError:
        return 0
    for entry in entries:
        if not entry.is_dir(follow_symlinks=False):
            continue
        if not entry.name.startswith(TEMP_PREFIXES):
            continue
        try:
            if entry.stat().st_mtime > cutoff:
                continue
        except OSError:
            continue
        try:
            shutil.rmtree(entry.path, ignore_errors=False)
            removed += 1
        except OSError:
            continue
    if removed:
        LOG.info("cleaned %d stale temp dir(s)", removed)
    return removed


def decode_mono16k(path: str) -> np.ndarray:
    """Read any audio file into float32 mono @16 kHz."""
    try:
        data, sr = sf.read(path, dtype="float32", always_2d=True)
    except Exception:
        ff = _ffmpeg()
        if not ff:
            raise
        tmp = str(Path(path).with_suffix(".decoded.wav"))
        subprocess.run([ff, "-y", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", "16000", tmp], check=True)
        data, sr = sf.read(tmp, dtype="float32", always_2d=True)
        Path(tmp).unlink(missing_ok=True)
    return _finish_mono(data, sr)


# ------------------------------------------------------------------------ f0
def pitch_coarse(x: np.ndarray, p_len: int, f0_up_key: int = 0):
    time_step = 160 / 16000 * 1000
    f0_min, f0_max = 50, 1100
    f0_mel_min = 1127 * np.log(1 + f0_min / 700)
    f0_mel_max = 1127 * np.log(1 + f0_max / 700)

    f0 = (
        parselmouth.Sound(x, 16000)
        .to_pitch_ac(
            time_step=time_step / 1000,
            voicing_threshold=0.6,
            pitch_floor=f0_min,
            pitch_ceiling=f0_max,
        )
        .selected_array["frequency"]
    )
    if len(f0) > p_len:
        f0 = f0[:p_len]
    pad_size = (p_len - len(f0) + 1) // 2
    if pad_size > 0 or p_len - len(f0) - pad_size > 0:
        f0 = np.pad(f0, [[pad_size, p_len - len(f0) - pad_size]], mode="constant")

    f0 = f0 * pow(2, f0_up_key / 12)
    f0_mel = 1127 * np.log(1 + f0 / 700)
    f0_mel[f0_mel > 0] = (f0_mel[f0_mel > 0] - f0_mel_min) * 254 / (f0_mel_max - f0_mel_min) + 1
    f0_mel[f0_mel <= 1] = 1
    f0_mel[f0_mel > 255] = 255
    return np.rint(f0_mel).astype(np.int64), f0


def clean_pitch(input_pitch: np.ndarray) -> np.ndarray:
    num_nan = np.sum(input_pitch == 1)
    if num_nan / max(len(input_pitch), 1) > 0.9:
        input_pitch[input_pitch != 1] = 1
    return input_pitch


# ---------------------------------------------------------------------- engine
class VoiceModel:
    """One loaded character checkpoint (the shared HuBERT lives on the Engine)."""

    def __init__(self, spec: dict, device: torch.device):
        self.spec = spec
        hps = sovits_utils.get_hparams_from_file(spec["config"])
        net = SynthesizerTrn(
            hps.data.filter_length // 2 + 1,
            hps.train.segment_size // hps.data.hop_length,
            **hps.model,
        )
        sovits_utils.load_checkpoint(spec["checkpoint"], net, None)
        self.net = net.eval().to(device)
        self.hps = hps
        self.device = device
        spk = getattr(hps, "spk", {"0": 0})
        sid = None
        if isinstance(spk, dict):
            for name, ident in spk.items():
                if name.lower() == spec["id"].lower():
                    sid = ident
                    break
            if sid is None:
                sid = next(iter(spk.values()))
        else:
            sid = 0
        self.sid = torch.LongTensor([int(sid)]).to(device).unsqueeze(0)


class Engine:
    def __init__(self, device: str | None = None, cache_size: int = 2, fp16: bool | None = None):
        self.voices = {v["id"]: v for v in discover_voices()}
        if not self.voices:
            raise RuntimeError(f"no usable so-vits voices under {MODELS_ROOT}")
        if device is None:
            device = "cuda" if torch.cuda.is_available() else "cpu"
        self.device = torch.device(device)
        self.cache_size = max(1, cache_size)
        self._cache: OrderedDict[str, VoiceModel] = OrderedDict()
        self._hubert = None
        self.lock = threading.Lock()
        # Half precision halves the decoder's activation memory too, which is the
        # tightest constraint on a 6 GB card (2347 -> 1656 MiB for 18 s of audio).
        self.fp16 = (self.device.type == "cuda") if fp16 is None else bool(fp16)
        self._result_cache: OrderedDict[str, tuple[np.ndarray, int]] = OrderedDict()
        self.result_cache_size = 6
        cleanup_temp()  # sweep temp dirs left behind by an older build or a crash
        if self.device.type == "cuda":
            # Measured: cudnn.benchmark=True spends 1.8-4.8 s autotuning the first
            # time it sees each new input length (every chunk has one) and buys
            # nothing in steady state (0.30 s vs 0.33 s), so keep it off.
            torch.backends.cudnn.benchmark = False
            torch.backends.cuda.matmul.allow_tf32 = True

    def _autocast(self):
        if self.fp16 and self.device.type == "cuda":
            return torch.autocast("cuda", dtype=torch.float16)
        return contextlib.nullcontext()

    def warmup(self, voice_id: str | None = None) -> None:
        """Run one conversion at the largest chunk size we ever use, so a real
        click does not pay for cuDNN autotuning, lazy CUDA init — or, and this is
        the expensive one, the first-touch cost of freshly allocated VRAM blocks
        (which grows with the length of the audio)."""
        started = time.time()
        try:
            voice = voice_id or next(iter(self.voices))
            sr = 16000
            seconds = CHUNK_SECONDS + 1.0
            t = np.arange(int(sr * seconds), dtype=np.float32) / sr
            tone = (0.1 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
            with self.lock:
                self.convert(tone, voice, int(self.voices[voice].get("pitch", 0)))
            if self.device.type == "cuda":
                allocated = torch.cuda.memory_allocated() / 2**20
                reserved = torch.cuda.memory_reserved() / 2**20
                LOG.info("warmup done in %.2fs (%.0f MiB allocated, %.0f MiB reserved)",
                         time.time() - started, allocated, reserved)
            else:
                LOG.info("warmup conversion done in %.2fs", time.time() - started)
        except Exception as exc:
            LOG.warning("warmup conversion failed: %s", exc)

    # -- lazy heavy stuff
    def _hubert_model(self):
        if self._hubert is None:
            hubert_path = self.voices[next(iter(self.voices))]["hubert"]
            LOG.info("loading hubert from %s", hubert_path)
            net = hubert_model.hubert_soft(hubert_path)
            self._hubert = net.eval().to(self.device)
        return self._hubert

    def _voice_model(self, voice_id: str) -> VoiceModel:
        spec_id = voice_id if voice_id in self.voices else next(iter(self.voices))
        if spec_id in self._cache:
            self._cache.move_to_end(spec_id)
            return self._cache[spec_id]
        LOG.info("loading voice %s (%s)", spec_id, self.voices[spec_id]["checkpoint"])
        model = VoiceModel(self.voices[spec_id], self.device)
        self._cache[spec_id] = model
        while len(self._cache) > self.cache_size:
            old_id, _ = self._cache.popitem(last=False)
            LOG.info("unloading voice %s", old_id)
        if self.device.type == "cuda":
            torch.cuda.empty_cache()
        return model

    # -- conversion
    def convert(self, wav16k: np.ndarray, voice_id: str, pitch: int | None = None) -> np.ndarray:
        """Convert 16 kHz speech to the target voice.

        A chunk that is too long for the free VRAM is split in half and retried
        instead of failing the whole answer."""
        try:
            return self._convert_once(wav16k, voice_id, pitch)
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            if wav16k.size < 16000 * 3:
                raise
            half = int(wav16k.size // 2)
            LOG.warning(
                "CUDA OOM on %.1fs of source, retrying as two halves", wav16k.size / 16000.0
            )
            head = self.convert(wav16k[:half], voice_id, pitch)
            tail = self.convert(wav16k[half:], voice_id, pitch)
            return np.concatenate([head, tail])

    def _convert_once(self, wav16k: np.ndarray, voice_id: str, pitch: int | None = None) -> np.ndarray:
        vm = self._voice_model(voice_id)
        if pitch is None:
            pitch = int(vm.spec.get("pitch", 0))
        source = torch.from_numpy(np.ascontiguousarray(wav16k, dtype=np.float32)).unsqueeze(0)
        with torch.inference_mode():
            with self._autocast():
                units = self._hubert_model().units(source.unsqueeze(0).to(self.device))
            soft = units.squeeze(0).float().cpu().numpy()
            f0_coarse, f0 = pitch_coarse(source.numpy()[0], soft.shape[0] * 2, pitch)
            f0_t = torch.FloatTensor(clean_pitch(f0)).unsqueeze(0).to(self.device)
            x_tst = torch.FloatTensor(soft).unsqueeze(0).to(self.device)
            x_tst = torch.repeat_interleave(x_tst, repeats=2, dim=1).transpose(1, 2)
            with self._autocast():
                audio = vm.net.infer(x_tst, f0=f0_t, g=vm.sid)[0, 0]
            audio = audio.float().cpu().numpy()
        return audio

    # -- full pipeline
    def speak(
        self,
        text: str,
        voice_id: str | None = None,
        pitch: int | None = None,
        source_voice: str | None = None,
        max_chars: int = 3000,
        rate: int | None = None,
    ) -> tuple[np.ndarray, int]:
        started = time.time()
        plain = clean_markdown(text)
        if len(plain) > max_chars:
            plain = plain[:max_chars]
        speed = int(rate or 0)
        chunks = split_text(plain, chunk_chars_for(speed))
        if not chunks:
            raise ValueError("nothing to speak after cleaning the text")
        voice = voice_id if voice_id in self.voices else next(iter(self.voices))
        src_voice = source_voice or DEFAULT_SOURCE_VOICE
        sample_rate = int(self._voice_model(voice).hps.data.sampling_rate)

        key = self._cache_key(plain, voice, pitch, speed, src_voice)
        cached = self._result_cache.get(key)
        if cached is not None:
            self._result_cache.move_to_end(key)
            LOG.info("speak cache hit (%.2fs audio)", cached[0].size / cached[1])
            return cached

        # Fetch the neutral source audio in parallel, but convert a chunk as soon
        # as its own audio lands: the GPU work then hides behind the network wait
        # instead of starting only after every chunk arrived.
        out: list[np.ndarray] = []
        pool = ThreadPoolExecutor(max_workers=min(4, len(chunks)), thread_name_prefix="tts-src")
        try:
            futures = [pool.submit(self._source_wav, chunk, src_voice, speed) for chunk in chunks]
            with self.lock:
                for i, future in enumerate(futures):
                    waited = time.time()
                    wav16k = future.result()
                    fetched = time.time() - waited
                    piece = self.convert(wav16k, voice, pitch)
                    LOG.info(
                        "chunk %d/%d done (%.1fs audio, fetch %.1fs + convert %.1fs, %+.1fs elapsed)",
                        i + 1,
                        len(chunks),
                        len(piece) / sample_rate,
                        fetched,
                        time.time() - waited - fetched,
                        time.time() - started,
                    )
                    out.append(piece)
        finally:
            pool.shutdown(wait=False, cancel_futures=True)
        gap = np.zeros(int(sample_rate * 0.12), dtype=np.float32)
        merged = []
        for piece in out:
            merged.append(piece.astype(np.float32))
            merged.append(gap)
        audio = np.concatenate(merged[:-1]) if merged else np.zeros(1, dtype=np.float32)
        peak = float(np.max(np.abs(audio))) if audio.size else 0.0
        if peak > 0.98:
            audio = (audio * (0.98 / peak)).astype(np.float32)
        self._result_cache[key] = (audio, sample_rate)
        while len(self._result_cache) > self.result_cache_size:
            self._result_cache.popitem(last=False)
        return audio, sample_rate

    def _cache_key(self, plain: str, voice: str, pitch, speed: int, src_voice: str) -> str:
        raw = f"{plain}\x00{voice}\x00{pitch}\x00{speed}\x00{src_voice}\x00{self.fp16}"
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()

    def _edge_attempt(self, text: str, src_voice: str, rate: int) -> bytes:
        return edge_tts_to_bytes(text, src_voice, rate, timeout=8.0)

    def _edge_hedged(self, text: str, src_voice: str, rate: int, budget: float = 12.0) -> bytes:
        """The edge-tts endpoint drops roughly half of its requests, so ask twice
        in parallel and keep the first answer that contains audio. Two rounds at
        most: after that the local SAPI voice is the cheaper way out."""
        deadline = time.time() + budget
        errors: list[str] = []
        for _round in range(2):
            remaining = deadline - time.time()
            if remaining < 1.5:
                break
            pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="tts-edge")
            try:
                pending = [pool.submit(self._edge_attempt, text, src_voice, rate) for _ in range(2)]
                try:
                    for future in as_completed(pending, timeout=remaining):
                        try:
                            return future.result()
                        except Exception as exc:
                            errors.append(str(exc))
                except (TimeoutError, FuturesTimeoutError):
                    errors.append("timeout")
            finally:
                pool.shutdown(wait=False, cancel_futures=True)
        raise RuntimeError("edge-tts failed: " + " | ".join(errors[-2:] or ["unknown"]))

    def _source_wav(self, text: str, src_voice: str, rate: int = 0) -> np.ndarray:
        """Neutral source audio. The online voice is decoded straight from memory;
        only the offline SAPI fallback needs a temp file (SAPI can only write to
        disk), and that one is removed right away with retries."""
        try:
            return decode_mono16k_bytes(self._edge_hedged(text, src_voice, rate))
        except Exception as exc:  # service down / network blocked
            LOG.warning("edge-tts failed (%s), falling back to SAPI", exc)
        tmpdir = Path(tempfile.mkdtemp(prefix="sovits-sapi-"))
        try:
            wav = tmpdir / "sapi.wav"
            sapi_to_wav(text, str(wav), rate)
            return decode_mono16k(str(wav))
        finally:
            _rmtree_retry(tmpdir)


def wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()
