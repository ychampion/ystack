#!/usr/bin/env node
// make-media / gemini — text-to-image and text-to-video through the Gemini API (Interactions API),
// with a monthly spend cap kept in a local ledger. Zero dependencies. Node 18+.
//
//   node gemini.mjs image "<prompt>" --out assets/hero.jpg [--model gemini-nano-banana-2.1] [--aspect 16:9] [--size 1K]
//   node gemini.mjs video "<prompt>" --out assets/loop.mp4 [--model gemini-omni-1.2-flash] [--resolution 720p] [--duration 8s] [--aspect 16:9]
//   node gemini.mjs spend                      # this month's spend from the ledger
//   add --dry-run to print the request and the estimate without calling the API
//
// The key comes from GEMINI_API_KEY only, and is never printed. With the vault mod:
//   GEMINI_API_KEY="{{vault:GEMINI_API_KEY}}" node gemini.mjs image "..." --out x.jpg
//
// The cap: MAKE_MEDIA_CAP_USD (default 40) per calendar month across every project. A call whose
// estimate would pass it is refused. --cap <usd> raises it for one call; use it only with the user's yes
// for this project. Ledger: MAKE_MEDIA_LEDGER, default ~/.make-media/ledger.jsonl.
//
// Exit codes: 0 written; 1 API or network error; 2 usage or missing key; 3 refused by the cap.
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const REVISION = '2026-05-20';

// USD, from Google's AI Studio pricing page as of 2026-11-07. Images per image; video per second.
const IMAGE_PRICE = {
  'gemini-nano-banana-2.1': { '512': 0.034, '1K': 0.034, '2K': 0.05, '4K': 0.113 },
  'gemini-3-pro-image': { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
};
const VIDEO_PRICE = {
  'gemini-omni-1.2-flash': { '360p': 0.023, '720p': 0.07, '1080p': 0.104, '4k': 0.209 },
};

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const has = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
};
const die = (code, msg) => {
  console.error(msg);
  process.exit(code);
};

const ledgerPath = process.env.MAKE_MEDIA_LEDGER || join(homedir(), '.make-media', 'ledger.jsonl');
const month = new Date().toISOString().slice(0, 7);
function spentThisMonth() {
  if (!existsSync(ledgerPath)) return 0;
  let total = 0;
  for (const line of readFileSync(ledgerPath, 'utf8').split('\n')) {
    try {
      const e = JSON.parse(line);
      if (typeof e.at === 'string' && e.at.startsWith(month) && e.ok) total += Number(e.usd) || 0;
    } catch {}
  }
  return Math.round(total * 1000) / 1000;
}
function record(entry) {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  appendFileSync(ledgerPath, JSON.stringify(entry) + '\n');
}

const dryRun = has('dry-run');
const capArg = flag('cap', undefined);
const cap = Number(capArg ?? process.env.MAKE_MEDIA_CAP_USD ?? 40);
const kind = argv.shift();

if (kind === 'spend') {
  console.log(`${month}: $${spentThisMonth().toFixed(3)} of $${cap.toFixed(2)} (ledger ${ledgerPath})`);
  process.exit(0);
}
if (kind !== 'image' && kind !== 'video') die(2, 'usage: node gemini.mjs image|video "<prompt>" --out <file or dir> [options] | node gemini.mjs spend');

const out = flag('out', undefined);
const aspect = flag('aspect', kind === 'image' ? '1:1' : '16:9');
let model, response_format, usd, detail;
if (kind === 'image') {
  model = flag('model', 'gemini-nano-banana-2.1');
  const size = flag('size', '1K');
  const price = IMAGE_PRICE[model]?.[size];
  if (price === undefined) die(2, `No price known for ${model} at ${size}. Known: ${JSON.stringify(IMAGE_PRICE)}. Update IMAGE_PRICE from the pricing page first.`);
  usd = price;
  detail = { size, aspect };
  response_format = { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspect, image_size: size };
} else {
  model = flag('model', 'gemini-omni-1.2-flash');
  const resolution = flag('resolution', '720p');
  const duration = flag('duration', '8s');
  const seconds = Number(String(duration).replace(/s$/, ''));
  const rate = VIDEO_PRICE[model]?.[resolution];
  if (rate === undefined || !(seconds >= 3 && seconds <= 15)) die(2, `Need a known model/resolution (${JSON.stringify(VIDEO_PRICE)}) and a duration of 3s to 15s.`);
  usd = Math.round(rate * seconds * 1000) / 1000;
  detail = { resolution, seconds, aspect };
  response_format = { type: 'video', aspect_ratio: aspect, resolution, duration: `${seconds}s` };
}
const prompt = argv.join(' ').trim();
if (!prompt) die(2, 'Give a prompt.');
if (!out) die(2, 'Give --out <file or directory>.');

const body = { model, input: prompt, response_format };
const spent = spentThisMonth();
console.error(`estimate $${usd.toFixed(3)} · this month $${spent.toFixed(3)} of $${cap.toFixed(2)} cap`);
if (spent + usd > cap) die(3, `Refused: this call would take the month to $${(spent + usd).toFixed(3)}, past the $${cap.toFixed(2)} cap. Raising the cap needs the user's yes for this project (then --cap <usd>).`);
if (dryRun) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}

const key = process.env.GEMINI_API_KEY;
if (!key) die(2, 'GEMINI_API_KEY is not set. With the vault mod: GEMINI_API_KEY="{{vault:GEMINI_API_KEY}}" node gemini.mjs ... (the user adds it once with /vault add GEMINI_API_KEY). Never paste a key into the chat.');
const headers = { 'x-goog-api-key': key, 'Content-Type': 'application/json', 'Api-Revision': REVISION };

/** Every media part anywhere in a response: { data, mime } or { uri, mime }. */
function mediaIn(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  const mime = node.mime_type || node.mimeType;
  if (typeof node.data === 'string' && node.data.length > 100 && (mime || node.type === 'image' || node.type === 'video')) found.push({ data: node.data, mime });
  else if (typeof node.uri === 'string' && (mime || node.type === 'video' || node.type === 'image')) found.push({ uri: node.uri, mime });
  for (const v of Object.values(node)) if (v && typeof v === 'object') mediaIn(v, found);
  return found;
}

async function call(url, init) {
  const r = await fetch(url, init);
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!r.ok) {
    const msg = json?.error?.message || text.slice(0, 400);
    throw new Error(`HTTP ${r.status}: ${msg}`);
  }
  return json ?? {};
}

const started = Date.now();
const base = { at: new Date().toISOString(), project: process.cwd(), kind, model, ...detail, prompt: prompt.slice(0, 300) };
try {
  let res = await call(`${API}/interactions`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(600_000) });
  // A long video may come back still running: poll the interaction until it holds media.
  while (mediaIn(res).length === 0 && res.id && !/^(completed|failed|cancelled)$/i.test(res.status || '') && Date.now() - started < 600_000) {
    await new Promise((r) => setTimeout(r, 10_000));
    res = await call(`${API}/interactions/${encodeURIComponent(res.id)}`, { headers, signal: AbortSignal.timeout(60_000) });
  }
  const media = mediaIn(res);
  if (media.length === 0) throw new Error(`No ${kind} in the response (status ${res.status ?? 'unknown'}). Keys: ${Object.keys(res).join(', ')}`);
  const m = media[0];
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4' }[m.mime] || (kind === 'image' ? '.jpg' : '.mp4');
  let target = resolve(out);
  if ((existsSync(target) && statSync(target).isDirectory()) || /[\\/]$/.test(out)) target = join(target, `${kind}-${Date.now()}${ext}`);
  else if (!extname(target)) target += ext;
  mkdirSync(dirname(target), { recursive: true });
  if (m.data) writeFileSync(target, Buffer.from(m.data, 'base64'));
  else {
    const r = await fetch(m.uri.includes('alt=media') ? m.uri : `${m.uri}${m.uri.includes('?') ? '&' : '?'}alt=media`, { headers: { 'x-goog-api-key': key } });
    if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
    writeFileSync(target, Buffer.from(await r.arrayBuffer()));
  }
  record({ ...base, ok: true, usd, out: target, seconds_taken: Math.round((Date.now() - started) / 1000) });
  console.log(target);
} catch (err) {
  // Logged at $0 on the assumption that a call returning no media is not billed; the Cloud billing
  // report is the source of truth if a long video timed out here after Google had generated it.
  record({ ...base, ok: false, usd: 0, error: String(err.message || err).slice(0, 300) });
  // exitCode, not process.exit(): exiting while fetch's sockets close trips a libuv assertion on Windows.
  console.error(`Gemini API: ${err.message || err}`);
  process.exitCode = 1;
}
