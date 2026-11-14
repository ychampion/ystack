// Reef Aquarium: a deep reef at night, seen from the side through the glass. Coral grows up the left edge and into the two
// bottom corners: branching coral, fans, braille-dotted brain coral and anemones that glow. Kelp stands in the corners.
// The middle of the water stays open for the conversation; everything that moves lives at the edges.
// The agent's activity changes the water: drifting fish when idle, a slow current through the kelp while thinking, bubble
// streams and darting fish while working, a glowing fish per subagent, red silt when a tool fails, a bloom of jellyfish on success.
// Pure string building: no DOM, no randomness, no clock. The same moment always gives the same picture.
import type { LivingTheme, Phase, SceneCtx } from './contract'

type Pal = {
  top: string
  mid: string
  deep: string
  shaft: string
  shaftPeak: number
  coral: string
  coralFar: string
  rim: string
  fish: string
  sand: string
  speck: string
}

const PALETTES: Record<Phase, Pal> = {
  night: { top: '#0b1a3e', mid: '#07112b', deep: '#030716', shaft: '#a9c8ff', shaftPeak: 0.16, coral: '#040a19', coralFar: '#0a1634', rim: '#1d3466', fish: '#26407a', sand: '#2a3d6e', speck: '#9fb8ff' },
  day: { top: '#0f4a4e', mid: '#0a2f36', deep: '#04161b', shaft: '#dcffd6', shaftPeak: 0.2, coral: '#04171a', coralFar: '#0b2e30', rim: '#1f5650', fish: '#3a7a70', sand: '#3c6a5c', speck: '#c8ffe6' },
  dawn: { top: '#2a2f5e', mid: '#121e3e', deep: '#060b1c', shaft: '#ffc9b4', shaftPeak: 0.16, coral: '#060a1c', coralFar: '#141c3e', rim: '#3a3a70', fish: '#4a4a86', sand: '#4a4470', speck: '#ffd6e6' },
  dusk: { top: '#26234e', mid: '#111634', deep: '#050817', shaft: '#ffb47a', shaftPeak: 0.15, coral: '#050816', coralFar: '#151838', rim: '#3c3266', fish: '#4a3c76', sand: '#4a3a5c', speck: '#ffd2a8' },
}

const GLOW = ['#4fe6cf', '#c77dff', '#ff8fb1']
const AGENT_HUES = ['#5ff5d8', '#ff8fbe', '#ffd36b', '#b49bff', '#9dff7a']

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

function palette(ctx: SceneCtx): Pal {
  const p = { ...PALETTES[ctx.phase] }
  if (ctx.season === 'winter') {
    for (const k of ['top', 'mid', 'deep', 'coralFar', 'rim', 'fish', 'sand'] as const) p[k] = mix(p[k], '#1c3654', 0.35)
    p.shaft = mix(p.shaft, '#eef6ff', 0.6)
    p.speck = '#e8f2ff'
  }
  if (ctx.season === 'summer') p.shaft = mix(p.shaft, '#ffe6a0', 0.45)
  return p
}

/** The middle of the window is for words: 0 there, 1 at the edges. */
function edge(x: number, y: number): number {
  const dx = Math.abs(x - 800) / 800
  const side = Math.min(1, Math.max(0, (dx - 0.42) / 0.22))
  const top = Math.min(1, Math.max(0, (90 - y) / 60))
  return Math.max(side, top * 0.6)
}

function soft(id: string, colour: string, peak: number): string {
  return `<radialGradient id="${id}"><stop offset="0" stop-color="${colour}" stop-opacity="${peak}"/><stop offset=".45" stop-color="${colour}" stop-opacity="${n(peak * 0.35)}"/><stop offset="1" stop-color="${colour}" stop-opacity="0"/></radialGradient>`
}

/** Square specks in one path. */
function specks(points: [number, number, number][]): string {
  return points.map(([x, y, s]) => `M${n(x)} ${n(y)}h${s}v${s}h-${s}z`).join('')
}

// ---------------------------------------------------------------- light from above

function lightShafts(ctx: SceneCtx, p: Pal): string {
  const sun = ctx.phase === 'day'
  // Night: a few narrow moon shafts slanting in from the top right. Day: broad sun rays fanning from the top.
  const shafts: [number, number, number, number][] = sun
    ? [[60, 300, -16, 1], [330, 200, -9, 0.7], [1150, 260, 10, 0.75], [1390, 320, 15, 1], [700, 220, 2, 0.28]]
    : [[150, 120, 18, 0.9], [330, 70, 18, 0.6], [1250, 140, 18, 1], [1440, 90, 18, 0.75]]
  let out = ''
  shafts.forEach(([x, w, skew, strength], i) => {
    out += `<g transform="translate(${x} 0) skewX(${skew})"><rect class="shaft" style="animation-duration:${30 + i * 7}s;animation-delay:-${i * 6}s" x="0" y="-20" width="${w}" height="${sun ? 980 : 900}" fill="url(#ray)" opacity="${strength}"/></g>`
  })
  let surface = ''
  if (sun || ctx.phase === 'dawn') {
    // The surface seen from below: rows of bright wavy dashes that slide, the light the shafts come from.
    let d = ''
    for (let row = 0; row < 4; row += 1) {
      for (let x = -80; x < 1700; x += 44) {
        const y = 10 + row * 16 + Math.sin(x / 70 + row) * 5
        if (hash(x, row, 4) < 0.35) continue
        d += `M${n(x)} ${n(y)}q11 -${4 - row} 22 0`
      }
    }
    surface = `<path class="ripple" d="${d}" stroke="${p.shaft}" stroke-opacity="${sun ? 0.22 : 0.12}" stroke-width="2" fill="none" stroke-linecap="round"/>`
  }
  const moon = sun ? `<ellipse cx="800" cy="-80" rx="900" ry="260" fill="url(#sunglow)"/>` : `<ellipse cx="1350" cy="-60" rx="520" ry="240" fill="url(#sunglow)"/>`
  return `${moon}<g mask="url(#fade)">${out}</g>${surface}`
}

// ---------------------------------------------------------------- drifting particles

function marineSnow(ctx: SceneCtx, p: Pal): string {
  const groups = ['', '', '']
  for (let i = 0; i < 170; i += 1) {
    const x = hash(i, 1, 9) * 1600
    const y = hash(i, 2, 9) * 1000
    if (hash(i, 3, 9) > edge(x, y) * 0.9 + 0.1) continue
    const s = hash(i, 4, 9) < 0.2 ? 3 : 2
    groups[i % 3] += specks([[x, y, s]])
  }
  const fall = ctx.activity === 'error' ? 0.35 : 0.5
  return groups
    .map((d, i) => `<g class="snow" style="animation-duration:${70 + i * 17}s;animation-delay:-${i * 23}s"><path class="tw" style="animation-duration:${8 + i * 3}s" d="${d}" fill="${p.speck}" opacity="${n(fall - i * 0.1)}"/></g>`)
    .join('')
}

// ---------------------------------------------------------------- the reef

function kelp(x: number, base: number, height: number, seed: number, colour: string): string {
  let spine = `M${x} ${base}`
  let leaves = ''
  const steps = Math.round(height / 26)
  for (let i = 1; i <= steps; i += 1) {
    const y = base - i * 26
    const cx = x + Math.sin(i * 0.55 + seed) * 12
    spine += `L${n(cx)} ${n(y)}`
    if (i > 1 && i < steps) {
      const side = i % 2 === 0 ? 1 : -1
      const len = 18 + hash(seed, i, 2) * 16
      leaves += `M${n(cx)} ${n(y)}q${n(side * len * 0.6)} -${n(len * 0.2)} ${n(side * len)} -${n(len * 0.9)}q-${n(side * len * 0.2)} ${n(len * 0.5)} -${n(side * len)} ${n(len * 0.9)}z`
    }
  }
  const delay = n(hash(seed, 7, 3) * 8)
  return `<g class="kelp" style="transform-origin:${x}px ${base}px;animation-delay:-${delay}s"><path d="${spine}" stroke="${colour}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="${leaves}" fill="${colour}"/></g>`
}

/** Branching coral grown by a deterministic recursion: thick limbs, thin twigs, a polyp at each tip. */
function branchCoral(x: number, y: number, size: number, seed: number, fill: string, tipColour: string, tipsOut: string[]): string {
  const widths = ['', '', '', '', '']
  const grow = (px: number, py: number, angle: number, len: number, depth: number, id: number): void => {
    const ex = px + Math.sin(angle) * len
    const ey = py - Math.cos(angle) * len
    const bend = (hash(seed, id, 5) - 0.5) * len * 0.5
    widths[depth] += `M${n(px)} ${n(py)}Q${n((px + ex) / 2 + bend)} ${n((py + ey) / 2)} ${n(ex)} ${n(ey)}`
    if (depth === 4 || len < 9) {
      tipsOut.push(`M${n(ex)} ${n(ey)}h0`)
      return
    }
    const forks = hash(seed, id, 6) < 0.35 ? 3 : 2
    for (let k = 0; k < forks; k += 1) {
      const spread = forks === 3 ? (k - 1) * 0.5 : (k - 0.5) * 0.75
      grow(ex, ey, angle + spread + (hash(seed, id * 3 + k, 7) - 0.5) * 0.4, len * (0.68 + hash(seed, id * 5 + k, 8) * 0.18), depth + 1, id * 3 + k + 1)
    }
  }
  grow(x, y, (hash(seed, 0, 1) - 0.5) * 0.3, size, 0, 1)
  void tipColour
  return widths.map((d, i) => (d ? `<path d="${d}" stroke="${fill}" stroke-width="${[13, 9, 6, 4, 2.6][i]}" fill="none" stroke-linecap="round"/>` : '')).join('')
}

/** A sea fan: ribs fanning out from a stub, laced with arcs. */
function seaFan(x: number, y: number, w: number, h: number, seed: number, colour: string): string {
  let d = ''
  const ribs = 11
  for (let i = 0; i < ribs; i += 1) {
    const a = -1.1 + (2.2 * i) / (ribs - 1) + (hash(seed, i, 2) - 0.5) * 0.12
    const r = h * (0.75 + hash(seed, i, 3) * 0.25)
    d += `M${x} ${y}Q${n(x + Math.sin(a) * r * 0.4)} ${n(y - r * 0.5)} ${n(x + Math.sin(a) * w)} ${n(y - Math.cos(a * 0.8) * r)}`
  }
  for (let k = 1; k <= 4; k += 1) {
    const r = (h * k) / 5
    d += `M${n(x - w * 0.18 * k)} ${n(y - r * 0.7)}Q${x} ${n(y - r * 1.25)} ${n(x + w * 0.18 * k)} ${n(y - r * 0.7)}`
  }
  return `<path d="${d}" stroke="${colour}" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".95"/>`
}

/** Brain coral: a dark mound whose skin is a braille field of raised dots in winding rows. */
function mound(x: number, y: number, rx: number, ry: number, seed: number, fill: string, dot: string): string {
  let d = ''
  for (let gy = y - ry + 6; gy < y; gy += 7) {
    for (let gx = x - rx + 4; gx < x + rx; gx += 6) {
      const u = (gx - x) / rx
      const v = (gy - y) / ry
      if (u * u + v * v > 0.86) continue
      if (Math.sin(gx / 9 + Math.sin(gy / 13 + seed) * 2.2) > 0.35) continue
      d += `M${gx} ${gy}h0`
    }
  }
  return `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}"/><path d="${d}" stroke="${dot}" stroke-width="2.6" stroke-linecap="round" opacity=".55"/>`
}

/** A glowing anemone: a squat foot and a crown of tentacles with lit tips. When the water turns bad it pulls them in. */
function anemone(x: number, y: number, size: number, colour: string, seed: number, foot: string, retract: boolean): string {
  let tentacles = ''
  let tips = ''
  const count = 13
  for (let i = 0; i < count; i += 1) {
    const a = -1.25 + (2.5 * i) / (count - 1)
    const len = size * (0.75 + hash(seed, i, 4) * 0.45)
    const tx = x + Math.sin(a) * len
    const ty = y - size * 0.25 - Math.cos(a) * len
    tentacles += `M${n(x + Math.sin(a) * size * 0.25)} ${n(y - size * 0.2)}Q${n(x + Math.sin(a) * len * 0.4 + (hash(seed, i, 5) - 0.5) * 10)} ${n(y - len * 0.6)} ${n(tx)} ${n(ty)}`
    tips += `M${n(tx)} ${n(ty)}h0`
  }
  const halo = `<ellipse class="breathe" style="animation-delay:-${n(hash(seed, 1, 1) * 6)}s" cx="${x}" cy="${n(y - size * 0.6)}" rx="${n(size * 2.2)}" ry="${n(size * 1.8)}" fill="url(#g${GLOW.indexOf(colour)})" opacity="${retract ? 0.25 : 1}"/>`
  const crown = `<g class="${retract ? 'shrink' : 'ten'}" style="transform-origin:${x}px ${y}px;animation-delay:-${n(hash(seed, 2, 1) * 5)}s"><path d="${tentacles}" stroke="${colour}" stroke-opacity=".55" stroke-width="3" fill="none" stroke-linecap="round"/><path class="tw" style="animation-duration:${5 + (seed % 4)}s" d="${tips}" stroke="${mix(colour, '#ffffff', 0.45)}" stroke-width="5" stroke-linecap="round"/></g>`
  return `${halo}${crown}<ellipse cx="${x}" cy="${y}" rx="${n(size * 0.42)}" ry="${n(size * 0.22)}" fill="${foot}"/>`
}

function reef(ctx: SceneCtx, p: Pal): string {
  const retract = ctx.activity === 'error'
  const tipsOut: string[] = []
  const coralFill = p.coral
  // Far reef: hazy, lighter shapes behind the near coral, giving the corners depth.
  const farTips: string[] = []
  const far =
    `<g opacity=".8">` +
    branchCoral(250, 760, 60, 51, p.coralFar, '', farTips) +
    branchCoral(360, 860, 48, 52, p.coralFar, '', farTips) +
    branchCoral(1250, 800, 58, 53, p.coralFar, '', farTips) +
    branchCoral(1500, 680, 66, 54, p.coralFar, '', farTips) +
    seaFan(330, 900, 70, 130, 55, p.coralFar) +
    seaFan(1210, 900, 60, 120, 56, p.coralFar) +
    `<path d="M150 1000C180 900 250 840 330 830C400 840 450 930 470 1000ZM1130 1000C1160 920 1220 860 1300 850C1380 840 1430 760 1520 720C1570 700 1600 700 1600 700V1000Z" fill="${p.coralFar}"/></g>`
  // Near rock: the ground the coral stands on, the left wall rising up the edge.
  const rock =
    `<path d="M0 360 C30 380 60 430 70 480 C110 520 120 600 150 650 C190 700 230 760 280 800 C330 830 380 880 400 930 C420 960 430 985 440 1000 L0 1000Z" fill="${coralFill}"/>` +
    `<path d="M1600 720 C1560 740 1520 760 1480 800 C1420 810 1360 850 1300 880 C1250 900 1210 940 1190 1000 L1600 1000Z" fill="${coralFill}"/>`
  const kelps =
    kelp(26, 700, 520, 1, mix(p.rim, '#3a8a5c', 0.55)) +
    kelp(70, 760, 380, 2, mix(p.rim, '#2f7a50', 0.45)) +
    kelp(1560, 820, 420, 3, mix(p.rim, '#3a8a5c', 0.55)) +
    kelp(1520, 860, 300, 4, mix(p.rim, '#2f7a50', 0.45)) +
    kelp(1236, 940, 200, 5, mix(p.rim, '#3a8a5c', 0.25))
  const corals =
    branchCoral(110, 640, 70, 11, coralFill, GLOW[0] ?? '', tipsOut) +
    branchCoral(250, 830, 64, 12, coralFill, GLOW[1] ?? '', tipsOut) +
    branchCoral(1430, 830, 72, 13, coralFill, GLOW[0] ?? '', tipsOut) +
    branchCoral(1330, 900, 52, 14, coralFill, GLOW[1] ?? '', tipsOut) +
    seaFan(48, 480, 64, 120, 21, mix(coralFill, p.rim, 0.55)) +
    seaFan(1500, 760, 80, 150, 22, mix(coralFill, p.rim, 0.55)) +
    mound(360, 960, 70, 44, 31, coralFill, p.rim) +
    mound(1540, 940, 80, 50, 32, coralFill, p.rim) +
    mound(140, 1000, 120, 70, 33, coralFill, p.rim)
  const polyps = `<path class="tw" style="animation-duration:9s" d="${tipsOut.join('')}" stroke="${mix(GLOW[2] ?? '', p.rim, 0.25)}" stroke-width="5" stroke-linecap="round" opacity="${retract ? 0.3 : 0.8}"/>`
  const anemones =
    anemone(170, 720, 34, GLOW[0] ?? '', 41, coralFill, retract) +
    anemone(60, 870, 40, GLOW[1] ?? '', 42, coralFill, retract) +
    anemone(310, 900, 26, GLOW[2] ?? '', 43, coralFill, retract) +
    anemone(1280, 930, 30, GLOW[0] ?? '', 44, coralFill, retract) +
    anemone(1390, 880, 38, GLOW[2] ?? '', 45, coralFill, retract) +
    anemone(1585, 860, 28, GLOW[1] ?? '', 46, coralFill, retract) +
    anemone(28, 560, 24, GLOW[0] ?? '', 47, coralFill, retract)
  // Sand: a dithered band of dots in the corners only.
  let sand = ''
  for (let x = 0; x < 1600; x += 6) {
    for (let y = 968; y < 1000; y += 6) {
      if (x > 470 && x < 1130) continue
      if (hash(x, y, 77) < 0.5 - (y - 968) / 90) continue
      sand += `M${x} ${y}h0`
    }
  }
  // Pitted rock: a braille scatter of dots over the near rock, lit from above, so it reads as stone, not a cut-out.
  let pits = ''
  for (let gy = 380; gy < 1000; gy += 9) {
    for (let gx = 0; gx < 1600; gx += 8) {
      if (gx > 440 && gx < 1190) continue
      const leftTop = gx < 150 ? 360 + gx * 1.93 : 650 + (gx - 150) * 1.2
      const rightTop = gx < 1300 ? 1000 - (gx - 1190) * 1.09 : gx < 1480 ? 880 - (gx - 1300) * 0.44 : 800 - (gx - 1480) * 0.67
      const inLeft = gx < 440 && gy > leftTop + 8
      const inRight = gx > 1190 && gy > rightTop + 8
      if (!inLeft && !inRight) continue
      if (hash(gx, gy, 88) > 0.16) continue
      pits += `M${gx} ${gy}h0`
    }
  }
  return `${far}${kelps}${rock}<path d="${pits}" stroke="${p.rim}" stroke-width="2.4" stroke-linecap="round" opacity=".55"/><path d="${sand}" stroke="${p.sand}" stroke-width="2.2" stroke-linecap="round" opacity=".5"/>${corals}${polyps}${anemones}`
}

// ---------------------------------------------------------------- life

const FISH = 'M-15 0C-8-9 6-9 13-2C15 0 15 0 13 2C6 9-8 9-15 0ZM-13 0L-24-8L-21 0L-24 8Z'

/** The everyday fish: dim silhouettes drifting on slow laps at the edges. */
function fishes(ctx: SceneCtx, p: Pal): string {
  const homes: [number, number, number, number][] = [
    [1260, 250, 1, 150],
    [250, 200, 0.85, 110],
    [1360, 560, 1.15, 120],
    [300, 470, 0.7, 70],
    [1220, 400, 0.8, 140],
    [380, 330, 0.9, 60],
    [1450, 140, 0.75, 90],
  ]
  // Where each fish hides when the water turns red: tucked against the coral, nose in.
  const hides: [number, number][] = [[200, 760], [90, 610], [1360, 860], [300, 860], [1470, 800], [130, 820], [1540, 870]]
  const count = ctx.activity === 'working' ? 7 : ctx.activity === 'idle' || ctx.activity === 'error' ? 3 : 4
  const body = mix(p.fish, p.speck, 0.15)
  let out = ''
  for (let i = 0; i < count; i += 1) {
    const [hx, hy, scale, range] = homes[i] ?? [0, 0, 1, 0]
    if (ctx.activity === 'error') {
      const [x, y] = hides[i] ?? [0, 0]
      out += `<g transform="translate(${x} ${y}) scale(${n(scale * 0.8)})"><g class="tremble" style="animation-delay:-${i}s"><path d="${FISH}" fill="${body}" opacity=".45"/></g></g>`
      continue
    }
    const fast = ctx.activity === 'working' && i >= 2
    const anim = fast ? 'dart' : 'swim'
    const secs = fast ? 7 + (i % 3) * 2 : 34 + i * 9
    out += `<g transform="translate(${hx} ${hy}) scale(${scale})"><g class="${anim}" style="--w:${fast ? range * 1.6 : range}px;animation-duration:${secs}s;animation-delay:-${n(hash(i, 3, 2) * secs)}s"><g class="bob" style="animation-delay:-${i}s"><path d="${FISH}" fill="${body}"/><path d="M-6-5C0-7 6-6 11-2" stroke="${mix(p.speck, body, 0.4)}" stroke-width="1.4" fill="none" opacity=".6"/><circle cx="7" cy="-1.5" r="1.6" fill="${p.deep}"/></g></g></g>`
  }
  return out
}

/** One glowing fish per subagent, each its own hue, swimming laps in the side water. */
function agentFish(ctx: SceneCtx): string {
  const lanes: [number, number, number, number, number][] = [
    [1215, 205, 300, 50, 19],
    [235, 150, 170, 40, 23],
    [1235, 455, 270, -40, 21],
    [250, 395, 150, 30, 26],
    [1205, 640, 310, 30, 24],
  ]
  let out = ''
  for (let i = 0; i < ctx.agents; i += 1) {
    const [x, y, w, h, secs] = lanes[i] ?? [0, 0, 0, 0, 20]
    const hue = AGENT_HUES[i] ?? '#ffffff'
    const wake = `<path class="tw" style="animation-duration:2s" d="M-30 -1h3v3h-3zM-40 2h2v2h-2zM-49 -2h2v2h-2z" fill="${hue}" opacity=".7"/>`
    out += `<g transform="translate(${x} ${y})"><g class="lap" style="--w:${w}px;--h:${h}px;animation-duration:${secs}s;animation-delay:-${n(i * 4.3)}s"><g class="bob" style="animation-delay:-${i * 0.7}s"><circle r="44" fill="url(#a${i})"/>${wake}<path d="${FISH}" fill="${hue}"/><path d="M-9-3C-2-6 6-5 11-1" stroke="#ffffff" stroke-opacity=".7" stroke-width="1.6" fill="none"/><circle cx="7" cy="-1.5" r="1.7" fill="#0a1020"/></g></g></g>`
  }
  return out
}

/** Rising bubbles from the reef. How many depends on how hard the agent is working. */
function bubbles(ctx: SceneCtx, p: Pal): string {
  const plan: Record<string, [number, number]> = { idle: [2, 2], thinking: [2, 4], working: [4, 10], agents: [3, 5], error: [0, 0], success: [3, 3] }
  const [sources, per] = plan[ctx.activity] ?? [0, 0]
  const vents: [number, number][] = [[170, 700], [1395, 850], [60, 840], [1290, 910]]
  const secs = ctx.activity === 'working' ? 9 : 17
  let out = ''
  for (let s = 0; s < sources; s += 1) {
    const [vx, vy] = vents[s] ?? [0, 0]
    const height = vy + 40
    for (let b = 0; b < per; b += 1) {
      const r = 2.5 + hash(s, b, 8) * (ctx.activity === 'working' ? 6 : 4)
      const delay = (b / per) * secs + hash(s, b, 9) * 1.5
      const rest = n(-(b / per) * height * 0.8)
      out += `<g class="rise" style="--h:-${height}px;transform:translateY(${rest}px);animation-duration:${secs}s;animation-delay:-${n(delay)}s"><g class="wob" style="animation-delay:-${n(hash(s, b, 3) * 3)}s"><circle cx="${n(vx + (hash(s, b, 4) - 0.5) * 8)}" cy="${vy}" r="${n(r)}" fill="${p.speck}" fill-opacity=".08" stroke="${p.speck}" stroke-opacity=".55" stroke-width="1.3"/><circle cx="${n(vx - r * 0.35)}" cy="${n(vy - r * 0.35)}" r="${n(r * 0.28)}" fill="#ffffff" opacity=".6"/></g></g>`
    }
  }
  return out
}

/** Thinking: a slow current made visible, long faint streaks gliding sideways at the edges. */
function current(ctx: SceneCtx, p: Pal): string {
  if (ctx.activity !== 'thinking') return ''
  const groups = ['', '', '']
  for (let i = 0; i < 48; i += 1) {
    const left = i % 2 === 0
    const x = left ? hash(i, 1, 33) * 360 : 1220 + hash(i, 1, 33) * 380
    const y = 90 + hash(i, 2, 33) * 700
    const len = 50 + hash(i, 3, 33) * 110
    groups[i % 3] += `M${n(x)} ${n(y)}q${n(len / 2)} -7 ${n(len)} 0`
  }
  return groups
    .map((d, i) => `<path class="current" style="animation-duration:${8 + i * 2.5}s;animation-delay:-${i * 3}s" d="${d}" stroke="${p.speck}" stroke-opacity=".32" stroke-width="1.6" fill="none" stroke-linecap="round"/>`)
    .join('')
}

/** Error: red silt boils up from the bottom and clouds the water. */
function silt(ctx: SceneCtx): string {
  if (ctx.activity !== 'error') return ''
  const clouds: [number, number, number, number][] = [[180, 880, 420, 260], [1420, 860, 440, 280], [60, 520, 260, 300], [1560, 420, 240, 280], [800, 1040, 600, 140]]
  let out = '<rect width="1600" height="1000" fill="#2a0707" opacity=".32"/>'
  clouds.forEach(([x, y, rx, ry], i) => {
    out += `<ellipse class="billow" style="transform-origin:${x}px ${y}px;animation-delay:-${i * 1.7}s" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#silt)"/>`
  })
  const pts: [number, number, number][] = []
  for (let i = 0; i < 260; i += 1) {
    const x = hash(i, 5, 61) * 1600
    const y = 300 + Math.pow(hash(i, 6, 61), 0.6) * 700
    if (hash(i, 7, 61) > edge(x, y) * 0.85 + 0.15) continue
    pts.push([x, y, hash(i, 8, 61) < 0.3 ? 3 : 2])
  }
  return `${out}<g class="churn"><path class="tw" style="animation-duration:3s" d="${specks(pts)}" fill="#d0533e" opacity=".6"/></g>`
}

/** Success: a bloom of jellyfish pulsing up the sides. */
function jellies(ctx: SceneCtx): string {
  if (ctx.activity !== 'success') return ''
  const spots: [number, number, number, string][] = [
    [120, 820, 1, '#ff9fd8'], [270, 720, 0.75, '#9fe8ff'], [380, 900, 0.6, '#c7a6ff'],
    [1250, 860, 0.8, '#9fe8ff'], [1380, 740, 1.05, '#ff9fd8'], [1520, 900, 0.7, '#c7a6ff'], [1460, 620, 0.55, '#ffd6a0'],
  ]
  let out = '<ellipse class="breathe" cx="200" cy="900" rx="420" ry="340" fill="url(#bloom)"/><ellipse class="breathe" style="animation-delay:-2s" cx="1420" cy="880" rx="440" ry="360" fill="url(#bloom)"/>'
  spots.forEach(([x, y, s, c], i) => {
    const tent = `M-14 0q-4 20 2 40M-5 1q4 24-2 52M5 1q-4 24 2 52M14 0q4 20-2 40`
    out += `<g transform="translate(${x} ${y}) scale(${s})"><g class="up" style="animation-delay:-${n(i * 1.3)}s"><g class="pulse" style="animation-delay:-${n(i * 0.4)}s"><circle cy="-6" r="40" fill="url(#jg)"/><path d="${tent}" stroke="${c}" stroke-opacity=".6" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M-22 2C-24-22-10-30 0-30C10-30 24-22 22 2C12-3-12-3-22 2Z" fill="${c}" fill-opacity=".55" stroke="${mix(c, '#ffffff', 0.5)}" stroke-width="1.6"/><path d="M-12-6C-10-18 10-18 12-6" stroke="#ffffff" stroke-opacity=".5" stroke-width="1.4" fill="none"/></g></g></g>`
  })
  return out
}

/** The season's drifters. */
function seasonal(ctx: SceneCtx, p: Pal): string {
  const pts: [number, number, number][] = []
  const near = (count: number, salt: number, size: number, top: number): void => {
    for (let i = 0; i < count; i += 1) {
      const x = hash(i, 1, salt) * 1600
      const y = top + hash(i, 2, salt) * (1000 - top)
      if (hash(i, 3, salt) > edge(x, y)) continue
      pts.push([x, y, hash(i, 4, salt) < 0.3 ? size + 1 : size])
    }
  }
  if (ctx.season === 'spring') {
    // Coral spawning: pink and cream bundles lifting slowly off the reef in plumes above the coral.
    for (let i = 0; i < 240; i += 1) {
      const plume = i % 4
      const [px, py] = ([[160, 700], [300, 860], [1400, 830], [1300, 900]][plume] ?? [0, 0]) as [number, number]
      const up = Math.pow(hash(i, 1, 71), 0.7) * 420
      pts.push([px + (hash(i, 2, 71) - 0.5) * (60 + up * 0.5), py - up, hash(i, 3, 71) < 0.3 ? 4 : 3])
    }
    const half = Math.floor(pts.length / 2)
    return `<g class="spawn"><path class="tw" style="animation-duration:6s" d="${specks(pts.slice(0, half))}" fill="#ffc6dc" opacity=".8"/><path class="tw" style="animation-duration:8s;animation-delay:-3s" d="${specks(pts.slice(half))}" fill="#fff0d8" opacity=".7"/></g>`
  }
  if (ctx.season === 'summer') {
    // Warm water: a golden haze from the surface, warm motes, and an amber cast pooled in the corners.
    near(90, 72, 2, 60)
    return `<ellipse class="breathe" cx="800" cy="-60" rx="1100" ry="420" fill="url(#warm)"/><ellipse cx="0" cy="1000" rx="520" ry="380" fill="url(#warm)"/><ellipse cx="1600" cy="1000" rx="520" ry="380" fill="url(#warm)"/><g class="snow" style="animation-duration:90s"><path class="tw" style="animation-duration:7s" d="${specks(pts)}" fill="#ffe2a0" opacity=".8"/></g>`
  }
  if (ctx.season === 'autumn') {
    // Plankton bloom: green-gold specks that glow in slow waves, the brightest with a halo.
    near(300, 73, 2, 120)
    const half = Math.floor(pts.length / 2)
    let halos = ''
    pts.filter((_, i) => i % 9 === 0).forEach(([x, y]) => {
      halos += `<circle cx="${n(x)}" cy="${n(y)}" r="9" fill="url(#plankton)"/>`
    })
    return `<g class="tw" style="animation-duration:6s">${halos}</g><path class="tw" style="animation-duration:5s" d="${specks(pts.slice(0, half))}" fill="#b6ff8a" opacity=".85"/><path class="tw" style="animation-duration:7s;animation-delay:-3s" d="${specks(pts.slice(half))}" fill="#ffd27a" opacity=".75"/>`
  }
  // Winter: big soft flakes of sea snow, falling slowly through the cold water.
  near(90, 74, 3, 0)
  return `<g class="snow" style="animation-duration:60s"><path d="${specks(pts)}" fill="${p.speck}" opacity=".55"/></g>`
}

function defs(ctx: SceneCtx, p: Pal): string {
  const glows = GLOW.map((c, i) => soft(`g${i}`, c, 0.26)).join('')
  const agents = AGENT_HUES.map((c, i) => soft(`a${i}`, c, 0.42)).join('')
  let grain = ''
  for (let i = 0; i < 140; i += 1) grain += `M${Math.floor(hash(i, 1, 13) * 48) * 2} ${Math.floor(hash(i, 2, 13) * 48) * 2}h2v2h-2z`
  return `<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.top}"/><stop offset=".5" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.deep}"/></linearGradient>
<linearGradient id="ray" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.shaft}" stop-opacity="0"/><stop offset=".5" stop-color="${p.shaft}" stop-opacity="${p.shaftPeak}"/><stop offset="1" stop-color="${p.shaft}" stop-opacity="0"/></linearGradient>
<linearGradient id="down" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".9" stop-color="#000"/></linearGradient>
<mask id="fade" maskUnits="userSpaceOnUse" x="-600" y="-40" width="2800" height="1100"><rect x="-600" y="-40" width="2800" height="1100" fill="url(#down)"/></mask>
<radialGradient id="calm" cx=".5" cy=".5" r=".55"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset=".7" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
${soft('sunglow', p.shaft, ctx.phase === 'day' ? 0.22 : 0.14)}${soft('warm', '#ffcf7a', 0.2)}${soft('plankton', '#c8ff8a', 0.45)}${soft('silt', '#9a3222', 0.6)}${soft('bloom', '#d08cff', 0.22)}${soft('jg', '#ffd0f0', 0.3)}${glows}${agents}
<pattern id="grain" width="96" height="96" patternUnits="userSpaceOnUse"><path d="${grain}" fill="#000" fill-opacity=".14"/></pattern>`
}

const STYLE = (ctx: SceneCtx): string => {
  const sway: Record<string, [number, number, number]> = { idle: [-2, 2.5, 9], thinking: [-1, 7, 7], working: [-4, 4, 4], agents: [-3, 3, 6], error: [-1, 1, 3], success: [-3, 3, 6] }
  const [a, b, s] = sway[ctx.activity] ?? [-2, 2, 9]
  return `.shaft{opacity:.85;animation:shaft 30s ease-in-out infinite alternate}
.ripple{animation:ripple 14s ease-in-out infinite alternate}
.snow{animation:snow 80s linear infinite}
.spawn{animation:spawn 70s linear infinite}
.tw{animation:tw 8s ease-in-out infinite}
.breathe{animation:breathe 8s ease-in-out infinite}
.kelp{animation:kelp ${s}s ease-in-out infinite alternate}
.ten{animation:ten ${s * 0.7}s ease-in-out infinite alternate}
.shrink{transform:scale(.62,.45)}
.swim{animation:swim 40s ease-in-out infinite}
.dart{animation:dart 8s cubic-bezier(.2,.9,.3,1) infinite}
.lap{animation:lap 20s linear infinite}
.bob{animation:bob 3s ease-in-out infinite}
.tremble{animation:tremble .7s ease-in-out infinite alternate}
.rise{animation:rise 12s linear infinite}
.wob{animation:wob 2.6s ease-in-out infinite alternate}
.current{animation:current 9s ease-in-out infinite}
.billow{animation:billow 6s ease-in-out infinite alternate}
.churn{animation:churn 7s ease-in-out infinite alternate}
.up{animation:up 9s ease-out infinite}
.pulse{animation:pulse 1.8s ease-in-out infinite}
@keyframes shaft{from{transform:translateX(-30px);opacity:.6}to{transform:translateX(30px);opacity:1}}
@keyframes ripple{from{transform:translateX(-40px)}to{transform:translateX(40px)}}
@keyframes snow{from{transform:translate(0,-40px)}to{transform:translate(30px,120px)}}
@keyframes spawn{from{transform:translate(0,40px)}to{transform:translate(-20px,-260px)}}
@keyframes tw{0%,100%{opacity:.3}50%{opacity:1}}
@keyframes breathe{0%,100%{opacity:.65}50%{opacity:1}}
@keyframes kelp{from{transform:rotate(${a}deg)}to{transform:rotate(${b}deg)}}
@keyframes ten{from{transform:skewX(${a * 2}deg)}to{transform:skewX(${b * 2}deg)}}
@keyframes swim{0%{transform:translateX(0) scaleX(1)}46%{transform:translateX(var(--w)) scaleX(1)}50%{transform:translateX(var(--w)) scaleX(-1)}96%{transform:translateX(0) scaleX(-1)}100%{transform:translateX(0) scaleX(1)}}
@keyframes dart{0%{transform:translate(0,0) scaleX(1)}12%{transform:translate(calc(var(--w)*.6),-14px) scaleX(1)}30%{transform:translate(calc(var(--w)*.7),-10px) scaleX(1)}38%{transform:translate(var(--w),8px) scaleX(1)}50%{transform:translate(var(--w),8px) scaleX(-1)}62%{transform:translate(calc(var(--w)*.35),20px) scaleX(-1)}80%{transform:translate(calc(var(--w)*.2),4px) scaleX(-1)}92%{transform:translate(0,0) scaleX(-1)}100%{transform:translate(0,0) scaleX(1)}}
@keyframes lap{0%{transform:translate(0,0) scaleX(1)}45%{transform:translate(var(--w),var(--h)) scaleX(1)}50%{transform:translate(var(--w),var(--h)) scaleX(-1)}95%{transform:translate(0,0) scaleX(-1)}100%{transform:translate(0,0) scaleX(1)}}
@keyframes bob{0%,100%{transform:translateY(-3px)}50%{transform:translateY(3px)}}
@keyframes tremble{from{transform:translateX(-1.5px)}to{transform:translateX(1.5px)}}
@keyframes rise{0%{transform:translateY(0);opacity:0}8%{opacity:1}85%{opacity:.9}100%{transform:translateY(var(--h));opacity:0}}
@keyframes wob{from{transform:translateX(-5px)}to{transform:translateX(5px)}}
@keyframes current{0%{transform:translateX(-60px);opacity:0}30%,70%{opacity:1}100%{transform:translateX(60px);opacity:0}}
@keyframes billow{from{transform:scale(.9) translateY(10px);opacity:.75}to{transform:scale(1.12) translateY(-20px);opacity:1}}
@keyframes churn{from{transform:translate(-14px,10px)}to{transform:translate(14px,-16px)}}
@keyframes up{0%{transform:translateY(0);opacity:1}80%{opacity:.85}100%{transform:translateY(-520px);opacity:0}}
@keyframes pulse{0%,100%{transform:scale(1,1)}40%{transform:scale(1.12,.86)}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`
}

function reefScene(ctx: SceneCtx): string {
  const p = palette(ctx)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>${STYLE(ctx)}</style><defs>${defs(ctx, p)}</defs>
<rect width="1600" height="1000" fill="url(#water)"/>
${lightShafts(ctx, p)}
${marineSnow(ctx, p)}
${seasonal(ctx, p)}
${current(ctx, p)}
${fishes(ctx, p)}
${reef(ctx, p)}
${bubbles(ctx, p)}
${agentFish(ctx)}
${jellies(ctx)}
${silt(ctx)}
<rect width="1600" height="1000" fill="url(#calm)"/><rect width="1600" height="1000" fill="url(#grain)"/>
</svg>`
}

export const theme: LivingTheme = {
  id: 'reef-aquarium',
  title: 'Reef Aquarium',
  blurb: 'A deep reef seen through the glass: coral, kelp and glowing anemones along the edges, fish drifting in open water.',
  reacts: 'Fish drift when idle, a current sways the kelp while thinking, bubbles rise and fish dart while working, one glowing fish swims laps per subagent, red silt clouds the water on an error, jellyfish bloom on success; moonlight by night, sun rays by day, and spawn, warm light, plankton glow or sea snow by season.',
  window: 'dark',
  glass: ctx => ({ blur: 14, tint: ctx.phase === 'day' ? '#082a2e' : '#081430', opacity: ctx.activity === 'error' ? 0.42 : 0.36 }),
  scene: reefScene,
}
