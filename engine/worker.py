"""HTTP worker: the DSH plugin's Host half talks to this on 127.0.0.1.

GET  /health                -> json (voices, device, warm state)
POST /speak   {text, voice} -> audio/wav      (json body)
GET  /speak?text=..&voice=.. -> audio/wav
POST /warm    {voice}       -> json           (preload a checkpoint)

Started with:  venv\\Scripts\\python.exe worker.py --port 8765
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import engine

LOG = logging.getLogger("sovits.worker")
STATE = {"engine": None, "ready": False, "warm": None, "error": None}
# One synthesis at a time: the engine keeps a small checkpoint cache and the GPU
# is shared, so concurrent requests would thrash memory and the LRU slot.
SPEAK_LOCK = threading.Lock()


def log(msg, *args):
    LOG.info(msg, *args)
    sys.stdout.flush()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "sovits-tts/1.0"

    # ---- helpers
    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _wav(self, audio, sample_rate: int) -> None:
        body = engine.wav_bytes(audio, sample_rate)
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def log_message(self, fmt, *args):  # one line per request, so callers are visible
        LOG.info("http %s - %s", self.address_string(), fmt % args)

    # ---- routes
    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        path = url.path.rstrip("/") or "/"
        if path in ("/health", "/"):
            eng = STATE["engine"]
            voices = [
                {"id": v["id"], "name": v["name"], "checkpoint": os.path.basename(v["checkpoint"])}
                for v in (eng.voices.values() if eng else [])
            ]
            return self._json(
                200,
                {
                    "ok": bool(eng),
                    "ready": STATE["ready"],
                    "warm": STATE["warm"],
                    "error": STATE["error"],
                    "device": str(eng.device) if eng else None,
                    "voices": voices,
                    "sourceVoices": engine.EDGE_VOICES,
                },
            )
        if path == "/speak":
            text = (query.get("text") or [""])[0]
            voice = (query.get("voice") or [None])[0]
            return self._speak(text, voice)
        return self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path.rstrip("/") or "/"
        body = self._body_json()
        if path == "/speak":
            return self._speak(body.get("text") or "", body.get("voice"), body)
        if path == "/warm":
            return self._warm(body.get("voice"))
        if path == "/shutdown":
            self._json(200, {"ok": True, "stopping": True})
            threading.Thread(target=self._stop, daemon=True).start()
            return None
        return self._json(404, {"ok": False, "error": "not found"})

    def _stop(self) -> None:
        """Answer first, then leave; the Host half polls /health to confirm."""
        try:
            self.wfile.flush()
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.2)
        os._exit(0)

    def _speak(self, text: str, voice, body: dict | None = None):
        body = body or {}
        if not (text or "").strip():
            return self._json(400, {"ok": False, "error": "empty text"})
        eng = STATE["engine"]
        if eng is None:
            return self._json(503, {"ok": False, "error": STATE["error"] or "engine not ready"})
        pitch = body.get("pitch")
        rate = body.get("rate")
        max_chars = body.get("maxChars")
        try:
            started = time.time()
            with SPEAK_LOCK:
                audio, sr = eng.speak(
                    text,
                    voice_id=voice,
                    pitch=int(pitch) if pitch is not None else None,
                    source_voice=body.get("sourceVoice"),
                    rate=int(rate) if rate is not None else None,
                    **(
                        {"max_chars": int(max_chars)}
                        if isinstance(max_chars, (int, float)) and max_chars > 0
                        else {}
                    ),
                )
            log("speak voice=%s chars=%d rate=%s pitch=%s audio=%.2fs took=%.2fs", voice, len(text), rate, pitch, len(audio) / sr, time.time() - started)
            return self._wav(audio, sr)
        except Exception as exc:  # noqa: BLE001 - keep the worker alive
            LOG.error("speak failed: %s\n%s", exc, traceback.format_exc())
            return self._json(500, {"ok": False, "error": f"{type(exc).__name__}: {exc}"})

    def _warm(self, voice):
        eng = STATE["engine"]
        if eng is None:
            return self._json(503, {"ok": False, "error": STATE["error"] or "engine not ready"})
        vid = voice or next(iter(eng.voices))
        try:
            with SPEAK_LOCK:
                eng._voice_model(vid)  # noqa: SLF001 - deliberate warm-up hook
                eng.warmup(vid)
            STATE["warm"] = vid
            return self._json(200, {"ok": True, "warm": vid})
        except Exception as exc:  # noqa: BLE001
            return self._json(500, {"ok": False, "error": f"{type(exc).__name__}: {exc}"})


def boot(warm_voice: str | None):
    try:
        t0 = time.time()
        STATE["engine"] = engine.Engine()
        STATE["ready"] = True
        log("engine ready in %.1fs device=%s voices=%s", time.time() - t0, STATE["engine"].device, list(STATE["engine"].voices))
        target = warm_voice or next(iter(STATE["engine"].voices))
        try:
            with SPEAK_LOCK:
                STATE["engine"]._voice_model(target)  # noqa: SLF001
            STATE["warm"] = target
            log("warmed voice %s", target)
        except Exception as exc:  # noqa: BLE001
            LOG.error("warm-up failed: %s", exc)
        try:
            with SPEAK_LOCK:
                STATE["engine"].warmup(target)
        except Exception as exc:  # noqa: BLE001
            LOG.warning("conversion warmup failed: %s", exc)
    except Exception as exc:  # noqa: BLE001
        STATE["error"] = f"{type(exc).__name__}: {exc}"
        LOG.error("engine boot failed: %s\n%s", exc, traceback.format_exc())
        sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("SOVITS_TTS_PORT", 8765)))
    parser.add_argument("--warm", default=None)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"LISTENING http://{args.host}:{args.port}", flush=True)
    threading.Thread(target=boot, args=(args.warm,), daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("worker stopped", flush=True)


if __name__ == "__main__":
    main()
