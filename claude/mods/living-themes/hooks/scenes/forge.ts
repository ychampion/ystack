// Forge: a blacksmith's corner at night. The hearth glows in the lower right under a brick hood, an anvil stands before it,
// a beam crosses the top left with lanterns on it, and a small window in the left wall shows the sky outside.
// The middle of the room stays a dark brick wall for the conversation.
// The agent's activity drives the smithy: embers breathe when idle, the bellows pump while thinking, the hammer strikes and
// sparks fly while working, a lantern is lit for each subagent, the fire chokes on smoke after an error, and an ingot cools
// from white heat to gold on success.
// Pure string building: no DOM, no randomness, no clock.
import type { LivingTheme, Phase, SceneCtx } from './contract'

type Pal = { wall: string; wallDeep: string; brick: string; mortar: string; wood: string; iron: string; ironLit: string; sky: string; skyLow: string; pane: string; light: number }

const PALETTES: Record<Phase, Pal> = {
  night: { wall: '#1a0f0c', wallDeep: '#0b0607', brick: '#2a1610', mortar: '#120a08', wood: '#1d120c', iron: '#120e0f', ironLit: '#5a3a2e', sky: '#0b1430', skyLow: '#16224a', pane: '#2a3a66', light: 0 },
  day: { wall: '#241713', wallDeep: '#120b0a', brick: '#3a221a', mortar: '#1a100c', wood: '#2a1b12', iron: '#16120f', ironLit: '#6a4a3a', sky: '#9fb6c8', skyLow: '#d6dfe2', pane: '#c8d6dc', light: 1 },
  dawn: { wall: '#21130f', wallDeep: '#0f0808', brick: '#341c15', mortar: '#170d0a', wood: '#24160f', iron: '#140f0f', ironLit: '#644234', sky: '#4a4f86', skyLow: '#f2a98a', pane: '#c99a8c', light: 0.6 },
  dusk: { wall: '#20120e', wallDeep: '#0e0707', brick: '#321b14', mortar: '#160c09', wood: '#23150e', iron: '#140f0f', ironLit: '#644234', sky: '#2c2756', skyLow: '#e88a52', pane: '#b8794e', light: 0.45 },
}

const LANTERNS = ['#ffb347', '#ff7a3c', '#ffd36b', '#ff9a8a', '#ffc98a']

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

function soft(id: string, colour: string, peak: number): string {
  return `<radialGradient id="${id}"><stop offset="0" stop-color="${colour}" stop-opacity="${peak}"/><stop offset=".4" stop-color="${colour}" stop-opacity="${n(peak * 0.4)}"/><stop offset="1" stop-color="${colour}" stop-opacity="0"/></radialGradient>`
}

// The hearth's mouth, where every glow and spark comes from.
const FIRE_X = 1470
const FIRE_Y = 850
// Where the hammer meets the anvil.
const STRIKE_X = 1236
const STRIKE_Y = 812

/** How hot the fire burns in each moment: glow strength and flicker speed. */
function heat(ctx: SceneCtx): { glow: number; flicker: number; embers: number } {
  switch (ctx.activity) {
    case 'thinking': return { glow: 1, flicker: 1.6, embers: 14 }
    case 'working': return { glow: 1.1, flicker: 0.9, embers: 22 }
    case 'agents': return { glow: 0.95, flicker: 1.4, embers: 14 }
    case 'error': return { glow: 0.35, flicker: 3, embers: 3 }
    case 'success': return { glow: 1.05, flicker: 1.4, embers: 16 }
    default: return { glow: 0.75, flicker: 2.4, embers: 8 }
  }
}

// ---------------------------------------------------------------- the room

function wall(p: Pal): string {
  // Bricks in a pattern: each course offset by half a brick, mortar between, a few bricks a shade off so it never tiles flat.
  let odd = ''
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      if (hash(col, row, 3) < 0.35) {
        const x = col * 64 + (row % 2) * 32
        odd += `M${x + 2} ${row * 26 + 2}h60v22h-60z`
      }
    }
  }
  return `<pattern id="brick" width="256" height="104" patternUnits="userSpaceOnUse"><rect width="256" height="104" fill="${p.brick}"/><path d="${odd}" fill="${mix(p.brick, '#000000', 0.25)}"/><path d="M0 0.5h256M0 26.5h256M0 52.5h256M0 78.5h256${[0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => `M${c * 64 + (r % 2) * 32 + 0.5} ${r * 26}v26`).join('')).join('')}" stroke="${p.mortar}" stroke-width="3"/></pattern>`
}

function windowView(ctx: SceneCtx, p: Pal): string {
  // The window in the left wall: x 96 to 336, y 230 to 470.
  const x = 96
  const y = 230
  const w = 240
  const h = 240
  let sky = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#sky)"/>`
  if (ctx.phase === 'night' || ctx.phase === 'dusk') {
    let stars = ''
    let bright = ''
    for (let i = 0; i < 46; i += 1) {
      const sx = x + 6 + hash(i, 1, 21) * (w - 12)
      const sy = y + 6 + hash(i, 2, 21) * (h * (ctx.phase === 'dusk' ? 0.45 : 0.85))
      if (hash(i, 3, 21) < 0.15) bright += `M${n(sx)} ${n(sy)}h0`
      else stars += `M${n(sx)} ${n(sy)}h0`
    }
    sky += `<path class="tw" d="${stars}" stroke="#dfe6ff" stroke-width="2" stroke-linecap="round"/><path class="tw" style="animation-duration:5s;animation-delay:-2s" d="${bright}" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round"/>`
    if (ctx.phase === 'night') sky += `<circle cx="${x + 178}" cy="${y + 58}" r="17" fill="#f2ecd6"/><circle cx="${x + 186}" cy="${y + 52}" r="15" fill="url(#skyflat)"/>`
  } else {
    sky += `<ellipse class="drift" cx="${x + 60}" cy="${y + 70}" rx="70" ry="16" fill="#ffffff" opacity=".35"/><ellipse class="drift" style="animation-delay:-20s" cx="${x + 170}" cy="${y + 120}" rx="60" ry="12" fill="#ffffff" opacity=".28"/>`
  }
  // A far roofline under the sky, then the season outside.
  sky += `<path d="M${x} ${y + h}V${y + 190}l30-26 30 26v-14h40v-30l26-20 26 20v44h34l26-22 28 22v${h - 190}z" fill="${mix(p.sky, '#000000', 0.7)}"/>`
  let season = ''
  if (ctx.season === 'autumn' || ctx.season === 'spring' || ctx.season === 'summer') {
    const leafColours: Record<string, string[]> = { autumn: ['#d9762e', '#b8452a', '#e3a43a'], spring: ['#ffc2d8', '#ffe2ec', '#f7a8c6'], summer: ['#4f8a3a', '#6aa646', '#3c7030'] }
    const colours = leafColours[ctx.season] ?? []
    // A branch reaching in from the top of the frame, and leaves on it.
    let leaves = ''
    for (let i = 0; i < 18; i += 1) {
      const t = i / 18
      const lx = x + w - t * 170 + (hash(i, 1, 31) - 0.5) * 20
      const ly = y + 20 + t * 50 + (hash(i, 2, 31) - 0.5) * 34
      leaves += `<ellipse cx="${n(lx)}" cy="${n(ly)}" rx="${ctx.season === 'spring' ? 5 : 8}" ry="${ctx.season === 'spring' ? 5 : 4}" transform="rotate(${Math.round(hash(i, 3, 31) * 180)} ${n(lx)} ${n(ly)})" fill="${colours[i % 3]}"/>`
    }
    season += `<g class="sway" style="transform-origin:${x + w}px ${y}px"><path d="M${x + w + 10} ${y - 6}C${x + w - 60} ${y + 30} ${x + 110} ${y + 50} ${x + 50} ${y + 86}" stroke="#1a120c" stroke-width="6" fill="none"/>${leaves}</g>`
    if (ctx.season === 'autumn') {
      for (let i = 0; i < 7; i += 1) {
        const lx = x + 20 + hash(i, 5, 32) * (w - 40)
        season += `<g class="fall" style="animation-duration:${9 + i * 1.7}s;animation-delay:-${n(hash(i, 6, 32) * 12)}s"><ellipse class="spin" cx="${n(lx)}" cy="${y + 40 + i * 22}" rx="7" ry="3.5" style="transform-origin:${n(lx)}px ${y + 40 + i * 22}px" fill="${colours[i % 3]}"/></g>`
      }
    }
    if (ctx.season === 'summer' && (ctx.phase === 'night' || ctx.phase === 'dusk')) {
      let flies = ''
      for (let i = 0; i < 8; i += 1) flies += `M${n(x + 20 + hash(i, 7, 33) * 200)} ${n(y + 120 + hash(i, 8, 33) * 90)}h0`
      season += `<path class="tw" style="animation-duration:3s" d="${flies}" stroke="#e8ff8a" stroke-width="4" stroke-linecap="round"/>`
    }
  }
  if (ctx.season === 'winter') {
    // Snow on the roofs outside, falling flakes, and frost feathering in from the corners of every pane.
    let flakes = ''
    for (let i = 0; i < 40; i += 1) flakes += `M${n(x + hash(i, 1, 41) * w)} ${n(y + hash(i, 2, 41) * h)}h0`
    season += `<g class="snowfall"><path d="${flakes}" stroke="#f4f8ff" stroke-width="3" stroke-linecap="round" opacity=".85"/></g><path d="M${x} ${y + 190}l30-26 30 26M${x + 100} ${y + 150}l26-20 26 20M${x + 186} ${y + 196}l26-22 28 22" stroke="#e8f0ff" stroke-width="4" fill="none" opacity=".8"/>`
  }
  // Panes: frame and muntins.
  const frame = mix(p.wood, '#000000', 0.2)
  let frost = ''
  if (ctx.season === 'winter') {
    const corners: [number, number, number, number][] = []
    for (const px of [x, x + w / 2]) for (const py of [y, y + h / 3, y + (2 * h) / 3]) {
      corners.push([px + 4, py + h / 3 - 4, 1, -1], [px + w / 2 - 4, py + h / 3 - 4, -1, -1])
    }
    let d = ''
    corners.forEach(([cx, cy, sx, sy], k) => {
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 5) * (Math.PI / 2)
        const len = 18 + hash(k, i, 51) * 22
        const ex = cx + Math.cos(a) * len * sx
        const ey = cy + Math.sin(a) * len * sy
        const mx = (cx + ex) / 2
        const my = (cy + ey) / 2
        d += `M${n(cx)} ${n(cy)}L${n(ex)} ${n(ey)}M${n(mx)} ${n(my)}l${n(6 * sx)} ${n(-2 * sy)}M${n(mx)} ${n(my)}l${n(-2 * sx)} ${n(6 * sy)}`
      }
    })
    frost = `<path d="${d}" stroke="#eaf4ff" stroke-width="1.4" stroke-linecap="round" opacity=".7"/><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#frost)"/>`
  }
  const glassSheen = `<path d="M${x + 10} ${y + h - 20}L${x + 80} ${y + 10}h24L${x + 34} ${y + h - 20}z" fill="#ffffff" opacity="${0.04 + p.light * 0.04}"/>`
  const frameD = `M${x - 14} ${y - 14}h${w + 28}v${h + 28}h-${w + 28}zM${x} ${y}v${h}h${w}v-${h}z`
  const muntins = `M${x + w / 2 - 4} ${y}h8v${h}h-8zM${x} ${y + h / 3 - 4}h${w}v8h-${w}zM${x} ${y + (2 * h) / 3 - 4}h${w}v8h-${w}z`
  const sill = `<rect x="${x - 26}" y="${y + h + 12}" width="${w + 52}" height="14" fill="${p.wood}"/>${ctx.season === 'winter' ? `<rect x="${x - 22}" y="${y + h + 8}" width="${w + 44}" height="6" rx="3" fill="#dfe8f4" opacity=".55"/>` : ''}`
  return `<g><clipPath id="pane"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath><g clip-path="url(#pane)">${sky}${season}${frost}${glassSheen}</g><path d="${frameD}" fill="${frame}" fill-rule="evenodd"/><path d="${muntins}" fill="${frame}"/>${sill}</g>`
}

/** By day the window throws a pale slab of light across the wall and floor. */
function windowLight(ctx: SceneCtx, p: Pal): string {
  if (p.light === 0) return `<ellipse cx="216" cy="350" rx="250" ry="230" fill="url(#moonlight)"/>`
  const tint = ctx.phase === 'day' ? '#e6eef2' : ctx.phase === 'dawn' ? '#ffcdb6' : '#ffb27a'
  return `<path d="M96 230h240v240L620 1000H330z" fill="${tint}" opacity="${n(0.05 * p.light)}"/><ellipse cx="216" cy="350" rx="300" ry="260" fill="url(#daylight)"/>`
}

function beamAndLanterns(ctx: SceneCtx, p: Pal): string {
  // A heavy beam across the top left, with an iron hook every ninety units.
  const beam = `<path d="M-20 64h600l14 10v26l-14 8h-600z" fill="${p.wood}"/><path d="M-20 64.5h600" stroke="${mix(p.wood, '#ffb070', 0.25)}" stroke-width="2"/><path d="M-20 72h596M-20 92h590" stroke="${mix(p.wood, '#000000', 0.35)}" stroke-width="2"/><path d="M40 100h18v-38h-18zM500 100h18v-38h-18z" fill="${mix(p.wood, '#000000', 0.25)}"/><rect x="0" y="100" width="18" height="380" fill="${p.wood}"/>`
  // The first lantern hangs dark; each subagent lights one more.
  const xs = [96, 186, 276, 366, 456, 546]
  let out = ''
  xs.forEach((lx, i) => {
    const lit = i > 0 && i <= ctx.agents
    const drop = 40 + (i % 2) * 22
    if (i > ctx.agents && i > 0) {
      out += `<path d="M${lx} 106v${drop - 26}" stroke="${p.iron}" stroke-width="2" opacity=".6"/><path d="M${lx - 6} ${106 + drop - 26}a6 6 0 1 0 12 0" stroke="${p.iron}" stroke-width="2" fill="none" opacity=".6"/>`
      return
    }
    const colour = LANTERNS[(i - 1 + LANTERNS.length) % LANTERNS.length] ?? '#ffb347'
    const top = 106 + drop
    const body = `<path d="M${lx} 106v${drop}" stroke="${p.iron}" stroke-width="2.4" stroke-dasharray="5 3"/><path d="M${lx - 13} ${top + 8}l13-12 13 12z" fill="${p.iron}"/><rect x="${lx - 12}" y="${top + 8}" width="24" height="34" fill="${lit ? colour : '#2a1c16'}" fill-opacity="${lit ? 0.55 : 1}"/><path d="M${lx - 12} ${top + 8}h24v34h-24zM${lx} ${top + 8}v34" stroke="${p.iron}" stroke-width="2.6" fill="none"/><rect x="${lx - 15}" y="${top + 42}" width="30" height="6" fill="${p.iron}"/>`
    const flame = lit ? `<ellipse class="flick" style="transform-origin:${lx}px ${top + 34}px;animation-delay:-${n(i * 0.37)}s" cx="${lx}" cy="${top + 28}" rx="4" ry="8" fill="#fff2c4"/><circle class="glow" style="animation-delay:-${i}s" cx="${lx}" cy="${top + 26}" r="80" fill="url(#l${i - 1})"/>` : ''
    out += `<g class="${lit ? 'swing' : ''}" style="transform-origin:${lx}px 106px;animation-delay:-${n(i * 0.9)}s">${flame}${body}</g>`
  })
  return beam + out
}

/** Tools on the wall below the window, and a quench tub in the corner. */
function tools(p: Pal): string {
  const c = p.iron
  return `<path d="M60 560h300v10H60z" fill="${p.wood}"/>
<path d="M92 570v130M86 700l6 26 6-26M114 570v120l-6 30M126 570v120l6 30" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round"/>
<path d="M176 570v120" stroke="${p.wood}" stroke-width="8" stroke-linecap="round"/><rect x="160" y="684" width="32" height="20" fill="${c}"/>
<path d="M236 570v140" stroke="${p.wood}" stroke-width="7" stroke-linecap="round"/><path d="M222 704h28v16h-28z" fill="${c}"/>
<path d="M298 570l-10 130M306 570l12 130" stroke="${c}" stroke-width="4" stroke-linecap="round"/>
<path d="M30 880h200l-12 120H42z" fill="${mix(p.wood, '#000000', 0.15)}"/><path d="M30 900h200M34 960h192" stroke="${c}" stroke-width="7"/><ellipse cx="130" cy="882" rx="100" ry="10" fill="#0a0d12"/>`
}

// ---------------------------------------------------------------- the hearth

function hearth(ctx: SceneCtx, p: Pal): string {
  const h = heat(ctx)
  const choked = ctx.activity === 'error'
  // Hood and chimney (brick), the hearth block, and the arched mouth.
  const hood = `<path d="M1310 690L1420 470V0h150v470L1640 690z" fill="url(#brick)"/><path d="M1310 690L1420 470V0h150v470L1640 690z" fill="url(#hoodshade)"/><path d="M1296 690h360v22h-360z" fill="${mix(p.brick, '#000000', 0.35)}"/>`
  const block = `<rect x="1330" y="712" width="300" height="300" fill="url(#brick)"/><rect x="1330" y="712" width="300" height="300" fill="url(#blockshade)"/>`
  const mouth = `M1380 920V820Q1380 770 1470 770Q1560 770 1560 820V920z`
  const inner = `<path d="${mouth}" fill="#0d0605"/><path d="${mouth}" fill="url(#firebed)" class="${ctx.activity === 'thinking' ? 'blow' : 'glow'}" opacity="${n(Math.min(1, h.glow))}"/>`
  // Coals: a heap of small polygons, each lit on its own clock.
  const lit = ['', '', '']
  let dark = ''
  for (let i = 0; i < 60; i += 1) {
    const cx = 1394 + hash(i, 1, 61) * 152
    const top = 896 - Math.sin(((cx - 1390) / 160) * Math.PI) * 22
    const cy = top + hash(i, 2, 61) * (918 - top)
    const r = 4 + hash(i, 3, 61) * 5
    const d = `M${n(cx - r)} ${n(cy)}l${n(r * 0.6)} -${n(r * 0.8)}l${n(r)} ${n(r * 0.1)}l${n(r * 0.5)} ${n(r * 0.8)}l-${n(r * 0.7)} ${n(r * 0.6)}z`
    if (hash(i, 4, 61) < (choked ? 0.75 : 0.35)) dark += d
    else lit[i % 3] += d
  }
  const coalTone = choked ? ['#5a1a10', '#7a2614', '#4a140c'] : ['#ff9a3c', '#ff6a1c', '#ffd27a']
  const coals = `<path d="${dark}" fill="#1a0c08"/>` + lit.map((d, i) => `<path class="coal" style="animation-duration:${n(h.flicker * (1.6 + i * 0.7))}s;animation-delay:-${i}s" d="${d}" fill="${coalTone[i]}"/>`).join('')
  // Flames: three tongues that flicker; small and low when the fire chokes.
  const scale = choked ? 0.35 : ctx.activity === 'idle' ? 0.6 : ctx.activity === 'working' || ctx.activity === 'thinking' ? 1 : 0.8
  const flames = [
    [1432, '#ff7a2a', 0.85],
    [1470, '#ffb347', 1],
    [1508, '#ff5a1a', 0.8],
  ]
    .map(([x, c, s], i) => `<g transform="translate(${x} 902) scale(${n((s as number) * scale)})"><path class="flame" style="animation-duration:${n(h.flicker * 0.5 + i * 0.13)}s;animation-delay:-${n(i * 0.21)}s" d="M-16 0C-20-30 -4-40 0-80C6-44 22-30 16 0Z" fill="${c}" opacity=".85"/><path class="flame" style="animation-duration:${n(h.flicker * 0.4 + i * 0.1)}s" d="M-8 0C-10-18 0-24 0-46C4-26 12-18 8 0Z" fill="#fff0b8"/></g>`)
    .join('')
  // A halftone of heat around the mouth: dots that grow toward the fire, a printed glow rather than a smooth one.
  // Four dot sizes, biggest nearest the fire, with a little jitter in the falloff so the edge of the glow frays.
  const sizes = ['', '', '', '']
  for (let gy = 480; gy < 1000; gy += 11) {
    for (let gx = 1020; gx < 1600; gx += 11) {
      const ox = gx + ((gy / 11) % 2) * 5.5
      const dist = Math.hypot(ox - FIRE_X, (gy - FIRE_Y) * 1.25) + (hash(gx, gy, 62) - 0.5) * 70
      const level = Math.floor((1 - dist / 470) * 5)
      if (level < 1 || (level === 1 && hash(gx, gy, 63) < 0.55) || (level === 2 && hash(gx, gy, 63) < 0.2)) continue
      sizes[Math.min(3, level - 1)] += `M${n(ox)} ${gy}h0`
    }
  }
  const halftone = `<g class="breathe" opacity="${n(0.3 * h.glow)}">${sizes.map((d, i) => `<path d="${d}" stroke="#ff8a3a" stroke-width="${[1.2, 2, 2.8, 3.6][i]}" stroke-linecap="round"/>`).join('')}</g>`
  const pool = `<ellipse class="${ctx.activity === 'thinking' ? 'blow' : 'breathe'}" cx="${FIRE_X}" cy="${FIRE_Y}" rx="520" ry="420" fill="url(#heat)" opacity="${n(Math.min(1, h.glow))}"/>`
  return `${pool}${hood}${halftone}${block}${inner}${coals}<g opacity="${choked ? 0.5 : 1}">${flames}</g><path d="${mouth}" fill="none" stroke="${mix(p.brick, '#ff8a3a', 0.25)}" stroke-width="6"/>`
}

/** The bellows on the floor beside the hearth; they pump while the agent thinks. */
function bellows(ctx: SceneCtx, p: Pal): string {
  const pumping = ctx.activity === 'thinking' || ctx.activity === 'agents' || ctx.activity === 'working'
  const speed = ctx.activity === 'thinking' ? 3.2 : 2.2
  const leather = mix(p.wood, '#6a3a24', 0.55)
  const lit = mix(leather, '#ff9a4a', 0.35)
  // A big pair of leather bellows lying before the hearth, its nozzle aimed into the fire; the top board rises and falls.
  const top = `<path d="M1420 950L1600 930V952L1420 958Z" fill="${p.wood}"/><path d="M1420 950L1600 930" stroke="${lit}" stroke-width="2.4"/><path d="M1600 924l-10 30" stroke="${p.wood}" stroke-width="10" stroke-linecap="round"/>`
  const pleats = `<path d="M1420 958L1600 952V986L1420 974Z" fill="${leather}"/><path d="M1440 962l150-6M1440 968l150-2M1440 974l150 4" stroke="${mix(leather, '#000000', 0.4)}" stroke-width="2"/>`
  const base = `<path d="M1420 974L1600 986V1000H1420Z" fill="${p.wood}"/>`
  return `<g class="${pumping ? 'pump' : ''}" style="transform-origin:1420px 990px;animation-duration:${speed}s">${pleats}${top}</g>${base}<path d="M1424 966L1390 918" stroke="${p.iron}" stroke-width="9" stroke-linecap="round"/><path d="M1424 966L1390 918" stroke="${mix(p.iron, '#ff8a3a', 0.3)}" stroke-width="2" stroke-linecap="round"/>`
}

function anvil(ctx: SceneCtx, p: Pal): string {
  const lit = mix(p.iron, '#ff8a3a', 0.45)
  const face = mix(p.iron, '#5a3a30', 0.5)
  const stump = `<path d="M1196 856h96l8 144h-112z" fill="${mix(p.wood, '#4a2a1a', 0.3)}"/><path d="M1292 856l8 144h-10l-6-144z" fill="${mix(p.wood, '#ff8a3a', 0.2)}"/><path d="M1208 880v110M1236 870v120M1272 878v112" stroke="${mix(p.wood, '#000000', 0.3)}" stroke-width="2"/>`
  // The anvil: a dark iron body, its working face and the side turned to the fire caught in orange light.
  const body = `<path d="M1148 812C1170 812 1180 806 1196 804H1316V826H1296C1290 838 1284 842 1278 846H1304V860H1188V846H1214C1208 842 1202 836 1196 828C1176 826 1160 822 1148 812Z" fill="${face}"/><path d="M1196 804H1316V811H1196z" fill="${mix(face, '#ffb070', 0.3)}"/><path d="M1148 812C1170 812 1180 806 1196 804H1316V826H1296C1290 838 1284 842 1278 846H1304V860" stroke="${lit}" stroke-width="3" fill="none" stroke-linejoin="round"/>`
  let ingot = ''
  if (ctx.activity === 'success') {
    ingot = `<circle class="cool-glow" cx="${STRIKE_X + 20}" cy="798" r="110" fill="url(#ingotglow)"/><rect class="ingot" x="${STRIKE_X - 14}" y="792" width="70" height="13" rx="2" fill="#e8a83a"/><path class="glint" d="M${STRIKE_X - 4} 795h30" stroke="#fff6d8" stroke-width="2" stroke-linecap="round"/>`
  } else if (ctx.activity === 'working') {
    ingot = `<rect x="${STRIKE_X - 14}" y="793" width="62" height="12" rx="2" fill="#ff7a2a"/><circle class="strikeflash" cx="${STRIKE_X}" cy="${STRIKE_Y - 6}" r="70" fill="url(#flash)"/>`
  }
  return `${stump}${body}${ingot}`
}

/** The hammer: raised and falling while working, resting against the anvil otherwise. */
function hammer(ctx: SceneCtx, p: Pal): string {
  // Drawn at the moment of the strike; pivots round the smith's grip off to the right.
  const shape = `<path d="M1340 760L${STRIKE_X + 10} 784" stroke="${p.wood}" stroke-width="9" stroke-linecap="round"/><path d="M${STRIKE_X - 14} 770h40v26h-40z" fill="${p.iron}" transform="rotate(12 ${STRIKE_X + 6} 783)"/><path d="M${STRIKE_X - 14} 770h40" stroke="${mix(p.iron, '#ff8a3a', 0.25)}" stroke-width="2" transform="rotate(12 ${STRIKE_X + 6} 783)"/>`
  if (ctx.activity === 'working') return `<g class="strike" style="transform-origin:1352px 760px">${shape}</g>`
  return `<g transform="rotate(-70 1352 760) translate(0 4)" opacity=".95">${shape}</g>`
}

/** Sparks off each strike: streaks thrown in arcs, in time with the hammer. */
function strikeSparks(ctx: SceneCtx): string {
  if (ctx.activity !== 'working') return ''
  let out = ''
  for (let i = 0; i < 26; i += 1) {
    const side = hash(i, 1, 71) < 0.65 ? -1 : 1
    const dx = side * (40 + hash(i, 2, 71) * 210)
    const up = 60 + hash(i, 3, 71) * 200
    const dn = 40 + hash(i, 4, 71) * 140
    const colour = hash(i, 5, 71) < 0.4 ? '#fff2b0' : '#ffb347'
    // A spark's own clock restarts on the strike (70% into the hammer's swing); half the sparks fly on every other strike,
    // with a longer flight, so no two bursts look alike.
    const long = i % 2 === 1
    const secs = long ? 2.6 : 1.3
    const delay = n(secs - 0.91)
    out += `<g class="sx" style="--dx:${n(dx)}px;animation-duration:${secs}s;animation-delay:-${delay}s"><path class="sy" style="--up:-${n(up)}px;--dn:${n(dn)}px;animation-duration:${secs}s;animation-delay:-${delay}s" d="M${STRIKE_X} ${STRIKE_Y}l${n(side * -7)} 2" stroke="${colour}" stroke-width="2.6" stroke-linecap="round"/></g>`
  }
  return out
}

/** Embers lifting off the fire and drifting up the chimney side. */
function embers(ctx: SceneCtx): string {
  const count = heat(ctx).embers
  let out = ''
  for (let i = 0; i < count; i += 1) {
    const x = 1300 + hash(i, 1, 81) * 280
    const secs = 7 + hash(i, 2, 81) * 8
    const rise = 260 + hash(i, 3, 81) * 380
    const rest = n(-hash(i, 4, 81) * rise)
    out += `<g class="ember" style="--rise:-${n(rise)}px;--drift:${n((hash(i, 5, 81) - 0.6) * 160)}px;transform:translateY(${rest}px);animation-duration:${n(secs)}s;animation-delay:-${n(hash(i, 6, 81) * secs)}s"><circle cx="${n(x)}" cy="760" r="${n(1.6 + hash(i, 7, 81) * 2)}" fill="${hash(i, 8, 81) < 0.3 ? '#ffe2a0' : '#ff8a3a'}"/></g>`
  }
  return out
}

/** Error: the fire chokes, and grey-red smoke rolls out under the hood and along the ceiling. */
function smoke(ctx: SceneCtx): string {
  if (ctx.activity !== 'error') return ''
  const puffs: [number, number, number, number][] = [[1460, 760, 160, 90], [1360, 640, 220, 120], [1460, 480, 260, 140], [1300, 300, 300, 150], [1500, 160, 320, 150], [1180, 120, 260, 110], [1560, 900, 180, 100]]
  return (
    `<rect width="1600" height="1000" fill="#1a0c0a" opacity=".28"/>` +
    puffs
      .map(([x, y, rx, ry], i) => `<g class="roll" style="animation-delay:-${n(i * 0.9)}s;animation-duration:${7 + (i % 3)}s"><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#smoke${i % 2})"/></g>`)
      .join('')
  )
}

function defs(ctx: SceneCtx, p: Pal): string {
  const lanterns = LANTERNS.map((c, i) => soft(`l${i}`, c, 0.32)).join('')
  const night = ctx.phase === 'night'
  let grain = ''
  for (let i = 0; i < 140; i += 1) grain += `M${Math.floor(hash(i, 1, 13) * 48) * 2} ${Math.floor(hash(i, 2, 13) * 48) * 2}h2v2h-2z`
  return `${wall(p)}
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.sky}"/><stop offset="1" stop-color="${p.skyLow}"/></linearGradient>
<linearGradient id="skyflat"><stop offset="0" stop-color="${p.sky}"/></linearGradient>
<linearGradient id="hoodshade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".75"/><stop offset=".7" stop-color="#000" stop-opacity=".35"/><stop offset="1" stop-color="#ff7a2a" stop-opacity=".18"/></linearGradient>
<linearGradient id="blockshade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a2a" stop-opacity=".16"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient>
<radialGradient id="firebed" cx=".5" cy=".85" r=".7"><stop offset="0" stop-color="#ffcf6a"/><stop offset=".35" stop-color="#ff7a2a"/><stop offset=".75" stop-color="#8a2410"/><stop offset="1" stop-color="#2a0c06"/></radialGradient>
<radialGradient id="room" cx=".9" cy=".88" r="1.1"><stop offset="0" stop-color="${mix(p.wall, '#ff7a2a', 0.14)}"/><stop offset=".45" stop-color="${p.wall}"/><stop offset="1" stop-color="${p.wallDeep}"/></radialGradient>
<radialGradient id="frost" cx=".5" cy=".5" r=".72"><stop offset=".55" stop-color="#eaf4ff" stop-opacity="0"/><stop offset="1" stop-color="#eaf4ff" stop-opacity=".55"/></radialGradient>
<radialGradient id="calm" cx=".48" cy=".48" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".3"/><stop offset=".7" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
${soft('heat', '#ff6a1c', 0.34)}${soft('flash', '#ffd890', 0.7)}${soft('ingotglow', '#ffe6a0', 0.5)}${soft('moonlight', night ? '#8fa6ff' : '#c7b2ff', 0.07)}${soft('daylight', ctx.phase === 'day' ? '#e6eef2' : '#ffc39a', 0.12)}
${soft('smoke0', '#6a5450', 0.75)}${soft('smoke1', '#7a3a30', 0.6)}${lanterns}
<pattern id="grain" width="96" height="96" patternUnits="userSpaceOnUse"><path d="${grain}" fill="#000" fill-opacity=".18"/></pattern>`
}

function style(ctx: SceneCtx): string {
  const strike = 1.3
  return `.tw{animation:tw 7s ease-in-out infinite}
.drift{animation:drift 60s ease-in-out infinite alternate}
.sway{animation:sway 9s ease-in-out infinite alternate}
.fall{animation:fall 11s linear infinite}
.spin{animation:spin 3s ease-in-out infinite alternate}
.snowfall{animation:snowfall 14s linear infinite}
.swing{animation:swing 6s ease-in-out infinite alternate}
.flick{animation:flick .9s ease-in-out infinite alternate}
.glow{animation:glow 4s ease-in-out infinite alternate}
.breathe{animation:breathe ${ctx.activity === 'idle' ? 7 : 4}s ease-in-out infinite alternate}
.coal{animation:coal 3s ease-in-out infinite alternate}
.blow{animation:blow 3.2s ease-in-out infinite}
.flame{transform-origin:0 0;animation:flame 1s ease-in-out infinite alternate}
.pump{animation:pump 3s ease-in-out infinite}
.strike{transform:rotate(38deg);animation:strike ${strike}s cubic-bezier(.5,0,.9,.5) infinite}
.strikeflash{opacity:0;animation:sflash ${strike}s linear infinite}
.sx{animation:sx ${strike * 2}s linear infinite}
.sy{opacity:0;animation:sy ${strike * 2}s linear infinite}
.ember{animation:ember 10s linear infinite}
.roll{animation:roll 8s ease-in-out infinite alternate}
.ingot{animation:ingot 8s ease-out forwards}
.cool-glow{opacity:.35;animation:coolglow 8s ease-out forwards}
.glint{opacity:.5;animation:tw 2.4s ease-in-out infinite}
@keyframes tw{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes drift{from{transform:translateX(-30px)}to{transform:translateX(40px)}}
@keyframes sway{from{transform:rotate(-1.5deg)}to{transform:rotate(2deg)}}
@keyframes fall{from{transform:translate(0,-150px)}to{transform:translate(40px,200px)}}
@keyframes spin{from{transform:rotate(-40deg)}to{transform:rotate(50deg)}}
@keyframes snowfall{from{transform:translate(0,-240px)}to{transform:translate(20px,0)}}
@keyframes swing{from{transform:rotate(-2deg)}to{transform:rotate(2deg)}}
@keyframes flick{from{transform:scale(.85,.8)}to{transform:scale(1.05,1.15)}}
@keyframes glow{from{opacity:.75}to{opacity:1}}
@keyframes breathe{from{opacity:.6}to{opacity:1}}
@keyframes blow{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes coal{from{opacity:.45}to{opacity:1}}
@keyframes flame{from{transform:scale(.9,.85) skewX(-4deg)}to{transform:scale(1.06,1.12) skewX(4deg)}}
@keyframes pump{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.55)}}
@keyframes strike{0%{transform:rotate(38deg)}55%{transform:rotate(44deg)}70%{transform:rotate(0deg)}74%{transform:rotate(-2deg)}100%{transform:rotate(38deg)}}
@keyframes sflash{0%,69%{opacity:0}71%{opacity:1}90%,100%{opacity:0}}
@keyframes sx{0%{transform:translateX(0)}60%,100%{transform:translateX(var(--dx))}}
@keyframes sy{0%{opacity:1;transform:translateY(0);animation-timing-function:cubic-bezier(.2,.7,.4,1)}22%{transform:translateY(var(--up));animation-timing-function:cubic-bezier(.6,0,.9,.6)}45%{opacity:.8}60%{opacity:0;transform:translateY(var(--dn))}100%{opacity:0;transform:translateY(var(--dn))}}
@keyframes ember{0%{transform:translate(0,0);opacity:0}10%{opacity:1}80%{opacity:.7}100%{transform:translate(var(--drift),var(--rise));opacity:0}}
@keyframes roll{from{transform:translate(20px,10px) scale(.92)}to{transform:translate(-70px,-30px) scale(1.12)}}
@keyframes ingot{0%{fill:#fffbe8}25%{fill:#ffe9a8}55%{fill:#ffc04a}100%{fill:#e8a83a}}
@keyframes coolglow{0%{opacity:1}100%{opacity:.35}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`
}

function forgeScene(ctx: SceneCtx): string {
  const p = PALETTES[ctx.phase]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>${style(ctx)}</style><defs>${defs(ctx, p)}</defs>
<rect width="1600" height="1000" fill="url(#brick)"/><rect width="1600" height="1000" fill="url(#room)" opacity=".88"/>
${windowLight(ctx, p)}
${windowView(ctx, p)}
${tools(p)}
${beamAndLanterns(ctx, p)}
${hearth(ctx, p)}
<rect x="0" y="986" width="1600" height="14" fill="${p.wallDeep}"/>
${embers(ctx)}
${anvil(ctx, p)}
${hammer(ctx, p)}
${strikeSparks(ctx)}
${bellows(ctx, p)}
${smoke(ctx)}
<rect width="1600" height="1000" fill="url(#calm)"/><rect width="1600" height="1000" fill="url(#grain)"/>
</svg>`
}

export const theme: LivingTheme = {
  id: 'forge',
  title: 'Forge',
  blurb: "A blacksmith's corner: a brick hearth and an anvil in the lower right, lanterns on a beam, a small window to the sky.",
  reacts: 'Embers breathe when idle, the bellows pump while thinking, the hammer strikes and sparks fly while working, a lantern lights on the beam per subagent, the fire chokes on smoke after an error, an ingot cools from white to gold on success; the window shows stars by night and pale light by day, frost in winter and falling leaves in autumn.',
  window: 'dark',
  glass: ctx => ({ blur: 14, tint: ctx.phase === 'day' ? '#1e130f' : '#140c0a', opacity: 0.36 }),
  scene: forgeScene,
}
