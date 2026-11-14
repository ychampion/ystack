// Shark Shoal: a LIGHT-window scene on white graph paper. Sharks are mosaics of small square tiles, each tile holding a
// glyph: dark slate along the back, grey on the flank, pale sand-white on the belly, with a soft shadow on the paper and a
// scatter of loose tiles trailing behind. Two sharks cruise diagonally across the left and right edges, keeping the middle
// (the chat) and the foot (the prompt box) clear. The layout is the same in every moment; the motion, the light and a few
// details change:
//   idle: two sharks cruise slowly.           thinking: they turn in slow circles where they are.
//   working: faster, with darting glyph fish.  agents: one small shark more per subagent (1-5).
//   error: one shark goes coral-red, the grid shivers once.   success: the shoal bursts outward in rings of tiles.
// Dawn and dusk warm the paper, night dims it to pale grey-blue with silver sharks; each season drifts a few tiles of its
// colour across the edges. Pure string building, the same string for the same moment.
import type { LivingTheme, SceneCtx } from './contract'

/** One tile's side in the shark's own frame, in px. */
const CELL = 12
const TILE = CELL - 2

type Kind = 'F' | 'B' | 'M' | 'L' | 'W' | 'S' | 'G' | 'E'
type Tile = { x: number; y: number; k: Kind }
type Paint = { tile: string; glyph: string }
type Palette = Record<Kind, Paint>

/** Tone on tone: each glyph a little lighter or darker than its tile. */
const DAY: Palette = {
  F: { tile: '#3a4651', glyph: '#5a6874' },
  B: { tile: '#4b5864', glyph: '#6c7a87' },
  M: { tile: '#75828e', glyph: '#97a2ac' },
  L: { tile: '#aeb7bf', glyph: '#cbd2d8' },
  W: { tile: '#ecebe5', glyph: '#d3d0c6' },
  S: { tile: '#e2d6bd', glyph: '#c4b28c' },
  G: { tile: '#5d6a76', glyph: '#7d8995' },
  E: { tile: '#1b2229', glyph: '#e8edf1' },
}
const NIGHT: Palette = {
  F: { tile: '#66768a', glyph: '#8d9bad' },
  B: { tile: '#7a8a9d', glyph: '#a2afbf' },
  M: { tile: '#9dabba', glyph: '#c0cad5' },
  L: { tile: '#c4cdd7', glyph: '#e0e6ec' },
  W: { tile: '#f1f4f7', glyph: '#d4dbe3' },
  S: { tile: '#e4e0d6', glyph: '#c3bba8' },
  G: { tile: '#8796a8', glyph: '#adb9c7' },
  E: { tile: '#28323e', glyph: '#f1f5f9' },
}
const CORAL: Palette = {
  F: { tile: '#a3302b', glyph: '#c8564d' },
  B: { tile: '#c0433b', glyph: '#e06d62' },
  M: { tile: '#d9665a', glyph: '#f0968a' },
  L: { tile: '#ec9b8e', glyph: '#f7c2b8' },
  W: { tile: '#fbe2db', glyph: '#f0bfb3' },
  S: { tile: '#f3cdbf', glyph: '#de9f8b' },
  G: { tile: '#b13a33', glyph: '#d8645a' },
  E: { tile: '#3d0f0d', glyph: '#fde7e2' },
}

const GLYPHS: Record<Kind, string> = {
  F: '#%/', B: '%/=#', M: '=:+/', L: ':-.+', W: '.:', S: ':.', G: '|', E: 'o',
}

/** A deterministic 0..1 value for a cell. */
function hash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x + 101, 374761393) ^ Math.imul(y + 37, 668265263) ^ Math.imul(salt + 7, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const round = (n: number): number => Math.round(n * 100) / 100

// ---------------------------------------------------------------- the shark, in its own frame: snout at +x, y down

/** Half the body's depth at `x` (cells): a long fusiform body, a pointed snout, a slim tail stock. */
function depth(x: number): number {
  if (x < -11 || x > 15) return 0
  if (x <= 4) {
    const s = (x + 11) / 15
    return 0.75 + 2.95 * (1 - (1 - s) ** 2)
  }
  const u = (x - 4) / 11
  return 3.7 * Math.max(0, 1 - u ** 2.1) ** 0.62
}

/** The body's centre line: the rear swings with the tail beat. */
function centre(x: number, beat: number): number {
  return x < 0 ? beat * 1.5 * (-x / 11) ** 2 : 0
}

function inTriangle(px: number, py: number, a: readonly number[], b: readonly number[], c: readonly number[]): boolean {
  const [ax = 0, ay = 0] = a
  const [bx = 0, by = 0] = b
  const [cx = 0, cy = 0] = c
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

/** How far a point lies from a segment, and how far along it the nearest point is. */
function segment(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; along: number } {
  const dx = bx - ax
  const dy = by - ay
  const along = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return { d: Math.hypot(px - ax - along * dx, py - ay - along * dy), along }
}

/** Which tile, if any, the cell at (cx, cy) holds for a shark mid-beat. Cells are tested at their centres. */
function tileAt(cx: number, cy: number, beat: number): Kind | undefined {
  const x = cx + 0.5
  const y = cy + 0.5
  const c = centre(x, beat)
  const h = depth(x)
  const top = c - h
  const belly = c + h * 0.86
  const pick = hash(cx, cy, 3)

  // The eye, and gill slits behind it.
  if (cx === 11 && cy === -1) return 'E'
  if (h > 0 && y > top && y < belly) {
    if ((cx === 6 || cx === 7 || cx === 8) && y > c - h * 0.35 && y < c + h * 0.5 && (cx !== 8 || pick < 0.8)) return 'G'
    // Countershading: back, flank, belly, with a ragged line between them.
    const z = y < c ? (c - y) / h : -(y - c) / (h * 0.86)
    const noise = (pick - 0.5) * 0.26
    if (z + noise > 0.5) return 'B'
    if (z + noise > 0.08) return 'M'
    if (z + noise > -0.28) return 'L'
    return pick < 0.16 ? 'S' : 'W'
  }

  const at = (px: number): readonly number[] => [px, centre(px, beat) - depth(px) + 0.4]
  const under = (px: number): readonly number[] => [px, centre(px, beat) + depth(px) * 0.86 - 0.4]
  // First dorsal: tall, its tip swept back. Second dorsal and the anal fin: small.
  if (inTriangle(x, y, at(6.2), at(0.6), [-1.2, at(0.6)[1]! - 4.6])) return 'F'
  if (inTriangle(x, y, at(-6.6), at(-8.6), [-9.6, at(-8.6)[1]! - 1.7])) return 'F'
  if (inTriangle(x, y, under(-7.2), under(-9), [-9.9, under(-9)[1]! + 1.5])) return 'M'
  // Pectoral fin: long, swept down and back. Pelvic: small.
  if (inTriangle(x, y, under(8), under(4.6), [0.8, under(4.6)[1]! + 4.6])) return pick < 0.55 ? 'B' : 'M'
  if (inTriangle(x, y, under(-2.8), under(-4.8), [-6.2, under(-4.8)[1]! + 1.7])) return 'M'

  // The crescent tail: a long upper lobe and a shorter lower one from the tail stock, turned with the beat.
  const px = -11
  const py = centre(px, beat)
  const turn = beat * 0.2
  const rot = (dx: number, dy: number): [number, number] => [px + dx * Math.cos(turn) - dy * Math.sin(turn), py + dx * Math.sin(turn) + dy * Math.cos(turn)]
  const [ux, uy] = rot(-6.4, -6.6)
  const [lx, ly] = rot(-4.4, 4)
  const upper = segment(x, y, px + 0.6, py, ux, uy)
  if (upper.d <= 1.45 - upper.along * 1.15) return upper.along > 0.55 || pick < 0.5 ? 'F' : 'B'
  const lower = segment(x, y, px + 0.6, py, lx, ly)
  if (lower.d <= 1.25 - lower.along * 0.95) return lower.along > 0.6 ? 'B' : 'M'
  return undefined
}

/** Every tile of a shark at one beat, front (x >= 0) or rear (x < 0). */
function sharkTiles(beat: number, part: 'front' | 'rear'): Tile[] {
  const tiles: Tile[] = []
  const [from, to] = part === 'front' ? [0, 16] : [-19, -1]
  for (let cy = -11; cy <= 9; cy += 1) {
    for (let cx = from; cx <= to; cx += 1) {
      const k = tileAt(cx, cy, beat)
      if (k !== undefined) tiles.push({ x: cx, y: cy, k })
    }
  }
  return tiles
}

/** Tiles of one kind in one path each, their glyphs one text per row. */
function mosaic(tiles: readonly Tile[], paint: Palette, salt: number): string {
  const byKind = new Map<Kind, Tile[]>()
  for (const t of tiles) {
    const list = byKind.get(t.k) ?? []
    list.push(t)
    byKind.set(t.k, list)
  }
  let path = ''
  let text = ''
  for (const [k, list] of byKind) {
    const p = paint[k]
    path += `<path fill="${p.tile}" d="${list.map(t => `M${t.x * CELL + 1} ${t.y * CELL + 1}h${TILE}v${TILE}h-${TILE}z`).join('')}"/>`
    const rows = new Map<number, Tile[]>()
    for (const t of list) {
      const row = rows.get(t.y) ?? []
      row.push(t)
      rows.set(t.y, row)
    }
    const glyphs = GLYPHS[k]
    for (const [y, row] of rows) {
      const shown = row.filter(t => k === 'E' || hash(t.x, t.y, salt) < 0.62)
      if (shown.length === 0) continue
      text += `<text fill="${p.glyph}" x="${shown.map(t => t.x * CELL + CELL / 2).join(' ')}" y="${y * CELL + 9.5}">${shown.map(t => glyphs[Math.floor(hash(t.x, t.y, salt + 1) * glyphs.length)] ?? '.').join('')}</text>`
    }
  }
  return path + text
}

/** One flat silhouette of a set of tiles, runs of a row joined into one rectangle. */
function silhouette(tiles: readonly Tile[]): string {
  const rows = new Map<number, number[]>()
  for (const t of tiles) {
    const row = rows.get(t.y) ?? []
    row.push(t.x)
    rows.set(t.y, row)
  }
  let d = ''
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b)
    let start = xs[0] ?? 0
    for (let i = 1; i <= xs.length; i += 1) {
      const prev = xs[i - 1] ?? 0
      const cur = xs[i]
      if (cur === prev + 1) continue
      const w = (prev - start + 1) * CELL
      d += `M${start * CELL} ${y * CELL}h${w}v${CELL}h-${w}z`
      start = cur ?? 0
    }
  }
  return d
}

/** Loose tiles scattered behind the tail, fewer and fainter the further back. */
function trail(paint: Palette): string {
  let out = ''
  for (let i = 0; i < 26; i += 1) {
    const back = 18 + hash(i, 1, 9) * 16
    const across = (hash(i, 2, 9) - 0.5) * (3 + (back - 18) * 0.55)
    const k: Kind = hash(i, 3, 9) < 0.45 ? 'L' : hash(i, 3, 9) < 0.75 ? 'M' : 'S'
    const x = Math.round(-back) * CELL
    const y = Math.round(across) * CELL
    const opacity = round(Math.max(0.12, 0.85 - (back - 18) / 20))
    out += `<rect x="${x + 1}" y="${y + 1}" width="${TILE}" height="${TILE}" fill="${paint[k].tile}" opacity="${opacity}"/>`
  }
  return out
}

/** The tail's four poses: swung one way, through the middle, the other way, back. */
const BEATS = [-1, 0, 1, 0] as const

/** The shapes every shark draws, once each: front, four rear poses, the trail and the shadow, for one palette. */
function sharkDefs(prefix: string, paint: Palette): string {
  const front = sharkTiles(0, 'front')
  let out = `<g id="${prefix}f">${mosaic(front, paint, 1)}</g>`
  BEATS.forEach((beat, i) => {
    out += `<g id="${prefix}r${i}">${mosaic(sharkTiles(beat, 'rear'), paint, 2 + (i % 2))}</g>`
  })
  out += `<g id="${prefix}t">${trail(paint)}</g>`
  return out
}

/** The shadow is the same for every palette: one blurred silhouette at the middle beat. */
function shadowDef(): string {
  const all = [...sharkTiles(0, 'front'), ...sharkTiles(0, 'rear')]
  return `<path id="sh" d="${silhouette(all)}"/>`
}

// ---------------------------------------------------------------- where and how they move

type Lane = {
  /** Where the lane starts and ends, off screen, and where a still scene puts the shark. */
  from: readonly [number, number]
  to: readonly [number, number]
  scale: number
}

/** The two big sharks: the left one heads down and left, the right one down and left along the right edge. */
const BIG: readonly Lane[] = [
  { from: [880, -300], to: [-420, 900], scale: 1.25 },
  { from: [2080, 180], to: [840, 1290], scale: 1.12 },
]

/** One small shark per subagent, each in a lane of its own along an edge. */
const SMALL: readonly Lane[] = [
  { from: [-220, 640], to: [560, 1140], scale: 0.5 },
  { from: [1180, -160], to: [1840, 420], scale: 0.46 },
  { from: [-200, 520], to: [470, -80], scale: 0.42 },
  { from: [1820, 560], to: [1240, 140], scale: 0.48 },
  { from: [820, -130], to: [1300, 190], scale: 0.38 },
]

/** The midpoint of a lane, where a still scene draws its shark. */
const mid = (lane: Lane): [number, number] => [round((lane.from[0] + lane.to[0]) / 2), round((lane.from[1] + lane.to[1]) / 2)]

/** The turn and mirror that point a shark (snout +x) along its lane, keeping its back up. */
function heading(lane: Lane): string {
  const dx = lane.to[0] - lane.from[0]
  const dy = lane.to[1] - lane.from[1]
  const left = dx < 0
  const angle = (Math.atan2(left ? -dy : dy, left ? -dx : dx) * 180) / Math.PI
  return `rotate(${round(angle)}) scale(${left ? -lane.scale : lane.scale} ${lane.scale})`
}

type Motion = {
  /** Seconds for one pass along a lane. */
  cruise: number
  /** Seconds for one tail beat (all four poses). */
  beat: number
  /** Circle in place in place of cruising. */
  isCircling: boolean
}

function motionOf(ctx: SceneCtx): Motion {
  switch (ctx.activity) {
    case 'thinking':
      return { cruise: 0, beat: 2.8, isCircling: true }
    case 'working':
      return { cruise: 38, beat: 1.1, isCircling: false }
    case 'agents':
      return { cruise: 60, beat: 1.6, isCircling: false }
    case 'error':
      return { cruise: 110, beat: 3.2, isCircling: false }
    case 'success':
      return { cruise: 70, beat: 1.4, isCircling: false }
    default:
      return { cruise: 96, beat: 2.4, isCircling: false }
  }
}

/** One shark: shadow, tail poses, front and trail, turned along its lane. */
function shark(prefix: string, lane: Lane, beat: number, index: number): string {
  const turn = heading(lane)
  const poses = BEATS.map((_, i) => `<use href="#${prefix}r${i}" class="pose${i === 0 ? ' p0' : ''}" style="animation-duration:${beat}s;animation-delay:-${round((beat * (4 - i)) / 4 + index * 0.37)}s"/>`).join('')
  const offset = Math.round(16 * lane.scale + 4)
  return `<g transform="translate(${offset} ${Math.round(offset * 1.5)})"><g transform="${turn}"><use href="#sh" class="shadow"/></g></g><g transform="${turn}"><g class="sway" style="animation-delay:-${index * 1.3}s"><use href="#${prefix}t"/>${poses}<use href="#${prefix}f"/></g></g>`
}

/** A ring of tiles bursting out from a shark (success). */
function burst(index: number): string {
  let out = ''
  const n = 20
  // Two rings, the second a beat behind the first, so the burst reads at any moment of the flash.
  for (const wave of [0, 1]) {
    for (let i = 0; i < n; i += 1) {
      const angle = round((360 / n) * i + index * 9 + wave * 9)
      const fill = ['#4b5864', '#aeb7bf', '#e2d6bd', '#6aa58f', '#d9b25a'][(i + wave) % 5]
      const size = wave === 0 ? 14 : 11
      out += `<g transform="rotate(${angle})"><rect class="ring" style="animation-delay:${round(wave * 1.3 + (i % 3) * 0.07)}s" x="${-size / 2}" y="${-size / 2}" width="${size}" height="${size}" fill="${fill}"/></g>`
    }
  }
  return `<g class="burst">${out}</g>`
}

/** One shark in its lane: cruising along it, or circling at its midpoint. */
function placed(prefix: string, lane: Lane, laneIndex: number, motion: Motion, ctx: SceneCtx, small: boolean): string {
  const [mx, my] = mid(lane)
  const id = `${small ? 's' : 'b'}${laneIndex}`
  const beat = small ? round(motion.beat * 0.7) : motion.beat
  const body = shark(prefix, lane, beat, laneIndex + (small ? 3 : 0))
  if (motion.isCircling) {
    // Circling: the shark rides a slow wheel around its lane's midpoint, its snout along the wheel's rim.
    const radius = small ? 90 : 230
    const seconds = small ? 18 : 30
    const dir = laneIndex % 2 === 0 ? 'spinR' : 'spinL'
    const flip = laneIndex % 2 === 0 ? '' : ' scale(-1 1)'
    return `<g transform="translate(${mx} ${my})"><g class="${dir}" style="animation-duration:${seconds}s;animation-delay:-${laneIndex * 5}s"><g transform="translate(0 ${-radius})${flip}"><g transform="scale(${lane.scale})">${shark(prefix, { from: [0, 0], to: [1, 0], scale: 1 }, beat, laneIndex)}</g></g></g></g>`
  }
  const seconds = Math.round((small ? motion.cruise * 0.8 : motion.cruise) * (1 + laneIndex * 0.07))
  const extra = !small && ctx.activity === 'success' ? burst(laneIndex) : ''
  return `<g class="lane ${id}" style="animation-duration:${seconds}s;animation-delay:-${round(seconds / 2)}s">${body}${extra}</g>`
}

/** The keyframes and still place of each lane. */
function laneStyles(lanes: readonly { lane: Lane; id: string }[]): string {
  return lanes
    .map(({ lane, id }) => {
      const [mx, my] = mid(lane)
      return `.${id}{transform:translate(${mx}px,${my}px)}@keyframes ${id}{from{transform:translate(${lane.from[0]}px,${lane.from[1]}px)}to{transform:translate(${lane.to[0]}px,${lane.to[1]}px)}}.${id}{animation-name:${id}}`
    })
    .join('')
}

// ---------------------------------------------------------------- the small things: fish, seasonal tiles

/** Where each school of tiny fish darts, which way, and how many. */
const SCHOOLS = [
  { x: 120, y: 640, dx: -1, dy: 0.7, n: 9 },
  { x: 1380, y: 300, dx: -1, dy: 1, n: 9 },
  { x: 260, y: 150, dx: -1, dy: 0.6, n: 6 },
] as const

/** Glyph fish: a two-tile body and a tail tile, darting along in bursts (working only). */
function fish(paint: Palette): string {
  let out = ''
  SCHOOLS.forEach((school, s) => {
    const angle = round((Math.atan2(-school.dy, -school.dx) * 180) / Math.PI)
    for (let i = 0; i < school.n; i += 1) {
      const x = Math.round(school.x + (hash(i, s, 41) - 0.5) * 220)
      const y = Math.round(school.y + (hash(i, s, 42) - 0.5) * 160)
      const seconds = round(3.2 + hash(i, s, 43) * 2.4)
      out += `<g transform="translate(${x} ${y}) rotate(${angle}) scale(-1.6 1.6)"><g class="dart" style="animation-duration:${seconds}s;animation-delay:-${round(hash(i, s, 44) * seconds)}s"><use href="#fish"/></g></g>`
    }
  })
  return `<defs><g id="fish"><path fill="${paint.B.tile}" d="M0 0h6v6h-6zM7 0h6v6h-6z"/><path fill="${paint.L.tile}" d="M-7 -3h6v6h-6zM-7 4h5v5h-5z"/><text x="3 10" y="5" fill="${paint.L.glyph}" font-size="6">=&gt;</text></g></defs>${out}`
}

const SEASON_TILES = {
  spring: { tile: '#f3c6d3', glyph: '#d98aa2', chars: '*o' },
  summer: { tile: '#f6dc6e', glyph: '#d6ad2a', chars: 'o*' },
  autumn: { tile: '#e2a14a', glyph: '#b06e1f', chars: '%/' },
  winter: { tile: '#e3ecf3', glyph: '#8fa6b8', chars: '+*' },
} as const

/** A few seasonal tiles drifting down and across the edges. */
function seasonal(ctx: SceneCtx): string {
  const s = SEASON_TILES[ctx.season]
  let out = ''
  for (let i = 0; i < 22; i += 1) {
    const side = i % 2 === 0
    const x = Math.round(side ? 30 + hash(i, 1, 51) * 330 : 1240 + hash(i, 1, 51) * 330)
    const y = Math.round(40 + hash(i, 2, 51) * 760)
    const seconds = Math.round(26 + hash(i, 3, 51) * 30)
    const size = 18 + Math.round(hash(i, 4, 51) * 10)
    const ch = s.chars[i % s.chars.length] ?? '*'
    const border = ctx.season === 'winter' ? ` stroke="#b4c5d3" stroke-width="1"` : ''
    out += `<g transform="translate(${x} ${y}) rotate(${Math.round(hash(i, 5, 51) * 40 - 20)})"><g class="drift" style="animation-duration:${seconds}s;animation-delay:-${Math.round(hash(i, 6, 51) * seconds)}s"><rect width="${size}" height="${size}" fill="${s.tile}"${border}/><text x="${size / 2}" y="${size - 2.5}" fill="${s.glyph}" font-size="${size - 5}">${ch}</text></g></g>`
  }
  return out
}

// ---------------------------------------------------------------- the paper and its light

const PAPER = {
  dawn: { ground: '#fdf6ee', line: '#eadfd2', glow: '#fbd9b8', glowAt: [0, 0] },
  day: { ground: '#fbfbf9', line: '#e4e7ea', glow: '#ffffff', glowAt: [800, 500] },
  dusk: { ground: '#fbefe6', line: '#ead8cc', glow: '#f6c3a6', glowAt: [1600, 1000] },
  night: { ground: '#e1e7ee', line: '#cdd6e0', glow: '#c8d3e2', glowAt: [800, 1000] },
} as const

function glassOf(ctx: SceneCtx) {
  return {
    dawn: { blur: 10, tint: '#fdf6ee', opacity: 0.42 },
    day: { blur: 10, tint: '#fbfbf9', opacity: 0.42 },
    dusk: { blur: 10, tint: '#fbefe6', opacity: 0.44 },
    night: { blur: 12, tint: '#e6ebf1', opacity: 0.5 },
  }[ctx.phase]
}

export function sharkShoalSvg(ctx: SceneCtx): string {
  const paint = ctx.phase === 'night' ? NIGHT : DAY
  const paper = PAPER[ctx.phase]
  const motion = motionOf(ctx)
  const isError = ctx.activity === 'error'
  const agents = Math.max(0, Math.min(SMALL.length, Math.floor(ctx.agents)))

  const lanes: { lane: Lane; id: string }[] = [
    ...BIG.map((lane, i) => ({ lane, id: `b${i}` })),
    ...SMALL.slice(0, agents).map((lane, i) => ({ lane, id: `s${i}` })),
  ]

  const style = `
text{font:800 9px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-anchor:middle}
.pose{opacity:0;animation:beat 2s steps(1,end) infinite}.p0{opacity:1}
.lane{animation-timing-function:linear;animation-iteration-count:infinite}
.sway{animation:sway 7s ease-in-out infinite alternate}
.spinR{animation:spinR 30s linear infinite}.spinL{animation:spinL 30s linear infinite}
.shadow{fill:#4a5866;opacity:${ctx.phase === 'night' ? 0.1 : 0.13}}
.dart{opacity:0;animation:dart 4s ease-out infinite}
.drift{opacity:.85;animation:drift 40s linear infinite}
.ring{opacity:.8;transform:translateX(150px);animation:ring 2.6s cubic-bezier(.2,.7,.3,1) 3 backwards}
.grid{animation:shiver .8s ease-in-out 1}
.twinkle{animation:twinkle 9s ease-in-out infinite alternate}
@keyframes beat{0%{opacity:1}26%{opacity:0}100%{opacity:0}}
@keyframes sway{from{transform:translateY(-5px)}to{transform:translateY(5px)}}
@keyframes spinR{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes spinL{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}
@keyframes dart{0%{opacity:0;transform:translateX(0)}8%{opacity:1}20%{transform:translateX(70px)}45%{transform:translateX(90px)}60%{transform:translateX(170px)}85%{opacity:1;transform:translateX(190px)}100%{opacity:0;transform:translateX(250px)}}
@keyframes drift{0%{opacity:0;transform:translate(0,0) rotate(0deg)}12%{opacity:.85}88%{opacity:.85}100%{opacity:0;transform:translate(90px,170px) rotate(90deg)}}
@keyframes ring{0%{opacity:0;transform:translateX(40px)}10%{opacity:1}75%{opacity:.8}100%{opacity:0;transform:translateX(320px)}}
@keyframes shiver{0%,100%{transform:translate(0,0)}15%{transform:translate(-4px,1px)}30%{transform:translate(4px,-1px)}45%{transform:translate(-3px,0)}60%{transform:translate(2px,1px)}80%{transform:translate(-1px,0)}}
@keyframes twinkle{from{opacity:.15}to{opacity:.6}}
${laneStyles(lanes)}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`

  const defs = `<pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M0 .5H24M.5 0V24" stroke="${paper.line}" fill="none"/></pattern>
<pattern id="major" width="120" height="120" patternUnits="userSpaceOnUse"><path d="M0 .5H120M.5 0V120" stroke="${paper.line}" stroke-opacity=".9" fill="none"/></pattern>
<radialGradient id="glow" cx="${paper.glowAt[0]}" cy="${paper.glowAt[1]}" r="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${paper.glow}" stop-opacity="${ctx.phase === 'day' ? 0 : 0.55}"/><stop offset="1" stop-color="${paper.glow}" stop-opacity="0"/></radialGradient>
<filter id="soft" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="7"/></filter>
${shadowDef()}${sharkDefs('a', isError ? CORAL : paint)}${isError ? sharkDefs('n', paint) : ''}`

  const shadowFilter = `<style>.shadow{filter:url(#soft)}</style>`
  const big = BIG.map((lane, i) => placed(isError && i === 1 ? 'n' : 'a', lane, i, motion, ctx, false)).join('')
  // In an error, only the left shark goes coral: the right one keeps the moment's palette.
  const small = SMALL.slice(0, agents).map((lane, i) => placed(isError ? 'n' : 'a', lane, i, motion, ctx, true)).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" font-family="monospace"><style>${style}</style>${shadowFilter}<defs>${defs}</defs>
<rect width="1600" height="1000" fill="${paper.ground}"/>
<rect width="1600" height="1000" fill="url(#glow)"/>
<g class="${isError ? 'grid' : ''}"><rect x="-24" y="-24" width="1648" height="1048" fill="url(#grid)"/><rect x="-24" y="-24" width="1648" height="1048" fill="url(#major)"/></g>
${seasonal(ctx)}
${ctx.activity === 'working' ? fish(paint) : ''}
${small}${big}
</svg>`
}

export const theme: LivingTheme = {
  id: 'shark-shoal',
  title: 'Shark Shoal',
  blurb: 'Mosaic sharks of glyph tiles cruise the edges of white graph paper.',
  reacts: 'Sharks circle while Claude thinks, speed up with darting fish while tools run, gain a small shark per subagent, flush coral on a failure and burst into rings on a merge; the paper warms at dawn and dusk and dims at night, with tiles of the season drifting by.',
  window: 'light',
  glass: glassOf,
  scene: sharkShoalSvg,
}
