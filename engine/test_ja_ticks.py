"""Check the Latin -> Japanese tick rewrite and the Japanese-voice segments."""

import sys
import time

import numpy as np

import engine as E


def main() -> int:
    samples = [
        "知道啦 desuwa 不过别回头嫌我自己听着别扭。",
        "在 desuwa 叫我做什么 desuwa",
        "平时不带口癖的一句话，看看有没有被误改。",
        "这句里的 DESUWA 和 desu  wa 都要改。",
        "这样也可以 desu no 还有 desuno 这两种写法。",
        "真的很难办 nanodesu 我尽力了。",
        "句尾挂个 desu 看看会不会被误伤。",
        "已经写成日文了：ですわ 和 ですの 都要保留。",
    ]
    for line in samples:
        norm = E.normalize_ja_ticks(line)
        parts = E.split_ja_segments(norm)
        print(f"in   : {line}")
        print(f"norm : {norm}")
        print(f"parts: {parts}")
        print()

    eng = E.Engine()
    text = "知道啦 desuwa 不过别回头嫌我自己听着别扭。"
    started = time.time()
    audio, sr = eng.speak(text, voice_id="yuuka", pitch=0, rate=0)
    took = time.time() - started
    dur = audio.size / sr
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    print(f"speak ok sr={sr} dur={dur:.2f}s peak={peak:.3f} took={took:.2f}s")
    E.sf.write("test_ja_ticks.wav", audio, sr, format="WAV", subtype="PCM_16")
    print("wrote test_ja_ticks.wav")
    if dur < 1.0 or peak < 0.05:
        print("FAIL: audio looks empty")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
