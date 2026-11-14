// Tide Clock: a shore seen from the side. A dune rises on the left, a sand beach runs along the foot of the screen and the
// sea fills the middle out to a level horizon. The sky is a dial: a faint dotted arc carries the sun from the left horizon
// at dawn, high to the right by day and down to the right at dusk, and the moon rides it at night; the tide is higher at
// night, so the water climbs the beach and the dune foot. The agent's activity sets the wave speed and foam, a sailboat
// on the horizon for each subagent, a dark squall line on an error and a sparkling sun path on success. The season dresses
// the dune. Pure string building: no Math.random, no Date.
import type { LivingTheme, SceneCtx } from './contract'

type Phase = SceneCtx['phase']
type Activity = SceneCtx['activity']
type Season = SceneCtx['season']

const HORIZON = 600
const ARC_X = 800
const ARC_RX = 690
const ARC_RY = 470

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

const n1 = (v: number): number => Math.round(v * 10) / 10

interface Palette {
  sky: readonly [string, string, string]
  seaTop: string
  seaBot: string
  glyph: string
  foam: string
  sand: string
  wet: string
  dune: string
  body: string
  dark: number
}

const PALETTES: Record<Phase, Palette> = {
  dawn: { sky: ['#8187bd', '#efb5b2', '#fddcaa'], seaTop: '#d4aab2', seaBot: '#5e6c98', glyph: '#fbe2d2', foam: '#fff6ec', sand: '#ecceac', wet: '#c4a48e', dune: '#8f9a6c', body: '#ffe2a2', dark: 0.25 },
  day: { sky: ['#7db8e6', '#badaf0', '#eaf4f2'], seaTop: '#8cc6d8', seaBot: '#2e78a2', glyph: '#e8f8ff', foam: '#ffffff', sand: '#eed8ac', wet: '#c8b08a', dune: '#86a05a', body: '#fff7d8', dark: 0 },
  dusk: { sky: ['#1d1836', '#5a2e52', '#d06a40'], seaTop: '#6e3e4c', seaBot: '#121429', glyph: '#ea9a74', foam: '#ffd0a8', sand: '#6a4a46', wet: '#4a3438', dune: '#3c3c34', body: '#ffaa5c', dark: 0.65 },
  night: { sky: ['#040915', '#0b1630', '#1b2a4c'], seaTop: '#142c4c', seaBot: '#030812', glyph: '#6584b8', foam: '#b2c8ee', sand: '#2e3040', wet: '#1c1e2c', dune: '#1c2a26', body: '#eef2ff', dark: 0.86 },
}

/** Where the sun or moon sits on the dial, as an angle along the arc from the left horizon (0) to the right (180). */
const DIAL: Record<Phase, number> = { dawn: 13, day: 138, dusk: 167, night: 42 }

/** The tide: how high the water reaches up the dune foot (left) and the beach (bottom). Highest at night. */
const TIDE: Record<Phase, readonly [number, number]> = { dawn: [690, 952], day: [736, 930], dusk: [680, 958], night: [640, 976] }

const SPEED: Record<Activity, number> = { idle: 1, thinking: 1.2, working: 1.9, agents: 1.4, error: 2.3, success: 0.8 }
const FOAM: Record<Activity, number> = { idle: 1, thinking: 1.3, working: 2.4, agents: 1.6, error: 2.8, success: 0.9 }
const SEASON_FOAM: Record<Season, number> = { spring: 1, summer: 0.85, autumn: 1.35, winter: 1.15 }
const DUNE_GRASS: Record<Season, string> = { spring: '#8cbc62', summer: '#9aa84e', autumn: '#b08a4c', winter: '#8e9886' }

function dialPoint(degrees: number): readonly [number, number] {
  const a = (degrees * Math.PI) / 180
  return [Math.round(ARC_X - ARC_RX * Math.cos(a)), Math.round(HORIZON - ARC_RY * Math.sin(a))]
}

function sky(p: Palette, phase: Phase): string {
  let stars = ''
  if (phase !== 'day') {
    const count = phase === 'night' ? 120 : 26
    for (let i = 0; i < count; i += 1) {
      const x = Math.round(hash(i, 11) * 1600)
      const y = Math.round(hash(i, 12) ** 1.25 * (phase === 'night' ? HORIZON - 30 : 260))
      const cls = hash(i, 13) < 0.3 ? ` class="tw" style="animation-delay:-${n1(hash(i, 14) * 5)}s"` : ''
      stars += `<circle${cls} cx="${x}" cy="${y}" r="${n1(0.6 + hash(i, 15) * 1.2)}"/>`
    }
    stars = `<g fill="#f2f5ff" opacity="${phase === 'night' ? 0.9 : 0.5}">${stars}</g>`
  }
  // The dial: a dotted arc with a longer tick at each hour of the day the scene knows (dawn, day, dusk, night).
  const arc = `M${ARC_X - ARC_RX} ${HORIZON}A${ARC_RX} ${ARC_RY} 0 0 1 ${ARC_X + ARC_RX} ${HORIZON}`
  let ticks = ''
  for (const deg of Object.values(DIAL)) {
    const [x, y] = dialPoint(deg)
    ticks += `<circle cx="${x}" cy="${y}" r="5"/>`
  }
  const dialTone = phase === 'night' || phase === 'dusk' ? '#c8d2f0' : '#5a6a88'
  const [bx, by] = dialPoint(DIAL[phase])
  const r = phase === 'night' ? 30 : phase === 'day' ? 36 : 46
  const disc = phase === 'night'
    ? `<circle cx="${bx}" cy="${by}" r="${r}" fill="${p.body}"/><circle cx="${bx + 11}" cy="${by - 7}" r="${r - 3}" fill="${p.sky[1]}" opacity="0.92"/>`
    : `<circle cx="${bx}" cy="${by}" r="${r}" fill="${p.body}"${phase === 'day' ? '' : ' clip-path="url(#aboveSea)"'}/>`
  let clouds = ''
  const tone = phase === 'night' ? '#26355a' : phase === 'dusk' ? mix(p.sky[1], p.sky[2], 0.4) : '#ffffff'
  ;[[180, 150, 1], [760, 70, 1.1], [1120, 260, 0.8], [470, 330, 0.7]].forEach(([cx, cy, s], i) => {
    let puffs = ''
    for (let k = 0; k < 5; k += 1) puffs += `<ellipse cx="${n1((k - 2) * 34 * s!)}" cy="${n1((hash(k, i + 4) - 0.5) * 10)}" rx="${n1((42 + hash(i, k + 6) * 26) * s!)}" ry="${n1((12 + hash(k + 1, i) * 8) * s!)}"/>`
    clouds += `<g transform="translate(${cx} ${cy})"><g class="drift" style="animation-delay:-${i * 41}s">${puffs}</g></g>`
  })
  return `<rect width="1600" height="1000" fill="url(#sky)"/>${stars}<path d="${arc}" stroke="${dialTone}" stroke-width="2.4" stroke-dasharray="0.1 11" stroke-linecap="round" fill="none" opacity="0.32"/><g stroke="${dialTone}" stroke-width="1.6" fill="none" opacity="0.4">${ticks}</g><g fill="${tone}" opacity="${phase === 'night' ? 0.35 : 0.6}">${clouds}</g><circle cx="${bx}" cy="${by}" r="${r * 6}" fill="url(#halo)"/>${disc}`
}

/** The water's near edge on the sand, for the tide of this phase. */
function shorePath(phase: Phase): string {
  const [left, bottom] = TIDE[phase]
  return `M0 ${left}C150 ${left + 60} 320 ${bottom - 10} 620 ${bottom}L1600 ${bottom}`
}

function land(p: Palette, season: Season, phase: Phase): string {
  const sand = `M0 470C110 452 230 508 360 606L1600 606V1000H0Z`
  let grains = ''
  for (let i = 0; i < 260; i += 1) {
    const x = Math.round(hash(i, 51) * 1600)
    const y = Math.round(880 + hash(i, 52) * 120)
    const t = x / 360
    const yy = x < 360 ? Math.round(Math.max(470 - 10 * Math.sin(t * Math.PI) + t * t * 120 + 8, 520) + hash(i, 53) * 300) : y
    grains += `M${x} ${yy}h${hash(i, 54) < 0.3 ? 3 : 2}v2h-${hash(i, 54) < 0.3 ? 3 : 2}z`
  }
  const grass = mix(DUNE_GRASS[season], '#0a0e18', p.dark * 0.8)
  let blades = ''
  for (let x = 0; x < 330; x += 6) {
    const t = x / 360
    const y = 470 - 10 * Math.sin(t * Math.PI) + t * t * 120
    const h = 14 + hash(x, 61) * 18
    const lean = (hash(x, 62) - 0.3) * 10
    blades += `M${x} ${n1(y + 6)}q${n1(lean * 0.4)} ${n1(-h * 0.6)} ${n1(lean)} ${n1(-h)}`
  }
  let extras = ''
  if (season === 'winter') {
    extras += `<path d="M0 468C110 450 230 506 330 580L320 586C230 520 120 466 0 482Z" fill="${mix('#f4f8ff', p.dune, p.dark * 0.45)}"/>`
  } else if (season === 'spring') {
    for (let i = 0; i < 18; i += 1) {
      const x = Math.round(10 + hash(i, 71) * 300)
      const t = x / 360
      extras += `<circle cx="${x}" cy="${n1(470 - 10 * Math.sin(t * Math.PI) + t * t * 120 - 8 - hash(i, 72) * 14)}" r="2.4" fill="${mix(['#f6c0d0', '#fff4c0', '#ffffff'][i % 3]!, '#0a0e18', p.dark * 0.6)}"/>`
    }
  } else if (season === 'summer') {
    // A striped beach umbrella planted on the sand at the dune foot.
    const pole = mix('#6a5040', '#0a0e18', p.dark * 0.6)
    extras += `<path d="M150 640L176 528" stroke="${pole}" stroke-width="3"/><path d="M118 540Q176 488 238 520Z" fill="${mix('#e8604a', '#0a0e18', p.dark * 0.6)}"/><path d="M148 524Q176 498 186 520Z M206 518Q214 506 238 520Z" fill="${mix('#fff3e0', '#0a0e18', p.dark * 0.6)}"/>`
  } else {
    for (let i = 0; i < 10; i += 1) extras += `<text x="${Math.round(60 + hash(i, 73) * 1400)}" y="${Math.round(TIDE[phase][1] + 10 + hash(i, 74) * 30)}" font-size="16" fill="${mix('#6a5a3a', '#0a0e18', p.dark * 0.6)}" opacity="0.7">~</text>`
  }
  return `<path d="${sand}" fill="url(#sandG)"/><path d="${grains}" fill="${mix(p.sand, '#000000', 0.25)}" opacity="0.35"/><path d="${blades}" stroke="${grass}" stroke-width="2" fill="none" stroke-linecap="round"/>${extras}`
}

/** Rows of wave glyphs from the horizon to the shore, nearer rows larger and faster. */
function seaRows(p: Palette, foam: number, speed: number): string {
  const rows = 19
  let out = ''
  for (let i = 0; i < rows; i += 1) {
    const t = (i + 1) / rows
    const y = n1(HORIZON + 8 + 340 * t ** 1.6)
    const size = n1(7 + 16 * t)
    const count = Math.ceil(1800 / (size * 0.6))
    let base = ''
    let crest = ''
    for (let c = 0; c < count; c += 1) {
      const h = hash(c, i * 5 + 1)
      base += h < 0.32 ? '~' : h < 0.5 ? '-' : h < 0.57 ? '=' : ' '
      crest += hash(c + 3, i * 11 + 2) < 0.02 * foam * (0.5 + t) ? '~' : ' '
    }
    const seconds = n1((6 + hash(i, 97) * 5) / speed)
    const amplitude = Math.round((8 + 16 * t) * Math.min(1.6, 0.6 + foam * 0.4))
    out += `<g class="sway" style="animation-duration:${seconds}s;animation-delay:-${n1(hash(i, 96) * seconds)}s;--a:${amplitude}px"><text x="-90" y="${y}" font-size="${size}" fill="${p.glyph}" opacity="${n1(0.22 + 0.38 * t)}">${base}</text><text x="-90" y="${y}" font-size="${size}" fill="${p.foam}" opacity="${n1(Math.min(0.95, 0.5 + 0.4 * t))}">${crest}</text></g>`
  }
  return out
}

/** Breakers: lines of white water that roll in toward the beach and fade on the sand. */
function breakers(p: Palette, phase: Phase, speed: number, foam: number): string {
  const [, bottom] = TIDE[phase]
  const lines = Math.min(5, Math.round(2 + foam))
  let out = ''
  for (let i = 0; i < lines; i += 1) {
    const y = bottom - 26 - i * 18
    let d = ''
    for (let x = 360 + i * 40; x < 1640; x += 90 + Math.round(hash(i, x) * 50)) {
      const w = 40 + Math.round(hash(x, i) * 70 * Math.min(1.5, foam))
      d += `M${x} ${y}q${w / 2} -${n1(3 + foam * 1.5)} ${w} 0`
    }
    out += `<path class="roll" style="animation-duration:${n1(5.5 / speed)}s;animation-delay:-${n1((i * 5.5) / speed / lines)}s" d="${d}" stroke="${p.foam}" stroke-width="${n1(1.6 + foam * 0.5)}" fill="none" stroke-linecap="round"/>`
  }
  return out
}

function glitter(p: Palette, phase: Phase, bright: boolean): string {
  const [bx] = dialPoint(DIAL[phase])
  const [, bottom] = TIDE[phase]
  const count = bright ? 64 : 30
  let out = ''
  let stars = ''
  for (let i = 0; i < count; i += 1) {
    const t = i / count
    const y = Math.round(HORIZON + 6 + t * (bottom - HORIZON - 30))
    const spread = 18 + t * 170
    const x = Math.round(bx + (hash(i, 41) - 0.5) * spread * 2)
    const w = Math.round(8 + hash(i, 42) * (20 + t * 46))
    out += `<rect class="tw" style="animation-duration:${n1(1.4 + hash(i, 43) * 2.4)}s;animation-delay:-${n1(hash(i, 44) * 3)}s" x="${x - w / 2}" y="${y}" width="${w}" height="${n1(1.5 + t * 3)}" rx="1"/>`
    if (bright && hash(i, 45) < 0.35) {
      const s = n1(5 + t * 10)
      stars += `<path class="spark" style="transform-origin:${x}px ${y}px;animation-delay:-${n1(hash(i, 46) * 2)}s" d="M${x} ${y - s}L${n1(x + s * 0.18)} ${n1(y - s * 0.18)}L${x + s} ${y}L${n1(x + s * 0.18)} ${n1(y + s * 0.18)}L${x} ${y + s}L${n1(x - s * 0.18)} ${n1(y + s * 0.18)}L${x - s} ${y}L${n1(x - s * 0.18)} ${n1(y - s * 0.18)}Z"/>`
    }
  }
  const colour = mix(p.body, '#ffffff', 0.35)
  const column = bright ? `<path d="M${bx - 24} ${HORIZON}L${bx + 24} ${HORIZON}L${bx + 210} ${bottom}L${bx - 210} ${bottom}Z" fill="url(#path)" filter="url(#soften)"/>` : ''
  return `${column}<g fill="${colour}" opacity="${bright ? 0.95 : phase === 'day' ? 0.6 : 0.5}">${out}${stars}</g>`
}

const BOATS: readonly (readonly [number, number])[] = [
  [1180, 0.9],
  [470, 0.8],
  [1420, 1],
  [1300, 0.65],
  [560, 0.7],
]

function sailboats(count: number, p: Palette): string {
  const hull = mix(p.seaBot, '#000000', 0.3)
  const sail = mix('#fbf6ea', p.seaBot, p.dark * 0.55)
  let out = ''
  for (let i = 0; i < count; i += 1) {
    const [x, s] = BOATS[i]!
    const light = p.dark > 0.5 ? `<circle cx="0" cy="-30" r="8" fill="url(#lamp)"/><circle cx="0" cy="-30" r="1.6" fill="#ffe7a3"/>` : ''
    out += `<g transform="translate(${x} ${HORIZON + 2}) scale(${s})"><g class="sail" style="animation-delay:-${i * 17}s"><g class="bob" style="animation-delay:-${n1(i * 0.8)}s"><path d="M0 -2V-30" stroke="${hull}" stroke-width="1.5"/><path d="M2 -4L2 -30L20 -4Z" fill="${sail}"/><path d="M-2 -6L-2 -22L-13 -6Z" fill="${mix(sail, '#e86a4a', 0.4)}"/><path d="M-18 -2L18 -2L13 4L-14 4Z" fill="${hull}"/>${light}</g></g></g>`
  }
  return out
}

function squall(p: Palette): string {
  let puffs = ''
  for (let i = 0; i < 12; i += 1) puffs += `<ellipse cx="${Math.round(820 + i * 72 + hash(i, 81) * 40)}" cy="${Math.round(470 + hash(i, 82) * 50)}" rx="${Math.round(90 + hash(i, 83) * 60)}" ry="${Math.round(50 + hash(i, 84) * 30)}"/>`
  const cloud = mix('#2a3040', p.seaBot, 0.3)
  return `<rect width="1600" height="1000" fill="#0a0e18" opacity="0.22"/>
<g class="squall"><g fill="${cloud}" opacity="0.95">${puffs}<rect x="760" y="500" width="900" height="80"/></g>
<g opacity="0.55" clip-path="url(#curtain)"><g class="rain"><rect x="740" y="520" width="900" height="300" fill="url(#rainP)"/></g></g>
<rect x="760" y="${HORIZON}" width="900" height="140" fill="url(#shadowSea)"/></g>
<path class="gust" d="M200 420h180M260 440h140M150 460h120" stroke="${mix(p.foam, p.seaBot, 0.4)}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>`
}

function scene(ctx: SceneCtx): string {
  const { phase, activity, season } = ctx
  const p = PALETTES[phase]
  const speed = SPEED[activity]
  const foam = FOAM[activity] * SEASON_FOAM[season]
  const [left, bottom] = TIDE[phase]
  const boatCount = activity === 'agents' || activity === 'working' || activity === 'thinking' ? Math.max(0, Math.min(5, ctx.agents)) : 0
  const style = `
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:700}
.tw{animation:tw 4s ease-in-out infinite}
.drift{animation:drift 150s ease-in-out infinite alternate}
.sway{animation:sway 8s ease-in-out infinite alternate}
.roll{opacity:.7;animation:roll 4s ease-in infinite}
.wash{animation:wash ${n1(6 / speed)}s ease-in-out infinite alternate}
.bob{animation:bob 4s ease-in-out infinite alternate}
.sail{animation:sail 60s ease-in-out infinite alternate}
.spark{transform-box:view-box;animation:spark 1.8s ease-in-out infinite}
.squall{animation:squall 7s ease-out 1 both}
.rain{animation:rain .45s linear infinite}
.gust{animation:gust 2.2s ease-in-out infinite}
.snowA{animation:snowA 14s linear infinite}
@keyframes tw{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes drift{from{transform:translateX(-55px)}to{transform:translateX(55px)}}
@keyframes sway{from{transform:translateX(calc(var(--a) * -1))}to{transform:translateX(var(--a))}}
@keyframes roll{0%{transform:translateY(-14px);opacity:0}25%{opacity:.85}80%{opacity:.6}100%{transform:translateY(16px);opacity:0}}
@keyframes wash{from{transform:translate(0,-5px)}to{transform:translate(-14px,7px)}}
@keyframes bob{from{transform:translateY(-1.5px) rotate(-2deg)}to{transform:translateY(1.5px) rotate(2deg)}}
@keyframes sail{from{transform:translateX(-40px)}to{transform:translateX(40px)}}
@keyframes spark{0%,100%{transform:scale(.3);opacity:.2}50%{transform:scale(1.1);opacity:1}}
@keyframes squall{from{transform:translateX(500px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes rain{from{transform:translate(0,0)}to{transform:translate(-12px,60px)}}
@keyframes gust{0%,100%{transform:translateX(0);opacity:0}50%{transform:translateX(-80px);opacity:.6}}
@keyframes snowA{from{transform:translate(0,0)}to{transform:translate(-30px,200px)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`

  const defs = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky[0]}"/><stop offset="0.55" stop-color="${p.sky[1]}"/><stop offset="1" stop-color="${p.sky[2]}"/></linearGradient>
<linearGradient id="sea" gradientUnits="userSpaceOnUse" x1="0" y1="${HORIZON}" x2="0" y2="1000"><stop offset="0" stop-color="${p.seaTop}"/><stop offset="1" stop-color="${p.seaBot}"/></linearGradient>
<linearGradient id="sandG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(p.sand, '#ffffff', 0.1)}"/><stop offset="1" stop-color="${mix(p.sand, '#000000', 0.12)}"/></linearGradient>
<radialGradient id="halo"><stop offset="0" stop-color="${p.body}" stop-opacity="0.5"/><stop offset="0.3" stop-color="${p.body}" stop-opacity="0.16"/><stop offset="1" stop-color="${p.body}" stop-opacity="0"/></radialGradient>
<radialGradient id="lamp"><stop offset="0" stop-color="#fff2c0" stop-opacity="0.9"/><stop offset="1" stop-color="#ffd070" stop-opacity="0"/></radialGradient>
<linearGradient id="path" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.body}" stop-opacity="0.55"/><stop offset="1" stop-color="${p.body}" stop-opacity="0.08"/></linearGradient>
<linearGradient id="shadowSea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05070e" stop-opacity="0.55"/><stop offset="1" stop-color="#05070e" stop-opacity="0"/></linearGradient>
<filter id="soften" x="-30%" y="-10%" width="160%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>
<clipPath id="aboveSea"><rect width="1600" height="${HORIZON}"/></clipPath>
<clipPath id="curtain"><rect x="760" y="520" width="900" height="${HORIZON - 520 + 40}"/></clipPath>
<pattern id="rainP" width="36" height="60" patternUnits="userSpaceOnUse"><path d="M28 0L24 24M10 30L6 54" stroke="#c8d2e4" stroke-width="1.4" stroke-opacity="0.75"/></pattern>
<pattern id="snowP" width="200" height="200" patternUnits="userSpaceOnUse">${Array.from({ length: 8 }, (_, i) => `<circle cx="${Math.round(hash(i, 91) * 200)}" cy="${Math.round(hash(i, 92) * 200)}" r="${n1(1.4 + hash(i, 93) * 1.6)}" fill="#fbfdff"/>`).join('')}</pattern>
<radialGradient id="clearG" cx="0.5" cy="1" r="0.6"><stop offset="0" stop-color="#000"/><stop offset="0.6" stop-color="#666"/><stop offset="1" stop-color="#fff"/></radialGradient>
<mask id="clear" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><rect width="1600" height="1000" fill="#fff"/><rect x="200" y="600" width="1200" height="400" fill="url(#clearG)"/></mask>
<clipPath id="water"><path d="M330 ${HORIZON}H1600V${bottom}H620C320 ${bottom - 10} 150 ${left + 60} 0 ${left}L0 690L330 ${HORIZON}Z"/></clipPath>`

  const water = `M330 ${HORIZON}H1600V${bottom}H620C320 ${bottom - 10} 150 ${left + 60} 0 ${left}L0 690L330 ${HORIZON}Z`
  const winter = season === 'winter' ? `<g opacity="0.8"><g class="snowA"><rect x="-200" y="-400" width="2000" height="1600" fill="url(#snowP)"/></g></g>` : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>${style}</style><defs>${defs}</defs>
${sky(p, phase)}
${land(p, season, phase)}
<path d="${shorePath(phase)}" stroke="${p.wet}" stroke-width="26" fill="none" opacity="0.6"/>
<path d="${water}" fill="url(#sea)"/>
<rect x="340" y="${HORIZON - 1}" width="1260" height="2" fill="${mix(p.sky[2], '#ffffff', 0.3)}" opacity="0.5"/>
<g clip-path="url(#water)"><g mask="url(#clear)">${glitter(p, phase, activity === 'success')}${seaRows(p, foam, speed)}</g>${breakers(p, phase, speed, foam)}</g>
<g class="wash"><path d="${shorePath(phase)}" stroke="${p.foam}" stroke-width="3" fill="none" opacity="0.85" stroke-dasharray="40 10 70 14 20 8"/><path d="${shorePath(phase)}" stroke="${p.foam}" stroke-width="9" fill="none" opacity="0.2"/></g>
${sailboats(boatCount, p)}
${activity === 'error' ? squall(p) : ''}
${winter}
</svg>`
}

function glass(ctx: SceneCtx): { blur: number; tint: string; opacity: number } {
  switch (ctx.phase) {
    case 'dawn':
      return { blur: 10, tint: '#fbf1ea', opacity: 0.4 }
    case 'day':
      return { blur: 10, tint: '#f0f6f8', opacity: 0.42 }
    case 'dusk':
      return { blur: 12, tint: '#1c1426', opacity: 0.46 }
    default:
      return { blur: 12, tint: '#0a1120', opacity: 0.44 }
  }
}

export const theme: LivingTheme = {
  id: 'tide-clock',
  title: 'Tide Clock',
  blurb: 'A shore seen from the side: a dune on the left, a beach along the foot, the sun or moon riding a dial across the sky.',
  reacts: 'Waves quicken and foam as the agent works, a sailboat rides the horizon for each subagent, a squall line darkens the sea on an error and the sun path sparkles on success; the sun or moon keeps the hour, the tide is high at night and the dune dresses for the season.',
  window: 'auto',
  glass,
  scene,
}
