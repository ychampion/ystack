// Garden Plot: a pixel cottage garden seen from the side. Raised beds sit in the bottom-left and bottom-right corners, a
// trellis climbs the left edge, a watering can rests on a crate at the right. The season decides what grows, the time of
// day lights it, and the agent's activity makes the garden move. Follows the clock: pale paper by day, dark by dusk and night.
// Pure string building: every sprite is a little character map turned into merged pixel runs.
import type { LivingTheme, SceneCtx } from './contract'

type Phase = SceneCtx['phase']
type Season = SceneCtx['season']
type Activity = SceneCtx['activity']

/** One garden pixel is 8 units: about 6 screen pixels in a 1200-wide window. */
const P = 8
/** The soil line, in units. */
const GROUND = 944

/** A repeatable number in 0..1 from an integer seed. */
function hash(seed: number): number {
  let h = (Math.imul(seed + 0x6d2b, 0x9e3779b1) ^ 0x5bd1e995) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

function r1(value: number): number {
  return Math.round(value * 10) / 10
}

function parseHex(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function mix(from: string, to: string, amount: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  return `#${a.map((channel, index) => Math.round(channel + ((b[index] ?? 0) - channel) * amount).toString(16).padStart(2, '0')).join('')}`
}

function grey(hex: string): string {
  const [r, g, b] = parseHex(hex)
  const level = Math.round(r * 0.3 + g * 0.55 + b * 0.15)
  return mix(hex, `#${[level, level, level].map(v => v.toString(16).padStart(2, '0')).join('')}`, 0.85)
}

/** The base colours of the garden, by day. Each phase pulls every one of them toward its own light. */
const BASE: Record<string, string> = {
  g: '#4f8a3c', // stem
  l: '#6aa84f', // leaf
  L: '#3f6f31', // leaf, shade
  t: '#e0533d', // tulip
  T: '#a8322a',
  u: '#f0b43a', // tulip, yellow
  U: '#c47f1e',
  v: '#e98bb0', // tulip, pink
  V: '#b85a83',
  y: '#f5c531', // sunflower petal
  Y: '#d99a1b',
  b: '#6b4423', // seed head
  B: '#40281a',
  o: '#e5832d', // pumpkin
  O: '#b95a1c',
  s: '#5d6b2c', // pumpkin stem
  d: '#c9a66b', // dry stalk
  D: '#97733f',
  k: '#3f7a6b', // winter greens
  K: '#2a5449',
  w: '#fbfbf4', // white: snow, daisy
  x: '#f2d64b', // daisy eye
  c: '#dff1f2', // glass
  C: '#9fc6cc', // glass edge
  p: '#9b6a43', // plank
  P: '#6f4a2c',
  q: '#7a5236', // soil
  Q: '#5a3a25',
  m: '#7aa39a', // watering can
  M: '#4f7770',
  h: '#3e5e58',
  n: '#7aa39a',
  e: '#5f6a72', // slug
  E: '#3c444b',
  a: '#f08a3c', // butterfly wings
  A: '#2c2a2a',
  f: '#f6de4a', // bee
  F: '#2b2622',
  r: '#ffffff', // bee wing
  h2: '#000000',
}

interface Light {
  readonly sky: string
  readonly skyLow: string
  readonly tint: string
  readonly amount: number
  readonly hedge: string
  readonly cloud: string
  readonly dark: boolean
}

const LIGHTS: Record<Phase, Light> = {
  dawn: { sky: '#f5e6dc', skyLow: '#f8dcc8', tint: '#f3b9a2', amount: 0.14, hedge: '#cfd8bd', cloud: '#fff4ec', dark: false },
  day: { sky: '#f4f1e3', skyLow: '#eef0dc', tint: '#ffffff', amount: 0, hedge: '#d3dfbf', cloud: '#ffffff', dark: false },
  dusk: { sky: '#2c2030', skyLow: '#4a2e33', tint: '#3e2433', amount: 0.42, hedge: '#3d3434', cloud: '#5b3c45', dark: true },
  night: { sky: '#111a2c', skyLow: '#1a2740', tint: '#0f1a33', amount: 0.52, hedge: '#1d2a36', cloud: '#26324a', dark: true },
}

type Palette = Record<string, string>

function palette(phase: Phase, season: Season): Palette {
  const light = LIGHTS[phase]
  const out: Palette = {}
  for (const [key, colour] of Object.entries(BASE)) {
    let base = colour
    if (season === 'autumn' && (key === 'l' || key === 'g')) base = mix(colour, '#b8862f', 0.45)
    if (season === 'winter' && (key === 'l' || key === 'g' || key === 'L')) base = mix(colour, '#6f7f6a', 0.5)
    out[key] = mix(base, light.tint, light.amount)
  }
  return out
}

function greyPalette(source: Palette): Palette {
  const out: Palette = {}
  for (const [key, colour] of Object.entries(source)) out[key] = key === 'q' || key === 'Q' || key === 'p' || key === 'P' ? colour : grey(colour)
  return out
}

/** A character map turned into one path per colour, rows of runs, in pixel units. '.' is empty. */
function pixels(rows: readonly string[], colours: Palette): string {
  const runs = new Map<string, string>()
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const key = row[x] ?? '.'
      if (key === '.' || key === ' ') {
        x += 1
        continue
      }
      let end = x + 1
      while (end < row.length && row[end] === key) end += 1
      runs.set(key, `${runs.get(key) ?? ''}M${x} ${y}h${end - x}v1h-${end - x}z`)
      x = end
    }
  })
  let out = ''
  for (const [key, path] of runs) {
    const colour = colours[key]
    if (colour === undefined) continue
    out += `<path d="${path}" fill="${colour}"${key === 'c' ? ' opacity=".45"' : ''}/>`
  }
  return out
}

/** A sprite placed with its bottom-left corner at (x, base), in units. Optional wrapper class for motion. */
function sprite(rows: readonly string[], colours: Palette, x: number, base: number, motion = '', flip = false): string {
  const height = rows.length
  const width = Math.max(...rows.map(row => row.length))
  const left = Math.round(x / P) * P
  const top = base - height * P
  const scale = flip ? `translate(${width},0) scale(-1,1)` : ''
  const inner = `<g transform="translate(${left} ${top}) scale(${P})"><g transform="${scale}">${pixels(rows, colours)}</g></g>`
  return motion === '' ? inner : `<g ${motion}>${inner}</g>`
}

const TULIP = ['.t...t.', '.tt.tt.', '.ttTtt.', '.tttTt.', '..tTt..', '...g...', '.l.g...', '.llg...', '..lg.l.', '...gll.', '...gl..', '...g...']
const BUD = ['...t...', '..tTt..', '...g...', '.l.g...', '.llg.l.', '...gll.', '...g...']
const SUNFLOWER = [
  '....y.y....', '..yyYyYyy..', '.yyYbbbYyy.', '.yYbbBbbYy.', 'yyYbBbBbYyy', '.yYbbBbbYy.', '.yyYbbbYyy.', '..yyYyYyy..', '....y.y....',
  '.....g.....', '.....g.ll..', '.....gllL..', '.....g.l...', '..ll.g.....', '.lLllg.....', '..l..g.....', '.....g.....', '.....g.l...',
  '.....gllL..', '.....g.ll..', '.....g.....', '...l.g.....', '..lLlg.....', '.....g.....', '.....g.....', '.....g.....',
]
const SUNFLOWER_SHORT = [...SUNFLOWER.slice(0, 13), ...SUNFLOWER.slice(20)]
const DAISY = ['.w.w.', 'wwxww', '.w.w.', '..g..', '.lg..', '..gl.', '..g..']
const PUMPKIN = ['....ss....', '..oOooOo..', '.oOooOooO.', 'oOooOooOoo', 'oOooOooOoo', '.oOooOooO.']
const PUMPKIN_SMALL = ['..s...', '.oOoo.', 'oOooOo', 'oOooOo', '.oOoo.']
const STALK = ['..d..', '.dd..', '..dD.', '..d.d', '.Dd..', 'd.d..', '..d..', '..dd.', '..d.D', '..d..', '.dd..', '..d..', '..d..', '..d..']
const CLOCHE = ['...wwww...', '..wwwwww..', '...CCCC...', '..CccccC..', '.Cc.....C.', '.Cc.....C.', '.C.k.k..C.', '.C.kKkKkC.', 'CCCCKCCCCC']
const KALE = ['.k.k.', 'kKkKk', '.kKk.', '..K..']
const CAN = ['.....hhhh...', '....h....h..', '...mmmmmmmm.', 'n.mmmmmmmMm.', 'nnmmmmmmmmm.', '..nmmmmmmMm.', '...mmmmmmmm.', '....MMMMMM..']
const CRATE = ['PPPPPPPPPP', 'PpPpPpPpPP', 'PPPPPPPPPP', 'PpPpPpPpPP', 'PPPPPPPPPP']
const SLUG = ['.....E.', '.eeeeE.', 'eeeeeee']
const BEE = ['.rr.', 'fFfF', '.fF.']
const BUTTERFLY = ['aa.aa', 'aaAaa', '.a.a.']
const PETAL = ['t']

/** A raised bed: a plank box `width` pixels wide and 3 high, with soil heaped on top. */
function bed(colours: Palette, x: number, width: number, snow: boolean): string {
  const rows: string[] = []
  rows.push('.' + 'q'.repeat(width - 2) + '.')
  rows.push('p'.repeat(width))
  rows.push(Array.from({ length: width }, (_, i) => (i % 7 === 3 ? 'P' : 'p')).join(''))
  rows.push('P'.repeat(width))
  let out = sprite(rows, colours, x, GROUND)
  if (snow) out += sprite([Array.from({ length: width }, (_, i) => (hash(i + x) > 0.3 ? 'w' : '.')).join(''), 'w'.repeat(width)], colours, x, GROUND - 3 * P)
  return out
}

/** The soil strip and grass under one corner, thinning out toward the middle with a pixel dither. */
function ground(colours: Palette, from: number, to: number, inward: 'left' | 'right', snow: boolean): string {
  const cols = Math.round((to - from) / P)
  const rows: string[] = []
  for (let row = 0; row < 8; row += 1) {
    let line = ''
    for (let col = 0; col < cols; col += 1) {
      const fade = inward === 'right' ? col / cols : 1 - col / cols
      const keep = fade < 0.75 || hash(col * 31 + row * 7) > (fade - 0.75) * 4
      if (!keep) {
        line += '.'
        continue
      }
      if (row === 0) line += hash(col * 13) > 0.55 ? (snow ? 'w' : 'l') : '.'
      else if (row === 1) line += snow ? 'w' : hash(col * 17) > 0.25 ? 'L' : 'q'
      else line += hash(col * 5 + row * 3) > 0.82 ? 'Q' : 'q'
    }
    rows.push(line)
  }
  return sprite(rows, colours, from, GROUND + 7 * P)
}

/** A hedge far behind the beds: soft pale blobs, edged with a checker dither, so the beds have something to stand against. */
function hedge(light: Light, from: number, to: number, seed: number): string {
  const cols = Math.round((to - from) / P)
  const bumps: Array<[number, number]> = []
  for (let index = 0; index < 7; index += 1) bumps.push([Math.round(hash(seed * 31 + index) * cols), 5 + Math.round(hash(seed * 17 + index) * 7)])
  let solid = ''
  let dither = ''
  for (let col = 0; col < cols; col += 1) {
    let height = 3
    for (const [centre, radius] of bumps) if (Math.abs(col - centre) < radius) height = Math.max(height, Math.round(Math.sqrt(radius * radius - (col - centre) ** 2) * 1.1))
    const top = GROUND / P - height
    solid += `M${col} ${top + 1}h1v${height}h-1z`
    dither += `M${col} ${top - ((col + top) % 2)}h1v1h-1z`
  }
  return `<g transform="translate(${from} 0) scale(${P})"><path d="${solid}" fill="${light.hedge}"/><path d="${dither}" fill="${light.hedge}" opacity=".6"/></g>`
}

/** The trellis up the left edge: two posts, crossbars and a lattice, with a vine dressed for the season. */
function trellis(colours: Palette, season: Season, blooming: boolean): string {
  const left = 2
  const right = 13
  const topRow = 36
  const bottomRow = GROUND / P
  let wood = ''
  for (const col of [left, right]) wood += `M${col} ${topRow}h2v${bottomRow - topRow}h-2z`
  for (let row = topRow + 2; row < bottomRow; row += 12) wood += `M${left} ${row}h${right - left + 2}v1h-${right - left + 2}z`
  let lattice = ''
  for (let row = topRow + 2; row < bottomRow - 12; row += 12) {
    for (let step = 0; step < 11; step += 1) {
      lattice += `M${left + 2 + step} ${row + 1 + step}h1v1h-1z`
      lattice += `M${right - 1 - step} ${row + 1 + step}h1v1h-1z`
    }
  }
  const leafKey: Record<Season, string[]> = {
    spring: ['l', 'l', 'L', 'v'],
    summer: ['l', 'L', 'l', 'L'],
    autumn: ['o', 'O', 't', 'd'],
    winter: [],
  }
  let leaves = ''
  const keys = leafKey[season]
  const count = season === 'autumn' ? 50 : 120
  for (let index = 0; index < count && keys.length > 0; index += 1) {
    const row = Math.round(topRow + 6 + hash(index * 3) * (bottomRow - topRow - 8))
    const wave = Math.sin(row / 5) * 4
    const col = Math.round(8 + wave + (hash(index * 7 + 1) - 0.5) * 9)
    const key = keys[index % keys.length] ?? 'l'
    leaves += `<rect x="${col}" y="${row}" width="${hash(index + 9) > 0.6 ? 2 : 1}" height="1" fill="${colours[key]}"/>`
  }
  if (season === 'summer') {
    for (let index = 0; index < 12; index += 1) {
      const row = Math.round(topRow + 8 + hash(index * 11) * (bottomRow - topRow - 14))
      const col = Math.round(8 + Math.sin(row / 5) * 4 + (hash(index * 5) - 0.5) * 6)
      leaves += `<rect x="${col}" y="${row}" width="2" height="2" fill="${mix(colours.v ?? '#888', '#6a8fe0', 0.7)}"/><rect x="${col}" y="${row}" width="1" height="1" fill="${colours.w}"/>`
    }
  }
  if (season === 'winter') {
    for (let row = topRow + 2; row < bottomRow; row += 12) leaves += `<rect x="${left}" y="${row - 1}" width="${right - left + 2}" height="1" fill="${colours.w}"/>`
    leaves += `<rect x="${left}" y="${topRow - 1}" width="2" height="1" fill="${colours.w}"/><rect x="${right}" y="${topRow - 1}" width="2" height="1" fill="${colours.w}"/>`
  }
  if (blooming) {
    for (let index = 0; index < 16; index += 1) {
      const row = Math.round(topRow + 4 + hash(index * 13 + 2) * (bottomRow - topRow - 10))
      const col = Math.round(8 + Math.sin(row / 5) * 4 + (hash(index * 17) - 0.5) * 8)
      leaves += `<g class="pop" style="animation-delay:${r1(hash(index) * 1.6)}s;transform-origin:${col + 1}px ${row + 1}px"><rect x="${col}" y="${row}" width="2" height="2" fill="${colours[index % 2 === 0 ? 'v' : 'u']}"/><rect x="${col}" y="${row}" width="1" height="1" fill="${colours.w}"/></g>`
    }
  }
  return `<g transform="scale(${P})"><path d="${wood}" fill="${colours.p}"/><path d="${lattice}" fill="${colours.P}"/>${leaves}</g>`
}

/** What grows in one bed this season: a list of [sprite, column offset in pixels, palette swap]. */
function plantsFor(season: Season, bedIndex: number, width: number): Array<{ rows: readonly string[]; at: number; swap?: Record<string, string> }> {
  const out: Array<{ rows: readonly string[]; at: number; swap?: Record<string, string> }> = []
  if (season === 'spring') {
    const colours: Array<Record<string, string>> = [{}, { t: 'u', T: 'U' }, { t: 'v', T: 'V' }]
    for (let at = 1, i = 0; at < width - 6; at += 5, i += 1) out.push({ rows: (i + bedIndex) % 3 === 2 ? BUD : TULIP, at, swap: colours[(i + bedIndex) % 3] })
  } else if (season === 'summer') {
    const tall = bedIndex === 0 || bedIndex === 3
    for (let at = 0, i = 0; at < width - 9; at += tall ? 9 : 6, i += 1) {
      if (tall) out.push({ rows: i % 2 === 0 ? SUNFLOWER : SUNFLOWER_SHORT, at })
      else out.push({ rows: i % 2 === 0 ? SUNFLOWER_SHORT : DAISY, at: at + 1 })
    }
  } else if (season === 'autumn') {
    for (let at = 0, i = 0; at < width - 8; at += 7, i += 1) out.push({ rows: i % 3 === 1 ? STALK : i % 2 === 0 ? PUMPKIN : PUMPKIN_SMALL, at })
  } else {
    for (let at = 0, i = 0; at < width - 9; at += 11, i += 1) out.push({ rows: CLOCHE, at })
    for (let at = 9; at < width - 5; at += 11) out.push({ rows: KALE, at })
  }
  return out
}

interface Bed {
  readonly x: number
  readonly width: number
}

/** Four beds: two in each bottom corner, the prompt box's foot left bare between them. */
const BEDS: readonly Bed[] = [
  { x: 136, width: 22 },
  { x: 336, width: 13 },
  { x: 1168, width: 15 },
  { x: 1304, width: 24 },
]

const BLOOM_SWAPS = [{}, { t: 'u', T: 'U' }, { t: 'v', T: 'V' }]

function bedPlants(colours: Palette, season: Season, index: number, ctx: SceneCtx, sick: boolean): string {
  const place = BEDS[index]
  if (place === undefined) return ''
  const base = GROUND - 3 * P
  let out = ''
  const breeze = ctx.activity === 'thinking'
  for (const [plantIndex, plant] of plantsFor(season, index, place.width).entries()) {
    const swap: Palette = { ...colours }
    for (const [from, to] of Object.entries(plant.swap ?? {})) swap[from] = colours[to] ?? colours[from] ?? '#888'
    const tones = sick ? greyPalette(swap) : swap
    const x = place.x + plant.at * P
    const seconds = r1(3.6 + hash(index * 19 + plantIndex) * 2.4)
    const motion = breeze
      ? `class="sway" style="animation-duration:${seconds}s;animation-delay:-${r1(hash(plantIndex + 7) * seconds)}s"`
      : sick
        ? `class="droop"`
        : ''
    out += sprite(plant.rows, tones, x, base, motion, hash(index * 7 + plantIndex) > 0.5 && season !== 'winter')
  }
  if (ctx.activity === 'success') {
    for (let at = 1, i = 0; at < place.width - 4; at += 4, i += 1) {
      const swap: Palette = { ...colours }
      for (const [from, to] of Object.entries(BLOOM_SWAPS[(i + index) % 3] ?? {})) swap[from] = colours[to] ?? '#888'
      const rows = season === 'winter' ? ['.t.', 'tTt', '.g.'] : ['.t.t.', 'ttTtt', '.tTt.', '..g..']
      const x = place.x + at * P
      out += `<g class="pop" style="animation-delay:${r1(0.2 + hash(i * 3 + index) * 1.4)}s;transform-origin:${x + 2 * P}px ${base - 14 * P}px">${sprite(rows, swap, x, base - (8 + Math.round(hash(i + index * 5) * 9)) * P)}</g>`
    }
  }
  return out
}

/** A pixel disc, for the sun and the moon; `bite` cuts a crescent out of it. */
function disc(radius: number, bite: number): string {
  let path = ''
  for (let y = -radius; y < radius; y += 1) {
    let start: number | null = null
    for (let x = -radius; x <= radius + 1; x += 1) {
      const inside = x <= radius && (x + 0.5) ** 2 + (y + 0.5) ** 2 <= radius * radius && (bite === 0 || (x + 0.5 - bite) ** 2 + (y + 0.5 + bite / 2) ** 2 > radius * radius)
      if (inside && start === null) start = x
      if (!inside && start !== null) {
        path += `M${start} ${y}h${x - start}v1h-${x - start}z`
        start = null
      }
    }
  }
  return path
}

function skyBody(phase: Phase, colours: Palette): string {
  if (phase === 'night') {
    return `<g transform="translate(1392 152) scale(${P})"><path d="${disc(9, 0)}" fill="#e6e8d8" opacity=".08" transform="scale(1.6)"/><path d="${disc(6, 4)}" fill="#ecebd6"/><rect x="-3" y="1" width="1" height="1" fill="#c9c8b3"/><rect x="-4" y="-2" width="1" height="1" fill="#c9c8b3"/></g>`
  }
  if (phase === 'dusk') {
    return `<g transform="translate(1416 392) scale(${P})"><path d="${disc(12, 0)}" fill="#e2733f" opacity=".16" transform="scale(1.5)"/><path d="${disc(8, 0)}" fill="#ee8a45"/><path d="M-8 2h16v1h-16zM-8 5h16v1h-16z" fill="${LIGHTS.dusk.sky}"/></g>`
  }
  const sun = phase === 'dawn' ? { x: 1440, y: 330, colour: '#f2a27a' } : { x: 1408, y: 150, colour: '#f6cf5a' }
  void colours
  return `<g transform="translate(${sun.x} ${sun.y}) scale(${P})"><path d="${disc(11, 0)}" fill="${sun.colour}" opacity=".18"/><path d="${disc(7, 0)}" fill="${sun.colour}"/></g>`
}

function stars(phase: Phase): string {
  if (phase !== 'night' && phase !== 'dusk') return ''
  let out = ''
  const count = phase === 'night' ? 40 : 14
  for (let index = 0; index < count; index += 1) {
    const right = index % 2 === 0
    const x = Math.round((right ? 1180 + hash(index * 3) * 400 : 20 + hash(index * 3) * 380) / P) * P
    const y = Math.round((20 + hash(index * 5 + 1) * 300) / P) * P
    const seconds = r1(3 + hash(index + 50) * 5)
    out += `<rect class="tw" style="animation-duration:${seconds}s;animation-delay:-${r1(hash(index) * seconds)}s" x="${x}" y="${y}" width="${hash(index + 8) > 0.8 ? P : P / 2}" height="${hash(index + 8) > 0.8 ? P : P / 2}" fill="#e9ecd8" opacity=".6"/>`
  }
  return out
}

/** Pixel clouds at the two top corners, drifting very slowly. */
function clouds(light: Light): string {
  const shape = ['...cccc.....', '.cccccccc...', 'cccccccccccc']
  const colours = { c: light.cloud }
  const spots = [
    [70, 110, 140],
    [250, 200, 180],
    [1180, 90, 160],
  ]
  return spots
    .map(([x, y, seconds], index) => `<g class="drift" style="animation-duration:${seconds}s;animation-delay:-${(index * 37) % (seconds ?? 1)}s" opacity="${light.dark ? 0.5 : 0.9}">${sprite(shape, colours, x ?? 0, y ?? 0)}</g>`)
    .join('')
}

/** Fireflies: tiny blinking lights near the beds and the trellis, by dusk and night. */
function fireflies(phase: Phase): string {
  if (phase !== 'night' && phase !== 'dusk') return ''
  const count = phase === 'night' ? 14 : 6
  let out = ''
  for (let index = 0; index < count; index += 1) {
    const right = index % 2 === 1
    const x = Math.round(right ? 1170 + hash(index * 7) * 400 : 30 + hash(index * 7) * 380)
    const y = Math.round(640 + hash(index * 11) * 260)
    const seconds = r1(3 + hash(index + 3) * 4)
    out += `<g class="glow" style="animation-duration:${seconds}s;animation-delay:-${r1(hash(index + 21) * seconds)}s"><circle cx="${x + 2}" cy="${y + 2}" r="9" fill="#e9f59a" opacity=".18"/><rect x="${x}" y="${y}" width="4" height="4" fill="#f1fa9c"/></g>`
  }
  return out
}

/** A path for a flyer, as keyframes: a loop of points about a home, eased. */
function loopKeyframes(name: string, points: ReadonlyArray<readonly [number, number]>): string {
  let frames = ''
  points.forEach((point, index) => {
    frames += `${r1((index / points.length) * 100)}%{transform:translate(${point[0]}px,${point[1]}px)}`
  })
  const first = points[0] ?? [0, 0]
  return `@keyframes ${name}{${frames}100%{transform:translate(${first[0]}px,${first[1]}px)}}`
}

function flyerLoop(index: number, homeX: number, homeY: number, spread: number): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (let step = 0; step < 8; step += 1) {
    const angle = (step / 8) * Math.PI * 2
    points.push([Math.round(homeX + Math.cos(angle) * spread * (0.7 + hash(index * 9 + step) * 0.6)), Math.round(homeY + Math.sin(angle * 2) * spread * 0.35 + (hash(index * 5 + step) - 0.5) * 40)])
  }
  return points
}

/** One flyer per subagent: a butterfly by day, a bright firefly by night, each on its own loop over a corner. */
function agentFlyers(count: number, phase: Phase, colours: Palette): { markup: string; keyframes: string } {
  const homes: Array<[number, number]> = [
    [270, 760],
    [1300, 740],
    [110, 520],
    [1460, 640],
    [420, 680],
  ]
  const wingColours = ['#f08a3c', '#5f8fd6', '#f2cf45', '#e07aa6', '#f5f4ea']
  let markup = ''
  let keyframes = ''
  const night = phase === 'night' || phase === 'dusk'
  for (let index = 0; index < count; index += 1) {
    const [homeX, homeY] = homes[index] ?? [270, 760]
    const points = flyerLoop(index, homeX, homeY, 110)
    keyframes += loopKeyframes(`fly${index}`, points)
    const seconds = 14 + index * 3
    const first = points[0] ?? [homeX, homeY]
    let body: string
    if (night) {
      body = `<circle cx="3" cy="3" r="16" fill="#eaf79a" opacity=".22"/><circle cx="3" cy="3" r="8" fill="#eaf79a" opacity=".3"/><rect width="6" height="6" fill="#f6fdb6"/>`
    } else {
      const wing = mix(wingColours[index] ?? '#f08a3c', LIGHTS[phase].tint, LIGHTS[phase].amount)
      body = `<g class="flap" style="animation-delay:-${index * 0.13}s">${sprite(BUTTERFLY, { a: wing, A: colours.A ?? '#222' }, 0, 3 * P)}</g>`
    }
    markup += `<g style="animation:fly${index} ${seconds}s ease-in-out infinite;animation-delay:-${index * 2.7}s;transform:translate(${first[0]}px,${first[1]}px)">${body}</g>`
  }
  return { markup, keyframes }
}

/** Working: bees zip between the beds, quick straight darts. */
function bees(colours: Palette): { markup: string; keyframes: string } {
  let markup = ''
  let keyframes = ''
  const homes: Array<[number, number]> = [
    [240, 800],
    [1240, 790],
    [1420, 760],
    [380, 840],
  ]
  homes.forEach(([homeX, homeY], index) => {
    const points: Array<[number, number]> = []
    for (let step = 0; step < 7; step += 1) points.push([Math.round(homeX + (hash(index * 23 + step) - 0.5) * 220), Math.round(homeY + (hash(index * 29 + step) - 0.5) * 120)])
    keyframes += loopKeyframes(`bee${index}`, points)
    const first = points[0] ?? [homeX, homeY]
    markup += `<g style="animation:bee${index} ${5 + index}s linear infinite;animation-delay:-${index * 1.3}s;transform:translate(${first[0]}px,${first[1]}px)"><g class="buzz">${sprite(BEE, colours, 0, 3 * P * 0.6)}</g></g>`
  })
  return { markup, keyframes: keyframes.replace(/scale/g, 'scale') }
}

/** The watering can on its crate. Working tips it over the big right bed, and water falls. */
function wateringCan(colours: Palette, pouring: boolean): string {
  const crate = sprite(CRATE, colours, 1504, GROUND)
  const canX = 1496
  const canBase = GROUND - 5 * P
  const can = sprite(CAN, colours, canX, canBase)
  let water = ''
  if (pouring) {
    for (let index = 0; index < 10; index += 1) {
      const x = 1446 + (index % 4) * 7 - (index % 3) * 3
      const delay = r1(index * 0.17)
      water += `<rect class="drop" style="animation-delay:-${delay}s" x="${x}" y="${GROUND - 13 * P + (index % 5) * 14}" width="4" height="8" fill="${mix('#7fb6e0', LIGHTS.day.tint, 0)}" opacity=".85"/>`
    }
  }
  return `${crate}<g class="${pouring ? 'tip' : ''}" style="transform-origin:${canX + 2 * P}px ${canBase - P}px">${can}</g>${water}`
}

/** Error: a little rain cloud over the first right-hand bed, and a slug crossing its rim. */
function blight(colours: Palette): string {
  const place = BEDS[2]
  if (place === undefined) return ''
  const cloud = ['.....cccc.........', '...cccccccc..ccc..', '.ccccccccccccccccc.', 'cccccccccccccccccc', '.CCCCCCCCCCCCCCCC.']
  const cloudX = place.x + 8
  const cloudY = 700
  let rain = ''
  for (let index = 0; index < 16; index += 1) {
    rain += `<rect class="rain" style="animation-delay:-${r1(hash(index) * 1.2)}s" x="${cloudX + 8 + index * 8}" y="${cloudY + 6 + (index % 3) * 22}" width="3" height="10" fill="#8fa4b8" opacity=".8"/>`
  }
  const slug = `<g class="crawl" style="transform:translateX(30px)">${sprite(SLUG, colours, place.x + 10, GROUND - 3 * P)}</g>`
  return `${sprite(cloud, { c: '#8b93a0', C: '#6c7480' }, cloudX, cloudY)}${rain}${slug}`
}

/** Falling things at the two edges: leaves in autumn, snow in winter. */
function falling(season: Season, colours: Palette): string {
  if (season !== 'autumn' && season !== 'winter') return ''
  let out = ''
  const count = season === 'winter' ? 34 : 18
  for (let index = 0; index < count; index += 1) {
    const right = index % 2 === 1
    const x = Math.round(right ? 1200 + hash(index * 3) * 390 : 10 + hash(index * 3) * 390)
    const y = Math.round(-20 + hash(index * 7) * 300)
    const seconds = r1((season === 'winter' ? 16 : 20) + hash(index + 2) * 12)
    const piece =
      season === 'winter'
        ? `<rect width="${hash(index + 4) > 0.7 ? 6 : 4}" height="${hash(index + 4) > 0.7 ? 6 : 4}" fill="${colours.w}" opacity=".9"/>`
        : `<rect width="8" height="4" fill="${colours[index % 3 === 0 ? 'O' : index % 3 === 1 ? 'o' : 't']}"/><rect x="2" y="4" width="4" height="2" fill="${colours.O}"/>`
    out += `<g transform="translate(${x} ${y})"><g class="fall" style="animation-duration:${seconds}s;animation-delay:-${r1(hash(index + 11) * seconds)}s;transform:translate(0,${Math.round(hash(index + 30) * 600)}px)">${piece}</g></g>`
  }
  return out
}

/** Thinking: seeds and petals carried on the breeze across the edges. */
function breezeBits(colours: Palette): string {
  let out = ''
  for (let index = 0; index < 10; index += 1) {
    const right = index % 2 === 1
    const x = right ? 1180 + hash(index * 5) * 200 : 40 + hash(index * 5) * 200
    const y = 560 + hash(index * 9) * 300
    const seconds = r1(9 + hash(index) * 6)
    out += `<g transform="translate(${Math.round(x)} ${Math.round(y)})"><g class="waft" style="animation-duration:${seconds}s;animation-delay:-${r1(hash(index + 5) * seconds)}s">${sprite(PETAL, { t: index % 2 === 0 ? colours.w ?? '#fff' : colours.v ?? '#f9c' }, 0, P * 0.5)}</g></g>`
  }
  return out
}

/** Success: sparkles over every bed. */
function sparkles(): string {
  let out = ''
  for (let index = 0; index < 22; index += 1) {
    const place = BEDS[index % BEDS.length]
    if (place === undefined) continue
    const x = Math.round(place.x + hash(index * 3) * place.width * P)
    const y = Math.round(GROUND - 60 - hash(index * 7) * 200)
    out += `<path class="tw" style="animation-duration:${r1(1.2 + hash(index) * 1.4)}s;animation-delay:-${r1(hash(index + 3))}s" d="M${x - 6} ${y}h12M${x} ${y - 6}v12" stroke="#fff6c2" stroke-width="3"/>`
  }
  return out
}

function sceneFor(ctx: SceneCtx): string {
  const light = LIGHTS[ctx.phase]
  const colours = palette(ctx.phase, ctx.season)
  const activity: Activity = ctx.activity
  const snow = ctx.season === 'winter'
  const agents = Math.max(0, Math.min(5, Math.round(ctx.agents)))
  const flyers = agentFlyers(activity === 'success' || activity === 'error' ? 0 : agents, ctx.phase, colours)
  const swarm = activity === 'working' ? bees(colours) : { markup: '', keyframes: '' }

  const style = `
.sway{transform-box:fill-box;transform-origin:50% 100%;animation:sway 5s ease-in-out infinite alternate}
.droop{transform-box:fill-box;transform-origin:50% 100%;transform:rotate(9deg) scaleY(.9)}
.drift{animation:drift 160s ease-in-out infinite alternate}
.tw{animation:tw 4s ease-in-out infinite}
.glow{animation:glow 4s ease-in-out infinite}
.flap{transform-box:fill-box;transform-origin:50% 50%;animation:flap .5s steps(2) infinite}
.buzz{animation:buzz .16s steps(2) infinite}
.tip{animation:tip 5s ease-in-out infinite;transform:rotate(-34deg)}
.drop{animation:drop .9s linear infinite}
.rain{animation:rain .8s linear infinite}
.crawl{animation:crawl 26s linear infinite alternate}
.fall{animation:fall 20s linear infinite}
.waft{animation:waft 12s ease-in-out infinite}
.pop{animation:pop 1.1s cubic-bezier(.3,1.6,.5,1) both}
@keyframes sway{from{transform:rotate(-3.5deg)}to{transform:rotate(3.5deg)}}
@keyframes drift{from{transform:translateX(0)}to{transform:translateX(64px)}}
@keyframes tw{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes glow{0%,100%{opacity:.15}45%,60%{opacity:1}}
@keyframes flap{50%{transform:scaleX(.3)}}
@keyframes buzz{50%{transform:translateY(-2px)}}
@keyframes tip{0%,12%{transform:rotate(0)}30%,80%{transform:rotate(-34deg)}95%,100%{transform:rotate(0)}}
@keyframes drop{from{transform:translateY(-10px);opacity:0}20%{opacity:.9}to{transform:translateY(70px);opacity:0}}
@keyframes rain{from{transform:translateY(0);opacity:0}20%{opacity:.85}to{transform:translateY(120px);opacity:0}}
@keyframes crawl{from{transform:translateX(0)}to{transform:translateX(70px)}}
@keyframes fall{0%{transform:translate(0,-40px) rotate(0)}50%{transform:translate(30px,320px) rotate(160deg)}100%{transform:translate(-10px,700px) rotate(320deg)}}
@keyframes waft{0%{transform:translate(0,0);opacity:0}15%{opacity:1}85%{opacity:1}100%{transform:translate(150px,-90px);opacity:0}}
@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}
${flyers.keyframes}${swarm.keyframes}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`

  const beds = BEDS.map((place, index) => bed(colours, place.x, place.width, snow)).join('')
  const plants = BEDS.map((_, index) => bedPlants(colours, ctx.season, index, ctx, activity === 'error' && index === 2)).join('')
  const sky = `<rect width="1600" height="1000" fill="${light.sky}"/><rect y="560" width="1600" height="440" fill="url(#low)"/><rect width="1600" height="1000" fill="url(#grain)"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges"><style>${style}</style>
<defs><linearGradient id="low" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${light.skyLow}" stop-opacity="0"/><stop offset="1" stop-color="${light.skyLow}"/></linearGradient>
<pattern id="grain" width="160" height="160" patternUnits="userSpaceOnUse">${Array.from({ length: 26 }, (_, i) => `<rect x="${Math.floor(hash(i * 3) * 20) * P}" y="${Math.floor(hash(i * 5 + 1) * 20) * P}" width="${P / 2}" height="${P / 2}" fill="${light.dark ? '#ffffff' : '#7a6a50'}" opacity="${light.dark ? 0.03 : 0.04}"/>`).join('')}</pattern></defs>
${sky}
${stars(ctx.phase)}
${skyBody(ctx.phase, colours)}
${clouds(light)}
${hedge(light, 0, 470, 1)}${hedge(light, 1140, 1600, 4)}
${ground(colours, 0, 520, 'right', snow)}${ground(colours, 1080, 1600, 'left', snow)}
${trellis(colours, ctx.season, activity === 'success')}
${beds}
${plants}
${wateringCan(colours, activity === 'working')}
${activity === 'error' ? blight(colours) : ''}
${falling(ctx.season, colours)}
${activity === 'thinking' ? breezeBits(colours) : ''}
${fireflies(ctx.phase)}
${swarm.markup}
${flyers.markup}
${activity === 'success' ? sparkles() : ''}
</svg>`
}

export const theme: LivingTheme = {
  id: 'garden-plot',
  title: 'Garden Plot',
  blurb: 'A pixel cottage garden in the bottom corners and up the left edge: raised beds, a trellis and a watering can.',
  reacts:
    'Idle the garden is still; thinking sends a breeze; working brings bees and tips the watering can; each subagent is a butterfly by day or a firefly by night; an error greys a bed under a rain cloud; success bursts every bed into bloom. Tulips in spring, sunflowers in summer, pumpkins and falling leaves in autumn, snowy cloches in winter; bright by day, warm at dusk, moonlit with fireflies at night.',
  window: 'auto',
  glass: ctx =>
    LIGHTS[ctx.phase].dark
      ? { blur: 14, tint: LIGHTS[ctx.phase].sky, opacity: 0.4 }
      : { blur: 14, tint: LIGHTS[ctx.phase].sky, opacity: 0.45 },
  scene: sceneFor,
}
