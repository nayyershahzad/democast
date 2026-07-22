// Drive the running app per the scene file and capture one video per act.
//
// Generic engine: everything app-specific comes from democast.config.yaml (baseUrl,
// auth, hooks) or the optional actions plugin. Pacing comes from durations.json — each
// scene is held for exactly as long as its narration takes, so audio and video line up
// without any post-hoc stretching. A scene's actions run first; the leftover time is
// spent sitting on the finished screen, which is what a presenter does while talking.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { parse } from 'yaml';
import { ocrFind, ocrText } from './ocr.mjs';

const BUILD   = process.env.DEMOCAST_BUILD;
const CONFIG  = process.env.DEMOCAST_CONFIG;
const SCENES  = process.env.DEMOCAST_SCENES;
const only    = process.env.DEMOCAST_ACTS ? new Set(process.env.DEMOCAST_ACTS.split(',').map(s => s.trim())) : null;

const cfg   = parse(readFileSync(CONFIG, 'utf8'));
const scn   = parse(readFileSync(SCENES, 'utf8'));
const durs  = JSON.parse(readFileSync(`${BUILD}/durations.json`, 'utf8'));
const BASE  = (process.env.PUBLIC_URL || cfg.baseUrl || '').replace(/\/$/, '');
const VP    = cfg.viewport || { width: 1600, height: 900 };
const MIN_HOLD = cfg.minHoldMs ?? 900;
const GAP      = cfg.gapMs ?? 250;
const CANVAS_DEFAULT = cfg.mode === 'canvas';   // Flutter/Unity/<canvas>: no DOM, drive by OCR

// Optional browser config. `fakeAudio` feeds a WAV as the microphone (so a voice feature
// can actually run on camera); `permissions` grants e.g. microphone; `args` passes extra
// Chromium flags. All optional.
const BROWSER = cfg.browser || {};
const launchArgs = [...(BROWSER.args || [])];
if (BROWSER.fakeAudio) {
  const fa = resolve(dirname(CONFIG), BROWSER.fakeAudio);
  launchArgs.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
                  `--use-file-for-fake-audio-capture=${fa}`);
}
const VID   = `${BUILD}/video`;
mkdirSync(VID, { recursive: true });

// Shared state across scenes: captured refs, ids, anything a custom verb stows.
const vars = {};
const failures = [];
// Per-scene video offset (seconds from its act's start) where its narration should begin.
const OFFSETS = `${BUILD}/offsets.json`;
const offsets = existsSync(OFFSETS) ? JSON.parse(readFileSync(OFFSETS, 'utf8')) : {};
// Diegetic sounds to mix into the final track at the moment they were triggered
// (e.g. the audio a mic feature is "hearing"). Keyed by act name → [{file, at}].
const SOUNDS = `${BUILD}/sounds.json`;
const sounds = existsSync(SOUNDS) ? JSON.parse(readFileSync(SOUNDS, 'utf8')) : {};

// Load the optional custom-actions plugin, resolved relative to the config file.
let plugins = {};
if (cfg.actions) {
  const p = resolve(dirname(CONFIG), cfg.actions);
  plugins = (await import(pathToFileURL(p).href)).default || {};
  console.log(`  actions plugin: ${Object.keys(plugins).join(', ') || '(none exported)'}`);
}

// Substitute {{var}} in a string from the shared vars bag.
const fill = s => typeof s === 'string' ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '') : s;

// Resolve an x/y that may be a fraction (0..1 → share of the viewport) or a raw pixel.
const px = (n, span) => (n > 0 && n <= 1 ? n * span : n);

async function act(page, a, canvas) {
  const [k, raw] = Object.entries(a)[0];
  const v = raw;
  // ---- canvas-mode verbs (Flutter/Unity/<canvas>): no DOM, so click by pixel or by OCR ----
  if (canvas) {
    switch (k) {
      case 'tap': {                         // { x, y }  — fraction (0..1) or pixels
        await page.mouse.click(px(v.x, VP.width), px(v.y, VP.height));
        return;
      }
      case 'tapText': {                     // { text, nth?, dy? } — OCR the frame, click the label
        const box = await ocrFind(page, v.text, v.nth || 0);
        if (!box) throw new Error(`OCR could not find "${v.text}"`);
        await page.mouse.click(box.cx, box.cy + (v.dy || 0));
        return;
      }
      case 'type':        return page.keyboard.type(String(fill(v)), { delay: 45 });
      case 'waitText': {                    // poll OCR until text appears (async content)
        const to = v.timeout || 30000, t0 = Date.now();
        while (Date.now() - t0 < to) {
          if ((await ocrText(page)).includes(String(v.text).toLowerCase())) return;
          await page.waitForTimeout(1500);
        }
        console.log(`      waitText "${v.text}" timed out after ${to}ms`);
        return;
      }
      case 'goto':        return page.goto(BASE + fill(v), { waitUntil: 'domcontentloaded' });
      case 'wait':        return page.waitForTimeout(v);
      case 'press':       return page.keyboard.press(v);
      default:
        if (plugins[k]) return plugins[k]({ page, base: BASE, vars, request: page.request }, v);
        throw new Error(`unknown canvas action ${k}`);
    }
  }
  // ---- DOM-mode verbs ----
  switch (k) {
    case 'goto':        return page.goto(BASE + fill(v), { waitUntil: 'domcontentloaded' });
    case 'wait':        return page.waitForTimeout(v);
    case 'press':       return page.keyboard.press(v);
    case 'clickText':   return page.getByText(fill(v)).first().click();
    case 'clickTitle':  return page.locator(`[title*="${v.title}"]`).first().click();
    case 'clickLast':   return page.getByRole(v.role, { name: v.name }).last().click();
    case 'clickRole': {
      const loc = page.getByRole(v.role, { name: v.name });
      if (v.optional && (await loc.count()) === 0) return;
      return (v.nth != null ? loc.nth(v.nth) : loc.first()).click();
    }
    case 'fill': {
      const loc = page.locator(v.selector).first();
      if ((await loc.count()) === 0) return;
      return loc.fill(fill(v.value));
    }
    case 'fillPlaceholder': {
      const loc = page.getByPlaceholder(v.placeholder).first();
      if ((await loc.count()) === 0) return;
      return loc.fill(fill(v.value));
    }
    case 'captureText': {
      // Pull a value off the page into vars, e.g. { as: ref, pattern: "INV-\\d+" }
      const body = await page.locator(v.scope || 'body').innerText();
      const m = body.match(new RegExp(v.pattern));
      if (m) vars[v.as] = m[0];
      console.log(`      captured ${v.as} = ${vars[v.as] ?? '(no match)'}`);
      return;
    }
    default:
      if (plugins[k]) return plugins[k]({ page, base: BASE, vars, request: page.request }, v);
      throw new Error(`unknown action ${k}`);
  }
}

// Config-driven sign-in. Returns storageState for reuse by needsAuth scenes.
async function signIn(browser) {
  const A = cfg.auth;
  const email = process.env[A.env.email];
  const password = process.env[A.env.password];
  if (!email || !password) throw new Error(`auth env not set (${A.env.email}/${A.env.password})`);
  const c = await browser.newContext({ viewport: VP });
  const q = await c.newPage();
  await q.goto(BASE + A.loginPath, { waitUntil: 'domcontentloaded' });
  const emailLoc = A.emailField.placeholder ? q.getByPlaceholder(A.emailField.placeholder) : q.locator(A.emailField.selector);
  const passLoc  = A.passwordField.placeholder ? q.getByPlaceholder(A.passwordField.placeholder) : q.locator(A.passwordField.selector);
  await emailLoc.first().fill(email);
  await passLoc.first().fill(password);
  await q.getByRole(A.submit.role, { name: A.submit.name }).click();
  await q.waitForTimeout(2500);
  if (A.successUrlNot && new RegExp(A.successUrlNot).test(q.url()))
    throw new Error('login did not take — check credentials');
  const state = `${BUILD}/auth.json`;
  await c.storageState({ path: state });
  await c.close();
  console.log('  auth ok (off-camera)');
  return state;
}

const browser = await chromium.launch(launchArgs.length ? { args: launchArgs } : {});

const wantsAuth = scn.acts.some(a => a.needsAuth && (!only || only.has(a.name)));
let authState = null;
if (wantsAuth) {
  // A pre-captured session file skips sign-in entirely — the only option for canvas
  // apps (no DOM login form to drive), and a fast path for any app.
  if (cfg.auth?.storageState) {
    authState = resolve(dirname(CONFIG), cfg.auth.storageState);
    console.log(`  auth: reusing session ${cfg.auth.storageState}`);
  } else if (cfg.auth) {
    authState = await signIn(browser);
  } else {
    throw new Error('a scene needs auth but config has no auth: block');
  }
}

for (const a of scn.acts) {
  if (only && !only.has(a.name)) continue;
  const slug = a.name.toLowerCase().replace(/\s+/g, '-');
  const canvasCtx = a.mode ? a.mode === 'canvas' : CANVAS_DEFAULT;
  const ctx = await browser.newContext({
    viewport: VP,
    ...(canvasCtx ? { deviceScaleFactor: 2 } : {}),   // hi-dpi so OCR can read painted text
    ...(BROWSER.permissions ? { permissions: BROWSER.permissions } : {}),
    recordVideo: { dir: `${VID}/tmp-${slug}`, size: VP },
    ...(a.needsAuth ? { storageState: authState } : {}),
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log(`  [pageerror] ${e.message.slice(0, 90)}`));
  const canvas = canvasCtx;                 // per-act: mode: canvas | dom, else deck default
  console.log(`\n▶ ${a.name}${canvas ? '  [canvas/OCR]' : ''}`);
  // Narration plays AFTER a scene's actions settle, so it always lands on the finished
  // screen — never over a Flutter boot or a loading spinner. We record each scene's real
  // video offset (actions done) and hand it to the muxer, instead of assuming narration
  // runs back-to-back. This keeps audio and picture in sync even when actions (a slow
  // boot, an image load) run longer than the line that narrates them.
  let actTime = 0;                          // ms of this act's video elapsed so far
  for (const sc of a.scenes) {
    const t0 = Date.now();
    for (const step of (sc.actions || [])) {
      // playSound is a mux marker, not a browser action: record the file + the video
      // offset at which it fires, so the muxer lays it into the final audio there.
      if (Object.keys(step)[0] === 'playSound') {
        const f = resolve(dirname(CONFIG), step.playSound);
        const at = +((actTime + (Date.now() - t0)) / 1000).toFixed(3);
        (sounds[a.name] = sounds[a.name] || []).push({ file: f, at });
        console.log(`      ♪ ${step.playSound} @${at}s`);
        continue;
      }
      try { await act(page, step, canvas); }
      catch (e) { console.log(`  ! ${sc.id}: ${Object.keys(step)[0]} — ${String(e.message).split('\n')[0].slice(0, 90)}`); }
    }
    // Assert we are filming the screen the narration describes. A confident voice-over
    // on the wrong screen is the worst failure this tool can have, so it fails the run.
    // Canvas apps have no DOM text, so we OCR the frame instead of reading innerText.
    if (sc.expect) {
      const body = canvas ? await ocrText(page) : await page.locator('body').innerText();
      const norm = s => canvas ? s.toLowerCase().replace(/\s+/g, ' ') : s;
      const missing = [].concat(sc.expect).filter(x => !norm(body).includes(norm(x)));
      if (missing.length) {
        failures.push(`${sc.id}: expected ${JSON.stringify(missing)} on screen`);
        console.log(`  ✗ ${sc.id}: NOT on screen — ${JSON.stringify(missing)}`);
      }
    }
    const actionsMs = Date.now() - t0;
    const narrationMs = (durs[sc.id]?.seconds ?? 3) * 1000;
    const holdMs = Math.max(narrationMs, MIN_HOLD);
    offsets[sc.id] = +((actTime + actionsMs) / 1000).toFixed(3);   // audio starts here
    console.log(`  ${sc.id.padEnd(16)} actions ${(actionsMs/1000).toFixed(1)}s · vo ${(narrationMs/1000).toFixed(1)}s · @${offsets[sc.id]}s`);
    await page.waitForTimeout(holdMs + GAP);
    actTime += actionsMs + holdMs + GAP;
  }
  await ctx.close();                         // video is flushed on context close
  const dir = `${VID}/tmp-${slug}`;
  const f = readdirSync(dir).find(x => x.endsWith('.webm'));
  if (f) renameSync(`${dir}/${f}`, `${VID}/${slug}.webm`);
  console.log(`  → ${slug}.webm`);
}
await browser.close();
writeFileSync(OFFSETS, JSON.stringify(offsets, null, 2));
writeFileSync(SOUNDS, JSON.stringify(sounds, null, 2));

if (failures.length) {
  console.log(`\n${failures.length} scene(s) filmed the wrong screen:`);
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
}
