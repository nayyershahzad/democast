#!/usr/bin/env python3
"""Mux each act's silent capture with its narration, then concat a master + captions.

Per-act audio is the act's scene wavs laid end to end with the same gap the recorder
held, so the track matches the picture without any stretching. Env contract matches
narrate.py (DEMOCAST_CONFIG / DEMOCAST_SCENES / DEMOCAST_BUILD).
"""
import json, os, pathlib, subprocess, sys, yaml

CONFIG = pathlib.Path(os.environ["DEMOCAST_CONFIG"])
SCENES = pathlib.Path(os.environ["DEMOCAST_SCENES"])
B      = pathlib.Path(os.environ["DEMOCAST_BUILD"])
OUT    = B / "out"
OUT.mkdir(parents=True, exist_ok=True)


def run(*a):
    subprocess.run(a, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def probe(p) -> float:
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0",
         str(p)], capture_output=True, text=True).stdout.strip() or 0)


def srt_time(t):
    h, r = divmod(t, 3600); m, s = divmod(r, 60)
    return f"{int(h):02}:{int(m):02}:{int(s):02},{int((s%1)*1000):03}"


def main():
    cfg  = yaml.safe_load(CONFIG.read_text())
    scn  = yaml.safe_load(SCENES.read_text())
    durs = json.loads((B / "durations.json").read_text())
    offs = json.loads((B / "offsets.json").read_text()) if (B / "offsets.json").exists() else {}
    snds = json.loads((B / "sounds.json").read_text()) if (B / "sounds.json").exists() else {}
    gap  = cfg.get("gapMs", 250) / 1000
    only = {a.strip() for a in sys.argv[1].split(',')} if len(sys.argv) > 1 and sys.argv[1] else None
    made = []   # (act_name, mp4) in order — includes acts not re-rendered this run

    for act in scn["acts"]:
        slug = act["name"].lower().replace(" ", "-")
        vid = B / "video" / f"{slug}.webm"
        if only and act["name"] not in only:
            if (OUT / f"{slug}.mp4").exists():
                made.append((act["name"], OUT / f"{slug}.mp4"))
            continue
        if not vid.exists():
            print(f"  skip {slug}: no capture"); continue

        # Place each scene's narration at the offset the recorder measured (when that
        # scene's actions finished), so the voice lands on the settled screen rather than
        # over a boot/loading frame. adelay shifts each clip; amix sums the non-overlapping
        # clips into one track. Falls back to back-to-back if no offsets were recorded.
        clips = [(sc["id"], B / "audio" / f"{sc['id']}.wav") for sc in act["scenes"]]
        clips = [(sid, w) for sid, w in clips if w.exists()]
        if not clips:
            print(f"  skip {slug}: no narration"); continue
        a_wav = B / f"{slug}.wav"
        if all(sid in offs for sid, _ in clips):
            # (offset_ms, wav): narration clips + any diegetic sounds for this act,
            # each delayed to its offset and summed. Non-overlapping, so no ducking needed.
            pieces = [(int(round(offs[sid] * 1000)), w) for sid, w in clips]
            pieces += [(int(round(s["at"] * 1000)), pathlib.Path(s["file"]))
                       for s in snds.get(act["name"], [])]
            inputs, filt = [], []
            for i, (ms, w) in enumerate(pieces):
                inputs += ["-i", str(w)]
                filt.append(f"[{i}:a]aresample=22050,adelay={ms}|{ms}[a{i}]")
            labels = "".join(f"[a{i}]" for i in range(len(pieces)))
            filt.append(f"{labels}amix=inputs={len(pieces)}:normalize=0:dropout_transition=0[out]")
            run("ffmpeg", "-v", "error", *inputs, "-filter_complex", ";".join(filt),
                "-map", "[out]", str(a_wav), "-y")
        else:
            sil = B / "silence.wav"
            if not sil.exists():
                run("ffmpeg", "-v", "error", "-f", "lavfi", "-i",
                    "anullsrc=r=22050:cl=mono", "-t", str(gap), str(sil), "-y")
            listing = B / f"{slug}-audio.txt"
            parts = []
            for sid, w in clips:
                parts += [f"file '{w}'", f"file '{sil}'"]
            listing.write_text("\n".join(parts))
            run("ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
                "-c", "copy", str(a_wav), "-y")

        # Optional music bed, DUCKED by the narration (voice keys a sidechain compressor).
        bed_src = cfg.get("music")
        if bed_src:
            bed = pathlib.Path(bed_src)
            if not bed.is_absolute():
                bed = CONFIG.parent / bed
            mixed = B / f"_mix_{slug}.wav"
            run("ffmpeg", "-v", "error", "-i", str(a_wav), "-stream_loop", "-1",
                "-i", str(bed), "-filter_complex",
                "[0:a]aformat=channel_layouts=mono,volume=1.0,asplit=2[vkey][vmix];"
                "[1:a]aformat=channel_layouts=mono,volume=0.35[bed];"
                "[bed][vkey]sidechaincompress=threshold=0.05:ratio=9:attack=8:release=420[ducked];"
                "[ducked][vmix]amix=inputs=2:normalize=0:duration=first[out]",
                "-map", "[out]", str(mixed), "-y")
            a_wav = mixed

        mp4 = OUT / f"{slug}.mp4"
        # Pad the audio, never trim the video: actions often run longer than their line,
        # and a bare -shortest would cut the PICTURE down to the narration.
        run("ffmpeg", "-v", "error", "-i", str(vid), "-i", str(a_wav),
            "-af", "apad", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-shortest",
            str(mp4), "-y")
        made.append((act["name"], mp4)); print(f"  ✓ {mp4.name}")

    if made:
        lst = B / "master.txt"
        lst.write_text("\n".join(f"file '{m}'" for _, m in made))
        run("ffmpeg", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
            "-c", "copy", str(OUT / "master.mp4"), "-y")

        by_name = {a["name"]: a for a in scn["acts"]}
        srt, clock, n = [], 0.0, 1
        for name, mp4 in made:
            start = clock
            for sc in by_name[name]["scenes"]:
                if sc["id"] in durs:
                    d = durs[sc["id"]]["seconds"]
                    # caption starts where the narration actually plays (its offset)
                    at = start + offs.get(sc["id"], 0.0)
                    srt.append((n, at, at + d, durs[sc["id"]]["text"])); n += 1
            clock = start + probe(mp4)        # trust the picture, not the audio sum
        (OUT / "master.srt").write_text("\n".join(
            f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{t}\n" for i, a, b, t in srt))
        print(f"  ✓ master.mp4 ({len(made)} acts)  + master.srt   → {OUT}")


if __name__ == "__main__":
    sys.exit(main())
