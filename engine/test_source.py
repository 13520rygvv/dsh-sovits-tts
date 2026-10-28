"""Verify the TTS source stage: online voice, in-process SAPI fallback, no PowerShell window."""
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import engine  # noqa: E402

TEXT_CN = "点一下喇叭就能听见优香在念这一段话，中文必须听得懂，英文也不能挂。"

print("== 1. edge-tts returns audio in memory, no temp file ==")
t0 = time.time()
data = engine.edge_tts_to_bytes(TEXT_CN, engine.DEFAULT_SOURCE_VOICE, 0)
print(f"  ok {len(data)}B in {time.time()-t0:.2f}s")

print("== 2. SAPI fallback must use comtypes, never PowerShell ==")
engine.edge_tts_to_bytes = lambda *a, **k: (_ for _ in ()).throw(RuntimeError("forced edge-tts failure"))
engine._sapi_powershell = lambda *a, **k: (_ for _ in ()).throw(
    RuntimeError("powershell path must not run"))

eng = engine.Engine()
before = len(list(Path(tempfile.gettempdir()).glob("sovits-sapi-*")))
audio = eng._source_wav(TEXT_CN, engine.DEFAULT_SOURCE_VOICE, 0)
after = len(list(Path(tempfile.gettempdir()).glob("sovits-sapi-*")))
print(f"  fallback audio: samples={audio.size} dur={audio.size/16000:.2f}s peak={abs(audio).max():.3f}")
print(f"  temp dirs left behind: {after - before} (must be 0)")

print("== 3. full pipeline over the fallback source ==")
t0 = time.time()
audio, sr = eng.speak(TEXT_CN, voice_id="yuuka")
print(f"  speak ok sr={sr} dur={audio.size/sr:.2f}s peak={float(abs(audio).max()):.3f} in {time.time()-t0:.2f}s")

print("== 4. no stray powershell children ==")
ps = subprocess.run(["powershell", "-NoProfile", "-Command",
                     "(Get-Process powershell -ErrorAction SilentlyContinue | Measure-Object).Count"],
                    capture_output=True, text=True)
print(f"  powershell processes running: {ps.stdout.strip()}")
print("ok")
