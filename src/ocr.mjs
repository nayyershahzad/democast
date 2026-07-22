// OCR helper for canvas apps (Flutter, Unity, <canvas> games) that expose no DOM text.
// Screenshots the page and runs Tesseract, so `tapText:` can click painted labels and the
// `expect:` guard can still verify what's on screen. Requires the `tesseract` binary.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'democast-ocr-'));
const norm = s => s.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();

// Returns words with page-pixel boxes: {text, cx, cy, left, top, w, h, conf, line}
// Boxes are divided by the device pixel ratio so they map to click (CSS) coordinates,
// while OCR still gets the extra resolution from a hi-dpi (2x) context.
async function words(page) {
  const png = join(TMP, 'frame.png');
  await page.screenshot({ path: png });
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  // psm 3 = full auto page segmentation. Empirically best on Flutter UI: it catches
  // button labels (incl. light text on coloured fills) that sparse mode (11) dropped.
  const tsv = execFileSync('tesseract', [png, 'stdout', '--psm', '3', 'tsv'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = [];
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t');
    if (c.length < 12) continue;
    const [, , blk, par, ln, , left, top, w, h, conf, text] = c;
    if (!text || !text.trim() || Number(conf) < 35) continue;
    const L = +left / dpr, T = +top / dpr, W = +w / dpr, H = +h / dpr;
    out.push({ text: text.trim(), left: L, top: T, w: W, h: H, conf: +conf,
               cx: L + W / 2, cy: T + H / 2, line: `${blk}.${par}.${ln}` });
  }
  return out;
}

// Full-screen text, normalized — for expect: checks.
export async function ocrText(page) {
  return norm((await words(page)).map(w => w.text).join(' '));
}

// Find a painted phrase and return a click target {cx, cy}. nth picks among matches
// in reading order. Handles multi-word phrases by scanning consecutive words on a line.
export async function ocrFind(page, phrase, nth = 0) {
  const ws = await words(page);
  const target = norm(phrase);
  const tokens = target.split(' ');
  const hits = [];

  // group by line, preserve reading order
  const byLine = new Map();
  for (const w of ws) {
    if (!byLine.has(w.line)) byLine.set(w.line, []);
    byLine.get(w.line).push(w);
  }
  for (const line of byLine.values()) {
    line.sort((a, b) => a.left - b.left);
    for (let i = 0; i + tokens.length <= line.length; i++) {
      const span = line.slice(i, i + tokens.length);
      const joined = norm(span.map(s => s.text).join(' '));
      if (joined === target || joined.includes(target)) {
        const left = Math.min(...span.map(s => s.left));
        const right = Math.max(...span.map(s => s.left + s.w));
        const top = Math.min(...span.map(s => s.top));
        const bot = Math.max(...span.map(s => s.top + s.h));
        hits.push({ cx: (left + right) / 2, cy: (top + bot) / 2, top });
      }
    }
  }
  // also allow a single-token substring match when phrase is one word
  if (!hits.length && tokens.length === 1) {
    for (const w of ws) if (norm(w.text).includes(target)) hits.push({ cx: w.cx, cy: w.cy, top: w.top });
  }
  hits.sort((a, b) => a.top - b.top);      // top-to-bottom reading order
  return hits[nth] || null;
}
