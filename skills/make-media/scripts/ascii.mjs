#!/usr/bin/env node
// make-media / ascii — turns an image into true ASCII art (text), for the ASCII/technical mode.
// Uses ffmpeg to decode and scale to grey pixels, then maps luminance to a character ramp. Node 18+.
//
//   node ascii.mjs <image> [--cols 96] [--ramp " .:-=+*#%@"] [--invert] [--out art.txt]
//
// Set the result in a <pre aria-label="what the picture shows"> in the page's mono face. --invert is for
// light text on a dark ground (bright pixels get dense characters). Character cells are about twice as
// tall as wide, so rows = cols x (image height / width) x 0.5.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); if (i === -1) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = (n) => { const i = args.indexOf(`--${n}`); if (i === -1) return false; args.splice(i, 1); return true; };
const cols = Number(flag('cols', '96'));
const ramp = flag('ramp', ' .:-=+*#%@');
const out = flag('out', undefined);
const invert = has('invert');
const src = args[0];
if (!src || !(cols > 4) || ramp.length < 2) { console.error('usage: node ascii.mjs <image> [--cols 96] [--ramp " .:-=+*#%@"] [--invert] [--out art.txt]'); process.exit(2); }

const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', src], { encoding: 'utf8' }).trim().split(',');
const [w, h] = probe.map(Number);
if (!(w > 0 && h > 0)) { console.error(`Could not read the size of ${src}`); process.exit(1); }
const rows = Math.max(1, Math.round((cols * h) / w / 2));
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-vf', `scale=${cols}:${rows}:flags=area,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });

// By default dark pixels get the dense end of the ramp (dark text on a light ground); --invert gives
// bright pixels the dense characters (light text on a dark ground).
const lines = [];
for (let y = 0; y < rows; y++) {
  let line = '';
  for (let x = 0; x < cols; x++) {
    const v = raw[y * cols + x] / 255;
    const t = invert ? v : 1 - v;
    line += ramp[Math.min(ramp.length - 1, Math.floor(t * ramp.length))];
  }
  lines.push(line.replace(/\s+$/, ''));
}
const text = lines.join('\n') + '\n';
if (out) { writeFileSync(out, text); console.log(out); } else process.stdout.write(text);
