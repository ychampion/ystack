// Lighthouse: a headland at the right edge, a striped tower with its lamp, the sea running to a far horizon on the left.
// The sea is rows of wave glyphs that grow toward the viewer; the cliff is a stepped rock face with a glyph texture.
// The time of day sets the sky, the sun or moon and whether the lamp burns; the agent's activity sets the beam's sweep,
// the swell, the boats and the weather; the season dresses the headland (flowers, rougher autumn water, winter snow).
// Pure string building: no Math.random, no Date, the same string for the same moment.
import type { LivingTheme, SceneCtx } from './contract'

type Phase = SceneCtx['phase']
type Activity = SceneCtx['activity']
type Season = SceneCtx['season']

const HORIZON = 640
const LAMP_X = 1470
const LAMP_Y = 336

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Blend two #rrggbb colours: t = 0 gives a, 1 gives b. */
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

const n1 = (v: number): number => Math.round(v * 10) / 10

interface Palette {
  top: string
  mid: string
  low: string
  seaTop: string
  seaBot: string
  glyph: string
  foam: string
  rock: string
  rockDark: string
  tower: string
  stripe: string
  body: string
  glow: string
  /** 0 = full daylight, 1 = deep night: how far land colours sink toward the rock's shadow. */
  dark: number
}

const PALETTES: Record<Phase, Palette> = {
  dawn: {
    top: '#8b8fc0', mid: '#eab2b6', low: '#fbdcae', seaTop: '#d9aeb0', seaBot: '#6c6f98', glyph: '#fbe3cf', foam: '#fff4e6',
    rock: '#7c6670', rockDark: '#4f4256', tower: '#f6ebe4', stripe: '#c25a5e', body: '#ffe1a6', glow: '#ffcf8a', dark: 0.3,
  },
  day: {
    top: '#8cbde6', mid: '#c4def0', low: '#ecf3f2', seaTop: '#8fc0d6', seaBot: '#3c7ca4', glyph: '#e9f7ff', foam: '#ffffff',
    rock: '#8c7f70', rockDark: '#5d5249', tower: '#f8f5ef', stripe: '#c94b42', body: '#fff7da', glow: '#fff1c0', dark: 0,
  },
  dusk: {
    top: '#1c1934', mid: '#4f2c4e', low: '#c4663f', seaTop: '#6a3e4a', seaBot: '#141529', glyph: '#e89670', foam: '#ffc79a',
    rock: '#33283a', rockDark: '#1c1624', tower: '#cdb4ae', stripe: '#8c3640', body: '#ffad62', glow: '#ff9a52', dark: 0.65,
  },
  night: {
    top: '#040916', mid: '#0a152c', low: '#18284a', seaTop: '#13284a', seaBot: '#040914', glyph: '#6584b8', foam: '#a9c2ec',
    rock: '#18202e', rockDark: '#0c111b', tower: '#a3acbf', stripe: '#5c2c3a', body: '#eef2ff', glow: '#9fb6e8', dark: 0.85,
  },
}

/** Where the sun or moon sits, and its radius. */
const BODY: Record<Phase, readonly [number, number, number]> = {
  dawn: [250, 632, 44],
  day: [250, 150, 32],
  dusk: [330, 608, 48],
  night: [232, 162, 28],
}

const BEAM_SECONDS: Record<Activity, number> = { idle: 18, thinking: 10, working: 5, agents: 8, error: 6, success: 12 }
const SWELL: Record<Activity, number> = { idle: 1, thinking: 1.15, working: 1.7, agents: 1.3, error: 2.3, success: 0.55 }
const ROUGH: Record<Activity, number> = { idle: 1, thinking: 1.1, working: 1.4, agents: 1.2, error: 2.1, success: 0.45 }
const SEASON_ROUGH: Record<Season, number> = { spring: 1, summer: 0.9, autumn: 1.45, winter: 1.2 }
const GRASS: Record<Season, string> = { spring: '#86b45e', summer: '#7a9e48', autumn: '#a88848', winter: '#7d8a74' }
const FLOWERS: Record<Season, readonly string[]> = {
  spring: ['#f6b8cc', '#ffffff', '#f7e37e', '#d9a6f0'],
  summer: ['#f3c94a', '#e8654a', '#fff1d6', '#f28a3c'],
  autumn: [],
  winter: [],
}

/** The headland's top edge at column x (only meaningful from x = 1180 rightward). */
function cliffTop(x: number): number {
  if (x < 1240) return HORIZON + 8 - (x - 1180) * 1.4
  if (x < 1330) return 564 - (x - 1240) * 0.25
  return 541 + Math.round((hash(Math.floor(x / 20), 5) - 0.5) * 4)
}

/** The rock face's left edge at row y, below the waterline. */
function cliffLeft(y: number): number {
  return 1180 - (y - HORIZON) * 0.17
}

/** The face's left edge at any row: the sloping shoulder above the waterline, the sheer face below it. */
function faceLeft(y: number): number {
  if (y >= HORIZON + 8) return cliffLeft(y)
  if (y >= 564) return 1180 + (HORIZON + 8 - y) / 1.4
  return 1240 + (564 - y) / 0.25
}

function sky(p: Palette): string {
  return `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.top}"/><stop offset="0.55" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.low}"/></linearGradient>
<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.seaTop}"/><stop offset="1" stop-color="${p.seaBot}"/></linearGradient>`
}

function stars(phase: Phase): string {
  const count = phase === 'night' ? 120 : phase === 'dusk' ? 36 : phase === 'dawn' ? 18 : 0
  const ceiling = phase === 'night' ? HORIZON - 40 : 300
  let still = ''
  let twinkling = ''
  for (let i = 0; i < count; i += 1) {
    const x = Math.round(hash(i, 11) * 1600)
    const y = Math.round(hash(i, 12) ** 1.3 * ceiling)
    const r = n1(0.6 + hash(i, 13) * 1.3)
    if (hash(i, 14) < 0.3) twinkling += `<circle class="tw" style="animation-duration:${n1(3 + hash(i, 15) * 5)}s;animation-delay:-${n1(hash(i, 16) * 6)}s" cx="${x}" cy="${y}" r="${r}"/>`
    else still += `<circle cx="${x}" cy="${y}" r="${r}"/>`
  }
  const fade = phase === 'night' ? 0.9 : 0.5
  return `<g fill="#f4f6ff" opacity="${fade}">${still}${twinkling}</g>`
}

function sunOrMoon(phase: Phase, p: Palette): string {
  const [x, y, r] = BODY[phase]
  const halo = `<circle cx="${x}" cy="${y}" r="${r * 6}" fill="url(#halo)"/>`
  if (phase === 'night') {
    return `${halo}<g><circle cx="${x}" cy="${y}" r="${r}" fill="${p.body}"/><circle cx="${x + 11}" cy="${y - 7}" r="${r - 2}" fill="${p.mid}" opacity="0.92"/><circle cx="${x - 12}" cy="${y + 8}" r="3" fill="#d4dcf2" opacity="0.6"/></g>`
  }
  const clip = phase === 'day' ? '' : ` clip-path="url(#aboveSea)"`
  return `${halo}<circle cx="${x}" cy="${y}" r="${r}" fill="${p.body}"${clip}/>`
}

/** Soft cloud banks drifting across the upper sky, each a cluster of ellipses. */
function clouds(p: Palette, phase: Phase): string {
  const tone = phase === 'night' ? mix(p.mid, '#4a5a80', 0.35) : phase === 'dusk' ? mix(p.mid, p.low, 0.45) : mix('#ffffff', p.mid, 0.25)
  const opacity = phase === 'night' ? 0.35 : phase === 'dusk' ? 0.55 : 0.7
  const banks: readonly (readonly [number, number, number, number])[] = [
    [140, 300, 1.2, 140],
    [760, 90, 1, 180],
    [1180, 200, 0.8, 160],
    [520, 380, 0.7, 210],
  ]
  let out = ''
  banks.forEach(([x, y, s, seconds], i) => {
    let puffs = ''
    for (let k = 0; k < 6; k += 1) {
      const dx = (k - 2.5) * 34 * s + (hash(i, k) - 0.5) * 20
      const dy = (hash(k, i + 9) - 0.5) * 12 * s
      puffs += `<ellipse cx="${n1(dx)}" cy="${n1(dy)}" rx="${n1((46 + hash(i + 3, k) * 30) * s)}" ry="${n1((14 + hash(k, i + 4) * 10) * s)}"/>`
    }
    out += `<g transform="translate(${x} ${y})"><g class="drift" style="animation-duration:${seconds}s;animation-delay:-${i * 31}s">${puffs}</g></g>`
  })
  return `<g fill="${tone}" opacity="${opacity}">${out}</g>`
}

/** Rows of wave glyphs from the horizon to the foot of the screen, nearer rows larger, each swaying on its own. */
function seaRows(p: Palette, rough: number, swell: number): string {
  const rows = 21
  let out = ''
  const foamChance = 0.025 * rough
  for (let i = 0; i < rows; i += 1) {
    const t = (i + 1) / rows
    const y = n1(HORIZON + 6 + 356 * t ** 1.65)
    const size = n1(7 + 17 * t)
    const count = Math.ceil(1800 / (size * 0.6))
    let base = ''
    let foam = ''
    for (let c = 0; c < count; c += 1) {
      const h = hash(c, i * 7 + 3)
      const wave = h < 0.3 ? '~' : h < 0.48 ? '-' : h < 0.56 ? '=' : h < 0.6 ? '.' : ' '
      base += wave
      foam += hash(c + 5, i * 13 + 1) < foamChance * (0.6 + t) ? '~' : ' '
    }
    const amplitude = Math.round((10 + 18 * t) * rough)
    const seconds = n1((7 + hash(i, 99) * 6) / swell)
    const style = `animation-duration:${seconds}s;animation-delay:-${n1(hash(i, 98) * seconds)}s`
    const opacity = n1(0.22 + 0.4 * t)
    out += `<g class="sway" style="${style};--a:${amplitude}px"><text x="-90" y="${y}" font-size="${size}" fill="${p.glyph}" opacity="${opacity}">${base}</text><text x="-90" y="${y}" font-size="${size}" fill="${p.foam}" opacity="${n1(Math.min(0.95, opacity + 0.3))}">${foam}</text></g>`
  }
  return out
}

/** The broken column of light on the water under the sun or moon. */
function glitter(phase: Phase, p: Palette, rough: number): string {
  const [bx] = BODY[phase]
  let out = ''
  for (let i = 0; i < 38; i += 1) {
    const t = i / 38
    const y = Math.round(HORIZON + 6 + t * 300)
    const spread = 20 + t * 150
    const x = Math.round(bx + (hash(i, 41) - 0.5) * spread * 2)
    const w = Math.round(10 + hash(i, 42) * (24 + t * 50))
    out += `<rect class="tw" style="animation-duration:${n1(2 + hash(i, 43) * 3 / rough)}s;animation-delay:-${n1(hash(i, 44) * 4)}s" x="${x - w / 2}" y="${y}" width="${w}" height="${n1(1.5 + t * 3)}" rx="1"/>`
  }
  const strength = phase === 'day' ? 0.75 : phase === 'night' ? 0.55 : 0.85
  return `<g fill="${mix(p.body, '#ffffff', 0.3)}" opacity="${strength}">${out}</g>`
}

function headland(p: Palette, season: Season): string {
  // The rock: a stepped outline (10 px columns, 6 px rows) from the waterline up to the plateau and off the right edge.
  let edge = `M1600 1000L${n1(cliffLeft(1000))} 1000`
  for (let y = 1000; y >= HORIZON + 8; y -= 12) edge += `L${Math.round(cliffLeft(y) / 6) * 6} ${y}`
  for (let x = 1180; x <= 1600; x += 10) edge += `L${x} ${Math.round(cliffTop(x) / 6) * 6}`
  edge += 'Z'
  let texture = ''
  const tones = ['#', '%', '=', ':', '/']
  for (let gy = 552; gy < 1000; gy += 13) {
    let xs = ''
    let glyphs = ''
    for (let gx = 1130; gx < 1600; gx += 11) {
      if (gy < cliffTop(gx) + 10 || gx < (gy > HORIZON ? cliffLeft(gy) + 8 : 1200)) continue
      if (hash(gx, gy) > 0.42) continue
      xs += `${gx} `
      glyphs += tones[Math.floor(hash(gy, gx) * tones.length)]
    }
    if (xs !== '') texture += `<text x="${xs.trim()}" y="${gy}" font-size="11">${glyphs}</text>`
  }
  // Strata: a few darker ledges that make the face read as layered stone.
  let strata = ''
  for (let i = 0; i < 9; i += 1) {
    const y = 572 + i * 46 + Math.round(hash(i, 3) * 14)
    const from = faceLeft(y) + 14
    strata += `<rect x="${Math.round(from)}" y="${y}" width="${Math.round(1600 - from)}" height="4" opacity="${n1(0.25 + hash(i, 4) * 0.3)}"/>`
  }
  const grass = mix(GRASS[season], p.rockDark, p.dark * 0.85)
  let blades = ''
  for (let x = 1236; x < 1600; x += 7) {
    const h = hash(x, 21)
    blades += `<text x="${x}" y="${n1(cliffTop(x) + 2)}" font-size="${10 + Math.round(h * 5)}">${h < 0.4 ? '"' : h < 0.7 ? "'" : ','}</text>`
  }
  const top = `<path d="M1236 ${cliffTop(1236) + 6}${Array.from({ length: 37 }, (_, i) => 1240 + i * 10).map(x => `L${x} ${n1(cliffTop(x) - 3 - hash(x, 2) * 3)}`).join('')}L1600 560L1236 570Z" fill="${grass}"/>`
  let flowers = ''
  const colours = FLOWERS[season]
  if (colours.length > 0) {
    for (let i = 0; i < 46; i += 1) {
      const x = Math.round(1246 + hash(i, 61) * 350)
      if (x > 1340 && x < 1420) continue
      const y = n1(cliffTop(x) - 4 - hash(i, 62) * 6)
      flowers += `<circle cx="${x}" cy="${y}" r="${n1(1.6 + hash(i, 63) * 1.6)}" fill="${mix(colours[i % colours.length]!, p.rockDark, p.dark * 0.6)}"/>`
    }
  }
  let snow = ''
  if (season === 'winter') {
    const white = mix('#f6f9ff', p.rockDark, p.dark * 0.45)
    snow += `<path d="M1232 ${cliffTop(1232) + 4}${Array.from({ length: 38 }, (_, i) => 1236 + i * 10).map(x => `L${x} ${n1(cliffTop(x) - 6 - hash(x, 8) * 4)}`).join('')}L1600 552L1600 548${Array.from({ length: 38 }, (_, i) => 1596 - i * 10).map(x => `L${x} ${n1(cliffTop(x) + 4 + hash(x, 9) * 6)}`).join('')}Z" fill="${white}"/>`
    for (let i = 0; i < 9; i += 1) {
      const y = 572 + i * 46 + Math.round(hash(i, 3) * 14)
      const from = faceLeft(y) + 14
      for (let k = 0; k < 3; k += 1) snow += `<rect x="${Math.round(from + hash(i, 5 + k) * 300)}" y="${y - 3}" width="${Math.round(14 + hash(i, 6 + k) * 40)}" height="3" rx="1.5" fill="${white}" opacity="0.85"/>`
    }
  }
  // Vertical cracks and the surf that breaks along the foot of the face.
  let cracks = ''
  for (let i = 0; i < 14; i += 1) {
    const x0 = Math.round(1200 + hash(i, 31) * 390)
    const y0 = Math.round(Math.max(cliffTop(x0) + 20, 560) + hash(i, 32) * 300)
    if (x0 < faceLeft(y0) + 20) continue
    let d = `M${x0} ${y0}`
    let x = x0
    for (let k = 1; k <= 5; k += 1) {
      x += Math.round((hash(i, 33 + k) - 0.5) * 14)
      d += `L${x} ${y0 + k * 22}`
    }
    cracks += d
  }
  let surf = ''
  for (let y = HORIZON + 12; y < 1000; y += 18) {
    const t = (y - HORIZON) / 360
    const x = Math.round(cliffLeft(y) - 10 - t * 40)
    surf += `<text class="surf" style="animation-delay:-${n1(hash(y, 7) * 3)}s" x="${x - Math.round(hash(y, 8) * 30)}" y="${y}" font-size="${Math.round(9 + t * 12)}">${'~'.repeat(2 + Math.floor(hash(y, 9) * 3))}</text>`
  }
  return `<path d="${edge}" fill="url(#rockG)"/><path d="${cracks}" fill="none" stroke="${p.rockDark}" stroke-width="2" opacity="0.5"/><g fill="${mix(p.foam, p.seaBot, 0.15)}" opacity="0.75">${surf}</g><g fill="${p.rockDark}">${strata}</g><g fill="${mix(p.rock, '#ffffff', 0.3 * (1 - p.dark) + 0.08)}" opacity="0.55">${texture}</g>${top}<g fill="${mix(grass, '#ffffff', 0.15)}">${blades}</g>${flowers}${snow}`
}

function tower(p: Palette, lit: boolean, phase: Phase): string {
  const body = 'M1446 541L1455 362L1485 362L1494 541Z'
  const shade = 'M1474 541L1474 362L1485 362L1494 541Z'
  const stripes = [380, 440, 500].map(y => `<rect x="1440" y="${y}" width="60" height="24"/>`).join('')
  const glass = lit ? '#ffe7a3' : mix(p.seaBot, '#ffffff', 0.25)
  const window = lit || phase === 'night' || phase === 'dusk' ? '#ffd27a' : mix(p.seaBot, '#ffffff', 0.15)
  return `<clipPath id="towerClip"><path d="${body}"/></clipPath>
<g><path d="M1350 541L1350 514L1380 494L1410 514L1410 541Z" fill="${mix(p.tower, p.rockDark, 0.25)}"/><path d="M1344 516L1380 490L1416 516L1410 518L1380 497L1350 518Z" fill="${p.stripe}"/><rect x="1362" y="522" width="8" height="10" fill="${window}"/><rect x="1388" y="522" width="8" height="10" fill="${window}"/></g>
<path d="${body}" fill="${p.tower}"/><g clip-path="url(#towerClip)" fill="${p.stripe}">${stripes}</g><path d="${shade}" fill="#000" opacity="0.16"/>
<rect x="1466" y="512" width="8" height="29" rx="4" fill="${mix(p.stripe, '#000000', 0.4)}"/>
<rect x="1443" y="356" width="54" height="6" fill="${mix(p.tower, p.rockDark, 0.5)}"/><path d="M1445 356V348M1453 356V348M1461 356V348M1479 356V348M1487 356V348M1495 356V348M1444 348H1496" stroke="${mix(p.tower, p.rockDark, 0.5)}" stroke-width="1.5"/>
<rect x="1457" y="322" width="26" height="34" fill="${glass}"/><path d="M1464 322V356M1476 322V356" stroke="${mix(p.tower, p.rockDark, 0.55)}" stroke-width="1.5"/>
<path d="M1451 323L1489 323L1470 302Z" fill="${p.stripe}"/><circle cx="1470" cy="299" r="3" fill="${p.stripe}"/>`
}

/** The lamp's halo and the beam, which narrows to a point and swings round as the lens turns. */
function beam(phase: Phase, activity: Activity, lit: boolean): string {
  if (!lit) return ''
  const sweeping = phase !== 'day' || activity !== 'idle'
  const strength = phase === 'night' ? 0.62 : phase === 'dusk' ? 0.5 : phase === 'dawn' ? 0.34 : 0.24
  const seconds = BEAM_SECONDS[activity]
  const halo = `<circle class="flash" style="animation-duration:${seconds}s" cx="${LAMP_X}" cy="${LAMP_Y}" r="70" fill="url(#lamp)"/>`
  if (!sweeping) return halo
  return `<g opacity="${strength}"><g class="beam" style="animation-duration:${seconds}s"><path d="M${LAMP_X} ${LAMP_Y - 6}L330 236L330 448L${LAMP_X} ${LAMP_Y + 6}Z" fill="url(#beamFar)"/><path d="M${LAMP_X} ${LAMP_Y - 3}L520 290L520 384L${LAMP_X} ${LAMP_Y + 3}Z" fill="url(#beamNear)"/></g></g>${halo}`
}

interface BoatSpot {
  x: number
  y: number
  scale: number
}

const AGENT_BOATS: readonly BoatSpot[] = [
  { x: 150, y: 700, scale: 1.05 },
  { x: 1020, y: 708, scale: 1.1 },
  { x: 360, y: 668, scale: 0.75 },
  { x: 1130, y: 676, scale: 0.8 },
  { x: 520, y: 654, scale: 0.55 },
]

function boat(spot: BoatSpot, p: Palette, sail: boolean, light: boolean, cruise: string, index: number): string {
  const hull = mix(p.seaBot, '#000000', 0.35)
  const canvas = mix('#fbf4e6', p.seaBot, p.dark * 0.6)
  const body = sail
    ? `<path d="M1 -3V-34" stroke="${hull}" stroke-width="1.6"/><path d="M3 -5L3 -32L22 -5Z" fill="${canvas}"/><path d="M-1 -7L-1 -26L-14 -7Z" fill="${mix(canvas, p.stripe, 0.35)}"/>`
    : `<rect x="-8" y="-10" width="13" height="10" fill="${mix(p.tower, p.seaBot, 0.45)}"/><path d="M-3 -10V-24" stroke="${hull}" stroke-width="1.4"/>`
  const lamp = light ? `<circle cx="${sail ? 1 : -3}" cy="${sail ? -36 : -25}" r="9" fill="url(#lamp)"/><circle cx="${sail ? 1 : -3}" cy="${sail ? -36 : -25}" r="2" fill="#ffe7a3"/>` : ''
  return `<g transform="translate(${spot.x} ${spot.y}) scale(${spot.scale})"><g class="${cruise}" style="animation-delay:-${index * 13}s"><g class="bob" style="animation-delay:-${n1(index * 0.7)}s">${body}<path d="M-22 0L22 0L16 8L-17 8Z" fill="${hull}"/>${lamp}</g></g></g>`
}

function boats(p: Palette, ctx: SceneCtx): string {
  const lights = ctx.phase !== 'day'
  const cruise = ctx.activity === 'working' ? 'cruise' : 'moor'
  let out = boat({ x: 640, y: 652, scale: 0.5 }, p, false, lights, cruise, 0) + boat({ x: 930, y: 662, scale: 0.62 }, p, false, lights, cruise, 1)
  const count = Math.max(0, Math.min(5, ctx.agents))
  for (let i = 0; i < count; i += 1) out += boat(AGENT_BOATS[i]!, p, true, lights, 'moor', i + 2)
  return out
}

function gulls(p: Palette, phase: Phase): string {
  if (phase === 'night') return ''
  const spots: readonly (readonly [number, number, number])[] = [
    [180, 260, 1],
    [260, 300, 0.8],
    [1300, 250, 0.9],
    [1380, 210, 0.7],
    [90, 340, 0.6],
  ]
  const colour = phase === 'dusk' ? '#2a1e2e' : mix('#3e4a5a', p.mid, 0.2)
  return spots
    .slice(0, phase === 'dusk' ? 2 : 5)
    .map(([x, y, s], i) => `<g transform="translate(${x} ${y}) scale(${s})"><g class="glide" style="animation-delay:-${i * 7}s"><path class="flap" style="animation-delay:-${n1(i * 0.37)}s" d="M-12 0Q-6 -7 0 0Q6 -7 12 0" fill="none" stroke="${colour}" stroke-width="2.2" stroke-linecap="round"/></g></g>`)
    .join('')
}

function storm(p: Palette): string {
  let puffs = ''
  for (let i = 0; i < 16; i += 1) {
    const x = Math.round(-60 + i * 112 + hash(i, 71) * 50)
    const y = Math.round(40 + hash(i, 72) * 120)
    puffs += `<ellipse cx="${x}" cy="${y}" rx="${Math.round(110 + hash(i, 73) * 80)}" ry="${Math.round(50 + hash(i, 74) * 40)}"/>`
  }
  const cloud = mix(p.rockDark, '#3a4050', 0.5)
  return `<rect width="1600" height="1000" fill="#0a0e18" opacity="0.32"/>
<g class="roll"><g fill="${cloud}" opacity="0.92">${puffs}</g><g fill="${mix(cloud, '#000000', 0.3)}" opacity="0.6"><rect x="-100" y="0" width="1800" height="60"/></g></g>
<path class="bolt" d="M420 150L392 260L414 262L380 380L436 236L412 234L444 150Z" fill="#f2f4ff"/>
<rect class="lightning" width="1600" height="1000" fill="#eef2ff"/>
<g opacity="0.45"><g class="rain"><rect x="-200" y="-200" width="2000" height="1400" fill="url(#rainP)"/></g></g>`
}

function successGlow(phase: Phase): string {
  if (phase === 'night') {
    return `<g transform="translate(1250 545)"><g class="flare"><circle r="90" fill="url(#flareGlow)"/><circle r="5" fill="#fff0c8"/></g></g><ellipse class="breathe" cx="1100" cy="${HORIZON}" rx="520" ry="150" fill="url(#gold)" opacity="0.4"/>`
  }
  return `<ellipse class="breathe" cx="520" cy="${HORIZON}" rx="980" ry="360" fill="url(#gold)"/>`
}

function snowfall(): string {
  return `<g opacity="0.85"><g class="snowA"><rect x="-200" y="-400" width="2000" height="1600" fill="url(#snowA)"/></g></g><g opacity="0.6"><g class="snowB"><rect x="-200" y="-400" width="2000" height="1600" fill="url(#snowB)"/></g></g>`
}

function scene(ctx: SceneCtx): string {
  const { phase, activity, season } = ctx
  const p = PALETTES[phase]
  const rough = ROUGH[activity] * SEASON_ROUGH[season]
  const swell = SWELL[activity]
  const lit = phase !== 'day' || activity === 'thinking' || activity === 'working' || activity === 'agents' || activity === 'error'

  const style = `
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:700}
.sway{animation:sway 9s ease-in-out infinite alternate}
.drift{animation:drift 160s ease-in-out infinite alternate}
.tw{animation:tw 5s ease-in-out infinite}
.beam{transform-box:view-box;transform-origin:${LAMP_X}px ${LAMP_Y}px;animation:sweep 12s ease-in-out infinite}
.surf{animation:surf 3s ease-in-out infinite alternate}
.flash{opacity:.6;animation:flash 12s ease-in-out infinite}
.bob{animation:bob 4.6s ease-in-out infinite alternate}
.moor{animation:moor 38s ease-in-out infinite alternate}
.cruise{animation:cruise 26s ease-in-out infinite alternate}
.glide{animation:glide 30s ease-in-out infinite alternate}
.flap{transform-box:fill-box;transform-origin:center;animation:flap .9s ease-in-out infinite alternate}
.roll{animation:roll 7s ease-out 1 both}
.rain{animation:rain .45s linear infinite}
.lightning{opacity:0;animation:light 5.5s linear infinite}
.bolt{opacity:0;animation:light 5.5s linear infinite}
.breathe{opacity:.8;animation:breathe 4s ease-in-out infinite alternate}
.flare{transform:translate(-120px,-360px);animation:flare 8s ease-out infinite}
.snowA{animation:fall 14s linear infinite}.snowB{animation:fallB 22s linear infinite}
@keyframes sway{from{transform:translateX(calc(var(--a) * -1))}to{transform:translateX(var(--a))}}
@keyframes drift{from{transform:translateX(-60px)}to{transform:translateX(60px)}}
@keyframes tw{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes sweep{0%{transform:scaleX(1)}25%{transform:scaleX(.02)}50%{transform:scaleX(-1)}75%{transform:scaleX(-.02)}100%{transform:scaleX(1)}}
@keyframes surf{from{opacity:.35;transform:translateX(6px)}to{opacity:1;transform:translateX(-6px)}}
@keyframes flash{0%,14%,36%,100%{opacity:.5}25%{opacity:1}}
@keyframes bob{from{transform:translateY(-2px) rotate(-2deg)}to{transform:translateY(2px) rotate(2deg)}}
@keyframes moor{from{transform:translateX(-14px)}to{transform:translateX(14px)}}
@keyframes cruise{from{transform:translateX(-160px)}to{transform:translateX(160px)}}
@keyframes glide{from{transform:translate(-40px,6px)}to{transform:translate(50px,-8px)}}
@keyframes flap{from{transform:scaleY(1)}to{transform:scaleY(.35)}}
@keyframes roll{from{transform:translateX(420px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes rain{from{transform:translate(0,0)}to{transform:translate(-20px,80px)}}
@keyframes light{0%,86%{opacity:0}87%{opacity:.55}88%{opacity:0}90%{opacity:.4}93%,100%{opacity:0}}
@keyframes breathe{from{opacity:.55}to{opacity:1}}
@keyframes flare{0%{transform:translate(0,0);opacity:1}30%{transform:translate(-110px,-370px);opacity:1}100%{transform:translate(-150px,-250px);opacity:.15}}
@keyframes fall{from{transform:translate(0,0)}to{transform:translate(-40px,200px)}}
@keyframes fallB{from{transform:translate(0,0)}to{transform:translate(30px,260px)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`

  const defs = `${sky(p)}
<radialGradient id="halo"><stop offset="0" stop-color="${p.glow}" stop-opacity="0.55"/><stop offset="0.3" stop-color="${p.glow}" stop-opacity="0.2"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/></radialGradient>
<radialGradient id="lamp"><stop offset="0" stop-color="#fff6d0" stop-opacity="0.95"/><stop offset="0.25" stop-color="#ffe08a" stop-opacity="0.5"/><stop offset="1" stop-color="#ffd070" stop-opacity="0"/></radialGradient>
<linearGradient id="beamFar" gradientUnits="userSpaceOnUse" x1="${LAMP_X}" y1="0" x2="330" y2="0"><stop offset="0" stop-color="#fff2c2" stop-opacity="0.75"/><stop offset="0.5" stop-color="#fff2c2" stop-opacity="0.22"/><stop offset="1" stop-color="#fff2c2" stop-opacity="0"/></linearGradient>
<linearGradient id="beamNear" gradientUnits="userSpaceOnUse" x1="${LAMP_X}" y1="0" x2="520" y2="0"><stop offset="0" stop-color="#fffbe6" stop-opacity="0.9"/><stop offset="1" stop-color="#fffbe6" stop-opacity="0"/></linearGradient>
<radialGradient id="gold"><stop offset="0" stop-color="#ffd27a" stop-opacity="0.6"/><stop offset="0.45" stop-color="#ffc35c" stop-opacity="0.22"/><stop offset="1" stop-color="#ffb84a" stop-opacity="0"/></radialGradient>
<radialGradient id="flareGlow"><stop offset="0" stop-color="#fff0c0" stop-opacity="0.9"/><stop offset="0.2" stop-color="#ff9a5a" stop-opacity="0.5"/><stop offset="1" stop-color="#ff6a4a" stop-opacity="0"/></radialGradient>
<radialGradient id="clearG" cx="0.5" cy="1" r="0.6"><stop offset="0" stop-color="#000"/><stop offset="0.55" stop-color="#555"/><stop offset="1" stop-color="#fff"/></radialGradient>
<mask id="clear" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><rect width="1600" height="1000" fill="#fff"/><rect x="180" y="640" width="1240" height="360" fill="url(#clearG)"/></mask>
<linearGradient id="rockG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(p.rock, '#ffffff', 0.12 * (1 - p.dark))}"/><stop offset="0.5" stop-color="${p.rock}"/><stop offset="1" stop-color="${p.rockDark}"/></linearGradient>
<clipPath id="aboveSea"><rect width="1600" height="${HORIZON}"/></clipPath>
<pattern id="rainP" width="40" height="80" patternUnits="userSpaceOnUse"><path d="M30 0L22 30M10 40L2 70" stroke="#d8e2f4" stroke-width="1.2" stroke-opacity="0.7"/></pattern>
<pattern id="snowA" width="200" height="200" patternUnits="userSpaceOnUse">${Array.from({ length: 8 }, (_, i) => `<circle cx="${Math.round(hash(i, 81) * 200)}" cy="${Math.round(hash(i, 82) * 200)}" r="${n1(1.4 + hash(i, 83) * 1.6)}" fill="#fbfdff"/>`).join('')}</pattern>
<pattern id="snowB" width="260" height="260" patternUnits="userSpaceOnUse">${Array.from({ length: 6 }, (_, i) => `<circle cx="${Math.round(hash(i, 84) * 260)}" cy="${Math.round(hash(i, 85) * 260)}" r="${n1(2 + hash(i, 86) * 2)}" fill="#fbfdff"/>`).join('')}</pattern>`

  const reflectedLamp = lit && phase !== 'day' ? `<g fill="#ffe3a0" opacity="0.5">${Array.from({ length: 14 }, (_, i) => `<rect class="tw" style="animation-delay:-${n1(hash(i, 51) * 4)}s" x="${Math.round(1150 + (hash(i, 52) - 0.5) * 60 - i * 3)}" y="${HORIZON + 10 + i * 12}" width="${Math.round(10 + hash(i, 53) * 26)}" height="2" rx="1"/>`).join('')}</g>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>${style}</style><defs>${defs}</defs>
<rect width="1600" height="1000" fill="url(#sky)"/>
${stars(phase)}
${sunOrMoon(phase, p)}
${clouds(p, phase)}
${gulls(p, phase)}
<rect y="${HORIZON}" width="1600" height="${1000 - HORIZON}" fill="url(#sea)"/>
<rect y="${HORIZON - 1}" width="1600" height="2" fill="${mix(p.low, '#ffffff', 0.3)}" opacity="0.5"/>
<g mask="url(#clear)">${glitter(phase, p, rough)}${reflectedLamp}${seaRows(p, rough, swell)}</g>
${boats(p, ctx)}
${beam(phase, activity, lit)}
${headland(p, season)}
${tower(p, lit, phase)}
${lit ? `<circle cx="${LAMP_X}" cy="${LAMP_Y}" r="22" fill="url(#lamp)"/>` : ''}
${activity === 'error' ? storm(p) : ''}
${activity === 'success' ? successGlow(phase) : ''}
${season === 'winter' ? snowfall() : ''}
</svg>`
}

function glass(ctx: SceneCtx): { blur: number; tint: string; opacity: number } {
  switch (ctx.phase) {
    case 'dawn':
      return { blur: 10, tint: '#fbf1ea', opacity: 0.4 }
    case 'day':
      return { blur: 10, tint: '#f1f6fa', opacity: 0.42 }
    case 'dusk':
      return { blur: 12, tint: '#1c1426', opacity: 0.46 }
    default:
      return { blur: 12, tint: '#0a1120', opacity: 0.44 }
  }
}

export const theme: LivingTheme = {
  id: 'lighthouse',
  title: 'Lighthouse',
  blurb: 'A striped lighthouse on a headland at the right edge, the sea running out to a far horizon.',
  reacts: 'The beam sweeps faster as the agent works, a boat puts out for each subagent, a storm rolls in on an error and the sea calms gold on success; the sky follows the clock and the headland the season.',
  window: 'auto',
  glass,
  scene,
}
