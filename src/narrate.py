#!/usr/bin/env python3
"""Synthesise every scene's narration FIRST, and measure it.

The measured duration becomes the scene's on-screen hold, so the recording is paced by
the voice rather than the other way round. Also emits nothing but a manifest the recorder
and muxer both read. Env contract (set by the CLI):

  DEMOCAST_CONFIG   path to democast.config.yaml
  DEMOCAST_SCENES   path to demo.yaml
  DEMOCAST_BUILD    build dir (durations.json + audio/ land here)
  DEMOCAST_TTS      tts dir (venv/ + voices/)
"""
import json, os, pathlib, subprocess, sys, yaml

CONFIG = pathlib.Path(os.environ["DEMOCAST_CONFIG"])
SCENES = pathlib.Path(os.environ["DEMOCAST_SCENES"])
BUILD  = pathlib.Path(os.environ["DEMOCAST_BUILD"])
# A venv keeps its programs in Scripts/ on Windows, bin/ elsewhere.
BIN = "Scripts" if os.name == "nt" else "bin"
TTS    = pathlib.Path(os.environ["DEMOCAST_TTS"])
PIPER  = TTS / "venv" / BIN / "piper"
OUT    = BUILD / "audio"


def dur(p: pathlib.Path) -> float:
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(p)], capture_output=True, text=True).stdout.strip())


def main() -> int:
    cfg = yaml.safe_load(CONFIG.read_text())
    scn = yaml.safe_load(SCENES.read_text())
    voices = cfg.get("voices", {})
    if "default" not in voices:
        print("FAIL  config voices: needs a `default:` entry"); return 1
    only = {a.strip() for a in sys.argv[1].split(',')} if len(sys.argv) > 1 and sys.argv[1] else None
    OUT.mkdir(parents=True, exist_ok=True)

    manifest = {}
    for act in scn["acts"]:
        if only and act["name"] not in only:
            continue
        for sc in act["scenes"]:
            # a scene may name a voice from the config map; else the default
            voice_key = sc.get("voice", "default")
            voice = voices.get(voice_key, voices["default"])
            model = TTS / "voices" / f"{voice}.onnx"
            if not model.exists():
                print(f"FAIL  voice not installed: {voice}  (run: npx democast voices --get {voice})")
                return 1
            text = " ".join(sc["say"].split())
            wav = OUT / f"{sc['id']}.wav"
            subprocess.run([str(PIPER), "-m", str(model), "-f", str(wav)],
                           input=text, text=True, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            manifest[sc["id"]] = {"act": act["name"], "wav": str(wav),
                                  "seconds": round(dur(wav), 2), "text": text}
            print(f"  {sc['id']:<18} {manifest[sc['id']]['seconds']:>6.2f}s  {voice}")

    path = BUILD / "durations.json"
    existing = json.loads(path.read_text()) if path.exists() else {}
    existing.update(manifest)
    path.write_text(json.dumps(existing, indent=2, ensure_ascii=False))
    total = sum(v["seconds"] for v in existing.values())
    print(f"  narration total: {total/60:.1f} min across {len(existing)} scenes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
