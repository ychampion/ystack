// Seasons Tree: one large tree on a low rise at the right edge, its crown a mosaic of glyph tiles. The season decides its
// look (spring blossom, full summer green, thinning autumn orange, bare winter branches with snow); the time of day sets
// the sky and the light on it; the agent's activity sets the wind (still at rest, a breeze while thinking, a strong wind
// with leaves or petals streaming while tools run), perches a bird per subagent, sends a storm cloud and a snapped twig on
// an error and makes the crown glint on success. Pure string building: no Math.random, no Date.
import type { LivingTheme, SceneCtx } from './contract'

type Phase = SceneCtx['phase']
type Activity = SceneCtx['activity']
type Season = SceneCtx['season']

const CELL = 15
const BASE_X = 1390
const BASE_Y = 950

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

interface Sky {
  top: string
  mid: string
  low: string
  body: string
  hill: readonly [string, string, string]
  night: string
  dark: number
}

const SKIES: Record<Phase, Sky> = {
  dawn: { top: '#8e93c4', mid: '#efbcc0', low: '#fde1bc', body: '#ffe6b0', hill: ['#c7a7b8', '#a98aa6', '#7d6a86'], night: '#4a3c5e', dark: 0.25 },
  day: { top: '#86bde8', mid: '#bfdcf1', low: '#eef5f0', body: '#fff8dc', hill: ['#b9d0d8', '#94b8a8', '#6f9a72'], night: '#2c3e3a', dark: 0 },
  dusk: { top: '#1e1a38', mid: '#5a3052', low: '#cf7048', body: '#ffb466', hill: ['#5a3a5c', '#3e2a44', '#271c30'], night: '#140e1c', dark: 0.62 },
  night: { top: '#050a18', mid: '#0c1730', low: '#1c2a4a', body: '#eef2ff', hill: ['#17223a', '#111a2c', '#0b111e'], night: '#060a14', dark: 0.86 },
}

interface Crown {
  /** Tile colours for the shadow, middle and lit sides, and the glyph colour of each. */
  tile: readonly [string, string, string]
  glyph: readonly [string, string, string]
  /** Share of tiles kept: autumn crowns thin out. */
  density: number
  /** A second colour sprinkled through the crown (green leaves in a blossom, red in autumn). */
  accent: string
  accentShare: number
  fall: readonly string[]
}

const CROWNS: Record<Exclude<Season, 'winter'>, Crown> = {
  spring: { tile: ['#d184a0', '#eea6be', '#ffd2df'], glyph: ['#f2b8cb', '#ffd6e2', '#fff2f6'], density: 0.96, accent: '#9cc46a', accentShare: 0.16, fall: ['#ffd0dd', '#f6aac2', '#ffffff'] },
  summer: { tile: ['#2f6a34', '#4a8c3e', '#79b652'], glyph: ['#4f8e48', '#76b45c', '#b2dc7a'], density: 1, accent: '#3c7a3a', accentShare: 0.1, fall: ['#79b652', '#4a8c3e'] },
  autumn: { tile: ['#a2432a', '#d26c2c', '#f0a43e'], glyph: ['#cc6a40', '#f29a4a', '#ffd27a'], density: 0.78, accent: '#b8321e', accentShare: 0.18, fall: ['#e0782e', '#c4482a', '#f2b040', '#a8562a'] },
}

/** The crown's clumps: centre and radius. Every limb runs from the trunk's fork to one of these. */
const CLUMPS: readonly (readonly [number, number, number])[] = [
  [1340, 330, 165],
  [1200, 450, 120],
  [1480, 430, 140],
  [1560, 270, 120],
  [1400, 205, 110],
  [1270, 560, 110],
  [1150, 330, 80],
]

const FORK_X = 1380
const FORK_Y = 640

/** Where each limb's top twig ends, near the crown's upper edge: perches for the birds. */
const PERCHES: readonly (readonly [number, number])[] = CLUMPS.map(([cx, cy, r], i) => [Math.round(cx + (hash(i, 5) - 0.5) * r * 0.6), Math.round(cy - r * 0.88)])

const WIND: Record<Activity, number> = { idle: 0, thinking: 0.5, working: 1.3, agents: 0.8, error: 1.1, success: 0.4 }
const FALLING: Record<Activity, number> = { idle: 2, thinking: 7, working: 22, agents: 12, error: 12, success: 6 }

function sky(s: Sky, phase: Phase): string {
  const [x, y, r] = phase === 'night' ? [210, 170, 30] : phase === 'day' ? [250, 150, 36] : phase === 'dawn' ? [190, 640, 46] : [470, 650, 50]
  let stars = ''
  if (phase !== 'day') {
    const count = phase === 'night' ? 110 : 26
    for (let i = 0; i < count; i += 1) {
      const sx = Math.round(hash(i, 21) * 1600)
      const sy = Math.round(hash(i, 22) ** 1.3 * (phase === 'night' ? 640 : 280))
      const cls = hash(i, 23) < 0.3 ? ` class="tw" style="animation-delay:-${n1(hash(i, 24) * 5)}s"` : ''
      stars += `<circle${cls} cx="${sx}" cy="${sy}" r="${n1(0.6 + hash(i, 25) * 1.2)}"/>`
    }
    stars = `<g fill="#f2f5ff" opacity="${phase === 'night' ? 0.9 : 0.5}">${stars}</g>`
  }
  const disc = phase === 'night'
    ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${s.body}"/><circle cx="${x + 10}" cy="${y - 6}" r="${r - 3}" fill="${s.mid}" opacity="0.9"/>`
    : `<circle cx="${x}" cy="${y}" r="${r}" fill="${s.body}"/>`
  let clouds = ''
  const cloudTone = phase === 'night' ? '#2a3858' : phase === 'dusk' ? mix(s.mid, s.low, 0.4) : '#ffffff'
  ;[[160, 300, 0.9], [700, 110, 1.1], [520, 420, 0.7]].forEach(([cx, cy, sc], i) => {
    let puffs = ''
    for (let k = 0; k < 5; k += 1) puffs += `<ellipse cx="${n1((k - 2) * 36 * sc!)}" cy="${n1((hash(k, i) - 0.5) * 12)}" rx="${n1((44 + hash(i, k + 3) * 26) * sc!)}" ry="${n1((13 + hash(k + 2, i) * 9) * sc!)}"/>`
    clouds += `<g transform="translate(${cx} ${cy})"><g class="drift" style="animation-delay:-${i * 37}s">${puffs}</g></g>`
  })
  return `<rect width="1600" height="1000" fill="url(#sky)"/>${stars}<circle cx="${x}" cy="${y}" r="${r * 6}" fill="url(#halo)"/>${disc}<g fill="${cloudTone}" opacity="${phase === 'night' ? 0.35 : 0.6}">${clouds}</g>`
}

/** Three rolling layers of hills: low along the bottom, rising to the knoll the tree stands on at the right. */
function hills(s: Sky, season: Season): string {
  const snow = season === 'winter'
  const tint = (c: string, i: number): string => (snow ? mix(c, '#f4f7ff', (0.55 - i * 0.12) * (1 - s.dark * 0.55)) : season === 'autumn' ? mix(c, '#a8783a', 0.2 * (1 - s.dark)) : c)
  const far = `M0 860C200 820 380 850 560 860S900 880 1100 840S1450 800 1600 820V1000H0Z`
  const mid = `M0 920C180 890 360 910 520 930S820 960 1000 930S1300 880 1600 870V1000H0Z`
  const near = `M840 1000C980 975 1120 948 1260 940S1500 930 1600 925V1000Z`
  let grass = ''
  for (let x = 900; x < 1600; x += 9) {
    const t = (x - 840) / 760
    const y = n1(1000 - 25 * t - 60 * t * (1 - t) - 2)
    const h = hash(x, 3)
    grass += `<text x="${x}" y="${y}" font-size="${11 + Math.round(h * 5)}">${h < 0.4 ? '"' : h < 0.7 ? "'" : ','}</text>`
  }
  return `<path d="${far}" fill="${tint(s.hill[0], 0)}"/><path d="${mid}" fill="${tint(s.hill[1], 1)}"/><path d="${near}" fill="${tint(s.hill[2], 2)}"/><g fill="${tint(mix(s.hill[2], '#ffffff', 0.18), 2)}" opacity="0.8">${grass}</g>`
}

function bark(s: Sky): string {
  return mix('#5a4436', s.night, s.dark * 0.75)
}

/** The trunk, the limbs to every clump and a few twigs off each: drawn the same in every season. */
function branches(s: Sky, season: Season): string {
  const colour = bark(s)
  let limbs = `<path d="M${BASE_X - 30} ${BASE_Y}C${BASE_X - 16} 840 ${FORK_X - 22} 720 ${FORK_X - 14} ${FORK_Y}L${FORK_X + 18} ${FORK_Y}C${FORK_X + 26} 730 ${BASE_X + 20} 860 ${BASE_X + 40} ${BASE_Y}Z" fill="${colour}"/>`
  let twigs = ''
  let snow = ''
  CLUMPS.forEach(([cx, cy, r], i) => {
    const width = Math.round(6 + r / 12)
    const bend = (hash(i, 7) - 0.5) * 80
    const mx = (FORK_X + cx) / 2 + bend
    const my = (FORK_Y + cy) / 2 + 30
    limbs += `<path d="M${FORK_X} ${FORK_Y + 10}Q${n1(mx)} ${n1(my)} ${cx} ${cy}" stroke="${colour}" stroke-width="${width}" fill="none" stroke-linecap="round"/>`
    if (season === 'winter') snow += `M${FORK_X} ${FORK_Y + 10 - width / 2}Q${n1(mx)} ${n1(my - width / 2)} ${cx} ${cy - width / 2}`
    const [px, py] = PERCHES[i]!
    twigs += `M${cx} ${cy}L${px} ${py}`
    const spray = season === 'winter' ? 7 : 4
    for (let k = 0; k < spray; k += 1) {
      const a = -Math.PI / 2 + (hash(i, k + 10) - 0.5) * 2.8
      const len = r * (0.5 + hash(k, i + 11) * 0.45)
      const ex = Math.round(cx + Math.cos(a) * len)
      const ey = Math.round(cy + Math.sin(a) * len)
      twigs += `M${cx} ${cy}L${ex} ${ey}`
      const fork = 0.6
      const fx = Math.round(cx + Math.cos(a) * len * fork)
      const fy = Math.round(cy + Math.sin(a) * len * fork)
      twigs += `M${fx} ${fy}L${Math.round(fx + Math.cos(a - 0.6) * len * 0.35)} ${Math.round(fy + Math.sin(a - 0.6) * len * 0.35)}`
      if (season === 'winter') {
        // Bare crowns show their fine structure: a second fork and a fringe of short twigs at each tip.
        twigs += `M${fx} ${fy}L${Math.round(fx + Math.cos(a + 0.55) * len * 0.3)} ${Math.round(fy + Math.sin(a + 0.55) * len * 0.3)}`
        for (const turn of [-0.5, 0.1, 0.6]) twigs += `M${ex} ${ey}L${Math.round(ex + Math.cos(a + turn) * 16)} ${Math.round(ey + Math.sin(a + turn) * 16)}`
      }
      if (season === 'winter' && hash(i, k) < 0.6) snow += `M${cx} ${cy - 2}L${ex} ${ey - 2}`
    }
  })
  const snowLine = snow === '' ? '' : `<path d="${snow}" stroke="${mix('#f6f9ff', s.night, s.dark * 0.4)}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
  // Bark: a few long dark grooves up the trunk.
  const grooves = [-14, -2, 12, 24].map((dx, i) => `M${BASE_X + dx} ${BASE_Y - 4}C${BASE_X + dx - 4} 860 ${FORK_X + dx * 0.6 - 4} 740 ${FORK_X + dx * 0.4} ${FORK_Y + 20 + i * 8}`).join('')
  return `${limbs}<path d="${twigs}" stroke="${colour}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="${grooves}" stroke="${mix(colour, '#000000', 0.35)}" stroke-width="2" fill="none" opacity="0.6"/>${snowLine}`
}

interface Tile {
  x: number
  y: number
  tone: number
  layer: number
  accent: boolean
}

/** The crown's tiles: every grid cell inside the union of clumps (with a ragged edge), shaded by where the light falls. */
function crownTiles(density: number, accentShare: number): Tile[] {
  const tiles: Tile[] = []
  for (let gy = Math.floor(60 / CELL); gy < Math.ceil(700 / CELL); gy += 1) {
    for (let gx = Math.floor(1020 / CELL); gx < Math.ceil(1600 / CELL); gx += 1) {
      const x = gx * CELL + CELL / 2
      const y = gy * CELL + CELL / 2
      let best = 9
      let light = 0
      for (const [cx, cy, r] of CLUMPS) {
        const d = Math.hypot(x - cx, y - cy) / r
        if (d < best) {
          best = d
          light = ((x - cx) * -0.6 + (y - cy) * -0.8) / r
        }
      }
      const edge = 1 + (hash(gx, gy) - 0.5) * 0.22
      if (best > edge) continue
      if (hash(gx + 7, gy + 3) > density + (1 - best) * 0.4) continue
      const tone = light > 0.3 ? 2 : light < -0.35 || best > 0.88 ? 0 : 1
      tiles.push({ x: gx * CELL, y: gy * CELL, tone, layer: Math.floor(hash(gx, gy + 41) * 3), accent: hash(gx + 13, gy) < accentShare })
    }
  }
  return tiles
}

const GLYPHS = '*%+@#8$s'

function crown(season: Season, s: Sky, wind: number): string {
  if (season === 'winter') return ''
  const c = CROWNS[season]
  const tiles = crownTiles(c.density, c.accentShare)
  const shade = (colour: string): string => mix(colour, s.night, s.dark * 0.72)
  let out = ''
  for (let layer = 0; layer < 3; layer += 1) {
    let group = ''
    for (let tone = 0; tone < 3; tone += 1) {
      for (const accent of [false, true]) {
        const list = tiles.filter(t => t.layer === layer && t.tone === tone && t.accent === accent)
        if (list.length === 0) continue
        const tile = accent ? mix(c.accent, c.tile[tone]!, 0.25 * tone) : c.tile[tone]!
        const glyph = accent ? mix(c.accent, '#ffffff', 0.35) : c.glyph[tone]!
        group += `<path d="${list.map(t => `M${t.x + 1} ${t.y + 1}h${CELL - 2}v${CELL - 2}h-${CELL - 2}z`).join('')}" fill="${shade(tile)}"/>`
        const rows = new Map<number, Tile[]>()
        for (const t of list) rows.set(t.y, [...(rows.get(t.y) ?? []), t])
        for (const [y, row] of rows) {
          group += `<text x="${row.map(t => t.x + CELL / 2).join(' ')}" y="${y + 11.5}" fill="${shade(glyph)}">${row.map(t => GLYPHS[Math.floor(hash(t.x, t.y) * GLYPHS.length)]).join('')}</text>`
        }
      }
    }
    const style = wind > 0 ? ` class="sway${layer}" style="animation-duration:${n1((5.5 - layer) / (0.5 + wind))}s;animation-delay:-${layer * 0.7}s"` : ''
    out += `<g${style}>${group}</g>`
  }
  return out
}

function falling(season: Season, activity: Activity, s: Sky): string {
  const colours = season === 'winter' ? [] : CROWNS[season].fall
  if (colours.length === 0) return ''
  let count = FALLING[activity] + (season === 'autumn' ? 4 : 0)
  if (season === 'summer' && WIND[activity] < 0.5) count = 0
  const wind = WIND[activity]
  let out = ''
  for (let i = 0; i < count; i += 1) {
    const [cx, cy, r] = CLUMPS[i % CLUMPS.length]!
    const x = Math.round(cx + (hash(i, 31) - 0.5) * r * 1.4)
    const y = Math.round(cy + (hash(i, 32) - 0.2) * r)
    const colour = mix(colours[i % colours.length]!, s.night, s.dark * 0.6)
    const seconds = n1((9 + hash(i, 33) * 7) / (0.6 + wind))
    const size = season === 'spring' ? 5 : 7
    out += `<g transform="translate(${x} ${y})"><g class="fall${i % 3}" style="animation-duration:${seconds}s;animation-delay:-${n1(hash(i, 34) * seconds)}s"><path d="M0 ${-size / 2}L${size / 2} 0L0 ${size / 2}L${-size / 2} 0Z" fill="${colour}"/></g></g>`
  }
  return out
}

function birds(count: number, s: Sky, season: Season): string {
  const body = mix('#3b3a48', s.night, s.dark * 0.5)
  const breast = mix('#d9643a', s.night, s.dark * 0.6)
  const order = [0, 2, 4, 3, 1]
  let out = ''
  for (let i = 0; i < count; i += 1) {
    const [x, y] = PERCHES[order[i]!]!
    const flip = i % 2 === 1 ? ' scale(-1 1)' : ''
    out += `<g transform="translate(${x} ${y - 14})${flip} scale(1.6)"><g class="hop" style="animation-delay:-${n1(i * 1.3)}s"><path d="M-9 2L-16 -2L-14 4Z" fill="${body}"/><ellipse cx="0" cy="0" rx="9" ry="7" fill="${body}"/><ellipse cx="2" cy="2" rx="5.5" ry="4.5" fill="${breast}"/><circle cx="7" cy="-6" r="5" fill="${body}"/><circle cx="8.5" cy="-7" r="1.2" fill="#f4f0e6"/><path d="M11.5 -6L16 -5L11.5 -4Z" fill="#e8b04a"/><path d="M-2 7V10M2 7V10" stroke="${body}" stroke-width="1.4"/></g></g>`
  }
  return out
}

function storm(s: Sky): string {
  let puffs = ''
  for (let i = 0; i < 9; i += 1) puffs += `<ellipse cx="${Math.round(1060 + i * 64 + hash(i, 51) * 30)}" cy="${Math.round(80 + hash(i, 52) * 50)}" rx="${Math.round(80 + hash(i, 53) * 50)}" ry="${Math.round(36 + hash(i, 54) * 24)}"/>`
  const tone = mix('#5a6070', s.night, s.dark * 0.5)
  // The snapped twig: it starts in the crown and comes to rest on the knoll.
  const twig = `<g class="snap"><path d="M1200 470L1232 452M1214 462L1222 446M1222 458L1238 462" stroke="${bark(s)}" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M1226 448l5 -3l2 5z" fill="${mix('#4a8c3e', s.night, s.dark * 0.6)}"/></g>`
  return `<rect width="1600" height="1000" fill="#101420" opacity="0.18"/><g class="roll"><g fill="${tone}" opacity="0.92">${puffs}</g><g opacity="0.5" clip-path="url(#underCloud)"><g class="rain"><rect x="1000" y="80" width="700" height="900" fill="url(#rainP)"/></g></g></g>${twig}`
}

function glints(season: Season, s: Sky): string {
  const colour = season === 'spring' ? '#fff4f8' : season === 'summer' ? '#ff5a3a' : season === 'autumn' ? '#ffd24a' : '#eaf6ff'
  let out = ''
  for (let i = 0; i < 28; i += 1) {
    const [cx, cy, r] = CLUMPS[i % CLUMPS.length]!
    const a = hash(i, 61) * Math.PI * 2
    const d = Math.sqrt(hash(i, 62)) * r * 0.9
    const x = Math.round(cx + Math.cos(a) * d)
    const y = Math.round(cy + Math.sin(a) * d)
    out += `<g class="glint" style="transform-origin:${x}px ${y}px;animation-delay:-${n1(hash(i, 63) * 2.4)}s"><circle cx="${x}" cy="${y}" r="${season === 'summer' ? 5 : 4}" fill="${colour}"/><path d="M${x - 9} ${y}H${x + 9}M${x} ${y - 9}V${y + 9}" stroke="#ffffff" stroke-width="1.5" opacity="0.8"/></g>`
  }
  let burst = ''
  for (let i = 0; i < 18; i += 1) {
    const a = (i / 18) * Math.PI * 2
    burst += `<g class="petal" style="--x:${Math.round(Math.cos(a) * 260)}px;--y:${Math.round(Math.sin(a) * 200)}px;animation-delay:-${n1(hash(i, 64) * 1.5)}s"><circle cx="1340" cy="360" r="4" fill="${season === 'spring' || season === 'winter' ? '#ffe0ea' : colour}"/></g>`
  }
  return `<circle cx="1340" cy="380" r="320" fill="url(#bless)" class="breathe"/>${out}${burst}`
}

function scene(ctx: SceneCtx): string {
  const { phase, activity, season } = ctx
  const s = SKIES[phase]
  const wind = WIND[activity]
  const birdCount = activity === 'agents' || activity === 'working' || activity === 'thinking' ? Math.max(0, Math.min(5, ctx.agents)) : 0
  const swing = n1(0.35 * wind)
  const style = `
text{font:700 ${CELL - 4}px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;text-anchor:middle}
.tw{animation:tw 5s ease-in-out infinite}
.drift{animation:drift 150s ease-in-out infinite alternate}
.tree{transform-box:view-box;transform-origin:${BASE_X}px ${BASE_Y}px;animation:treeSway 6s ease-in-out infinite alternate}
.sway0,.sway1,.sway2{transform-box:view-box;transform-origin:${BASE_X}px ${BASE_Y}px;animation:sway 4s ease-in-out infinite alternate}
.sway1{animation-name:sway1}.sway2{animation-name:sway2}
.fall0{animation:fall0 10s linear infinite}.fall1{animation:fall1 10s linear infinite}.fall2{animation:fall2 10s linear infinite}
.hop{animation:hop 3.2s ease-in-out infinite}
.roll{animation:roll 6s ease-out 1 both}
.rain{animation:rain .5s linear infinite}
.snap{transform-box:view-box;transform-origin:1216px 460px;transform:translate(-40px,474px) rotate(160deg);animation:snap 2.6s cubic-bezier(.5,0,.8,.4) 1 both}
.glint{transform-box:view-box;animation:glint 2.4s ease-in-out infinite}
.petal{opacity:0;animation:petal 3s ease-out infinite}
.breathe{opacity:.7;animation:breathe 3s ease-in-out infinite alternate}
.snowA{animation:snowA 16s linear infinite}.snowB{animation:snowB 24s linear infinite}
@keyframes tw{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes drift{from{transform:translateX(-50px)}to{transform:translateX(50px)}}
@keyframes treeSway{from{transform:rotate(-${n1(swing * 0.4)}deg)}to{transform:rotate(${n1(swing * 0.4)}deg)}}
@keyframes sway{from{transform:rotate(-${swing}deg)}to{transform:rotate(${swing}deg)}}
@keyframes sway1{from{transform:rotate(-${n1(swing * 1.3)}deg)}to{transform:rotate(${n1(swing * 0.8)}deg)}}
@keyframes sway2{from{transform:rotate(-${n1(swing * 0.7)}deg)}to{transform:rotate(${n1(swing * 1.4)}deg)}}
@keyframes fall0{0%{transform:translate(0,0) rotate(0);opacity:0}8%{opacity:1}100%{transform:translate(-${Math.round(120 + 260 * wind)}px,520px) rotate(540deg);opacity:0}}
@keyframes fall1{0%{transform:translate(0,0) rotate(0);opacity:0}8%{opacity:1}50%{transform:translate(-${Math.round(40 + 160 * wind)}px,260px) rotate(200deg)}100%{transform:translate(-${Math.round(60 + 340 * wind)}px,560px) rotate(420deg);opacity:0}}
@keyframes fall2{0%{transform:translate(0,0) rotate(0);opacity:0}8%{opacity:1}100%{transform:translate(-${Math.round(200 + 200 * wind)}px,440px) rotate(-360deg);opacity:0}}
@keyframes hop{0%,40%,100%{transform:translateY(0)}45%{transform:translateY(-6px)}50%{transform:translateY(0)}70%{transform:rotate(-8deg)}}
@keyframes roll{from{transform:translateX(380px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes rain{from{transform:translate(0,0)}to{transform:translate(-10px,60px)}}
@keyframes snap{from{transform:translate(0,0) rotate(0)}to{transform:translate(-40px,474px) rotate(160deg)}}
@keyframes glint{0%,100%{transform:scale(.4);opacity:.2}50%{transform:scale(1.2);opacity:1}}
@keyframes petal{0%{transform:translate(0,0);opacity:0}10%{opacity:1}100%{transform:translate(var(--x),var(--y));opacity:0}}
@keyframes breathe{from{opacity:.4}to{opacity:.9}}
@keyframes snowA{from{transform:translate(0,0)}to{transform:translate(-30px,200px)}}
@keyframes snowB{from{transform:translate(0,0)}to{transform:translate(20px,260px)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`

  const defs = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.top}"/><stop offset="0.6" stop-color="${s.mid}"/><stop offset="1" stop-color="${s.low}"/></linearGradient>
<radialGradient id="halo"><stop offset="0" stop-color="${s.body}" stop-opacity="0.5"/><stop offset="0.3" stop-color="${s.body}" stop-opacity="0.16"/><stop offset="1" stop-color="${s.body}" stop-opacity="0"/></radialGradient>
<radialGradient id="bless"><stop offset="0" stop-color="#fff2c8" stop-opacity="0.45"/><stop offset="1" stop-color="#fff2c8" stop-opacity="0"/></radialGradient>
<clipPath id="underCloud"><rect x="1000" y="100" width="600" height="840"/></clipPath>
<pattern id="rainP" width="40" height="60" patternUnits="userSpaceOnUse"><path d="M30 0L26 22M12 30L8 52" stroke="#d6deee" stroke-width="1.2" stroke-opacity="0.7"/></pattern>
<pattern id="snowA" width="200" height="200" patternUnits="userSpaceOnUse">${Array.from({ length: 8 }, (_, i) => `<circle cx="${Math.round(hash(i, 81) * 200)}" cy="${Math.round(hash(i, 82) * 200)}" r="${n1(1.4 + hash(i, 83) * 1.6)}" fill="#fbfdff"/>`).join('')}</pattern>
<pattern id="snowB" width="260" height="260" patternUnits="userSpaceOnUse">${Array.from({ length: 6 }, (_, i) => `<circle cx="${Math.round(hash(i, 84) * 260)}" cy="${Math.round(hash(i, 85) * 260)}" r="${n1(2 + hash(i, 86) * 2)}" fill="#fbfdff"/>`).join('')}</pattern>`

  const snowfall = season === 'winter' ? `<g opacity="0.85"><g class="snowA"><rect x="-200" y="-400" width="2000" height="1600" fill="url(#snowA)"/></g></g><g opacity="0.55"><g class="snowB"><rect x="-200" y="-400" width="2000" height="1600" fill="url(#snowB)"/></g></g>` : ''
  const treeClass = wind > 0 ? ' class="tree"' : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>${style}</style><defs>${defs}</defs>
${sky(s, phase)}
${hills(s, season)}
<ellipse cx="${BASE_X + 20}" cy="${BASE_Y + 4}" rx="190" ry="14" fill="#000" opacity="0.14"/>
<g${treeClass}>${branches(s, season)}${crown(season, s, wind)}${birds(birdCount, s, season)}</g>
${falling(season, activity, s)}
${activity === 'error' ? storm(s) : ''}
${activity === 'success' ? glints(season, s) : ''}
${snowfall}
</svg>`
}

function glass(ctx: SceneCtx): { blur: number; tint: string; opacity: number } {
  switch (ctx.phase) {
    case 'dawn':
      return { blur: 10, tint: '#fbf1ee', opacity: 0.4 }
    case 'day':
      return { blur: 10, tint: '#f1f6f4', opacity: 0.42 }
    case 'dusk':
      return { blur: 12, tint: '#1a1424', opacity: 0.46 }
    default:
      return { blur: 12, tint: '#0a101e', opacity: 0.44 }
  }
}

export const theme: LivingTheme = {
  id: 'seasons-tree',
  title: 'Seasons Tree',
  blurb: 'One large tree on a knoll at the right edge, dressed for the season: blossom, full green, autumn orange or bare with snow.',
  reacts: 'The wind rises from still to a gale as the agent thinks and works, leaves or petals stream off, a bird perches for each subagent, a storm cloud snaps a twig on an error and the crown glints on success; the sky keeps the hour and the tree keeps the season.',
  window: 'auto',
  glass,
  scene,
}
