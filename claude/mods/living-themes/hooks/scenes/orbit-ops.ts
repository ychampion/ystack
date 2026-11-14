// Orbit Ops: a cyanotype mission chart. A planet drawn in fine plotted lines sits in the top-right corner, a relay station
// is parked below it on the right edge, and five plotted orbits fan out from the planet, each with its equal-time ticks.
// The chart keeps one layout; the agent's activity decides what moves on it. A dark-window scene.
// Pure string building: no DOM, no randomness, no clock.
import type { LivingTheme, SceneCtx } from './contract'

type Phase = SceneCtx['phase']
type Season = SceneCtx['season']

const PX = 1452
const PY = 178
const PR = 112
/** The relay station, parked on the right edge below the planet. */
const SX = 1488
const SY = 588
/** Poses per orbit in the keyframes: enough that straight blending between them stays on the curve. */
const POSES = 64

/** One sheet of paper and its inks, per time of day. Day is a paler cyan wash, still dark enough for light text. */
interface Ink {
  readonly paper: string
  readonly pool: string
  readonly chalk: string
  readonly glow: string
  readonly gold: string
  readonly red: string
  readonly bright: string
  readonly speck: string
}

const INKS: Record<Phase, Ink> = {
  night: { paper: '#121a42', pool: '#070b26', chalk: '#c6d4f2', glow: '#8fa6ff', gold: '#f2c96b', red: '#ff6f61', bright: '#fff3cf', speck: '#04071a' },
  dawn: { paper: '#1d3468', pool: '#101f4c', chalk: '#d6e2f6', glow: '#f2b3a0', gold: '#f6c98a', red: '#ff7466', bright: '#fff0dc', speck: '#0a1638' },
  day: { paper: '#1c5a84', pool: '#0f3c62', chalk: '#dbeff9', glow: '#bfe8ff', gold: '#f4d27a', red: '#ff7a6a', bright: '#ffffff', speck: '#0a2c4a' },
  dusk: { paper: '#262c63', pool: '#141843', chalk: '#d4daf2', glow: '#f0aa7a', gold: '#f3c17a', red: '#ff6e60', bright: '#fff1d8', speck: '#0b0e30' },
}

/** Season: how far down the ice cap reaches (latitude, degrees) and where the sun sits (screen degrees, y down). */
const SEASONS: Record<Season, { readonly cap: number; readonly sun: number; readonly word: string }> = {
  winter: { cap: 44, sun: 118, word: 'WNTR' },
  spring: { cap: 60, sun: 140, word: 'SPRG' },
  summer: { cap: 76, sun: 162, word: 'SMMR' },
  autumn: { cap: 62, sun: 140, word: 'AUTM' },
}

/** An orbit with the planet at one focus: apoapsis direction (screen degrees), nearest and farthest distance, period in seconds. */
interface Orbit {
  readonly dir: number
  readonly near: number
  readonly far: number
  readonly period: number
}

/** The five plotted orbits fan out to the lower left, so a body spends most of its time near the far end, on screen. */
const ORBITS: readonly Orbit[] = [
  { dir: 128, near: 150, far: 330, period: 74 },
  { dir: 146, near: 160, far: 400, period: 96 },
  { dir: 112, near: 170, far: 430, period: 118 },
  { dir: 162, near: 176, far: 470, period: 140 },
  { dir: 100, near: 186, far: 500, period: 164 },
]

function r1(value: number): number {
  return Math.round(value * 10) / 10
}

/** A repeatable number in 0..1 from an integer seed. */
function hash(seed: number): number {
  let h = (Math.imul(seed + 0x9e37, 0x85ebca6b) ^ 0x27d4eb2f) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35) >>> 0
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

function rad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** A point on an orbit at eccentric anomaly E (radians from the nearest pass). */
function orbitPoint(orbit: Orbit, anomaly: number): [number, number] {
  const a = (orbit.near + orbit.far) / 2
  const e = (orbit.far - orbit.near) / (orbit.far + orbit.near)
  const b = a * Math.sqrt(1 - e * e)
  const u = a * (Math.cos(anomaly) - e)
  const v = b * Math.sin(anomaly)
  const p = rad(orbit.dir + 180)
  return [PX + u * Math.cos(p) - v * Math.sin(p), PY + u * Math.sin(p) + v * Math.cos(p)]
}

/** Where a body is after a share (0..1) of its period: Kepler's equation, solved by Newton's steps. */
function orbitAt(orbit: Orbit, share: number): [number, number] {
  const e = (orbit.far - orbit.near) / (orbit.far + orbit.near)
  const mean = 2 * Math.PI * share
  let anomaly = mean
  for (let step = 0; step < 12; step += 1) anomaly -= (anomaly - e * Math.sin(anomaly) - mean) / (1 - e * Math.cos(anomaly))
  return orbitPoint(orbit, anomaly)
}

function orbitPath(orbit: Orbit): string {
  let path = ''
  for (let degrees = 0; degrees < 360; degrees += 5) {
    const [x, y] = orbitPoint(orbit, rad(degrees))
    path += `${path === '' ? 'M' : 'L'}${r1(x)} ${r1(y)}`
  }
  return `${path}z`
}

/** Equal-time ticks across the orbit, every sixth one long: they bunch at the far end, where a body is slow. */
function orbitTicks(orbit: Orbit): string {
  let path = ''
  for (let index = 0; index < 36; index += 1) {
    const [x, y] = orbitAt(orbit, index / 36)
    const [nx, ny] = orbitAt(orbit, index / 36 + 0.002)
    const length = Math.hypot(nx - x, ny - y) || 1
    const half = index % 6 === 0 ? 7 : 3.5
    const ox = (-(ny - y) / length) * half
    const oy = ((nx - x) / length) * half
    path += `M${r1(x - ox)} ${r1(y - oy)}L${r1(x + ox)} ${r1(y + oy)}`
  }
  return path
}

function orbitKeyframes(index: number, orbit: Orbit): string {
  let frames = ''
  for (let pose = 0; pose <= POSES; pose += 1) {
    const [x, y] = orbitAt(orbit, pose / POSES)
    frames += `${r1((pose / POSES) * 100)}%{transform:translate(${r1(x)}px,${r1(y)}px)}`
  }
  return `@keyframes k${index}{${frames}}`
}

/** A body riding orbit `index`, `share` of the way round at the first frame. Its resting pose is the same point, so a still frame matches. */
function rider(index: number, share: number, inner: string, moving: boolean, period?: number): string {
  const orbit = ORBITS[index]
  if (orbit === undefined) return ''
  const [x, y] = orbitAt(orbit, share)
  const seconds = period ?? orbit.period
  const motion = moving ? `animation:k${index} ${seconds}s linear infinite;animation-delay:-${r1(share * seconds)}s;` : ''
  return `<g style="${motion}transform:translate(${r1(x)}px,${r1(y)}px)">${inner}</g>`
}

/** Paper: the wash, pools of deeper colour in the corners, paper tooth and the drafting grid, which keeps out of the reading column. */
function paper(ink: Ink): string {
  const pools = [
    [-60, -60, 700, 520],
    [1680, -80, 700, 560],
    [1700, 1080, 620, 500],
    [-80, 1080, 600, 440],
  ]
    .map(pool => `<ellipse cx="${pool[0]}" cy="${pool[1]}" rx="${pool[2]}" ry="${pool[3]}" fill="url(#pool)"/>`)
    .join('')
  return `<rect width="1600" height="1000" fill="${ink.paper}"/>${pools}<rect width="1600" height="1000" fill="url(#tooth)"/><rect width="1600" height="1000" fill="url(#minor)" mask="url(#out)"/><rect width="1600" height="1000" fill="url(#major)" mask="url(#ghost)"/>`
}

function toothSpecks(ink: Ink): string {
  let specks = ''
  for (let index = 0; index < 52; index += 1) {
    const light = hash(index * 3 + 1) > 0.5
    specks += `<rect x="${r1(hash(index * 7 + 2) * 180)}" y="${r1(hash(index * 11 + 5) * 180)}" width="${light ? 1.2 : 1.7}" height="1.2" fill="${light ? ink.chalk : ink.speck}" opacity="${light ? 0.07 : 0.16}"/>`
  }
  return specks
}

/** The latitude lines that face us, with the north pole tipped a little toward the viewer. */
const TILT = rad(16)

function parallelPath(latitude: number): string {
  const phi = rad(latitude)
  let path = ''
  let open = false
  for (let degrees = -180; degrees <= 180; degrees += 6) {
    const lambda = rad(degrees)
    const z = Math.sin(phi) * Math.sin(TILT) + Math.cos(phi) * Math.cos(lambda) * Math.cos(TILT)
    if (z < 0) {
      open = false
      continue
    }
    const x = PX + PR * Math.cos(phi) * Math.sin(lambda)
    const y = PY - PR * (Math.sin(phi) * Math.cos(TILT) - Math.cos(phi) * Math.cos(lambda) * Math.sin(TILT))
    path += `${open ? 'L' : 'M'}${r1(x)} ${r1(y)}`
    open = true
  }
  return path
}

/** The planet: limb, graticule, ice cap by season, a hatched night side, an atmosphere ring and a graduated arc. Meridians sweep across the face: the rotation. */
function planet(ink: Ink, season: Season, spin: number): string {
  const s = SEASONS[season]
  const cap = rad(s.cap)
  const capY = PY - PR * Math.sin(cap) * Math.cos(TILT)
  const capRx = PR * Math.cos(cap)
  const capRy = PR * Math.cos(cap) * Math.sin(TILT)
  const parallels = [-60, -30, 0, 30, 60].map(parallelPath).join('')
  let meridians = ''
  const count = 10
  for (let index = 0; index < count; index += 1) {
    const share = index / count
    const scale = share < 0.5 ? -Math.cos(2 * Math.PI * share) : 1
    const opacity = share < 0.5 ? 0.42 : 0
    meridians += `<path class="mer" style="animation-duration:${spin}s;animation-delay:-${r1(share * spin)}s;transform:scaleX(${r1(scale * 100) / 100});opacity:${opacity}" d="M${PX} ${PY - PR}A${PR} ${PR} 0 0 1 ${PX} ${PY + PR}"/>`
  }
  const sunX = PX + PR * 0.62 * Math.cos(rad(s.sun))
  const sunY = PY + PR * 0.62 * Math.sin(rad(s.sun))
  const ticks = (() => {
    let path = ''
    for (let degrees = 95; degrees <= 265; degrees += 5) {
      const long = degrees % 15 === 5
      const inner = PR + (long ? 22 : 26)
      path += `M${r1(PX + inner * Math.cos(rad(degrees)))} ${r1(PY + inner * Math.sin(rad(degrees)))}L${r1(PX + (PR + 31) * Math.cos(rad(degrees)))} ${r1(PY + (PR + 31) * Math.sin(rad(degrees)))}`
    }
    return path
  })()
  const arcFrom = [PX + (PR + 31) * Math.cos(rad(95)), PY + (PR + 31) * Math.sin(rad(95))]
  const arcTo = [PX + (PR + 31) * Math.cos(rad(265)), PY + (PR + 31) * Math.sin(rad(265))]
  return `<defs><clipPath id="disc"><circle cx="${PX}" cy="${PY}" r="${PR}"/></clipPath>
<mask id="night" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><circle cx="${PX}" cy="${PY}" r="${PR + 2}" fill="#fff"/><circle cx="${r1(sunX)}" cy="${r1(sunY)}" r="${r1(PR * 1.1)}" fill="#000"/></mask></defs>
<circle cx="${PX}" cy="${PY}" r="${PR + 46}" fill="url(#halo)"/>
<circle cx="${PX}" cy="${PY}" r="${PR}" fill="${ink.pool}" opacity=".55"/>
<g clip-path="url(#disc)">
<path d="M${PX - PR} ${PY - PR - 4}H${PX + PR}V${r1(capY)}H${PX - PR}z" fill="url(#ice)"/><ellipse cx="${PX}" cy="${r1(capY)}" rx="${r1(capRx)}" ry="${r1(capRy)}" fill="url(#ice)"/>
<path class="fine" d="${parallels}"/>
${meridians}
<rect x="${PX - PR}" y="${PY - PR}" width="${PR * 2}" height="${PR * 2}" fill="url(#hatch)" mask="url(#night)"/>
</g>
<path d="${parallelPath(s.cap)}" fill="none" stroke="${ink.chalk}" stroke-width="1" opacity=".55"/>
<circle cx="${PX}" cy="${PY}" r="${PR}" fill="none" stroke="${ink.chalk}" stroke-width="1.5" opacity=".78"/>
<circle cx="${PX}" cy="${PY}" r="${PR + 9}" fill="none" stroke="${ink.chalk}" stroke-width=".8" stroke-dasharray="2 5" opacity=".38"/>
<path d="M${r1(arcFrom[0] ?? 0)} ${r1(arcFrom[1] ?? 0)}A${PR + 31} ${PR + 31} 0 0 1 ${r1(arcTo[0] ?? 0)} ${r1(arcTo[1] ?? 0)}${ticks}" fill="none" stroke="${ink.chalk}" stroke-width=".9" opacity=".34"/>
<path class="chain" d="M${PX - PR - 70} ${PY}H${PX + PR + 70}M${PX} ${PY - PR - 70}V${PY + PR + 70}"/>
<text x="${PX - PR - 64}" y="${PY - 8}" class="lab" opacity=".5">${s.word} · CAP ${s.cap}°</text>`
}

/** The relay station on the right edge: a hub, two hatched panels, a dish and a slowly turning ring. */
function station(ink: Ink, alarm: boolean): string {
  const body = alarm ? ink.red : ink.chalk
  return `<g><circle class="ring" cx="${SX}" cy="${SY}" r="24" fill="none" stroke="${ink.chalk}" stroke-width=".9" stroke-dasharray="3 4 12 4" opacity=".55"/>
<rect x="${SX - 6}" y="${SY - 6}" width="12" height="12" fill="${ink.paper}" stroke="${body}" stroke-width="1.3"/>
<path d="M${SX - 46} ${SY - 5}h34v10h-34zM${SX + 12} ${SY - 5}h34v10h-34z" fill="url(#hatch)" stroke="${ink.chalk}" stroke-width="1"/>
<path d="M${SX - 12} ${SY}h6M${SX + 6} ${SY}h6M${SX} ${SY - 6}v-12" stroke="${ink.chalk}" stroke-width="1"/>
<path d="M${SX - 8} ${SY - 22}q8 8 16 0" fill="none" stroke="${ink.chalk}" stroke-width="1.2"/>
<text x="${SX - 34}" y="${SY + 42}" class="lab">RELAY-0</text></g>`
}

/** The link from the station up to the planet: three bowed dashed lines. Thinking makes them pulse; otherwise one rests faint. */
function links(ink: Ink, active: boolean): string {
  const top = PY + PR + 6
  const curves = [
    `M${SX - 4} ${SY - 26}Q${SX - 40} ${(SY + top) / 2} ${PX - 22} ${top}`,
    `M${SX} ${SY - 26}Q${SX + 6} ${(SY + top) / 2} ${PX + 6} ${top + 2}`,
    `M${SX + 4} ${SY - 26}Q${SX + 46} ${(SY + top) / 2} ${PX + 34} ${top - 4}`,
  ]
  if (!active) return `<path d="${curves[1]}" fill="none" stroke="${ink.chalk}" stroke-width="1" stroke-dasharray="2 6" opacity=".3"/>`
  return curves
    .map(
      (curve, index) =>
        `<path class="pulse" style="animation-delay:-${index * 0.9}s,-${index * 1.3}s" d="${curve}" fill="none" stroke="${index === 1 ? ink.gold : ink.glow}" stroke-width="${index === 1 ? 1.6 : 1.1}" stroke-dasharray="7 9" opacity=".7"/>`,
    )
    .join('')
}

/** One satellite: a diamond hub between two panels, a leader and its label. */
function satellite(ink: Ink, index: number, alarm: boolean): string {
  const colour = alarm ? ink.red : ink.bright
  const label = `SAT-0${index + 1}${alarm ? ' LOS' : ''}`
  return `<g class="${alarm ? 'blink' : ''}">${alarm ? `<circle class="alarm" r="30" fill="none" stroke="${colour}" stroke-width="2"/>` : ''}<circle r="12" fill="${colour}" opacity=".12"/><path d="M-4 0L0 -4L4 0L0 4z" fill="${colour}"/><path d="M-14 -2h8v4h-8zM6 -2h8v4h-8z" fill="none" stroke="${colour}" stroke-width="1"/><path d="M5 -6l9 -9h16" fill="none" stroke="${colour}" stroke-width=".7" opacity=".7"/><text x="16" y="-18" class="lab" fill="${colour}" opacity=".95">${label}</text></g>`
}

const GLYPHS = '01A7F3C9E25B+=/*'

/** Packets of data: glyphs riding the first three orbits, bunching at the far ends, plus a short climb up the link. */
function packets(ink: Ink): string {
  let out = ''
  for (let orbit = 0; orbit < 3; orbit += 1) {
    for (let index = 0; index < 7; index += 1) {
      const glyph = GLYPHS[(orbit * 7 + index * 5) % GLYPHS.length] ?? '0'
      const inner = `<text class="glyph" x="-4" y="4" fill="${ink.gold}">${glyph}</text>`
      out += rider(orbit, (index / 7 + orbit * 0.11) % 1, inner, true, (ORBITS[orbit]?.period ?? 80) / 2.5)
    }
  }
  return out
}

/** The telemetry trace in the bottom-right corner: a scrolling wave whose shape says what the agent is doing. */
function telemetry(ink: Ink, activity: SceneCtx['activity']): string {
  const left = 1296
  const top = 838
  const width = 260
  const height = 100
  const mid = top + height / 2
  const shapes: Record<SceneCtx['activity'], { amp: number; wave: number; jag: number; colour: string; seconds: number }> = {
    idle: { amp: 6, wave: 130, jag: 0, colour: ink.chalk, seconds: 26 },
    thinking: { amp: 18, wave: 86, jag: 0, colour: ink.glow, seconds: 12 },
    working: { amp: 26, wave: 44, jag: 0.35, colour: ink.gold, seconds: 6 },
    agents: { amp: 22, wave: 60, jag: 0.15, colour: ink.bright, seconds: 9 },
    error: { amp: 34, wave: 30, jag: 1, colour: ink.red, seconds: 3 },
    success: { amp: 4, wave: 260, jag: 0, colour: ink.bright, seconds: 30 },
  }
  const shape = shapes[activity]
  /** Two copies of a wave a whole number of wavelengths long, so the slide loops without a seam. */
  const span = Math.ceil(width / shape.wave) * shape.wave
  let path = ''
  for (let x = 0; x <= span * 2; x += 4) {
    const jag = shape.jag * (hash(Math.round(x % span) + 17) - 0.5) * shape.amp * 1.4
    const y = mid + Math.sin((2 * Math.PI * x) / shape.wave) * shape.amp + jag
    path += `${x === 0 ? 'M' : 'L'}${r1(left + x)} ${r1(y)}`
  }
  const grid = `M${left} ${mid}h${width}M${left + width / 4} ${top}v${height}M${left + width / 2} ${top}v${height}M${left + (3 * width) / 4} ${top}v${height}`
  return `<clipPath id="scope"><rect x="${left}" y="${top}" width="${width}" height="${height}"/></clipPath>
<rect x="${left}" y="${top}" width="${width}" height="${height}" fill="none" stroke="${ink.chalk}" stroke-width=".9" opacity=".36"/>
<path d="${grid}" fill="none" stroke="${ink.chalk}" stroke-width=".6" stroke-dasharray="2 4" opacity=".24"/>
<g clip-path="url(#scope)"><path class="scroll" style="--span:-${span}px;animation-duration:${shape.seconds}s" d="${path}" fill="none" stroke="${shape.colour}" stroke-width="1.3" opacity=".62"/></g>
<text x="${left}" y="${top - 8}" class="lab">TLM · ${activity.toUpperCase()}</text>`
}

/** The title block in the bottom-left corner and a ruler up the left edge. */
function margins(ink: Ink, phase: Phase, season: Season): string {
  let ruler = ''
  for (let y = 80; y <= 800; y += 16) ruler += `M24 ${y}h${(y - 80) % 80 === 0 ? 16 : 7}`
  let rulerLabels = ''
  for (let y = 80; y <= 800; y += 160) rulerLabels += `<text x="46" y="${y + 4}" class="lab" opacity=".45">${String((y - 80) / 8).padStart(3, '0')}</text>`
  const block = `M40 858h300v100h-300zM40 890h300M200 890v68M40 924h160`
  const scale = `M216 936h100M216 931v10M241 933v6M266 931v10M291 933v6M316 931v10`
  return `<path d="M24 80V800${ruler}" fill="none" stroke="${ink.chalk}" stroke-width=".9" opacity=".34"/>${rulerLabels}
<path d="${block}${scale}" fill="none" stroke="${ink.chalk}" stroke-width=".9" opacity=".42"/>
<text x="52" y="880" class="lab big">ORBIT OPS · MISSION CHART</text>
<text x="52" y="912" class="lab">SHEET 07 · ${phase.toUpperCase()}</text>
<text x="52" y="946" class="lab">${season.toUpperCase()} EPOCH</text>
<text x="214" y="912" class="lab">SCALE 1:4·10⁶</text>`
}

/** Plotted stars in the upper-left, by night, dawn and dusk: small crosses that breathe. */
/** The moon in the top-left corner, plotted like the planet but small, and the dashed transfer arc that joins them over the top. */
const MX = 196
const MY = 196
const MR = 46
const ARC = { fromX: PX - PR - 8, fromY: PY - 34, ctrlX: 800, ctrlY: -110, toX: MX + MR + 10, toY: MY - 18 }

function arcPoint(t: number): [number, number] {
  const u = 1 - t
  return [u * u * ARC.fromX + 2 * u * t * ARC.ctrlX + t * t * ARC.toX, u * u * ARC.fromY + 2 * u * t * ARC.ctrlY + t * t * ARC.toY]
}

function moon(ink: Ink, season: Season, moving: boolean): string {
  const sun = rad(SEASONS[season].sun)
  const craters = [
    [-14, -10, 8],
    [12, 14, 6],
    [18, -16, 4],
    [-6, 22, 5],
  ]
    .map(([x, y, r]) => `<circle cx="${MX + (x ?? 0)}" cy="${MY + (y ?? 0)}" r="${r}" fill="none" stroke="${ink.chalk}" stroke-width=".8" opacity=".45"/>`)
    .join('')
  let frames = ''
  for (let pose = 0; pose <= 24; pose += 1) {
    const [x, y] = arcPoint(pose / 24)
    frames += `${r1((pose / 24) * 100)}%{transform:translate(${r1(x)}px,${r1(y)}px)}`
  }
  const [restX, restY] = arcPoint(0.3)
  const probe = `<g style="${moving ? 'animation:probe 220s linear infinite alternate;animation-delay:-66s;' : ''}transform:translate(${r1(restX)}px,${r1(restY)}px)"><path d="M-3 -3h6v6h-6zM-9 0h18" fill="none" stroke="${ink.bright}" stroke-width="1"/><text x="8" y="-8" class="lab">PRB-7</text></g>`
  let ticks = ''
  for (let step = 1; step < 20; step += 1) {
    const [x, y] = arcPoint(step / 20)
    const [nx, ny] = arcPoint(step / 20 + 0.01)
    const length = Math.hypot(nx - x, ny - y) || 1
    const half = step % 5 === 0 ? 6 : 3
    ticks += `M${r1(x + ((ny - y) / length) * half)} ${r1(y - ((nx - x) / length) * half)}L${r1(x - ((ny - y) / length) * half)} ${r1(y + ((nx - x) / length) * half)}`
  }
  return `<style>@keyframes probe{${frames}}</style><defs><mask id="moonNight" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><circle cx="${MX}" cy="${MY}" r="${MR + 1}" fill="#fff"/><circle cx="${r1(MX + MR * 0.6 * Math.cos(sun))}" cy="${r1(MY + MR * 0.6 * Math.sin(sun))}" r="${r1(MR * 1.12)}" fill="#000"/></mask></defs>
<path d="M${r1(ARC.fromX)} ${ARC.fromY}Q${ARC.ctrlX} ${ARC.ctrlY} ${ARC.toX} ${ARC.toY}" fill="none" stroke="${ink.chalk}" stroke-width=".9" stroke-dasharray="10 6" opacity=".4"/><path d="${ticks}" fill="none" stroke="${ink.chalk}" stroke-width=".8" opacity=".35"/>
<circle cx="${MX}" cy="${MY}" r="${MR + 30}" fill="url(#halo)" opacity=".7"/><circle cx="${MX}" cy="${MY}" r="${MR}" fill="${ink.pool}" opacity=".5"/>${craters}
<rect x="${MX - MR}" y="${MY - MR}" width="${MR * 2}" height="${MR * 2}" fill="url(#hatch)" mask="url(#moonNight)"/>
<circle cx="${MX}" cy="${MY}" r="${MR}" fill="none" stroke="${ink.chalk}" stroke-width="1.3" opacity=".7"/><circle cx="${MX}" cy="${MY}" r="${MR + 8}" fill="none" stroke="${ink.chalk}" stroke-width=".7" stroke-dasharray="1 4" opacity=".4"/>
<path class="chain" d="M${MX - MR - 40} ${MY}H${MX + MR + 40}M${MX} ${MY - MR - 40}V${MY + MR + 40}"/><text x="${MX - 30}" y="${MY + MR + 26}" class="lab">LUNA-B</text>
${probe}`
}

function stars(ink: Ink, phase: Phase): string {
  if (phase === 'day') return ''
  const count = phase === 'night' ? 34 : 16
  let out = ''
  for (let index = 0; index < count; index += 1) {
    const x = r1(70 + hash(index * 5 + 3) * 440)
    const y = r1(30 + hash(index * 9 + 7) * 330)
    const size = hash(index + 91) > 0.75 ? 4 : 2
    const seconds = r1(4 + hash(index + 40) * 7)
    out += `<path class="tw" style="animation-duration:${seconds}s;animation-delay:-${r1(hash(index + 3) * seconds)}s" d="M${x - size} ${y}h${size * 2}M${x} ${y - size}v${size * 2}" stroke="${ink.chalk}" stroke-width=".9" opacity=".5"/>`
  }
  return out
}

/** Success: the satellites hold still and constellation lines draw between them, the station and the planet. */
function constellation(ink: Ink, count: number): string {
  const shares = [0.5, 0.46, 0.55, 0.42, 0.52]
  const points: Array<[number, number]> = [[PX - PR * 0.7, PY + PR * 0.7]]
  for (let index = 0; index < count; index += 1) {
    const orbit = ORBITS[index]
    if (orbit !== undefined) points.push(orbitAt(orbit, shares[index] ?? 0.5))
  }
  points.sort((a, b) => b[1] - a[1] || a[0] - b[0])
  points.push([SX, SY - 26])
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${r1(point[0])} ${r1(point[1])}`).join('')
  const nodes = points.map((point, index) => `<circle class="tw" style="animation-duration:${2 + index * 0.4}s" cx="${r1(point[0])}" cy="${r1(point[1])}" r="5" fill="none" stroke="${ink.bright}" stroke-width="1.2"/>`).join('')
  return `<path class="draw" pathLength="1" d="${path}" fill="none" stroke="${ink.bright}" stroke-width="1.8" stroke-dasharray="1" opacity=".9"/><path d="${path}" fill="none" stroke="${ink.gold}" stroke-width="7" opacity=".12"/>${nodes}`
}

function sceneFor(ctx: SceneCtx): string {
  const ink = INKS[ctx.phase]
  const activity = ctx.activity
  const spin = activity === 'idle' ? 240 : activity === 'working' ? 90 : activity === 'thinking' ? 150 : 180
  const agents = Math.max(0, Math.min(5, Math.round(ctx.agents)))
  const satCount = activity === 'success' ? Math.max(agents, 3) : activity === 'error' ? Math.max(agents, 1) : agents
  const moving = activity !== 'success'

  const keyframes = ORBITS.map((orbit, index) => orbitKeyframes(index, orbit)).join('')
  const style = `
.fine{fill:none;stroke:${ink.chalk};stroke-width:.8;opacity:.32}
.chain{fill:none;stroke:${ink.chalk};stroke-width:.7;stroke-dasharray:22 5 3 5;opacity:.24}
.lab{font:10px monospace;fill:${ink.chalk};opacity:.62;letter-spacing:.06em}
.big{font-size:12px;opacity:.78}
.glyph{font:bold 12px monospace}
.mer{fill:none;stroke:${ink.chalk};stroke-width:.8;transform-origin:${PX}px ${PY}px;animation:mer 240s linear infinite}
.ring{transform-origin:${SX}px ${SY}px;animation:turn 60s linear infinite}
.pulse{animation:flow 2.6s linear infinite,breathe 3.4s ease-in-out infinite}
.blink{animation:blink 1.1s steps(1) infinite}
.tw{animation:tw 6s ease-in-out infinite}
.scroll{animation:scroll 10s linear infinite}
.draw{animation:draw 2.4s ease-out both}
.tear{animation:tear 1.6s steps(4) infinite}
.alarm{animation:alarm 1.1s ease-out infinite;opacity:.5}
@keyframes mer{0%{transform:scaleX(-1);opacity:0;animation-timing-function:cubic-bezier(.37,0,.63,1)}3%{opacity:.42}47%{opacity:.42}50%{transform:scaleX(1);opacity:0}100%{transform:scaleX(1);opacity:0}}
@keyframes turn{to{transform:rotate(360deg)}}
@keyframes flow{to{stroke-dashoffset:-32}}
@keyframes breathe{0%,100%{opacity:.35}50%{opacity:.95}}
@keyframes blink{0%{opacity:1}50%{opacity:.15}}
@keyframes tw{0%,100%{opacity:.18}50%{opacity:.75}}
@keyframes scroll{to{transform:translateX(var(--span))}}
@keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes tear{to{stroke-dashoffset:-60}}
@keyframes alarm{from{transform:scale(.4);opacity:.9}to{transform:scale(1.6);opacity:0}}
${moving ? keyframes : ''}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`

  const defs = `<defs>
<radialGradient id="pool"><stop offset="0" stop-color="${ink.pool}" stop-opacity=".8"/><stop offset=".45" stop-color="${ink.pool}" stop-opacity=".45"/><stop offset="1" stop-color="${ink.pool}" stop-opacity="0"/></radialGradient>
<radialGradient id="halo"><stop offset=".7" stop-color="${ink.glow}" stop-opacity=".16"/><stop offset="1" stop-color="${ink.glow}" stop-opacity="0"/></radialGradient>
<pattern id="tooth" width="180" height="180" patternUnits="userSpaceOnUse">${toothSpecks(ink)}</pattern>
<pattern id="minor" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M20.5 0v100M40.5 0v100M60.5 0v100M80.5 0v100M0 20.5h100M0 40.5h100M0 60.5h100M0 80.5h100" stroke="${ink.chalk}" stroke-opacity=".07" fill="none"/></pattern>
<pattern id="major" width="100" height="100" patternUnits="userSpaceOnUse"><path d="M.5 0v100M0 .5h100" stroke="${ink.chalk}" stroke-opacity=".15" fill="none"/></pattern>
<pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0v5" stroke="${ink.chalk}" stroke-width=".8" opacity=".42"/></pattern>
<pattern id="ice" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".9" fill="${ink.chalk}" opacity=".7"/><circle cx="4.5" cy="4.5" r=".7" fill="${ink.chalk}" opacity=".45"/></pattern>
<linearGradient id="outRamp"><stop offset="0" stop-color="#fff"/><stop offset=".22" stop-color="#fff"/><stop offset=".34" stop-color="#fff" stop-opacity="0"/><stop offset=".68" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#fff"/><stop offset="1" stop-color="#fff"/></linearGradient>
<linearGradient id="ghostRamp"><stop offset="0" stop-color="#fff"/><stop offset=".22" stop-color="#fff"/><stop offset=".34" stop-color="#fff" stop-opacity=".22"/><stop offset=".68" stop-color="#fff" stop-opacity=".22"/><stop offset=".8" stop-color="#fff"/><stop offset="1" stop-color="#fff"/></linearGradient>
<mask id="out" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><rect width="1600" height="1000" fill="url(#outRamp)"/></mask>
<mask id="ghost" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><rect width="1600" height="1000" fill="url(#ghostRamp)"/></mask>
</defs>`

  // The orbits: all five are always plotted, faint; a busy one (a satellite on it, or packets) is drawn stronger.
  let orbits = ''
  ORBITS.forEach((orbit, index) => {
    const busy = index < satCount || (activity === 'working' && index < 3)
    const torn = activity === 'error' && index === 0
    if (torn) {
      orbits += `<path class="tear" d="${orbitPath(orbit)}" fill="none" stroke="${ink.red}" stroke-width="2" stroke-dasharray="38 7 12 18 5 26 20 9" opacity=".9"/><path d="${orbitPath(orbit)}" fill="none" stroke="${ink.red}" stroke-width="9" opacity=".1"/>`
    } else {
      orbits += `<path d="${orbitPath(orbit)}" fill="none" stroke="${ink.chalk}" stroke-width="${busy ? 1.2 : 0.8}" opacity="${busy ? 0.5 : 0.2}"/>`
    }
    orbits += `<path d="${orbitTicks(orbit)}" fill="none" stroke="${torn ? ink.red : ink.chalk}" stroke-width=".8" opacity="${busy ? 0.45 : 0.18}"/>`
  })

  let riders = ''
  if (activity === 'working') riders += packets(ink)
  const restShares = [0.5, 0.46, 0.55, 0.42, 0.52]
  const startShares = [0.38, 0.62, 0.47, 0.3, 0.56]
  for (let index = 0; index < satCount; index += 1) {
    const share = moving ? (startShares[index] ?? 0.5) : (restShares[index] ?? 0.5)
    riders += rider(index, share, satellite(ink, index, activity === 'error' && index === 0), moving)
  }

  const linkLayer = links(ink, activity === 'thinking' || activity === 'working')
  const success = activity === 'success' ? constellation(ink, satCount) : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" font-family="monospace"><style>${style}</style>${defs}
${paper(ink)}
${stars(ink, ctx.phase)}
${margins(ink, ctx.phase, ctx.season)}
<g mask="url(#ghost)">${moon(ink, ctx.season, moving)}${orbits}${success}${riders}</g>
${planet(ink, ctx.season, spin)}
${linkLayer}
${station(ink, activity === 'error')}
${telemetry(ink, activity)}
</svg>`
}

export const theme: LivingTheme = {
  id: 'orbit-ops',
  title: 'Orbit Ops',
  blurb: 'A cyanotype mission chart: a plotted planet in the corner, a relay station and five measured orbits.',
  reacts:
    'Idle the planet turns slowly; thinking pulses the station link; working streams glyph packets along the orbits; each subagent flies its own labelled satellite; an error tears one orbit red; success links the satellites in a constellation. Night is deep indigo, day pale cyan, and the ice cap grows in winter.',
  window: 'dark',
  glass: ctx => ({ blur: 12, tint: INKS[ctx.phase].pool, opacity: ctx.phase === 'day' ? 0.3 : 0.36 }),
  scene: sceneFor,
}
