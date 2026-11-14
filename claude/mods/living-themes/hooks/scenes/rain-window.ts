// Rain Window: a city at night seen through a window in the rain. Out-of-focus city lights pool as bokeh in the lower
// corners, beads of water sit on the glass in a braille grid, and rivulets slide down it in fits and starts.
// The middle of the glass stays dark and sparse for the conversation.
// The agent's activity is the weather: a drizzle when idle, steady rain while thinking, a downpour while working, a pair of
// car lights along the street per subagent, lightning and a thunder-dark sky after an error, and on success the rain stops
// and a rainbow glows in the top left. Time of day sets the sky and the city's colour; the season brings snow and frost,
// leaves stuck to the glass, or a lighter spring rain. Pure string building: no DOM, no randomness, no clock.
import type { LivingTheme, Phase, SceneCtx } from './contract'

type Pal = { top: string; low: string; haze: string; skyline: string; lights: string[]; bead: string; streak: string }

const PALETTES: Record<Phase, Pal> = {
  night: { top: '#070a1a', low: '#141a36', haze: '#2a2f5a', skyline: '#05060f', lights: ['#ffb45a', '#ff6a5a', '#7ad8ff', '#ffe6a8', '#c890ff'], bead: '#b8c8ff', streak: '#8fa4e0' },
  dusk: { top: '#151432', low: '#3a2a3e', haze: '#6a4040', skyline: '#0c0a14', lights: ['#ffa040', '#ffc070', '#ff7a4a', '#ffd890', '#ff9a6a'], bead: '#ffd2b0', streak: '#d0a090' },
  dawn: { top: '#1c2038', low: '#4a3c4e', haze: '#7a5a64', skyline: '#10101c', lights: ['#ffc8a0', '#ffe0c0', '#a8c8ff', '#ffb090', '#fff0d0'], bead: '#ffe0d8', streak: '#c8b0b8' },
  day: { top: '#232c3c', low: '#3a4656', haze: '#5a6676', skyline: '#161c26', lights: ['#e8eef8', '#c8d4e4', '#ffe8c0', '#d0e0f0', '#f0f4ff'], bead: '#e6eefc', streak: '#b0bccc' },
}

const CAR_HUES = [['#fff4d6', '#ff3a2a'], ['#e8f0ff', '#ff4a3a'], ['#fff0c0', '#ff5a2a'], ['#f4f8ff', '#ff2a3a'], ['#fff8e0', '#ff6a3a']]

function hash(a: number, b: number, salt = 0): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(salt | 0, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function mix(a: string, b: string, t: number): string {
  let out = '#'
  for (let i = 1; i < 7; i += 2) {
    const v = Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t)
    out += v.toString(16).padStart(2, '0')
  }
  return out
}

const n = (v: number): string => String(Math.round(v * 10) / 10)

/** 0 over the reading column, 1 at the sides: how much may happen at a point of the glass. */
function edge(x: number, y: number): number {
  const dx = Math.abs(x - 800) / 800
  const side = Math.min(1, Math.max(0, (dx - 0.38) / 0.26))
  const low = Math.min(1, Math.max(0, (y - 880) / 120)) * 0.5
  return Math.max(side, low)
}

function palette(ctx: SceneCtx): Pal {
  const p = { ...PALETTES[ctx.phase], lights: [...PALETTES[ctx.phase].lights] }
  if (ctx.season === 'winter') {
    p.top = mix(p.top, '#1a2436', 0.3)
    p.low = mix(p.low, '#3a4a60', 0.35)
    p.haze = mix(p.haze, '#8a9ab0', 0.3)
    p.bead = '#f2f6ff'
  }
  if (ctx.season === 'summer') p.haze = mix(p.haze, '#a07050', 0.2)
  return p
}

/** How hard it rains: rivulets on the glass, rain lines outside, and how fast they fall. */
function rain(ctx: SceneCtx): { rivulets: number; lines: number; speed: number } {
  const base = { idle: { rivulets: 7, lines: 40, speed: 1 }, thinking: { rivulets: 16, lines: 90, speed: 1.3 }, working: { rivulets: 34, lines: 320, speed: 2.4 }, agents: { rivulets: 14, lines: 90, speed: 1.4 }, error: { rivulets: 22, lines: 160, speed: 2 }, success: { rivulets: 0, lines: 0, speed: 1 } }[ctx.activity] ?? { rivulets: 7, lines: 40, speed: 1 }
  if (ctx.season === 'spring') return { rivulets: Math.round(base.rivulets * 0.6), lines: Math.round(base.lines * 0.6), speed: base.speed }
  return base
}

// ---------------------------------------------------------------- the city behind the glass

function city(ctx: SceneCtx, p: Pal): string {
  // A soft skyline: blocks of building, rising higher at the sides than in the middle, with lit windows on the side blocks.
  const lit = ctx.phase === 'day' ? 0.1 : ctx.phase === 'dawn' ? 0.22 : 0.38
  let d = 'M0 1000'
  let win = ''
  let x = 0
  let i = 0
  while (x < 1600) {
    const w = 50 + hash(i, 1, 3) * 90
    const right = Math.min(1600, x + w)
    const sideLift = 1 - Math.min(1, Math.abs(x + w / 2 - 800) / 700)
    const top = 1000 - (180 + hash(i, 2, 3) * 260 - sideLift * 150)
    d += `V${n(top)}H${n(right)}`
    if (edge(x + w / 2, 700) > 0.3) {
      for (let wy = top + 14; wy < 990; wy += 18) {
        for (let wx = x + 8; wx < right - 12; wx += 14) {
          if (hash(Math.round(wx), Math.round(wy), 7) < lit) win += `M${n(wx)} ${n(wy)}h6v8h-6z`
        }
      }
    }
    x = right
    i += 1
  }
  d += 'V1000Z'
  const warm = p.lights[0] ?? '#ffb45a'
  return `<path d="${d}" fill="${p.skyline}" opacity=".88"/><path d="${win}" fill="${warm}" opacity="${n(0.18 + lit * 0.5)}"/>`
}

/** Bokeh: the city's lights out of focus, big soft discs with a brighter rim, pooled in the lower corners. */
function bokeh(ctx: SceneCtx, p: Pal): string {
  let out = ''
  const count = ctx.phase === 'day' ? 20 : 34
  for (let i = 0; i < count; i += 1) {
    const left = i % 2 === 0
    const spreadX = Math.pow(hash(i, 1, 9), 1.6) * 430
    const x = left ? spreadX : 1600 - spreadX
    const y = 1000 - Math.pow(hash(i, 2, 9), 1.5) * 420 - 10
    const r = 14 + hash(i, 3, 9) * 38
    const colour = Math.floor(hash(i, 4, 9) * p.lights.length)
    const delay = n(hash(i, 5, 9) * 9)
    out += `<circle class="glow" style="animation-delay:-${delay}s;animation-duration:${n(6 + hash(i, 6, 9) * 6)}s" cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="url(#b${colour})"/>`
  }
  // Two street lamps high in the top corners.
  out += `<circle cx="70" cy="140" r="90" fill="url(#b3)" opacity=".7"/><circle cx="1540" cy="110" r="80" fill="url(#b0)" opacity=".6"/>`
  return out
}

/** Rain outside: thin slanted lines falling behind the glass, scrolling. */
function rainOutside(ctx: SceneCtx, p: Pal): string {
  const { lines, speed } = rain(ctx)
  if (ctx.season === 'winter') {
    // Snow instead: soft flakes drifting down outside, in two depths.
    const layers = ['', '']
    for (let i = 0; i < 160; i += 1) {
      const x = hash(i, 1, 11) * 1600
      const y = hash(i, 2, 11) * 2000 - 1000
      if (hash(i, 3, 11) > edge(x, 500) * 0.85 + 0.15) continue
      layers[i % 2] += `M${n(x)} ${n(y)}h0`
    }
    return layers.map((d, k) => `<g class="fallsnow" style="animation-duration:${n((k ? 30 : 20) / speed)}s"><path d="${d}" stroke="#eef4ff" stroke-width="${k ? 3 : 5}" stroke-linecap="round" opacity="${k ? 0.5 : 0.7}"/></g>`).join('')
  }
  if (lines === 0) return ''
  let d = ''
  for (let i = 0; i < lines; i += 1) {
    const x = hash(i, 1, 12) * 1700
    const y = hash(i, 2, 12) * 2000 - 1000
    if (hash(i, 3, 12) > edge(Math.min(1599, x), 500) * 0.8 + 0.2) continue
    const len = 20 + hash(i, 4, 12) * 40
    d += `M${n(x)} ${n(y)}l-${n(len * 0.18)} ${n(len)}`
  }
  return `<g class="fallrain" style="animation-duration:${n(1.6 / speed)}s"><path d="${d}" stroke="${p.streak}" stroke-width="1.4" opacity=".42" stroke-linecap="round"/></g>`
}

// ---------------------------------------------------------------- the glass

/** Beads on the glass, set on a braille grid: cells of two by four dots, each cell raising a few of its dots. */
function beads(ctx: SceneCtx, p: Pal): string {
  const sizes = ['', '', '']
  const dry = ctx.activity === 'success' ? 0.6 : 1
  for (let cy = 0; cy < 1000; cy += 30) {
    for (let cx = 0; cx < 1600; cx += 18) {
      const e = edge(cx, cy)
      const density = (0.1 + e * 0.75) * dry * (ctx.season === 'winter' ? 0.6 : 1)
      if (hash(cx, cy, 13) > density) continue
      for (let dot = 0; dot < 8; dot += 1) {
        if (hash(cx * 8 + dot, cy, 14) > 0.32) continue
        const x = cx + (dot % 2) * 6
        const y = cy + Math.floor(dot / 2) * 6
        sizes[Math.floor(hash(x, y, 15) * 3)] += `M${x} ${y}h0`
      }
    }
  }
  return sizes.map((d, i) => `<path d="${d}" stroke="${p.bead}" stroke-width="${[1.8, 2.6, 3.4][i]}" stroke-linecap="round" opacity="${[0.22, 0.3, 0.38][i]}"/>`).join('')
}

/** Rivulets: a drop sliding down the glass in fits and starts, its wet trail of dots behind it. */
function rivulets(ctx: SceneCtx, p: Pal): string {
  const { rivulets: count, speed } = rain(ctx)
  if (ctx.season === 'winter') return ''
  let out = ''
  for (let i = 0; i < count; i += 1) {
    // Rivulets keep to the sides of the glass; a few faint ones cross the middle.
    let x = hash(i, 1, 16) * 1600
    if (hash(i, 2, 16) > edge(x, 400) * 0.92 + 0.08) x = x < 800 ? x * 0.35 : 1600 - (1600 - x) * 0.35
    const len = 70 + hash(i, 3, 16) * 160
    let trail = ''
    let wx = 0
    for (let k = 0; k < len; k += 6) {
      wx += (hash(i, k, 17) - 0.5) * 2.2
      if (hash(i, k, 18) < 0.75) trail += `M${n(wx)} ${n(-k)}h0`
    }
    const secs = (7 + hash(i, 4, 16) * 9) / speed
    const rest = n(hash(i, 5, 16) * 900)
    const drop = 3.2 + hash(i, 6, 16) * 2.2
    out += `<g class="slide" style="transform:translateY(${rest}px);animation-duration:${n(secs)}s;animation-delay:-${n(hash(i, 7, 16) * secs)}s"><g transform="translate(${n(x)} 0)"><path d="${trail}" stroke="${p.bead}" stroke-width="2.6" stroke-linecap="round" opacity=".5"/><path d="${trail}" stroke="${p.bead}" stroke-width="7" stroke-linecap="round" opacity=".06"/><circle cx="${n(wx)}" cy="4" r="${n(drop)}" fill="${p.bead}" fill-opacity=".22" stroke="${p.bead}" stroke-opacity=".7" stroke-width="1.2"/><circle cx="${n(wx - drop * 0.35)}" cy="${n(4 - drop * 0.35)}" r="${n(drop * 0.3)}" fill="#ffffff" opacity=".8"/></g></g>`
  }
  return out
}

/** Condensation: a pale mist across the foot of the glass and up into the corners. */
function mist(ctx: SceneCtx): string {
  return `<rect x="0" y="700" width="1600" height="300" fill="url(#mistdown)" opacity="${ctx.season === 'winter' ? 0.9 : 0.6}"/>`
}

/** Winter frost: ice feathers growing in from the four corners of the glass, and a white bloom there. */
function frost(ctx: SceneCtx): string {
  if (ctx.season !== 'winter') return ''
  const corners: [number, number, number, number][] = [[0, 0, 1, 1], [1600, 0, -1, 1], [0, 1000, 1, -1], [1600, 1000, -1, -1]]
  let d = ''
  corners.forEach(([cx, cy, sx, sy], c) => {
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 15) * (Math.PI / 2)
      const len = 90 + hash(c, i, 19) * 170
      let px = cx
      let py = cy
      const steps = 6
      for (let s = 1; s <= steps; s += 1) {
        const r = (len * s) / steps
        const nx = cx + Math.cos(a) * r * sx
        const ny = cy + Math.sin(a) * r * sy
        d += `M${n(px)} ${n(py)}L${n(nx)} ${n(ny)}`
        // Side barbs on each segment, shorter toward the tip.
        const barb = (1 - s / steps) * 18 + 4
        d += `M${n(nx)} ${n(ny)}l${n(Math.cos(a + 0.7) * barb * sx)} ${n(Math.sin(a + 0.7) * barb * sy)}M${n(nx)} ${n(ny)}l${n(Math.cos(a - 0.7) * barb * sx)} ${n(Math.sin(a - 0.7) * barb * sy)}`
        px = nx
        py = ny
      }
    }
  })
  return `<ellipse cx="0" cy="0" rx="380" ry="300" fill="url(#frostbloom)"/><ellipse cx="1600" cy="0" rx="380" ry="300" fill="url(#frostbloom)"/><ellipse cx="0" cy="1000" rx="420" ry="320" fill="url(#frostbloom)"/><ellipse cx="1600" cy="1000" rx="420" ry="320" fill="url(#frostbloom)"/><path d="${d}" stroke="#f0f6ff" stroke-width="1" stroke-linecap="round" opacity=".3"/><path d="${d}" stroke="#f0f6ff" stroke-width="5" stroke-linecap="round" opacity=".05"/>`
}

/** Autumn: a few wet leaves stuck to the glass at the edges, beads gathered on them. */
function leaves(ctx: SceneCtx): string {
  if (ctx.season !== 'autumn') return ''
  const spots: [number, number, number, number, string][] = [[90, 360, 1.1, 30, '#c0602a'], [300, 930, 0.9, -40, '#d89030'], [1480, 300, 1, 120, '#a8402a'], [1380, 940, 0.8, 70, '#c87a28'], [1560, 700, 0.7, -20, '#d8a040'], [40, 760, 0.75, 160, '#b0502a']]
  return spots
    .map(([x, y, s, rot, c]) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M0 -40C22 -28 28 -8 22 12C14 30 4 36 0 44C-4 36 -14 30 -22 12C-28 -8 -22 -28 0 -40Z" fill="${c}" opacity=".85"/><path d="M0 -36V44M0 -16l14 -10M0 0l16 -8M0 14l14 -6M0 -16l-14 -10M0 0l-16 -8M0 14l-14 -6" stroke="${mix(c, '#000000', 0.35)}" stroke-width="1.5" fill="none" opacity=".7"/><circle cx="8" cy="-6" r="3" fill="#ffffff" opacity=".5"/><circle cx="-10" cy="16" r="2.2" fill="#ffffff" opacity=".45"/></g>`)
    .join('')
}

/** One pair of car lights per subagent, gliding along the street at the foot of a corner: headlights one way, tail lights back. */
function cars(ctx: SceneCtx): string {
  const lanes: [number, number, number, boolean, number][] = [
    [20, 952, 420, true, 13],
    [1580, 962, -420, false, 15],
    [430, 978, -400, false, 17],
    [1180, 944, 400, true, 12],
    [40, 990, 400, false, 19],
  ]
  let out = ''
  for (let i = 0; i < ctx.agents; i += 1) {
    const [x, y, run, head, secs] = lanes[i] ?? [0, 0, 0, true, 10]
    const hues = CAR_HUES[i] ?? ['#ffffff', '#ff3a2a']
    const colour = (head ? hues[0] : hues[1]) ?? '#ffffff'
    const dir = run > 0 ? 1 : -1
    const beam = head ? `<path d="M${dir * 10} -6l${dir * 120} -14v40z" fill="url(#beam${i})" opacity=".5"/>` : ''
    out += `<g transform="translate(${x} ${y})"><g class="drive" style="--run:${run}px;animation-duration:${secs}s;animation-delay:-${n(i * 3.7)}s;transform:translateX(${n(run * 0.4)}px)">${beam}<circle cx="-12" r="22" fill="url(#c${i})"/><circle cx="12" r="22" fill="url(#c${i})"/><circle cx="-12" r="4" fill="${mix(colour, '#ffffff', 0.5)}"/><circle cx="12" r="4" fill="${mix(colour, '#ffffff', 0.5)}"/><ellipse cy="26" rx="34" ry="5" fill="${colour}" opacity=".18"/></g></g>`
  }
  return out
}

/** Error: lightning forks across the top right, the room flashes, and the sky goes thunder-dark. */
function storm(ctx: SceneCtx): string {
  if (ctx.activity !== 'error') return ''
  let d = 'M1330 -10'
  let x = 1330
  let y = -10
  let branch = ''
  for (let k = 0; k < 9; k += 1) {
    x += (hash(k, 1, 51) - 0.45) * 70
    y += 30 + hash(k, 2, 51) * 30
    d += `L${n(x)} ${n(y)}`
    if (k === 3 || k === 6) branch += `M${n(x)} ${n(y)}l${n(40 + k * 4)} ${n(30 + k * 3)}l-12 ${n(36)}l${n(22)} 30`
  }
  return `<rect width="1600" height="1000" fill="#03040a" opacity=".38"/><g class="bolt"><path d="${d}${branch}" stroke="#e8eeff" stroke-width="3" fill="none" stroke-linejoin="bevel"/><path d="${d}" stroke="#a8b8ff" stroke-width="12" fill="none" opacity=".35"/></g><rect class="strike" width="1600" height="1000" fill="#dfe6ff"/>`
}

/** Success: the rain has stopped; a rainbow and a patch of clear sky glow in the top left. */
function clearing(ctx: SceneCtx): string {
  if (ctx.activity !== 'success') return ''
  const bands = ['#ff6a6a', '#ffa860', '#ffe070', '#8ae08a', '#70b8ff', '#9a8aff']
  const arcs = bands.map((c, i) => `<circle cx="-120" cy="760" r="${700 - i * 13}" fill="none" stroke="${c}" stroke-width="13"/>`).join('')
  return `<ellipse class="glow" cx="220" cy="120" rx="640" ry="420" fill="url(#clear)"/><g class="rainbow" mask="url(#bowmask)" opacity=".42">${arcs}</g>`
}

function defs(ctx: SceneCtx, p: Pal): string {
  const disc = (id: string, c: string, peak: number): string => `<radialGradient id="${id}"><stop offset="0" stop-color="${c}" stop-opacity="${n(peak * 0.6)}"/><stop offset=".6" stop-color="${c}" stop-opacity="${n(peak * 0.5)}"/><stop offset=".82" stop-color="${c}" stop-opacity="${n(peak * 0.62)}"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`
  const strength = ctx.phase === 'day' ? 0.26 : 0.46
  const discs = p.lights.map((c, i) => disc(`b${i}`, c, strength)).join('')
  let carGlow = ''
  CAR_HUES.forEach((h, i) => {
    const lanesHead = [true, false, false, true, false][i]
    const c = lanesHead ? h[0] : h[1]
    carGlow += `<radialGradient id="c${i}"><stop offset="0" stop-color="${c}" stop-opacity=".9"/><stop offset=".35" stop-color="${c}" stop-opacity=".35"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient><linearGradient id="beam${i}" x1="${i === 3 || i === 0 ? 0 : 1}" x2="${i === 3 || i === 0 ? 1 : 0}"><stop offset="0" stop-color="${h[0]}" stop-opacity=".5"/><stop offset="1" stop-color="${h[0]}" stop-opacity="0"/></linearGradient>`
  })
  return `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.top}"/><stop offset=".7" stop-color="${p.low}"/><stop offset="1" stop-color="${p.haze}"/></linearGradient>
<linearGradient id="mistdown" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.bead}" stop-opacity="0"/><stop offset="1" stop-color="${p.bead}" stop-opacity=".1"/></linearGradient>
<radialGradient id="frostbloom"><stop offset="0" stop-color="#eef4ff" stop-opacity=".32"/><stop offset=".6" stop-color="#eef4ff" stop-opacity=".1"/><stop offset="1" stop-color="#eef4ff" stop-opacity="0"/></radialGradient>
<radialGradient id="clear"><stop offset="0" stop-color="#bfe0ff" stop-opacity=".3"/><stop offset=".6" stop-color="#9fc8ff" stop-opacity=".08"/><stop offset="1" stop-color="#9fc8ff" stop-opacity="0"/></radialGradient>
<radialGradient id="calm" cx=".5" cy=".45" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".7" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="bowfade" cx=".05" cy=".25" r=".42"><stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<mask id="bowmask" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><rect width="1600" height="1000" fill="url(#bowfade)"/></mask>
${discs}${carGlow}`
}

function style(): string {
  return `.glow{animation:glow 8s ease-in-out infinite alternate}
.fallrain{animation:fallrain 1.6s linear infinite}
.fallsnow{animation:fallsnow 24s linear infinite}
.slide{animation:slide 10s linear infinite}
.drive{animation:drive 14s linear infinite}
.bolt{opacity:.25;animation:bolt 5s linear infinite}
.strike{opacity:0;animation:strike 5s linear infinite}
.rainbow{animation:rainbow 6s ease-out both}
@keyframes glow{from{opacity:.6}to{opacity:1}}
@keyframes fallrain{from{transform:translate(0,0)}to{transform:translate(-180px,1000px)}}
@keyframes fallsnow{from{transform:translate(0,0)}to{transform:translate(-60px,1000px)}}
@keyframes slide{0%{transform:translateY(-260px)}18%{transform:translateY(80px)}30%{transform:translateY(110px)}52%{transform:translateY(470px)}62%{transform:translateY(500px)}100%{transform:translateY(1260px)}}
@keyframes drive{0%{transform:translateX(0);opacity:0}8%{opacity:1}88%{opacity:1}100%{transform:translateX(var(--run));opacity:0}}
@keyframes bolt{0%,1%{opacity:0}2%{opacity:1}4%{opacity:.1}6%{opacity:1}12%{opacity:0}100%{opacity:0}}
@keyframes strike{0%,1%{opacity:0}2%{opacity:.35}4%{opacity:0}6%{opacity:.22}10%,100%{opacity:0}}
@keyframes rainbow{from{opacity:0}to{opacity:.42}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`
}

function rainScene(ctx: SceneCtx): string {
  const p = palette(ctx)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>${style()}</style><defs>${defs(ctx, p)}</defs>
<rect width="1600" height="1000" fill="url(#sky)"/>
${clearing(ctx)}
${city(ctx, p)}
${bokeh(ctx, p)}
${rainOutside(ctx, p)}
${cars(ctx)}
<rect width="1600" height="1000" fill="url(#calm)"/>
${mist(ctx)}
${frost(ctx)}
${beads(ctx, p)}
${leaves(ctx)}
${rivulets(ctx, p)}
${storm(ctx)}
</svg>`
}

export const theme: LivingTheme = {
  id: 'rain-window',
  title: 'Rain Window',
  blurb: 'A city at night through a rainy window: soft bokeh lights in the lower corners, beads and rivulets sliding down the glass.',
  reacts: 'Drizzle when idle, steady rain while thinking, a downpour while working, a pair of car lights per subagent, lightning and a thunder-dark sky after an error, and the rain stopping under a rainbow on success; overcast grey by day, amber city at dusk, deep night; snow and frost in winter, leaves on the glass in autumn, lighter rain in spring.',
  window: 'dark',
  glass: ctx => ({ blur: 12, tint: ctx.phase === 'day' ? '#1a212c' : '#0a0c1a', opacity: 0.34 }),
  scene: rainScene,
}
