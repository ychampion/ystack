// First snow: only the context fill. A quiet sky, falling snow, and a snowbank across the foot of the window that rises
// as the context window fills, burying a row of fence posts at each side (they give the height a scale); a compaction
// clears it. The robin's sign reads the fill and the candle burns down with the minutes left on the prompt cache. A
// lantern sits on the snow for each subagent, the snow blushes red on a failed tool and a shooting star crosses on a
// merge or a green test run. The time of day sets the sky. Pure string building: the same string for the same moment.
import type { Gauges, LivingTheme, SceneCtx } from './contract'
import { SKIES, aurora, hash, moonOrSun, r1, signs, sky, snowfall, stars } from './winter-cabin'
import type { Sky } from './winter-cabin'

/** The bank's top, on the window's foot, for a fill of `s` (0 to 1): from a thin layer to about a third of the height. */
const bankTop = (s: number) => 950 - s * 330

function bank(p: Sky, s: number): string {
  const y = bankTop(s)
  const back = `<path d="M-20 ${r1(y - 18)}C200 ${r1(y - 46)} 420 ${r1(y - 6)} 700 ${r1(y - 26)}S1200 ${r1(y - 44)} 1620 ${r1(y - 16)}L1620 1000L-20 1000Z" fill="${p.snowShade}" opacity=".7"/>`
  const front = `<path d="M-20 ${r1(y)}C180 ${r1(y - 24)} 380 ${r1(y + 12)} 640 ${r1(y - 6)}S1100 ${r1(y - 30)} 1340 ${r1(y - 4)}S1540 ${r1(y + 6)} 1620 ${r1(y - 8)}L1620 1000L-20 1000Z" fill="url(#ground)"/>`
  const rim = `<path d="M-20 ${r1(y)}C180 ${r1(y - 24)} 380 ${r1(y + 12)} 640 ${r1(y - 6)}S1100 ${r1(y - 30)} 1340 ${r1(y - 4)}S1540 ${r1(y + 6)} 1620 ${r1(y - 8)}" stroke="#ffffff" stroke-opacity=".65" stroke-width="3" fill="none"/>`
  const glints = Array.from({ length: 22 }, (_, i) => `<circle class="tw" style="animation-delay:-${r1(hash(i, 141) * 4)}s" cx="${Math.round(hash(i, 142) * 1600)}" cy="${Math.round(y + 14 + hash(i, 143) * Math.max(20, 990 - y - 14))}" r="1.6"/>`).join('')
  return `${back}${front}${rim}<g fill="#ffffff" opacity=".85">${glints}</g>`
}

/** Fence posts at both sides, standing on the ground line: the bank swallows them as it rises. */
function fence(): string {
  const posts: string[] = []
  const xs = [40, 110, 180, 250, 1350, 1420, 1490, 1560]
  for (const [i, x] of xs.entries()) {
    const h = 290 + hash(i, 150) * 40
    posts.push(`<rect x="${x - 7}" y="${r1(960 - h)}" width="14" height="${r1(h)}" rx="3" fill="#5b4334"/><path d="M${x - 9} ${r1(960 - h)}Q${x} ${r1(960 - h - 12)} ${x + 9} ${r1(960 - h)}Z" fill="#f4f7ff"/>`)
  }
  const rails = `<path d="M33 720H257M33 800H257M1343 720H1567M1343 800H1567" stroke="#4a3528" stroke-width="7"/>`
  return `<g>${rails}${posts.join('')}</g>`
}

function lanterns(ctx: SceneCtx, s: number): string {
  if (ctx.activity !== 'agents') return ''
  const y = bankTop(s) - 14
  return Array.from({ length: ctx.agents }, (_, i) => {
    const x = 1060 + i * 46
    return `<circle cx="${x}" cy="${r1(y)}" r="26" fill="url(#lampGlow)"/><rect x="${x - 7}" y="${r1(y - 12)}" width="14" height="20" rx="3" fill="#ffcf6a"/><rect x="${x - 8}" y="${r1(y - 14)}" width="16" height="3" fill="#2a1d16"/>`
  }).join('')
}

function scene(ctx: SceneCtx): string {
  const p = SKIES[ctx.phase]
  const g: Gauges = ctx.gauges ?? { context: 0, cacheMin: null }
  const s = Math.max(0, Math.min(1, g.context / 100))
  const style = `.tw{animation:tw 3.2s ease-in-out infinite alternate}
.au{animation:au 14s ease-in-out infinite alternate}.au.b{animation-duration:19s}.au.c{animation-duration:23s}
.bob{animation:bob .9s ease-in-out infinite alternate}.hop{animation:hop .7s ease-in-out infinite}.flap{animation:flap .25s ease-in-out infinite alternate}
.breathe{animation:breathe 4s ease-in-out infinite alternate}
.blink{animation:blink .6s steps(2) infinite}
@keyframes tw{from{opacity:.35}to{opacity:1}}
@keyframes au{from{transform:translateX(-40px) skewX(-4deg)}to{transform:translateX(40px) skewX(4deg)}}
@keyframes bob{from{transform:translateY(0)}to{transform:translateY(-4px)}}
@keyframes hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-16px)}}
@keyframes flap{from{transform:rotate(-3deg)}to{transform:rotate(3deg)}}
@keyframes breathe{from{opacity:.75}to{opacity:1}}
@keyframes blink{0%{opacity:.16}100%{opacity:.02}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}.motion{display:none}.still{display:inline}}`
  const defs = `${sky(p)}
<linearGradient id="auG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#53f0b0" stop-opacity="0"/><stop offset=".35" stop-color="#53f0b0"/><stop offset=".7" stop-color="#7ad8ff"/><stop offset="1" stop-color="#7ad8ff" stop-opacity="0"/></linearGradient>
<linearGradient id="auV" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b48cff" stop-opacity="0"/><stop offset=".5" stop-color="#b48cff"/><stop offset="1" stop-color="#53f0b0" stop-opacity="0"/></linearGradient>
<radialGradient id="moonGlow"><stop offset="0" stop-color="#fff6d8" stop-opacity=".45"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></radialGradient>
<radialGradient id="sunGlow"><stop offset="0" stop-color="#fff1c8" stop-opacity=".7"/><stop offset="1" stop-color="#ffe0b0" stop-opacity="0"/></radialGradient>
<radialGradient id="lampGlow"><stop offset="0" stop-color="#ffe6a0" stop-opacity=".75"/><stop offset=".45" stop-color="#ffcf6a" stop-opacity=".25"/><stop offset="1" stop-color="#ffcf6a" stop-opacity="0"/></radialGradient>
<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.snow}"/><stop offset="1" stop-color="${p.snowShade}"/></linearGradient>
<linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5432"/><stop offset="1" stop-color="#6a3c22"/></linearGradient>
<radialGradient id="flake"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".7"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<linearGradient id="trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<linearGradient id="colG" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1600" y2="0"><stop offset=".15" stop-color="#000"/><stop offset=".29" stop-color="#fff"/><stop offset=".71" stop-color="#fff"/><stop offset=".85" stop-color="#000"/></linearGradient>
<mask id="colMask" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><rect width="1600" height="1000" fill="url(#colG)"/></mask>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8d4ff" stop-opacity=".10"/><stop offset=".35" stop-color="#c8d4ff" stop-opacity="0"/></linearGradient>
<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe6ff" stop-opacity="0"/><stop offset="1" stop-color="#dfe6ff" stop-opacity=".22"/></linearGradient>`
  const column = `<g mask="url(#colMask)"><rect width="1600" height="1000" fill="#0a1030" opacity=".38"/><rect width="1600" height="1000" fill="url(#sheen)"/><rect y="760" width="1600" height="240" fill="url(#mist)"/></g>`
  const star =
    ctx.activity === 'success'
      ? `<g transform="translate(860 210)"><animateTransform attributeName="transform" type="translate" values="1180 90;560 330;560 330" keyTimes="0;.6;1" dur="2.6s" repeatCount="indefinite"/><path d="M0 0L-160 60" stroke="url(#trail)" stroke-width="3" stroke-linecap="round"/><circle r="3.5" fill="#ffffff"/></g>`
      : ''
  const blush = ctx.activity === 'error' ? `<rect class="blink" width="1600" height="1000" fill="#ff3b3b" opacity=".1"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>${style}</style><defs>${defs}</defs>
<rect width="1600" height="1000" fill="url(#sky)"/>
${stars(p)}
${aurora(p)}
${moonOrSun(p, ctx.phase)}
${star}
${snowfall(s, false)}
${fence()}
${bank(p, s)}
${column}
${lanterns(ctx, s)}
${signs(ctx, g)}
${snowfall(s, true)}
${blush}
</svg>`
}

function glass(ctx: SceneCtx): { blur: number; tint: string; opacity: number } {
  return ctx.phase === 'day' ? { blur: 16, tint: '#16224a', opacity: 0.12 } : { blur: 16, tint: '#0a1030', opacity: 0.1 }
}

export const theme: LivingTheme = {
  id: 'first-snow',
  title: 'First snow',
  blurb: 'Only the context fill: falling snow, and a snowbank that rises across the foot of the window as the context fills.',
  reacts:
    'The bank climbs and buries the fence posts as the context fills, and a compaction clears it; the robin sign reads the fill and the candle burns down with the cache. A lantern sits on the snow for each subagent, the snow blushes red on an error and a shooting star crosses on success.',
  window: 'dark',
  gauges: true,
  glass,
  scene,
}
