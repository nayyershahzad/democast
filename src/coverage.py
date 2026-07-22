#!/usr/bin/env python3
"""Fail if the scene file and a human-facing script have drifted apart.

Only runs when config coverage.mode == "numbered". The script (e.g. docs/DEMO_SCRIPT.md)
is what a presenter reads; demo.yaml is what the robot does. They may differ in *how*,
never in *which numbered steps exist*. A scene cites steps with `steps: [3, 4]`.
"""
import os, re, pathlib, sys, yaml

CONFIG = pathlib.Path(os.environ["DEMOCAST_CONFIG"])
SCENES = pathlib.Path(os.environ["DEMOCAST_SCENES"])


def main() -> int:
    cfg = yaml.safe_load(CONFIG.read_text())
    cov = cfg.get("coverage", {})
    if cov.get("mode", "off") != "numbered":
        print("  coverage: off"); return 0
    script = (CONFIG.parent / cov["script"]).resolve()
    if not script.exists():
        print(f"FAIL  coverage.script not found: {script}"); return 1

    steps = {int(m) for m in re.findall(r'^(\d+)\.\s', script.read_text(), re.M)}
    scn = yaml.safe_load(SCENES.read_text())
    covered, cited = set(), []
    for act in scn["acts"]:
        for sc in act["scenes"]:
            for s in sc.get("steps", []):
                cited.append((sc["id"], s))
                if s:                     # 0 = un-numbered prose (an intro/outro)
                    covered.add(s)
    missing = sorted(steps - covered)
    phantom = sorted({s for _, s in cited if s and s not in steps})
    if missing:
        print(f"FAIL  script steps with no scene: {missing}")
    if phantom:
        print(f"FAIL  scenes citing steps that no longer exist: {phantom}")
    if not missing and not phantom:
        print(f"ok    {len(covered)}/{len(steps)} script steps covered by {len(cited)} scene refs")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
