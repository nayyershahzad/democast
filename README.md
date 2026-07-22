# democast

**Shy to make a demo video of your work? Don't.** Let the AI model that's already coding
your app write a `demo.yaml` as it goes. Pick a language and a voice. Run one command.
Out comes a narrated screen-recording of your product — real UI, real data, spoken
walkthrough, captions.

```bash
npx democast init      # scaffold config + demo.yaml + AGENTS.md
npx democast wizard    # pick your language + voice (offline, free)
npx democast render    # → .democast/build/out/master.mp4
```

https://github.com/nayyershahzad/democast

---

## Why it's different

- **Model-independent by design.** The intelligence is your coding agent (Claude, GPT,
  Gemini, local, or you) writing a plain YAML file. The renderer is deterministic and
  calls no LLM. Point *any* assistant at `AGENTS.md` and it maintains your demo for you.
- **Offline & free.** Narration is [Piper](https://github.com/rhasspy/piper) TTS running
  locally — dozens of languages, no API key, no per-render cost, nothing leaves your box.
- **Paced by the voice.** Each scene is held for exactly as long as its narration takes,
  so audio and video line up with zero manual timing. Write more, the scene lasts longer.
- **It refuses to lie.** A scene can declare `expect:` — text that must be on screen while
  its line plays. Film the wrong screen and the run fails loudly instead of shipping a
  confident voice-over over a login page.

## Two ways in

**Cold start on an existing app.** Say to your assistant: *"demo time — read the codebase
and use democast to make a demo."* It runs `init`, reads your routes/components/login flow
to author `demo.yaml` from scratch, then `check` → `render`. The recipe it follows is in
[`AGENTS.md`](AGENTS.md) — that file ships in your repo so any model can pick it up.

**As-you-build.** The agent maintains `demo.yaml` alongside the code, like tests, so a
fresh video is always one command away.

## How it fits your workflow

You don't storyboard. Your AI does, continuously:

1. You (or your agent) run `npx democast init`. It drops an **`AGENTS.md`** into your repo.
2. Every time the agent adds a feature, it adds/updates a scene in `demo.yaml` — same
   discipline as tests.
3. Ask *"is it demo-ready?"* → the agent runs `npx democast check` (fast, no recording)
   and tells you coverage passed and the narration measures to N minutes.
4. `npx democast render` → a master `.mp4` + `.srt` captions.

## What you write

```yaml
# demo.yaml
acts:
  - name: The dashboard
    needsAuth: true
    scenes:
      - id: dashboard
        say: "Every release your team shipped, on one timeline."
        expect: ["Releases"]
        actions:
          - goto: /app
          - wait: 3500
```

Full schema: [`docs/SCHEMA.md`](docs/SCHEMA.md). The agent contract: [`AGENTS.md`](AGENTS.md).

## Requirements

- Node 18+
- `ffmpeg` on your PATH (`brew install ffmpeg` / `apt install ffmpeg`)
- `python3` (the wizard builds a local Piper venv for you)

`npx democast doctor` checks all of the above and installs the browser + voices.

## Commands

| Command | Does |
|---|---|
| `democast init` | scaffold `democast.config.yaml`, `demo.yaml`, `democast.actions.mjs`, `AGENTS.md` |
| `democast wizard` | interactive language/voice pick, fetch the voice, patch the config |
| `democast doctor` | verify ffmpeg/piper/browser; install what's missing |
| `democast voices [--get <id>]` | list common voices; download one |
| `democast check` | coverage + narration dry-run — is the script demo-ready? (no recording) |
| `democast render [--acts "A,B"] [--no-hooks]` | the whole pipeline → `master.mp4` |

## A note on music

Narration needs no music. If you add a bed (`music:` in the config), **you** are
responsible for its licence — "CC0" tags on aggregator sites are frequently wrong, and
share-alike licences are viral on a customer video. Default is off, deliberately.

## Credits

Built out of the demo-video tool ENGSTECH made for [ExpoOS](https://expoos.engstech.com).
MIT licensed. Piper voices are permissively licensed by the [rhasspy/piper](https://github.com/rhasspy/piper) project.
