// Desert Caravan: one-bit dithered dunes in the bottom corners under a dithered sun or moon. A far dune line runs along the
// right, and the caravan walks it when the agent works, one camel per subagent. Follows the clock: sand paper by dawn and
// day, umber and indigo paper by dusk and night. Pure string building: every dot sits on one 5-unit grid.
import type { LivingTheme, SceneCtx } from './contract'

type Phase = SceneCtx['phase']
type Season = SceneCtx['season']

const W = 1600
const H = 1000
/** One dither cell is 5 units: 4 screen pixels in a 1280-wide window. */
const CELL = 5
const COLS = W / CELL
const ROWS = H / CELL

/** The 8x8 ordered-dither matrix, built by the usual doubling. */
function bayer(size: number): number[][] {
  if (size === 1) return [[0]]
  const half = bayer(size / 2)
  const out: number[][] = []
  for (let y = 0; y < size; y += 1) {
    const row: number[] = []
    for (let x = 0; x < size; x += 1) {
      const quarter = y < size / 2 ? (x < size / 2 ? 0 : 2) : x < size / 2 ? 3 : 1
      row.push(4 * (half[y % (size / 2)]?.[x % (size / 2)] ?? 0) + quarter)
    }
    out.push(row)
  }
  return out
}

const BAYER = bayer(8)

function threshold(col: number, row: number): number {
  return ((BAYER[row % 8]?.[col % 8] ?? 0) + 0.5) / 64
}

function hash(seed: number): number {
  let h = (Math.imul(seed + 0x2545, 0x9e3779b1) ^ 0x68e31da4) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  return ((h ^ (h >>> 12)) >>> 0) / 4294967296
}

function r1(value: number): number {
  return Math.round(value * 10) / 10
}

function smoothstep(low: number, high: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)))
  return t * t * (3 - 2 * t)
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

/** A stock: the paper, the flat tone of each dune (back to front), the one sand ink, the sky body and the accents. */
interface Stock {
  readonly paper: string
  readonly sands: readonly string[]
  readonly ink: string
  readonly soft: string
  readonly body: string
  readonly water: string
  readonly bloom: string
  readonly frost: string
  readonly dark: boolean
}

const STOCKS: Record<Phase, Stock> = {
  day: { paper: '#efe4ca', sands: ['#ebdfc3', '#e7dabc', '#e3d5b5', '#dfd0ae'], ink: '#76603f', soft: '#bba582', body: '#cf5a35', water: '#3d8a86', bloom: '#c4507a', frost: '#8fb0c8', dark: false },
  dawn: { paper: '#f2e1d3', sands: ['#eedccd', '#ead6c6', '#e6d0bf', '#e2cab8'], ink: '#85594f', soft: '#c49f92', body: '#e0744c', water: '#4a8a92', bloom: '#c4507a', frost: '#9ab3cc', dark: false },
  dusk: { paper: '#291c1e', sands: ['#2d1f21', '#312224', '#352527', '#39282a'], ink: '#b07454', soft: '#6e4a3c', body: '#ea7a3e', water: '#5fa5a0', bloom: '#e07aa0', frost: '#c7d6ea', dark: true },
  night: { paper: '#141927', sands: ['#171c2b', '#1a1f2f', '#1d2233', '#202537'], ink: '#7a86aa', soft: '#3e4762', body: '#ece6cb', water: '#6fa8c0', bloom: '#d58ab0', frost: '#dfe8f6', dark: true },
}

/** Winter cools every colour; summer bleaches the day paper a little. */
function stockFor(phase: Phase, season: Season): Stock {
  const base = STOCKS[phase]
  if (season === 'winter') {
    const cold = base.dark ? '#1b2a48' : '#c9d6e6'
    const amount = base.dark ? 0.32 : 0.28
    return {
      ...base,
      paper: mix(base.paper, cold, amount),
      sands: base.sands.map(sand => mix(sand, cold, amount)),
      ink: mix(base.ink, base.dark ? '#a9bde0' : '#4d6178', 0.35),
      soft: mix(base.soft, cold, amount),
    }
  }
  if (season === 'summer' && !base.dark) return { ...base, paper: mix(base.paper, '#fff6dc', 0.4), sands: base.sands.map(sand => mix(sand, '#fff3d2', 0.3)) }
  return base
}

type CrestPoint = readonly [number, number, number?]

interface Dune {
  readonly crest: readonly CrestPoint[]
  readonly tone: number
  readonly reach: number
  readonly soft: boolean
}

/** Back to front. The first is the far dune line the caravan walks on; the last lies along the very bottom. */
const DUNES: readonly Dune[] = [
  { crest: [[0, 700], [260, 668, 1], [620, 716], [1000, 722], [1230, 680], [1440, 634, 1], [1600, 654]], tone: 0.3, reach: 110, soft: true },
  { crest: [[0, 790], [210, 742, 1], [520, 836], [800, 872], [1100, 846], [1370, 760, 1], [1600, 792]], tone: 0.42, reach: 170, soft: false },
  { crest: [[0, 884], [280, 846, 1], [580, 930], [900, 962], [1200, 924], [1430, 858, 1], [1600, 878]], tone: 0.48, reach: 150, soft: false },
  { crest: [[0, 958], [330, 936], [700, 988], [1000, 994], [1290, 968], [1600, 946]], tone: 0.5, reach: 70, soft: false },
]

function crestAt(points: readonly CrestPoint[], x: number): number {
  let last = 0
  for (let index = 0; index < points.length; index += 1) {
    const to = points[index]
    if (to === undefined) continue
    last = to[1]
    if (x > to[0]) continue
    const from = index === 0 ? undefined : points[index - 1]
    if (from === undefined) return to[1]
    const t = (x - from[0]) / (to[0] - from[0])
    let eased = (1 - Math.cos(Math.PI * t)) / 2
    if (to[2] === 1 && from[2] !== 1) eased = Math.pow(t, 1.7)
    if (from[2] === 1 && to[2] !== 1) eased = 1 - Math.pow(1 - t, 1.7)
    return from[1] + (to[1] - from[1]) * eased
  }
  return last
}

/** The crest's row on the dither grid. */
function crestRow(dune: Dune, col: number): number {
  return Math.round(crestAt(dune.crest, col * CELL + CELL / 2) / CELL)
}

/** 1 at the window's edges, 0 under the conversation and the prompt box. */
function edgeWeight(x: number): number {
  const u = x / W
  return Math.max(1 - smoothstep(0.17, 0.33, u), smoothstep(0.67, 0.83, u))
}

/** Rows of cells turned into runs: `cells(col, row)` says whether a cell is inked. Draws in cell units. */
function runs(firstRow: number, lastRow: number, firstCol: number, lastCol: number, inked: (col: number, row: number) => boolean): string {
  let path = ''
  for (let row = firstRow; row <= lastRow; row += 1) {
    let start = -1
    for (let col = firstCol; col <= lastCol + 1; col += 1) {
      const on = col <= lastCol && inked(col, row)
      if (on && start < 0) start = col
      if (!on && start >= 0) {
        path += `M${start} ${row}h${col - start}v1h-${col - start}z`
        start = -1
      }
    }
  }
  return path
}

/** The dune's outline, a staircase on the grid, in units. */
function outline(dune: Dune): string {
  let path = `M0 ${H}`
  let previous = -1
  for (let col = 0; col < COLS; col += 1) {
    const top = crestRow(dune, col) * CELL
    if (top !== previous) {
      path += previous < 0 ? `V${top}` : `H${col * CELL}V${top}`
      previous = top
    }
  }
  return `${path}H${W}V${H}z`
}

/**
 * One dune's dots. Shade is strongest just under the crest and dissolves downward; slopes facing away from the sun take more;
 * autumn's low sun stretches the shade further. Cells hidden behind a nearer dune are skipped.
 */
function duneDots(index: number, sunLeft: boolean, longShadows: boolean): string {
  const dune = DUNES[index]
  if (dune === undefined) return ''
  const reach = dune.reach * (longShadows ? 1.6 : 1)
  return runs(Math.floor(600 / CELL), ROWS - 1, 0, COLS - 1, (col, row) => {
    const x = col * CELL + CELL / 2
    const weight = edgeWeight(x)
    if (weight <= 0) return false
    const top = crestRow(dune, col)
    if (row < top) return false
    for (let front = index + 1; front < DUNES.length; front += 1) {
      const nearer = DUNES[front]
      if (nearer !== undefined && row >= crestRow(nearer, col)) return false
    }
    const depth = (row - top) * CELL
    const slope = (crestAt(dune.crest, x + 20) - crestAt(dune.crest, x - 20)) / 40
    const away = Math.max(0, (sunLeft ? -1 : 1) * slope)
    const swell = 0.85 + 0.15 * Math.sin(x / 110 + index * 2.1)
    const tone = Math.min(0.62, (dune.tone * swell + away * (longShadows ? 0.9 : 0.5)) * Math.pow(Math.max(0, 1 - depth / reach), 1.35)) * weight
    return tone > threshold(col, row)
  })
}

/** Where the crest crosses the middle it keeps one thin dotted line, so the land is there under the words. */
function middleLee(index: number): string {
  const dune = DUNES[index]
  if (dune === undefined) return ''
  let path = ''
  for (let col = Math.floor(240 / CELL); col < Math.ceil(1360 / CELL); col += 1) {
    const middle = 1 - edgeWeight(col * CELL)
    const row = crestRow(dune, col)
    if (0.4 * middle > threshold(col, row)) path += `M${col} ${row}h1v1h-1z`
  }
  return path
}

/** Sun or moon, by phase: low on the left at dawn, high on the right by day, low on the right at dusk, the moon by night. */
function bodyPlace(phase: Phase): { x: number; y: number; r: number } {
  if (phase === 'dawn') return { x: 210, y: 560, r: 30 }
  if (phase === 'dusk') return { x: 1390, y: 560, r: 38 }
  if (phase === 'night') return { x: 1350, y: 190, r: 26 }
  return { x: 1340, y: 200, r: 30 }
}

function skyBody(stock: Stock, phase: Phase, season: Season): string {
  const place = bodyPlace(phase)
  const radius = place.r * (season === 'summer' && phase === 'day' ? 1.25 : 1)
  const halo = season === 'summer' && !stock.dark ? 2.6 : 1.9
  const cx = place.x / CELL
  const cy = place.y / CELL
  const r = radius / CELL
  const reach = Math.ceil(r * halo) + 1
  const crescent = phase === 'night'
  const path = runs(Math.floor(cy - reach), Math.ceil(cy + reach), Math.floor(cx - reach), Math.ceil(cx + reach), (col, row) => {
    const distance = Math.hypot(col + 0.5 - cx, row + 0.5 - cy)
    let tone = distance <= r ? 1 : distance <= r * 1.4 ? 0.42 : distance <= r * halo ? 0.16 : 0
    if (crescent && distance <= r && Math.hypot(col + 0.5 - cx + r * 0.45, row + 0.5 - cy - r * 0.2) < r * 0.92) tone = 0.08
    return tone > threshold(col, row)
  })
  let rays = ''
  if (season === 'summer' && !stock.dark) {
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2
      const from = r * 2.9
      const to = r * (index % 2 === 0 ? 4.2 : 3.6)
      for (let step = from; step < to; step += 1.4) rays += `M${Math.round(cx + Math.cos(angle) * step)} ${Math.round(cy + Math.sin(angle) * step)}h1v1h-1z`
    }
  }
  return `<g class="rise"><g transform="scale(${CELL})"><path d="${path}${rays}" fill="${stock.body}"/></g></g>`
}

/** Dithered stars in the two top corners, by night (and a few at dusk), each one cell. */
function stars(stock: Stock, phase: Phase): string {
  if (phase !== 'night' && phase !== 'dusk') return ''
  const count = phase === 'night' ? 46 : 16
  let out = ''
  for (let index = 0; index < count; index += 1) {
    const right = index % 3 !== 0
    const col = Math.floor((right ? 1150 + hash(index * 3) * 440 : 20 + hash(index * 3) * 420) / CELL)
    const row = Math.floor((20 + hash(index * 7 + 1) * 440) / CELL)
    const seconds = r1(3 + hash(index + 9) * 6)
    out += `<rect class="tw" style="animation-duration:${seconds}s;animation-delay:-${r1(hash(index) * seconds)}s" x="${col * CELL}" y="${row * CELL}" width="${CELL}" height="${CELL}" fill="${stock.ink}"/>`
  }
  return out
}

/** Heat shimmer over the far dune at the edges: bands of faint dots that jitter sideways a cell at a time. */
function shimmer(stock: Stock): string {
  let out = ''
  for (let band = 0; band < 5; band += 1) {
    const baseRow = Math.floor(600 / CELL) + band * 2
    const path = runs(baseRow, baseRow, 0, COLS - 1, (col, row) => {
      const x = col * CELL
      const near = DUNES[0] !== undefined ? crestRow(DUNES[0], col) - row : 0
      if (near < 1 || near > 14) return false
      return 0.2 * edgeWeight(x) > threshold(col + band * 3, row)
    })
    out += `<g class="shim" style="animation-duration:${r1(0.7 + band * 0.23)}s;animation-delay:-${r1(band * 0.31)}s"><g transform="scale(${CELL})"><path d="${path}" fill="${stock.soft}"/></g></g>`
  }
  return out
}

/** Thinking: wind lifts grains off the crests at the edges and carries them up and away, one cell a step. */
function wind(stock: Stock): string {
  let out = ''
  for (let index = 0; index < 42; index += 1) {
    const right = index % 2 === 0
    const dune = DUNES[1 + (index % 3)]
    if (dune === undefined) continue
    const x = Math.round((right ? 1110 + hash(index * 5) * 470 : 20 + hash(index * 5) * 450) / CELL) * CELL
    const y = crestRow(dune, x / CELL) * CELL - CELL
    const seconds = r1(5 + hash(index + 4) * 7)
    out += `<rect class="lift" style="animation-duration:${seconds}s;animation-delay:-${r1(hash(index + 13) * seconds)}s" x="${x}" y="${y}" width="${CELL}" height="${CELL}" fill="${stock.ink}"/>`
  }
  // A veil of drift along two crests, sliding downwind a cell at a time.
  for (const index of [1, 2]) {
    const dune = DUNES[index]
    if (dune === undefined) continue
    const path = runs(0, ROWS - 1, 0, COLS - 1, (col, row) => {
      const top = crestRow(dune, col)
      const lift = top - row
      if (lift < 1 || lift > 7) return false
      return 0.22 * (1 - lift / 8) * edgeWeight(col * CELL) > threshold(col + 3, row + 5)
    })
    out += `<g class="veil" style="animation-delay:-${index * 1.7}s"><g transform="scale(${CELL})"><path d="${path}" fill="${stock.soft}"/></g></g>`
  }
  return out
}

const CAMEL = ['.##...........', '####..........', '..##....##....', '...#...####...', '...##########.', '....##########', '....#########.']
const LEGS_A = ['....#..#..#..#', '...#...#.#...#', '...#...#.#...#']
const LEGS_B = ['....#.#...#.#.', '....#.#...#.#.', '.....#....#.#.']
const GUIDE = ['..#..', '.###.', '..#..', '.####', '#.#.#', '..#.#', '..#.#', '.#.##', '.#..#', '#...#']
const PALM = [
  '##........##....', '..##....##......', '....#####.......', '.####..#####....', '#....##.....##..', '.....#.#.....#..', '......#.........', '......#.........',
  '.......#........', '.......#........', '.......#........', '.......##.......', '........#.......', '........#.......', '........#.......', '........#.......',
  '........##......', '.........#......', '.........#......', '.........#......',
]

function cellsPath(rows: readonly string[]): string {
  return runs(0, rows.length - 1, 0, Math.max(...rows.map(row => row.length)) - 1, (col, row) => rows[row]?.[col] === '#')
}

/** The caravan's road: the far crest, from off the right edge to just short of the conversation. */
const ROAD_FROM = 1640
const ROAD_TO = 1110

function roadPoint(share: number): [number, number] {
  const x = ROAD_FROM + (ROAD_TO - ROAD_FROM) * share
  const dune = DUNES[0]
  const y = dune === undefined ? 650 : crestAt(dune.crest, Math.min(W, x))
  return [Math.round(x / CELL) * CELL, Math.round(y / CELL) * CELL]
}

function roadKeyframes(): string {
  let frames = ''
  for (let pose = 0; pose <= 20; pose += 1) {
    const [x, y] = roadPoint(pose / 20)
    const fade = pose === 0 || pose === 20 ? 0 : 1
    frames += `${pose * 5}%{transform:translate(${x}px,${y}px);opacity:${fade}}`
  }
  return `@keyframes road{${frames}}`
}

/** The caravan: a guide and a string of camels walking the far crest toward the middle, legs stepping. */
function caravan(stock: Stock, camels: number, walking: boolean, longShadows: boolean): string {
  const period = 120
  const camelBody = `<path d="${cellsPath(CAMEL)}"/>`
  const legsA = `<path d="${cellsPath(LEGS_A)}" transform="translate(0 7)"/>`
  const legsB = `<path d="${cellsPath(LEGS_B)}" transform="translate(0 7)"/>`
  const shadow = longShadows ? `<path d="M2 10h22v1h-22zM6 11h14v1h-14z" opacity=".45"/>` : ''
  const legs = walking ? `<g class="stepA">${legsA}</g><g class="stepB">${legsB}</g>` : legsA
  const camel = `<g transform="translate(-${7 * CELL} -${10 * CELL}) scale(${CELL})" fill="${stock.ink}">${camelBody}${legs}${shadow}</g>`
  const guide = `<g transform="translate(-${3 * CELL} -${10 * CELL}) scale(${CELL})" fill="${stock.ink}"><path d="${cellsPath(GUIDE)}"/></g>`
  let out = ''
  // Lead (the guide) near the inner end of the road; each camel 78 units behind, so five plus the guide fit the right edge.
  const length = ROAD_FROM - ROAD_TO
  const lead = (ROAD_FROM - 1160) / length
  for (let index = 0; index <= camels; index += 1) {
    const share = lead - (index * 78 + (index > 0 ? 6 : 0)) / length
    const [x, y] = roadPoint(Math.max(0.02, share))
    const motion = walking ? `animation:road ${period}s linear infinite;animation-delay:-${r1(((share + 1) % 1) * period)}s;` : ''
    out += `<g style="${motion}transform:translate(${x}px,${y}px)">${index === 0 ? guide : camel}</g>`
  }
  return out
}

/** Error: a band of storm dither sweeping right to left over the lower third, with streaks. */
function sandstorm(stock: Stock): string {
  let dots = ''
  for (let row = 0; row < 8; row += 1) for (let col = 0; col < 8; col += 1) if ((BAYER[row]?.[col] ?? 64) < 26) dots += `M${col} ${row}h1v1h-1z`
  let streaks = ''
  for (let index = 0; index < 26; index += 1) {
    const x = Math.round(hash(index * 3) * 900)
    const y = Math.round(500 + hash(index * 7) * 320)
    streaks += `M${x} ${y}h${40 + Math.round(hash(index + 1) * 120)}v${CELL}h-${40 + Math.round(hash(index + 1) * 120)}z`
  }
  return `<defs><pattern id="storm" width="${8 * CELL}" height="${8 * CELL}" patternUnits="userSpaceOnUse"><path transform="scale(${CELL})" d="${dots}" fill="${stock.ink}"/></pattern>
<linearGradient id="stormEdge"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".25" stop-color="#fff"/><stop offset=".75" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="stormRise" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".35" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity=".8"/></linearGradient>
<mask id="stormMask" maskUnits="userSpaceOnUse" x="0" y="0" width="900" height="1000"><rect width="900" height="1000" fill="url(#stormEdge)"/><rect width="900" height="460" fill="#000"/></mask></defs>
<g class="storm" style="transform:translateX(1050px)"><g mask="url(#stormMask)"><rect y="440" width="900" height="560" fill="url(#storm)" opacity=".75"/><path d="${streaks}" fill="${stock.ink}" opacity=".55"/></g></g>`
}

/** Success: an oasis in the bottom-left corner: a dithered pool, three palms and glints on the water. */
function oasis(stock: Stock): string {
  const cx = 250 / CELL
  const cy = 912 / CELL
  const rx = 30
  const ry = 5
  const pool = runs(Math.floor(cy - ry), Math.ceil(cy + ry), Math.floor(cx - rx), Math.ceil(cx + rx), (col, row) => {
    const d = Math.hypot((col + 0.5 - cx) / rx, (row + 0.5 - cy) / ry)
    return d < 0.85 ? 0.9 > threshold(col, row) : d < 1 ? 0.45 > threshold(col, row) : false
  })
  const rim = runs(Math.floor(cy - ry - 1), Math.ceil(cy + ry + 1), Math.floor(cx - rx - 2), Math.ceil(cx + rx + 2), (col, row) => {
    const d = Math.hypot((col + 0.5 - cx) / (rx + 2), (row + 0.5 - cy) / (ry + 1.2))
    return d >= 0.92 && d < 1.08 && 0.6 > threshold(col, row)
  })
  const palms = [
    [118, 905, 1, 1],
    [168, 920, -1, 0.8],
    [360, 914, 1, 0.9],
  ]
    .map(([x, y, flip, size], index) => {
      const s = CELL * 1.6 * (size ?? 1)
      return `<g class="sprout" style="animation-delay:${index * 0.35}s;transform-origin:${x}px ${y}px"><g transform="translate(${x} ${y}) scale(${(flip ?? 1) * s} ${s}) translate(-9 -${PALM.length})" fill="${stock.ink}"><path d="${cellsPath(PALM)}"/></g></g>`
    })
    .join('')
  let glints = ''
  for (let index = 0; index < 7; index += 1) {
    const x = Math.round((cx - rx * 0.7 + hash(index * 3) * rx * 1.4) * CELL)
    const y = Math.round((cy - 2 + hash(index * 5) * 4) * CELL)
    glints += `<path class="glint" style="animation-delay:-${r1(hash(index) * 2)}s" d="M${x - 10} ${y}h20v${CELL}h-20zM${x} ${y - 10}h${CELL}v20h-${CELL}z" fill="${stock.dark ? '#fff8e0' : '#ffffff'}"/>`
  }
  return `<g class="sprout" style="transform-origin:250px 912px"><g transform="scale(${CELL})"><path d="${rim}" fill="${stock.ink}"/><path d="${pool}" fill="${stock.water}"/></g></g>${palms}${glints}`
}

/** Spring: a few small blooms at the dune feet in the corners. */
function blooms(stock: Stock): string {
  let path = ''
  let stems = ''
  for (let index = 0; index < 26; index += 1) {
    const right = index % 2 === 0
    const col = Math.floor((right ? 1180 + hash(index * 11) * 400 : 30 + hash(index * 11) * 380) / CELL)
    const dune = DUNES[2 + (index % 2)]
    if (dune === undefined) continue
    const row = crestRow(dune, col) + 1 + Math.floor(hash(index * 7) * 5)
    path += `M${col} ${row - 3}h1v1h-1zM${col - 1} ${row - 2}h3v1h-3zM${col} ${row - 1}h1v1h-1z`
    stems += `M${col} ${row}h1v1h-1z`
  }
  return `<g transform="scale(${CELL})"><path d="${stems}" fill="${stock.ink}"/><path d="${path}" fill="${stock.bloom}"/></g>`
}

/** Winter: frost along the crests at the edges, a broken line of pale cells. */
function frost(stock: Stock): string {
  let path = ''
  for (const dune of DUNES.slice(1)) {
    for (let col = 0; col < COLS; col += 1) {
      const weight = edgeWeight(col * CELL)
      const row = crestRow(dune, col)
      if (0.75 * weight > threshold(col, row)) path += `M${col} ${row}h1v1h-1z`
      if (0.35 * weight > threshold(col + 4, row + 1)) path += `M${col} ${row + 1}h1v1h-1z`
    }
  }
  return `<g transform="scale(${CELL})"><path d="${path}" fill="${stock.frost}"/></g>`
}

function sceneFor(ctx: SceneCtx): string {
  const stock = stockFor(ctx.phase, ctx.season)
  const activity = ctx.activity
  const agents = Math.max(0, Math.min(5, Math.round(ctx.agents)))
  const sunLeft = ctx.phase === 'dawn'
  const longShadows = ctx.season === 'autumn'
  const showCaravan = activity === 'working' || activity === 'agents' || agents > 0
  const walking = activity === 'working' || activity === 'agents'
  const camels = activity === 'working' && agents === 0 ? 3 : Math.max(1, agents)

  const style = `
.rise{animation:rise 240s steps(8) infinite alternate}
.tw{animation:tw 5s steps(2) infinite}
.shim{animation:shim 1s steps(2) infinite alternate}
.lift{animation:lift 8s steps(24) infinite}
.veil{animation:veil 3.2s steps(4) infinite}
.stepA{animation:stepA .7s steps(1) infinite}
.stepB{animation:stepB .7s steps(1) infinite;opacity:0}
.storm{animation:storm 5.5s linear infinite}
.sprout{animation:sprout 1.4s cubic-bezier(.3,1.4,.5,1) both}
.glint{animation:glint 1.6s steps(2) infinite}
@keyframes rise{to{transform:translateY(-${8 * CELL}px)}}
@keyframes tw{50%{opacity:.2}}
@keyframes shim{to{transform:translateX(${CELL}px)}}
@keyframes lift{0%{transform:translate(0,0);opacity:0}10%{opacity:1}70%{opacity:1}100%{transform:translate(-${36 * CELL}px,-${12 * CELL}px);opacity:0}}
@keyframes veil{to{transform:translateX(-${4 * CELL}px)}}
@keyframes stepA{50%{opacity:0}}
@keyframes stepB{50%{opacity:1}}
@keyframes storm{from{transform:translateX(1650px)}to{transform:translateX(-950px)}}
@keyframes sprout{from{transform:scale(.2);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes glint{50%{opacity:.1}}
${walking ? roadKeyframes() : ''}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`

  let dunes = ''
  DUNES.forEach((dune, index) => {
    const sand = stock.sands[index] ?? stock.paper
    const dots = duneDots(index, sunLeft, longShadows)
    dunes += `<path d="${outline(dune)}" fill="${sand}"/><g transform="scale(${CELL})"><path d="${dots}" fill="${dune.soft ? stock.soft : stock.ink}"/><path d="${middleLee(index)}" fill="${stock.soft}"/></g>`
    if (index === 0) {
      if (activity === 'idle') dunes += shimmer(stock)
      if (showCaravan) dunes += caravan(stock, camels, walking, longShadows || ctx.phase === 'dusk')
    }
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges"><style>${style}</style>
<rect width="1600" height="1000" fill="${stock.paper}"/>
${stars(stock, ctx.phase)}
${skyBody(stock, ctx.phase, ctx.season)}
${dunes}
${ctx.season === 'winter' ? frost(stock) : ''}
${ctx.season === 'spring' ? blooms(stock) : ''}
${activity === 'thinking' ? wind(stock) : ''}
${activity === 'success' ? oasis(stock) : ''}
${activity === 'error' ? sandstorm(stock) : ''}
</svg>`
}

export const theme: LivingTheme = {
  id: 'desert-caravan',
  title: 'Desert Caravan',
  blurb: 'One-bit dithered dunes in the bottom corners, a dithered sun or moon, and a caravan on the far dune line.',
  reacts:
    'Idle the air shimmers; thinking lifts sand on the wind; working sets a caravan walking the far dune, one camel per subagent; an error sweeps a sandstorm across; success raises an oasis with palms. The sun climbs from dawn to dusk and the moon rises at night; winter is cold and frosted, summer harsh, spring blooms, autumn casts long shadows.',
  window: 'auto',
  glass: ctx => {
    const stock = stockFor(ctx.phase, ctx.season)
    return { blur: 16, tint: stock.paper, opacity: stock.dark ? 0.38 : 0.42 }
  },
  scene: sceneFor,
}
