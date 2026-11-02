#!/usr/bin/env node
// democast — turn a demo.yaml your agent writes into a narrated demo video.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const PKG   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CWD   = process.cwd();
const HOME  = join(CWD, '.democast');           // per-project: tts + build live here
const BUILD = join(HOME, 'build');
const TTS   = join(HOME, 'tts');
const CONFIG = join(CWD, 'democast.config.yaml');
const SCENES = join(CWD, 'demo.yaml');

const C = { dim: s => `\x1b[2m${s}\x1b[0m`, b: s => `\x1b[1m${s}\x1b[0m`,
            g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m` };

// Common voices to offer in the wizard. The full catalogue is far larger —
// any Piper voice id works; see docs. (language: [ids])
const VOICE_MENU = {
  'English (US)': ['en_US-hfc_male-medium', 'en_US-hfc_female-medium', 'en_US-ryan-high'],
  'English (GB)': ['en_GB-alba-medium', 'en_GB-northern_english_male-medium'],
  'Urdu':         ['ur_PK-fasih-medium'],
  'Spanish':      ['es_ES-davefx-medium'],
  'French':       ['fr_FR-siwis-medium'],
  'German':       ['de_DE-thorsten-medium'],
  'Hindi':        ['hi_IN-pratham-medium'],
  'Arabic':       ['ar_JO-kareem-medium'],
};

function sh(cmd, args, extraEnv = {}) {
  const env = { ...process.env, DEMOCAST_CONFIG: CONFIG, DEMOCAST_SCENES: SCENES,
                DEMOCAST_BUILD: BUILD, DEMOCAST_TTS: TTS, ...extraEnv };
  return new Promise((res) => {
    // Windows: npx is a .cmd shim, which Node only runs through a shell.
    const win = process.platform === 'win32' && cmd === 'npx';
    const p = win ? spawn(['npx.cmd', ...args].join(' '), { stdio: 'inherit', env, cwd: CWD, shell: true })
                  : spawn(cmd, args, { stdio: 'inherit', env, cwd: CWD });
    p.on('close', code => res(code ?? 1));
  });
}
// Windows has no python3 (only a Store stub that fails); its interpreter is `python`.
const PY3  = process.platform === 'win32' ? 'python' : 'python3';
const py   = (f, args = [], env = {}) => sh(PY3, [join(PKG, 'src', f), ...args], env);
const node = (f, args = [], env = {}) => sh('node',   [join(PKG, 'src', f), ...args], env);

function have(bin, vArg = '-version') {
  return spawnSync(bin, [vArg], { stdio: 'ignore' }).status === 0;
}

function banner() {
  console.log(C.b('\n  democast') + C.dim(' — your agent writes the script, this makes the video.\n'));
  console.log('  ' + C.dim('npx democast ') + 'init      ' + C.dim('scaffold config + demo.yaml + AGENTS.md'));
  console.log('  ' + C.dim('npx democast ') + 'wizard    ' + C.dim('pick language / voice, fetch it, write config'));
  console.log('  ' + C.dim('npx democast ') + 'doctor    ' + C.dim('check ffmpeg / piper / browser, install what is missing'));
  console.log('  ' + C.dim('npx democast ') + 'voices    ' + C.dim('list voices  ·  --get <id> to download one'));
  console.log('  ' + C.dim('npx democast ') + 'check     ' + C.dim('coverage + narration dry-run (no recording) — is it demo-ready?'));
  console.log('  ' + C.dim('npx democast ') + 'render    ' + C.dim('the whole thing → .democast/build/out/master.mp4'));
  console.log('  ' + C.dim('             ') + '          ' + C.dim('  render --acts "Sign up,Close"   render --no-hooks\n'));
}

function ensureProject() {
  if (!existsSync(CONFIG) || !existsSync(SCENES)) {
    console.log(C.r('  no democast project here.') + ' Run ' + C.b('npx democast init') + ' first.');
    process.exit(1);
  }
  mkdirSync(BUILD, { recursive: true });
  mkdirSync(TTS, { recursive: true });
}

function readVoicesFromConfig() {
  const txt = readFileSync(CONFIG, 'utf8');
  // light-touch parse: pull voice ids so we can pre-fetch them without a yaml dep here
  const ids = [...txt.matchAll(/^\s*\w+:\s*([a-z]{2}_[A-Z]{2}-[\w-]+)\s*$/gm)].map(m => m[1]);
  return [...new Set(ids)];
}

// Resolve auth env from the config's auth.env mapping, if the user set real values
// in their own environment. We never store secrets — we just pass them through.
function authEnv() {
  return {};   // credentials come from the user's shell (DEMOCAST_EMAIL, etc.)
}

async function cmdInit() {
  const files = [
    ['templates/democast.config.yaml', 'democast.config.yaml'],
    ['templates/demo.example.yaml', 'demo.yaml'],
    ['templates/democast.actions.mjs', 'democast.actions.mjs'],
    ['AGENTS.md', 'AGENTS.md'],
  ];
  for (const [src, dst] of files) {
    const to = join(CWD, dst);
    if (existsSync(to)) { console.log('  ' + C.y('skip') + ` ${dst} (exists)`); continue; }
    copyFileSync(join(PKG, src), to);
    console.log('  ' + C.g('+') + ` ${dst}`);
  }
  console.log('\n  Next:');
  console.log('  1. ' + C.b('npx democast wizard') + '   pick your language + voice');
  console.log('  2. point ' + C.b('baseUrl') + ' in democast.config.yaml at your running app');
  console.log('  3. let your AI edit ' + C.b('demo.yaml') + ' as it builds (see AGENTS.md)');
  console.log('  4. ' + C.b('npx democast render') + '\n');
}

async function cmdWizard() {
  ensureProject();
  const rl = createInterface({ input, output });
  console.log(C.b('\n  democast wizard\n'));
  const langs = Object.keys(VOICE_MENU);
  langs.forEach((l, i) => console.log(`   ${i + 1}. ${l}`));
  const li = parseInt(await rl.question('\n  Narration language? [1] ') || '1', 10) - 1;
  const lang = langs[li] ?? langs[0];
  const opts = VOICE_MENU[lang];
  console.log();
  opts.forEach((v, i) => console.log(`   ${i + 1}. ${v}`));
  const vi = parseInt(await rl.question('\n  Voice? [1] ') || '1', 10) - 1;
  const voice = opts[vi] ?? opts[0];
  const base = (await rl.question('\n  Where is your app running? [http://localhost:3000] ')).trim() || 'http://localhost:3000';
  const music = /^y/i.test(await rl.question('  Music bed under the narration? (you supply a licensed wav) [y/N] '));
  await rl.close();

  // Patch the config in place (simple line rewrites — keeps comments intact).
  let cfg = readFileSync(CONFIG, 'utf8');
  cfg = cfg.replace(/^baseUrl:.*$/m, `baseUrl: ${base}`);
  cfg = cfg.replace(/^\s*default:.*$/m, `  default: ${voice}`);
  if (music) cfg = cfg.replace(/^music:.*$/m, 'music: ./music/bed.wav   # <-- drop a licensed wav here');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(CONFIG, cfg);
  console.log('\n  ' + C.g('✓') + ` config set: ${voice} @ ${base}`);
  console.log('  fetching the voice…\n');
  await py('voices.py', ['setup', voice]);
  console.log('\n  ' + C.g('ready') + ' — write demo.yaml, then ' + C.b('npx democast render') + '\n');
}

async function cmdVoices(argv) {
  const gi = argv.indexOf('--get');
  ensureProject();
  if (gi !== -1 && argv[gi + 1]) return py('voices.py', ['setup', argv[gi + 1]]);
  console.log(C.b('\n  Common Piper voices') + C.dim('  (offline, free, ~65 MB each)\n'));
  for (const [lang, ids] of Object.entries(VOICE_MENU)) {
    console.log('  ' + C.b(lang));
    ids.forEach(v => console.log('    ' + v));
  }
  console.log('\n  Download one:  ' + C.b('npx democast voices --get en_GB-alba-medium'));
  console.log('  Full catalogue: ' + C.dim('https://github.com/rhasspy/piper/blob/master/VOICES.md') + '\n');
}

async function cmdDoctor() {
  ensureProject();
  console.log(C.b('\n  doctor\n'));
  const ok = (label, good) => console.log(`   ${good ? C.g('✓') : C.r('✗')} ${label}`);
  ok('node >= 18', Number(process.versions.node.split('.')[0]) >= 18);
  const ff = have('ffmpeg'); ok('ffmpeg', ff);
  const fp = have('ffprobe'); ok('ffprobe', fp);
  const p3 = have(PY3, '--version'); ok(PY3, p3);
  if (!ff || !fp) console.log('     ' + C.y('→ install ffmpeg:  brew install ffmpeg   |   apt install ffmpeg'));

  console.log('\n  fetching browser + voices…\n');
  // Playwright browser (idempotent — no-op if present)
  await sh('npx', ['playwright', 'install', 'chromium']);
  // Piper venv + every voice the config references
  const voices = readVoicesFromConfig();
  await py('voices.py', ['setup', ...voices]);
  console.log('\n  ' + C.g('doctor done') + '\n');
}

async function cmdCheck() {
  ensureProject();
  console.log(C.b('\n  check') + C.dim(' — is the demo script ready to record?\n'));
  const cov = await py('coverage.py');
  if (cov !== 0) { console.log(C.r('\n  coverage failed — fix demo.yaml vs your script.\n')); process.exit(cov); }
  // Narration dry-run: synthesises + measures every line, catching unspeakable text
  // and un-installed voices, WITHOUT driving the browser. Cheap readiness signal.
  const nar = await py('narrate.py', ['']);
  if (nar !== 0) { console.log(C.r('\n  narration failed.\n')); process.exit(nar); }
  console.log(C.g('\n  ✓ ready to record.') + ' Run ' + C.b('npx democast render') + '\n');
}

async function cmdRender(argv) {
  ensureProject();
  const acts = (() => { const i = argv.indexOf('--acts'); return i !== -1 ? (argv[i + 1] || '') : ''; })();
  const noHooks = argv.includes('--no-hooks');
  const cfgTxt = readFileSync(CONFIG, 'utf8');
  const hookBefore = (cfgTxt.match(/^\s*before:\s*"([^"]*)"/m) || [])[1];
  const hookAfter  = (cfgTxt.match(/^\s*after:\s*"([^"]*)"/m) || [])[1];

  console.log(C.b('\n  render\n'));
  console.log('  == coverage ==');            if (await py('coverage.py')) process.exit(1);
  if (!noHooks && hookBefore) { console.log(`  == hook before: ${hookBefore} ==`); await sh('bash', ['-lc', hookBefore]); }
  console.log('  == narrate (paces the recording) =='); if (await py('narrate.py', [acts])) process.exit(1);
  console.log('  == record ==');
  const rc = await node('record.mjs', [], { DEMOCAST_ACTS: acts, ...authEnv() });
  console.log('  == mux ==');                  await py('mux.py', [acts]);
  if (!noHooks && hookAfter) { console.log(`  == hook after: ${hookAfter} ==`); await sh('bash', ['-lc', hookAfter]); }
  if (rc !== 0) { console.log(C.r(`\n  done WITH FAILURES (a scene filmed the wrong screen) — inspect .democast/build/out\n`)); process.exit(rc); }
  console.log(C.g('\n  ✓ done') + ` — ${join(BUILD, 'out', 'master.mp4')}` +
              C.dim('  (proofread captions in master.srt)\n'));
}

const [, , cmd = 'banner', ...argv] = process.argv;
const table = { banner, init: cmdInit, wizard: cmdWizard, voices: cmdVoices,
                doctor: cmdDoctor, check: cmdCheck, render: cmdRender };
(table[cmd] || banner)(argv);
