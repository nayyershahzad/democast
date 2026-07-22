#!/usr/bin/env python3
"""Create the piper venv and download voices. Env: DEMOCAST_TTS (tts dir).

Usage:
  voices.py setup <voice> [<voice> ...]   ensure venv + download these voices
  voices.py get <voice>                   download one more voice
"""
import os, pathlib, subprocess, sys

TTS = pathlib.Path(os.environ["DEMOCAST_TTS"])
VENV = TTS / "venv"
PY = VENV / "bin" / "python"
VOICES = TTS / "voices"


def ensure_venv():
    if not (VENV / "bin" / "piper").exists():
        print("  creating piper venv (one-time)…")
        subprocess.run(["python3", "-m", "venv", str(VENV)], check=True)
        subprocess.run([str(VENV / "bin" / "pip"), "install", "-q", "--upgrade", "pip"], check=True)
        subprocess.run([str(VENV / "bin" / "pip"), "install", "-q", "piper-tts", "pyyaml"], check=True)


def get(voice: str):
    VOICES.mkdir(parents=True, exist_ok=True)
    if (VOICES / f"{voice}.onnx").exists():
        print(f"  have {voice}"); return
    print(f"  downloading {voice}…")
    subprocess.run([str(PY), "-m", "piper.download_voices", voice, "--data-dir", str(VOICES)], check=True)


def main() -> int:
    if subprocess.run(["ffmpeg", "-version"], capture_output=True).returncode != 0:
        print("FAIL  ffmpeg not found on PATH — install it first (brew/apt install ffmpeg)")
        return 1
    cmd = sys.argv[1] if len(sys.argv) > 1 else "setup"
    ensure_venv()
    for v in sys.argv[2:]:
        get(v)
    print(f"  ok — voices in {VOICES}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
