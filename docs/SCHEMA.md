# `demo.yaml` schema

One file. Your coding agent writes it and keeps it in sync with the app. The renderer
reads it top to bottom and produces one video per act plus a concatenated master cut.

```yaml
acts:
  - name: <string>          # act title; also the video filename (slugified)
    needsAuth: <bool>       # optional; sign in off-camera and reuse the session
    scenes:
      - id: <string>        # stable, unique; keys per-scene audio + single-act re-render
        say: <string>       # narration, read aloud by TTS. Its length = the on-screen hold.
        voice: <string>     # optional; a key from config `voices` (default: "default")
        expect: [<string>]  # optional; text that MUST be on screen, or the run fails
        steps: [<int>]      # optional; script step numbers, only used if coverage is on
        actions: [<action>] # ordered list; run before the hold begins
```

## Actions (built in)

Each action is a single-key map. Runs in order; failures are logged, not fatal (except a
failed `expect:`).

| Action | Form | Does |
|---|---|---|
| `goto` | `goto: /path` | navigate to `baseUrl + path`. Supports `{{var}}`. |
| `wait` | `wait: 2000` | pause N ms (let animations/data settle) |
| `press` | `press: Enter` | keyboard key |
| `clickText` | `clickText: Sign up` | click first element containing this text |
| `clickRole` | `clickRole: { role: button, name: "Publish" }` | click by ARIA role + name. Add `optional: true` to skip if absent, `nth: 0` to disambiguate. |
| `clickLast` | `clickLast: { role: button, name: "Re-issue" }` | click the last match (dialogs over lists) |
| `clickTitle` | `clickTitle: { title: "force overdue" }` | click by `title` attribute substring |
| `fill` | `fill: { selector: "#email", value: "a@b.io" }` | fill by CSS selector. Supports `{{var}}`. |
| `fillPlaceholder` | `fillPlaceholder: { placeholder: "Email", value: "a@b.io" }` | fill by placeholder. Supports `{{var}}`. |
| `captureText` | `captureText: { as: ref, pattern: "INV-\\d+" }` | stash a match from the page into `{{ref}}` for later scenes |

## Canvas mode (Flutter, Unity, `<canvas>` apps)

Apps that paint to a canvas expose **no DOM** — Playwright can't see text, buttons, or
placeholders, so the DOM verbs above don't work. Set `mode: canvas` (in config, or per-act
with `mode: canvas`) and democast drives by **screenshot + OCR** instead. Requires the
`tesseract` binary (`apt install tesseract-ocr` / `brew install tesseract`).

Canvas contexts render at 2× so OCR can read the text, and `expect:` is verified by OCR'ing
the frame rather than reading the DOM.

| Action | Form | Does |
|---|---|---|
| `tapText` | `tapText: { text: "Continue", nth?, dy? }` | OCR the frame, click the centre of that label. `dy` nudges the click (e.g. to hit a field below its label). |
| `tap` | `tap: { x: 0.5, y: 0.92 }` | click a point. Values ≤ 1 are fractions of the viewport (resolution-independent); larger are pixels. Use for fixed chrome like a full-width bottom button. |
| `type` | `type: "hello"` | type into the focused field (after a `tapText`/`tap`) |
| `waitText` | `waitText: { text: "Done", timeout: 30000 }` | poll OCR until the text appears (or timeout). Use for async content — a network load, a transcription, a job result. |
| `playSound` | `playSound: ./assets/clip.wav` | mix a sound into the final audio at this exact moment — e.g. the speech a mic feature is "hearing", a notification chime. Not a browser action; it's a marker the muxer honours. Works in DOM mode too. |
| `goto` `wait` `press` | as above | also available |

### Driving a microphone / camera feature

To film a voice or camera feature actually working, feed a media file as the device via the
`browser:` config and grant permission:

```yaml
browser:
  fakeAudio: ./assets/spoken.wav   # played as the microphone (16-bit PCM WAV)
  permissions: [microphone]        # or [camera], [geolocation], ...
  args: []                         # extra Chromium flags if needed
```

Then a scene taps the mic, waits while the file plays, taps stop, and `waitText:` waits for
the transcript to land. (Tip: Piper — the same TTS democast narrates with — can synthesize
the spoken input.)

**Authoring tips for canvas mode.** OCR reads dark text on light backgrounds most
reliably; it can miss light text on coloured buttons. So: pick `expect:` anchors that are
**titles/labels**, not button text; tap fixed-position buttons with `tap:` fractions and
content/list items with `tapText:`. Since there's no DOM login form, reuse a captured
session via `auth.storageState` rather than scripting the sign-in.

## Actions (custom)

Anything not built in is looked up in your `democast.actions.mjs` plugin. Use this for
domain verbs — pick a row that's free *right now* from your API, open a URL built from a
captured value, walk a 3D scene. Signature and examples are in the generated
`democast.actions.mjs`.

## Pacing model

The narration is synthesised and measured **first**. A scene is held on screen for
`max(spoken length, minHoldMs)`; its actions run inside that window, and any leftover time
sits on the finished screen — exactly what a presenter does while talking. This is why you
never set durations by hand: write a longer `say:` and the scene automatically lasts
longer. A 25-minute walkthrough and a 4-minute teaser differ only in how much you write.

## Config reference

See `democast.config.yaml` — every field is commented. Highlights:

- `baseUrl` — the running app the robot drives.
- `voices` — a map of names → Piper voice ids; `default` is required. Scenes pick one with `voice:`.
- `auth` — selectors + env-var names for an off-camera sign-in (password never filmed, never on a command line).
- `hooks.before` / `hooks.after` — shell commands to seed/reset demo data around a render.
- `music` — path to a licensed wav to duck under narration, or `false`.
- `coverage` — optionally cross-check `demo.yaml` against a human script so they can't drift.
