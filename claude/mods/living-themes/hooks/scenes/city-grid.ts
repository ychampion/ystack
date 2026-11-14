// City Grid: a pixel skyline seen at street level. Tall blocks stand along the left and right edges and the skyline drops
// low in the middle, so the prompt box has open sky above it. Everything is snapped to an 8 px grid.
// The time of day sets the sky (stepped bands, a pixel sun or moon, stars); the agent's activity lights the windows (a few
// at rest, most of them while tools run, flickering as they work), sends a drone across for each subagent, blacks out a
// block with a red beacon on an error and sets off rooftop fireworks on success; the season adds snow, haze, heat shimmer
// or a clearing spring shower. Pure string building: no Math.random, no Date.
import type { LivingTheme, SceneCtx } from './contract'

type Phase = SceneCtx['phase']
type Activity = SceneCtx['activity']
type Season = SceneCtx['season']

const PX = 8

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  let out = 0
  for (const shift of [16, 8, 0]) {
    const ca = (pa >> shift) & 255
    const cb = (pb >> shift) & 255
    out |= Math.round(ca + (cb - ca) * t) << shift
  }
  return `#${out.toString(16).padStart(6, '0')}`
}

const snap = (v: number): number => Math.round(v / PX) * PX
const n1 = (v: number): number => Math.round(v * 10) / 10

interface Palette {
  sky: readonly [string, string, string]
  far: string
  near: string
  edge: string
  glass: string
  lit: string
  body: string
  cloud: string
  street: string
  dark: number
}

const PALETTES: Record<Phase, Palette> = {
  dawn: {
    sky: ['#5c5f9c', '#e4a0a6', '#ffd8a4'], far: '#a58aa4', near: '#5a4e6e', edge: '#3e3552', glass: '#7a6c8c', lit: '#ffe2a0',
    body: '#fff0c4', cloud: '#fbd2c4', street: '#3a3048', dark: 0.35,
  },
  day: {
    sky: ['#5c9ede', '#a6d0ef', '#e4f1f6'], far: '#a7bdd2', near: '#62748e', edge: '#46566e', glass: '#8aa2bc', lit: '#fff1c2',
    body: '#fff8dc', cloud: '#ffffff', street: '#4a5466', dark: 0,
  },
  dusk: {
    sky: ['#1c1636', '#562c58', '#d0623e'], far: '#4e2e52', near: '#21182e', edge: '#150f20', glass: '#2e2440', lit: '#ffc46a',
    body: '#ffb060', cloud: '#a8506a', street: '#120c1a', dark: 0.7,
  },
  night: {
    sky: ['#04071a', '#0c1430', '#1c2448'], far: '#161d38', near: '#0d1222', edge: '#070a14', glass: '#1a2034', lit: '#ffd57a',
    body: '#eef0ff', cloud: '#2a3256', street: '#05070e', dark: 0.9,
  },
}

/** Share of windows lit for each activity. The same windows stay lit as more join, so the city brightens in place. */
const LIT: Record<Activity, number> = { idle: 0.12, thinking: 0.26, working: 0.58, agents: 0.44, error: 0.3, success: 0.66 }
const FLICKER: Record<Activity, number> = { idle: 0.02, thinking: 0.08, working: 0.3, agents: 0.16, error: 0.2, success: 0.1 }

interface Block {
  x: number
  w: number
  top: number
  tone: number
  roof: number
}

/** How tall the skyline stands at column x: 1 along the edges, 0 over the middle where the prompt box sits. */
function tallness(x: number): number {
  const edge = x < 800 ? (520 - x) / 150 : (x - 1080) / 150
  const t = Math.max(0, Math.min(1, edge))
  return t * t * (3 - 2 * t)
}

function blocks(seed: number, base: number, rise: number, jitter: number): Block[] {
  const out: Block[] = []
  let x = -16
  let i = 0
  while (x < 1616) {
    const w = snap(56 + hash(i, seed) * 72)
    const t = tallness(x + w / 2)
    const top = snap(base - rise * t - (hash(i, seed + 1) - 0.5) * jitter * (0.35 + t))
    out.push({ x, w, top, tone: hash(i, seed + 2), roof: hash(i, seed + 3) })
    x += w + (hash(i, seed + 4) < 0.2 ? PX : 0)
    i += 1
  }
  return out
}

const NEAR_BLOCKS = blocks(11, 928, 560, 170)
const FAR_BLOCKS = blocks(37, 860, 560, 200)
/** The block that blacks out on an error: the tallest on the right. */
const DARK_BLOCK = NEAR_BLOCKS.reduce((best, b) => (b.x > 1100 && b.top < best.top ? b : best), NEAR_BLOCKS[NEAR_BLOCKS.length - 1]!)

function sky(p: Palette): string {
  const bands = 34
  let out = ''
  for (let i = 0; i < bands; i += 1) {
    const t = i / (bands - 1)
    const colour = t < 0.55 ? mix(p.sky[0], p.sky[1], t / 0.55) : mix(p.sky[1], p.sky[2], (t - 0.55) / 0.45)
    const y = snap((i * 1000) / bands)
    out += `<rect y="${y}" width="1600" height="${snap(1000 / bands) + PX}" fill="${colour}"/>`
  }
  return out
}

/** A disc drawn in 8 px pixels. */
function pixelDisc(cx: number, cy: number, r: number): string {
  let d = ''
  for (let y = -r; y < r; y += PX) {
    for (let x = -r; x < r; x += PX) {
      if ((x + PX / 2) ** 2 + (y + PX / 2) ** 2 <= r * r) d += `M${cx + x} ${cy + y}h${PX}v${PX}h-${PX}z`
    }
  }
  return d
}

function sunOrMoon(phase: Phase, p: Palette): string {
  const [cx, cy, r] = phase === 'night' ? [1320, 144, 40] : phase === 'day' ? [232, 136, 48] : phase === 'dawn' ? [600, 360, 56] : [1016, 352, 56]
  const halo = `<circle cx="${cx}" cy="${cy}" r="${r * 4}" fill="url(#halo)"/>`
  if (phase === 'night') {
    // A pixel moon with darker craters.
    return `${halo}<path d="${pixelDisc(cx, cy, r)}" fill="${p.body}"/><path d="M${cx - 16} ${cy - 16}h8v8h-8zM${cx + 8} ${cy}h8v8h-8zM${cx - 8} ${cy + 16}h8v8h-8zM${cx + 16} ${cy - 24}h8v8h-8z" fill="#c9cde8"/>`
  }
  return `${halo}<path d="${pixelDisc(cx, cy, r)}" fill="${p.body}"/>`
}

function stars(phase: Phase): string {
  if (phase === 'day') return ''
  const count = phase === 'night' ? 110 : 30
  const ceiling = phase === 'night' ? 520 : 260
  let still = ''
  let twinkle = ''
  for (let i = 0; i < count; i += 1) {
    const x = snap(hash(i, 3) * 1600) / 2 * 2
    const y = Math.round((hash(i, 4) ** 1.2 * ceiling) / 4) * 4
    const s = hash(i, 5) < 0.2 ? 4 : 2
    if (hash(i, 6) < 0.3) twinkle += `<rect class="tw" style="animation-duration:${n1(2 + hash(i, 7) * 4)}s;animation-delay:-${n1(hash(i, 8) * 5)}s" x="${x}" y="${y}" width="${s}" height="${s}"/>`
    else still += `M${x} ${y}h${s}v${s}h-${s}z`
  }
  return `<g fill="#f2f4ff" opacity="${phase === 'night' ? 0.9 : 0.55}"><path d="${still}"/>${twinkle}</g>`
}

/** Blocky clouds drifting slowly across the upper sky. */
function clouds(p: Palette, phase: Phase): string {
  const opacity = phase === 'night' ? 0.4 : phase === 'dusk' ? 0.55 : 0.75
  const spots: readonly (readonly [number, number, number])[] = [
    [120, 88, 0],
    [680, 64, 1],
    [1180, 120, 2],
    [440, 200, 3],
  ]
  let out = ''
  for (const [x, y, i] of spots) {
    const w = snap(120 + hash(i, 41) * 100)
    const d = `M0 16h${w}v16h-${w}zM${snap(w * 0.15)} 8h${snap(w * 0.6)}v8h-${snap(w * 0.6)}zM${snap(w * 0.3)} 0h${snap(w * 0.3)}v8h-${snap(w * 0.3)}zM${snap(w * 0.1)} 32h${snap(w * 0.75)}v8h-${snap(w * 0.75)}z`
    out += `<g transform="translate(${x} ${y})"><g class="drift" style="animation-duration:${110 + i * 30}s;animation-delay:-${i * 40}s"><path d="${d}"/></g></g>`
  }
  return `<g fill="${p.cloud}" opacity="${opacity}">${out}</g>`
}

function farLayer(p: Palette): string {
  let d = ''
  let dots = ''
  for (const b of FAR_BLOCKS) {
    d += `M${b.x} ${b.top}h${b.w}V1000H${b.x}z`
    if (b.roof < 0.3) d += `M${b.x + snap(b.w / 2) - 4} ${b.top - 40}h8v40h-8z`
    for (let y = b.top + 16; y < 980; y += 24) {
      for (let x = b.x + 8; x < b.x + b.w - 8; x += 16) {
        if (hash(x, y) < 0.18) dots += `M${x} ${y}h4v4h-4z`
      }
    }
  }
  return `<path d="${d}" fill="${p.far}"/><path d="${dots}" fill="${mix(p.far, p.lit, 0.45)}" opacity="${0.35 + p.dark * 0.4}"/>`
}

interface Lights {
  glass: string
  lit: string
  flicker: string
}

function windows(b: Block, litShare: number, flickerShare: number, blackout: boolean, out: Lights): void {
  const marginX = 10
  const cols = Math.max(1, Math.floor((b.w - marginX * 2 + 8) / 16))
  const offset = b.x + Math.floor((b.w - (cols * 16 - 8)) / 2)
  for (let y = b.top + 16; y < 950; y += 20) {
    for (let c = 0; c < cols; c += 1) {
      const x = offset + c * 16
      const h = hash(x, y + 7)
      const cell = `M${x} ${y}h8v10h-8z`
      if (blackout || h >= litShare) {
        out.glass += cell
      } else if (hash(y, x + 3) < flickerShare) {
        out.flicker += `<rect class="fl" style="animation-duration:${n1(0.6 + hash(x, y) * 2.4)}s;animation-delay:-${n1(hash(y, x) * 3)}s" x="${x}" y="${y}" width="8" height="10"/>`
      } else {
        out.lit += cell
      }
    }
  }
}

function nearLayer(p: Palette, ctx: SceneCtx): string {
  const blackout = ctx.activity === 'error'
  const lights: Lights = { glass: '', lit: '', flicker: '' }
  let facades = ''
  let shade = ''
  let roofs = ''
  let snow = ''
  let beacons = ''
  for (const b of NEAR_BLOCKS) {
    const dead = blackout && b === DARK_BLOCK
    // Each block takes its own shade: some cooler, some warmer brick, some darker glass towers.
    const warm = mix(p.near, '#8a5a4a', 0.35 * (1 - p.dark * 0.6))
    const tone = dead ? mix(p.near, '#000000', 0.55) : b.tone < 0.3 ? mix(p.near, warm, 0.8) : b.tone < 0.6 ? mix(p.near, p.edge, 0.5) : mix(p.near, p.sky[1], 0.12)
    facades += `<path d="M${b.x} ${b.top}h${b.w}V1000H${b.x}z" fill="${tone}"/>`
    shade += `M${b.x + b.w - 8} ${b.top}h8V1000h-8z`
    // A roof detail: a water tank, a stepped crown, or a mast whose light blinks at night.
    const mid = b.x + snap(b.w / 2)
    if (b.roof < 0.28) roofs += `M${mid - 16} ${b.top - 24}h32v24h-32zM${mid - 12} ${b.top - 32}h24v8h-24z`
    else if (b.roof < 0.5) roofs += `M${b.x + 8} ${b.top - 16}h${b.w - 16}v16h-${b.w - 16}zM${b.x + 24} ${b.top - 32}h${Math.max(8, b.w - 48)}v16h-${Math.max(8, b.w - 48)}z`
    else if (b.roof < 0.72 && b.top < 700) {
      roofs += `M${mid - 2} ${b.top - 64}h4v64h-4z`
      if (ctx.phase !== 'day') beacons += `<rect class="blink" style="animation-delay:-${n1(b.tone * 2)}s" x="${mid - 4}" y="${b.top - 72}" width="8" height="8"/>`
    } else roofs += `M${b.x + 8} ${b.top - 8}h16v8h-16z`
    if (ctx.season === 'winter') {
      snow += `M${b.x} ${b.top - 8}h${b.w}v8h-${b.w}z`
      if (b.roof < 0.28) snow += `M${mid - 16} ${b.top - 32}h32v8h-32z`
      if (b.roof >= 0.28 && b.roof < 0.5) snow += `M${b.x + 8} ${b.top - 24}h${b.w - 16}v8h-${b.w - 16}z`
    }
    windows(b, LIT[ctx.activity], FLICKER[ctx.activity], dead, lights)
  }
  const day = ctx.phase === 'day' || ctx.phase === 'dawn'
  const litColour = day ? mix(p.lit, '#ffffff', 0.25) : p.lit
  let out = `${facades}<path d="${shade}" fill="#000" opacity="0.18"/><path d="${roofs}" fill="${p.edge}"/>`
  out += `<path d="${lights.glass}" fill="${p.glass}" opacity="${day ? 0.75 : 0.9}"/>`
  out += `<g fill="${litColour}"><path d="${lights.lit}"/>${lights.flicker}</g>`
  if (!day) out += `<path d="${lights.lit}" fill="${p.lit}" opacity="0.35" filter="url(#bloom)"/>`
  if (snow !== '') out += `<path d="${snow}" fill="${mix('#f4f8ff', p.near, p.dark * 0.45)}"/>`
  if (beacons !== '') out += `<g fill="#ff4a4a">${beacons}</g>`
  return out
}

/** The red warning beacon on the block that lost its power, with a glow that swells with each flash. */
function errorBeacon(): string {
  const mid = DARK_BLOCK.x + snap(DARK_BLOCK.w / 2)
  const top = DARK_BLOCK.top - 40
  return `<path d="M${mid - 2} ${top + 8}h4v32h-4z" fill="#2a1a1e"/><circle class="alarm" cx="${mid}" cy="${top + 4}" r="70" fill="url(#redGlow)"/><rect class="alarmCore" x="${mid - 8}" y="${top}" width="16" height="12" fill="#ff3a3a"/>
<rect x="${DARK_BLOCK.x}" y="${DARK_BLOCK.top}" width="${DARK_BLOCK.w}" height="${1000 - DARK_BLOCK.top}" fill="#ff2a2a" class="alarmWash"/>`
}

const DRONE_LANES: readonly (readonly [number, number])[] = [
  [96, 34],
  [176, 46],
  [248, 28],
  [136, 58],
  [304, 40],
]

function drones(count: number, p: Palette): string {
  const hull = p.dark > 0.5 ? mix(p.far, '#ffffff', 0.25) : mix(p.edge, '#000000', 0.2)
  let out = ''
  for (let i = 0; i < count; i += 1) {
    const [y, seconds] = DRONE_LANES[i]!
    const reverse = i % 2 === 1
    const start = Math.round(150 + hash(i, 91) * 1300)
    const art = `<path d="M-12 0h24v6h-24zM-20 -4h12v2h-12zM8 -4h12v2h-12zM-16 -2h2v2h-2zM14 -2h2v2h-2zM-4 6h8v4h-8z" fill="${hull}"/><rect class="blink" style="animation-delay:-${n1(i * 0.4)}s" x="-2" y="8" width="4" height="4" fill="${i % 2 === 0 ? '#ff4a4a' : '#4aff9a'}"/><circle class="blink" style="animation-delay:-${n1(i * 0.4)}s" cx="0" cy="10" r="10" fill="url(#${i % 2 === 0 ? 'redGlow' : 'greenGlow'})"/>`
    out += `<g transform="translate(0 ${y})"><g class="${reverse ? 'flyL' : 'flyR'}" style="transform:translateX(${start}px);animation-duration:${seconds}s;animation-delay:-${n1((start / 1700) * seconds)}s"><g class="hover" style="animation-delay:-${i}s">${art}</g></g></g>`
  }
  return out
}

const FIREWORKS: readonly (readonly [number, number, string, number])[] = [
  [176, 260, '#ffd36a', 0],
  [1424, 230, '#ff7a9a', 0.9],
  [312, 170, '#7ae0ff', 1.7],
  [1288, 150, '#b6ff7a', 2.4],
]

function fireworks(): string {
  let out = ''
  for (const [x, y, colour, delay] of FIREWORKS) {
    let sparks = ''
    for (let k = 0; k < 14; k += 1) {
      const a = (k / 14) * Math.PI * 2
      sparks += `M${snap(x + Math.cos(a) * 88) - 4} ${snap(y + Math.sin(a) * 88) - 4}h8v8h-8zM${snap(x + Math.cos(a) * 60)} ${snap(y + Math.sin(a) * 60)}h6v6h-6zM${snap(x + Math.cos(a + 0.2) * 32)} ${snap(y + Math.sin(a + 0.2) * 32)}h4v4h-4z`
    }
    out += `<g class="burst" style="transform-origin:${x}px ${y}px;animation-delay:-${delay}s"><circle cx="${x}" cy="${y}" r="90" fill="url(#halo)" opacity="0.6"/><path d="${sparks}" fill="${colour}"/></g>`
    out += `<rect class="trail" style="animation-delay:-${delay}s" x="${x - 2}" y="${y}" width="4" height="16" fill="${colour}"/>`
  }
  return out
}

function seasonLayer(season: Season, p: Palette, phase: Phase): string {
  if (season === 'winter') {
    return `<g class="snowA"><rect x="-100" y="-300" width="1800" height="1400" fill="url(#snowP)"/></g><rect y="968" width="1600" height="32" fill="${mix('#eef4ff', p.street, p.dark * 0.5)}"/>`
  }
  if (season === 'autumn') {
    return `<rect width="1600" height="1000" fill="url(#haze)"/>`
  }
  if (season === 'summer') {
    let lines = ''
    for (let i = 0; i < 14; i += 1) {
      const y = snap(330 + i * 40 + hash(i, 5) * 20)
      const x = hash(i, 6) < 0.5 ? snap(hash(i, 7) * 360) : snap(1120 + hash(i, 7) * 400)
      lines += `<rect class="shimmer" style="animation-delay:-${n1(hash(i, 8) * 2)}s" x="${x}" y="${y}" width="${snap(80 + hash(i, 9) * 120)}" height="2"/>`
    }
    return `<g fill="${mix(p.sky[2], '#ffffff', 0.5)}" opacity="${phase === 'night' ? 0.15 : 0.45}">${lines}</g>`
  }
  // Spring: a shower that clears, and on a light sky a faint pixel rainbow.
  const bow = phase === 'day' || phase === 'dawn'
    ? `<g class="bow" fill="none" stroke-width="8">${['#ff8a8a', '#ffc46a', '#fff08a', '#8ae08a', '#8ac4ff', '#b48aff'].map((c, i) => `<path d="M${-40 + i * 8} 560A${420 - i * 8} ${420 - i * 8} 0 0 1 ${800 - i * 8} 560" stroke="${c}"/>`).join('')}</g>`
    : ''
  return `${bow}<g class="clearing"><g class="rain"><rect x="-100" y="-300" width="1800" height="1400" fill="url(#rainP)"/></g></g>`
}

function scene(ctx: SceneCtx): string {
  const { phase, activity, season } = ctx
  const p = PALETTES[phase]
  const style = `
.tw{animation:tw 4s steps(2) infinite}
.drift{animation:drift 140s ease-in-out infinite alternate}
.fl{animation:fl 1.6s steps(1) infinite}
.blink{animation:blink 1.4s steps(1) infinite}
.flyR{animation:flyR 40s linear infinite}.flyL{animation:flyL 40s linear infinite}
.hover{animation:hover 1.2s ease-in-out infinite alternate}
.alarm{opacity:.7;animation:alarm 1.1s ease-in-out infinite}
.alarmCore{animation:blink 1.1s steps(1) infinite}
.alarmWash{opacity:.06;animation:wash 1.1s ease-in-out infinite}
.burst{transform-box:view-box;transform:scale(1);opacity:.9;animation:burst 2.6s ease-out infinite}
.trail{opacity:0;animation:trail 2.6s ease-in infinite}
.snowA{animation:snow 12s linear infinite}
.shimmer{animation:shimmer 1.8s ease-in-out infinite alternate}
.rain{animation:rain .5s linear infinite}
.clearing{opacity:.12;animation:clear 24s ease-out 1 both}
.bow{opacity:.3;animation:bow 12s ease-in 1 both}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.2}}
@keyframes drift{from{transform:translateX(-48px)}to{transform:translateX(48px)}}
@keyframes fl{0%,100%{opacity:1}37%{opacity:.15}52%{opacity:1}71%{opacity:.4}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.1}}
@keyframes flyR{from{transform:translateX(-80px)}to{transform:translateX(1680px)}}
@keyframes flyL{from{transform:translateX(1680px)}to{transform:translateX(-80px)}}
@keyframes hover{from{transform:translateY(-3px)}to{transform:translateY(3px)}}
@keyframes alarm{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes wash{0%,100%{opacity:0}50%{opacity:.12}}
@keyframes burst{0%{transform:scale(.1);opacity:0}8%{opacity:1}60%{transform:scale(1);opacity:.9}100%{transform:scale(1.15);opacity:0}}
@keyframes trail{0%{opacity:1;transform:translateY(260px)}10%{opacity:1;transform:translateY(0)}12%,100%{opacity:0}}
@keyframes snow{from{transform:translate(0,0)}to{transform:translate(-32px,200px)}}
@keyframes shimmer{from{transform:translate(-6px,0) scaleY(1);opacity:.2}to{transform:translate(6px,1px) scaleY(2);opacity:1}}
@keyframes rain{from{transform:translate(0,0)}to{transform:translate(-16px,64px)}}
@keyframes clear{from{opacity:.75}to{opacity:.12}}
@keyframes bow{from{opacity:.05}to{opacity:.3}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`

  const defs = `<radialGradient id="halo"><stop offset="0" stop-color="${p.body}" stop-opacity="0.45"/><stop offset="0.4" stop-color="${p.body}" stop-opacity="0.12"/><stop offset="1" stop-color="${p.body}" stop-opacity="0"/></radialGradient>
<radialGradient id="redGlow"><stop offset="0" stop-color="#ff3a3a" stop-opacity="0.7"/><stop offset="1" stop-color="#ff3a3a" stop-opacity="0"/></radialGradient>
<radialGradient id="greenGlow"><stop offset="0" stop-color="#4aff9a" stop-opacity="0.6"/><stop offset="1" stop-color="#4aff9a" stop-opacity="0"/></radialGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0.3" stop-color="#e0a060" stop-opacity="0"/><stop offset="0.75" stop-color="#d89a5a" stop-opacity="${phase === 'night' ? 0.12 : 0.3}"/><stop offset="1" stop-color="#c88850" stop-opacity="${phase === 'night' ? 0.18 : 0.4}"/></linearGradient>
<filter id="bloom" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="4"/></filter>
<pattern id="snowP" width="160" height="200" patternUnits="userSpaceOnUse">${Array.from({ length: 9 }, (_, i) => `<rect x="${snap(hash(i, 71) * 152)}" y="${snap(hash(i, 72) * 192)}" width="${hash(i, 73) < 0.4 ? 6 : 4}" height="${hash(i, 73) < 0.4 ? 6 : 4}" fill="#f6f9ff"/>`).join('')}</pattern>
<pattern id="rainP" width="48" height="64" patternUnits="userSpaceOnUse"><path d="M36 0l-4 16M14 30l-4 16" stroke="${mix('#c8d8f0', p.sky[1], 0.2)}" stroke-width="2" stroke-opacity="0.7"/></pattern>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges"><style>${style}</style><defs>${defs}</defs>
${sky(p)}
${stars(phase)}
${sunOrMoon(phase, p)}
${clouds(p, phase)}
${farLayer(p)}
${season === 'autumn' ? seasonLayer(season, p, phase) : ''}
${drones(activity === 'agents' || activity === 'working' || activity === 'thinking' ? Math.max(0, Math.min(5, ctx.agents)) : 0, p)}
${nearLayer(p, ctx)}
<rect y="976" width="1600" height="24" fill="${p.street}"/>
${activity === 'error' ? errorBeacon() : ''}
${activity === 'success' ? fireworks() : ''}
${season === 'autumn' ? '' : seasonLayer(season, p, phase)}
</svg>`
}

function glass(ctx: SceneCtx): { blur: number; tint: string; opacity: number } {
  switch (ctx.phase) {
    case 'dawn':
      return { blur: 8, tint: '#f8eff0', opacity: 0.4 }
    case 'day':
      return { blur: 8, tint: '#eef4fa', opacity: 0.42 }
    case 'dusk':
      return { blur: 10, tint: '#171226', opacity: 0.46 }
    default:
      return { blur: 10, tint: '#080c1a', opacity: 0.42 }
  }
}

export const theme: LivingTheme = {
  id: 'city-grid',
  title: 'City Grid',
  blurb: 'A pixel skyline along both edges of the screen, low in the middle, under a sky that keeps the hour.',
  reacts: 'Windows light up as the agent works and flicker while tools run, a drone crosses for each subagent, a block blacks out under a red beacon on an error and fireworks go up on success; snow, haze, heat shimmer or spring rain follow the season.',
  window: 'auto',
  glass,
  scene,
}
