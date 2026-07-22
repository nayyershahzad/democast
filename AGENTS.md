# AGENTS.md — how to keep `demo.yaml` in sync while you build

**You are the coding agent. This file is your job description for demo videos.**
The human you work with wants a narrated demo video of this app at any moment, without
ever writing a storyboard. That is your job, done a little at a time as you code.

This works with **any** model or assistant — Claude, GPT, Gemini, a local model, or a
human. Nothing here calls an LLM API. You write a plain YAML file; a deterministic tool
(`democast`) turns it into a video. The intelligence is you; the renderer is dumb on
purpose.

## Your standing instructions

1. **Maintain `demo.yaml`.** Whenever you add or change a user-facing feature, add or
   update the scene that shows it. Treat `demo.yaml` like tests: it rots if you ignore it.
2. **Keep narration speakable.** Each scene's `say:` is read aloud by a text-to-speech
   voice and its spoken length becomes how long that screen is held. So: short sentences,
   no parentheses, no "e.g.", no URLs read aloud. Spell out anything TTS mangles
   ("PKR 34,020" → "thirty four thousand and twenty rupees").
3. **Drive the real UI.** Actions use real selectors (button names, placeholders) from the
   app you just built. If you renamed a button, fix the scene that clicks it.
4. **Add an `expect:`** to any scene where landing on the wrong screen would be
   embarrassing. It is text that must be visible while the line plays; the render fails
   loudly if it is not. This is the single most valuable habit — it stops the tool
   narrating the login page while claiming to show the dashboard.
5. **Tell the human when it is demo-ready.** After a meaningful change, run
   `npx democast check` (fast, no recording) and report: coverage passed, narration
   measures to N minutes, ready to record — or exactly what is out of sync.

## Cold start: "demo time — look at the codebase and make a demo"

The common case is a codebase that already exists, with **no `demo.yaml` yet**. You author
one by reading the repo. Do this, in order:

1. **Confirm the app runs** and note its URL/port (check `package.json` scripts, a
   `docker-compose.yml`, a `Procfile`, a `README`). Put it in `baseUrl`.
2. **Enumerate the routes.** Find the router (Next.js `app/`/`pages/`, React Router,
   Django/Rails/FastAPI routes, etc.). The user-facing pages become your acts, roughly in
   the order a first-time user meets them: landing → sign up → the core loop → an admin/ops
   view → close.
3. **Read the real selectors.** For each page you'll film, open its component and copy the
   exact button labels and input placeholders into `clickRole`/`fillPlaceholder`. Do **not**
   guess — a wrong label is caught at render, but you can avoid the round-trip.
4. **Find the login flow** if any page needs auth: the login route, the email/password
   fields, the submit button, and where credentials come from (an `.env`, a seed script,
   test fixtures). Fill in the `auth:` block and mark those acts `needsAuth: true`. Read
   credentials from env vars — never inline a password.
5. **Find the seed/reset command** (`make seed`, `npm run db:reset`, a fixtures script) and
   wire it to `hooks.before` so the demo is repeatable and doesn't consume live data.
6. **Pick the story, not every screen.** A demo is 4–6 acts that show the product's point,
   not a click-through of the whole app. Prefer the happy path a buyer would care about.
7. **Guard the risky scenes** with `expect:` (dashboards, post-login pages, anything data-
   dependent), then `npx democast check` and iterate until it's green.

Then tell the human the story you chose and that it's ready to `render`. If you invented
any demo data (names, emails), say so.

**If it's a canvas app (Flutter, Unity, a `<canvas>` game):** there's no DOM — the page is
one painted surface (a giveaway: `document.body.innerText` is empty, or you see
`<flt-glass-pane>`/`<flutter-view>`). Set `mode: canvas` in the config and author scenes
with `tapText:` (OCR finds the label) and `tap: {x,y}` fractions for fixed buttons; pick
`expect:` anchors that are dark titles, not light button text. There's no login form to
drive, so capture a session once and point `auth.storageState` at it. Full guidance in
`docs/SCHEMA.md` under "Canvas mode".

## The full loop

```
npx democast init        # once — scaffolds config + demo.yaml + this file
npx democast wizard      # once — human picks language + voice
# ...you build features and edit demo.yaml as you go...
npx democast check       # you run this often; it is cheap
npx democast render      # produces .democast/build/out/master.mp4
```

## Authoring rules that matter

- **One scene = one idea on one screen.** If a beat needs two screens, make it two scenes.
- **`id` is stable and unique.** Re-rendering a single act keys off it; don't churn ids.
- **Order is presentation order.** Acts and scenes render top-to-bottom into the master cut.
- **`needsAuth: true`** on an act signs in off-camera and reuses the session — never script
  a visible login unless the login screen itself is the thing being shown.
- **Never invent selectors.** If you're unsure a button says "Publish", open the component
  and check. A wrong selector is caught at render time, but `expect:` catches it earlier.
- **Data that a run consumes** (a booking, a signup) should be reset by the `hooks.before`
  command in the config, so the demo is repeatable. Wire that hook to the app's seed script.
- **Custom verbs** (pick a live row, jump to a generated URL) go in `democast.actions.mjs`,
  not hardcoded ids that a previous run may have used up. See that file's examples.

## When the human asks "make a demo video"

1. Make sure the app is running and reachable at `baseUrl` in `democast.config.yaml`.
2. `npx democast check` — fix anything it reports.
3. `npx democast render`.
4. Point them at `.democast/build/out/master.mp4`, and tell them to skim
   `master.srt` to proofread the narration.

Full field reference: `docs/SCHEMA.md`.
