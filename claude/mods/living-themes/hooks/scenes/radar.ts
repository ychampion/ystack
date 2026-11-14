// Radar: a phosphor radar scope in the top right of a dark console, with a faint glyph grid over the whole screen and a
// small trace and readout in the bottom left. The middle stays an empty, dim grid for the conversation.
// The agent's activity drives the scope: a slow empty sweep when idle, a steady sweep with faint echoes while thinking,
// a fast sweep painting blips while working, one labelled contact (A1 to A5) tracked across the scope per subagent,
// a red contact and alert rings after an error, and every contact locking on with brackets and a green flash on success.
// The phosphor is amber at night and green by day; the season adds weather echoes (snow speckle, rain bands, bird flocks,
// storm cells). Pure string building: no DOM, no randomness, no clock.
import type { LivingTheme, Phase, SceneCtx } from './contract'

const CX = 1330
const CY = 270
const R = 220

const PHOSPHOR: Record<Phase, { ink: string; bright: string; ground: string; deep: string }> = {
  night: { ink: '#ffae2e', bright: '#ffe0a0', ground: '#0d0904', deep: '#060402' },
  dusk: { ink: '#ff9a3a', bright: '#ffd2a0', ground: '#0e0805', deep: '#060302' },
  dawn: { ink: '#d6e64a', bright: '#f2ffb0', ground: '#0a0b05', deep: '#040502' },
  day: { ink: '#3cff8e', bright: '#c8ffe0', ground: '#04100a', deep: '#020604' },
}
const ALERT = '#ff4a3a'
const LOCK = '#6aff9a'

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

/** A point on the scope: bearing in degrees clockwise from north, range 0 to 1. */
function polar(bearing: number, range: number): [number, number] {
  const a = (bearing * Math.PI) / 180
  return [CX + Math.sin(a) * R * range, CY - Math.cos(a) * R * range]
}

/** Sweep period in seconds for each activity. */
function sweepSeconds(ctx: SceneCtx): number {
  return { idle: 14, thinking: 7, working: 2.8, agents: 4.5, error: 3.5, success: 4.5 }[ctx.activity] ?? 10
}

/** Something on the scope lights when the sweep passes its bearing, then fades: its clock is set so the peak lands on the beam. */
function onBeam(bearing: number, period: number): string {
  const lead = period - ((((bearing % 360) + 360) % 360) / 360) * period
  return `animation-duration:${n(period)}s;animation-delay:-${n(lead % period)}s`
}

// ---------------------------------------------------------------- the console

function glyphGrid(p: { ink: string }): string {
  // A tile of faint marks: dots on a 24 grid, a plus every 96, and a scatter of tiny glyphs so it reads as a character display.
  let dots = ''
  for (let y = 0; y < 96; y += 24) for (let x = 0; x < 96; x += 24) if (x + y > 0) dots += `M${x + 0.5} ${y + 0.5}h0`
  const chars = '01:+-.=*/'
  let glyphs = ''
  for (let i = 0; i < 3; i += 1) {
    const gx = Math.floor(hash(i, 1, 5) * 4) * 24 + 12
    const gy = Math.floor(hash(i, 2, 5) * 4) * 24 + 16
    glyphs += `<text x="${gx}" y="${gy}">${chars[Math.floor(hash(i, 3, 5) * chars.length)]}</text>`
  }
  return `<pattern id="grid" width="96" height="96" patternUnits="userSpaceOnUse"><path d="${dots}" stroke="${p.ink}" stroke-width="1.6" stroke-linecap="round" opacity=".18"/><path d="M-4 0h8M0 -4v8M92 0h8M96 -4v8M-4 96h8M0 92v8M92 96h8M96 92v8" stroke="${p.ink}" stroke-width="1" opacity=".3"/><g fill="${p.ink}" opacity=".12" font-size="11">${glyphs}</g></pattern>`
}

function rulers(p: { ink: string }): string {
  // Edge rulers: ticks along the top and left edges, with coordinates every 200, like the frame of a plotting display.
  let ticks = ''
  let labels = ''
  for (let x = 0; x <= 1600; x += 40) ticks += `M${x} 0v${x % 200 === 0 ? 14 : 6}`
  for (let y = 0; y <= 1000; y += 40) ticks += `M0 ${y}h${y % 200 === 0 ? 14 : 6}`
  for (let x = 200; x < 1000; x += 200) labels += `<text x="${x + 4}" y="24">${String(x / 10).padStart(3, '0')}</text>`
  for (let y = 200; y < 1000; y += 200) labels += `<text x="18" y="${y + 4}">${String(y / 10).padStart(3, '0')}</text>`
  return `<path d="${ticks}" stroke="${p.ink}" stroke-width="1.2" opacity=".35"/><g fill="${p.ink}" opacity=".35" font-size="11">${labels}</g>`
}

function scopeBody(ctx: SceneCtx, p: { ink: string; bright: string; ground: string }): string {
  const ink = ctx.activity === 'error' ? mix(p.ink, ALERT, 0.35) : p.ink
  // Bezel, glass, range rings, cross hairs.
  let rings = ''
  for (let k = 1; k <= 4; k += 1) rings += `<circle cx="${CX}" cy="${CY}" r="${(R * k) / 4}" fill="none" stroke="${ink}" stroke-width="${k === 4 ? 1.6 : 1}" stroke-dasharray="${k === 4 ? 'none' : '2 5'}" opacity="${k === 4 ? 0.6 : 0.35}"/>`
  const cross = `<path d="M${CX - R} ${CY}h${R * 2}M${CX} ${CY - R}v${R * 2}M${n(CX - R * 0.707)} ${n(CY - R * 0.707)}L${n(CX + R * 0.707)} ${n(CY + R * 0.707)}M${n(CX - R * 0.707)} ${n(CY + R * 0.707)}L${n(CX + R * 0.707)} ${n(CY - R * 0.707)}" stroke="${ink}" stroke-width="1" opacity=".2"/>`
  // Bearing ticks round the rim: every 5 degrees, longer every 10, labelled every 30.
  let ticks = ''
  let labels = ''
  for (let b = 0; b < 360; b += 5) {
    const [x1, y1] = polar(b, 1)
    const [x2, y2] = polar(b, b % 30 === 0 ? 1.09 : b % 10 === 0 ? 1.06 : 1.035)
    ticks += `M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`
    if (b % 30 === 0) {
      const [lx, ly] = polar(b, 1.17)
      labels += `<text x="${n(lx)}" y="${n(ly + 4)}">${String(b).padStart(3, '0')}</text>`
    }
  }
  // Range labels along the north line.
  let ranges = ''
  for (let k = 1; k <= 3; k += 1) ranges += `<text x="${CX + 5}" y="${n(CY - (R * k) / 4 - 3)}" text-anchor="start">${k * 10}</text>`
  return `<circle cx="${CX}" cy="${CY}" r="${R + 46}" fill="url(#bezel)"/><circle cx="${CX}" cy="${CY}" r="${R + 2}" fill="url(#glass)"/><circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#scan)" opacity=".5"/>${rings}${cross}<path d="${ticks}" stroke="${ink}" stroke-width="1.3" opacity=".6"/><g fill="${ink}" font-size="12" text-anchor="middle" opacity=".7">${labels}</g><g fill="${ink}" font-size="10" opacity=".45">${ranges}</g>`
}

function sweep(ctx: SceneCtx, p: { ink: string; bright: string }): string {
  const ink = ctx.activity === 'error' ? mix(p.ink, ALERT, 0.5) : p.ink
  // The afterglow: thin wedges behind the beam, each fainter, so the trail fades without a conic gradient.
  let wedges = ''
  const steps = 16
  const span = ctx.activity === 'idle' ? 40 : 60
  for (let i = 0; i < steps; i += 1) {
    const a0 = -((i + 1) * span) / steps
    const a1 = -(i * span) / steps
    const [x0, y0] = polar(a0, 1)
    const [x1, y1] = polar(a1, 1)
    wedges += `<path d="M${CX} ${CY}L${n(x0)} ${n(y0)}A${R} ${R} 0 0 1 ${n(x1)} ${n(y1)}Z" fill="${ink}" opacity="${n(0.2 * Math.pow(1 - i / steps, 2.2))}"/>`
  }
  const [bx, by] = polar(0, 1)
  return `<g class="sweep" style="transform-origin:${CX}px ${CY}px;animation-duration:${sweepSeconds(ctx)}s">${wedges}<path d="M${CX} ${CY}L${n(bx)} ${n(by)}" stroke="${p.bright}" stroke-width="2.2" opacity=".9"/><path d="M${CX} ${CY}L${n(bx)} ${n(by)}" stroke="${ink}" stroke-width="7" opacity=".25"/></g>`
}

// ---------------------------------------------------------------- echoes

/** Blips: echoes painted by the beam. How many and how bright depends on the activity. */
function blips(ctx: SceneCtx, p: { ink: string; bright: string }): string {
  const plan: Record<string, [number, number]> = { idle: [0, 0], thinking: [7, 0.5], working: [16, 1], agents: [6, 0.6], error: [5, 0.5], success: [0, 0] }
  const [count, strength] = plan[ctx.activity] ?? [0, 0]
  const period = sweepSeconds(ctx)
  let out = ''
  for (let i = 0; i < count; i += 1) {
    const bearing = hash(i, 1, 11) * 360
    const range = 0.25 + hash(i, 2, 11) * 0.68
    const [x, y] = polar(bearing, range)
    const size = 2.5 + hash(i, 3, 11) * 3
    // An echo is a short arc across the beam, not a dot: wider the further out it is.
    const half = 2 + range * 4
    const [ax, ay] = polar(bearing - half, range)
    const [bx2, by2] = polar(bearing + half, range)
    out += `<g class="blip" style="${onBeam(bearing, period)}" opacity="${n(strength * 0.5)}"><path d="M${n(ax)} ${n(ay)}A${n(R * range)} ${n(R * range)} 0 0 1 ${n(bx2)} ${n(by2)}" stroke="${p.ink}" stroke-width="${n(size)}" stroke-linecap="round" fill="none" opacity="${n(strength)}"/><circle cx="${n(x)}" cy="${n(y)}" r="${n(size * 0.5)}" fill="${p.bright}" opacity="${n(strength)}"/></g>`
  }
  return out
}

/** Weather layer: faint echoes painted by the beam like any other, in the season's pattern. */
function weather(ctx: SceneCtx, p: { ink: string }): string {
  const period = sweepSeconds(ctx)
  const ink = p.ink
  // Echoes are grouped into eight bearing sectors, each sector lit as the beam crosses it.
  const sectors: string[] = ['', '', '', '', '', '', '', '']
  const add = (bearing: number, range: number, size: number): void => {
    const [x, y] = polar(bearing, range)
    const s = Math.floor((((bearing % 360) + 360) % 360) / 45)
    sectors[s] += `M${n(x)} ${n(y)}h${size}v${size}h-${size}z`
  }
  if (ctx.season === 'winter') {
    // Snow: a fine, even speckle of clutter over the whole scope.
    for (let i = 0; i < 520; i += 1) add(hash(i, 1, 21) * 360, Math.sqrt(hash(i, 2, 21)) * 0.98, hash(i, 3, 21) < 0.2 ? 2.6 : 1.8)
  } else if (ctx.season === 'autumn') {
    // Rain: three curved bands of echo sweeping across the south west.
    for (let band = 0; band < 3; band += 1) {
      for (let i = 0; i < 150; i += 1) {
        const t = hash(i, 1, 22 + band)
        const bearing = 170 + band * 30 + t * 70
        const range = 0.45 + band * 0.14 + Math.sin(t * 3 + band) * 0.08 + (hash(i, 2, 22 + band) - 0.5) * 0.09
        if (range < 0.98) add(bearing, range, hash(i, 3, 22) < 0.3 ? 2.4 : 1.6)
      }
    }
  } else if (ctx.season === 'spring') {
    // Birds: small tight flocks out at long range.
    for (let f = 0; f < 5; f += 1) {
      const b0 = hash(f, 1, 23) * 360
      const r0 = 0.5 + hash(f, 2, 23) * 0.4
      for (let i = 0; i < 9; i += 1) add(b0 + (hash(i, f, 24) - 0.5) * 8, r0 + (hash(f, i, 25) - 0.5) * 0.06, 3)
    }
  } else {
    // Summer: two storm cells, dense blobs of echo.
    for (const [b0, r0, salt] of [[60, 0.62, 26], [250, 0.5, 27]] as const) {
      for (let i = 0; i < 160; i += 1) {
        const a = hash(i, 1, salt) * Math.PI * 2
        const d = Math.sqrt(hash(i, 2, salt))
        add(b0 + Math.cos(a) * d * 14, r0 + Math.sin(a) * d * 0.13, d < 0.4 ? 2.4 : 1.6)
      }
    }
  }
  return sectors
    .map((d, s) => (d ? `<path class="echo" style="${onBeam(s * 45 + 22.5, period)}" d="${d}" fill="${ink}"/>` : ''))
    .join('')
}

/** One tracked contact per subagent: it crosses the scope on a straight course, its track behind it, with a label tag. */
function contacts(ctx: SceneCtx, p: { ink: string; bright: string }, count: number, locked: boolean): string {
  const courses: [number, number, number, number, number][] = [
    [-0.8, -0.35, 0.8, 0.05, 48],
    [0.55, -0.85, -0.2, 0.75, 56],
    [-0.6, 0.6, 0.75, -0.4, 62],
    [0.85, 0.3, -0.75, 0.45, 52],
    [-0.15, 0.85, 0.35, -0.8, 66],
  ]
  let out = ''
  for (let i = 0; i < count; i += 1) {
    const [x0, y0, x1, y1, secs] = courses[i] ?? [0, 0, 0, 0, 50]
    const sx = CX + x0 * R
    const sy = CY + y0 * R
    const dx = (x1 - x0) * R
    const dy = (y1 - y0) * R
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    // Track history: dots behind the contact along its course, fading.
    let track = ''
    for (let k = 1; k <= 6; k += 1) track += `<circle cx="${n(-ux * k * 9)}" cy="${n(-uy * k * 9)}" r="1.6" opacity="${n(0.75 - k * 0.11)}"/>`
    const colour = locked ? LOCK : p.bright
    const label = `A${i + 1}`
    const tag = `<path d="M5 -5l10 -12h4" stroke="${colour}" stroke-width="1" fill="none" opacity=".8"/><rect x="19" y="-26" width="26" height="15" fill="${p.ink}" opacity=".18"/><text x="32" y="-15" text-anchor="middle" fill="${colour}" font-size="11">${label}</text>`
    const mark = locked
      ? `<g class="lock" style="animation-delay:-${n(i * 0.15)}s"><path d="M-14 -8v-6h6M8 -14h6v6M14 8v6h-6M-8 14h-6v-6" stroke="${LOCK}" stroke-width="2" fill="none"/></g>`
      : `<rect x="-7" y="-7" width="14" height="14" fill="none" stroke="${colour}" stroke-width="1.2" opacity=".75"/>`
    // Rest pose: the contact a third of the way along its course.
    out += `<g class="course" style="--dx:${n(dx)}px;--dy:${n(dy)}px;transform:translate(${n(dx * 0.35)}px,${n(dy * 0.35)}px);animation-duration:${secs}s;animation-delay:-${n(hash(i, 4, 31) * secs)}s"><g transform="translate(${n(sx)} ${n(sy)})"><g fill="${p.ink}">${track}</g><circle r="3.6" fill="${colour}"/><circle class="ping" r="9" fill="none" stroke="${colour}" stroke-width="1"/>${mark}${tag}</g></g>`
  }
  return `<g clip-path="url(#disk)">${out}</g>`
}

/** Error: a red contact on the scope, alert rings spreading from it, the rim washed red. */
function alert(ctx: SceneCtx): string {
  if (ctx.activity !== 'error') return ''
  const [x, y] = polar(218, 0.55)
  let rings = ''
  for (let k = 0; k < 3; k += 1) rings += `<circle class="alarm" style="animation-delay:-${k * 0.6}s;transform-origin:${n(x)}px ${n(y)}px" cx="${n(x)}" cy="${n(y)}" r="40" fill="none" stroke="${ALERT}" stroke-width="2"/>`
  const diamond = `<path class="blink" d="M${n(x)} ${n(y - 10)}l10 10-10 10-10-10z" fill="${ALERT}"/><path d="M${n(x - 18)} ${n(y - 18)}h36v36h-36z" fill="none" stroke="${ALERT}" stroke-width="1.4" stroke-dasharray="4 3"/>`
  const rim = `<circle class="rimflash" cx="${CX}" cy="${CY}" r="${R + 8}" fill="none" stroke="${ALERT}" stroke-width="6"/>`
  const tag = `<text x="${n(x + 22)}" y="${n(y - 20)}" fill="${ALERT}" font-size="12">UNK</text>`
  return `<circle cx="${n(x)}" cy="${n(y)}" r="120" fill="url(#alertglow)"/><g clip-path="url(#disk)">${rings}</g>${diamond}${tag}${rim}`
}

/** Success: a green flash over the scope and a ring spreading out from the centre. */
function lockFlash(ctx: SceneCtx): string {
  if (ctx.activity !== 'success') return ''
  return `<circle class="flash" cx="${CX}" cy="${CY}" r="${R}" fill="url(#lockglow)"/><circle class="spread" style="transform-origin:${CX}px ${CY}px" cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${LOCK}" stroke-width="3"/>`
}

// ---------------------------------------------------------------- bottom-left instruments

function readout(ctx: SceneCtx, p: { ink: string; bright: string }): string {
  const mode = { idle: 'STBY', thinking: 'SCAN', working: 'TRK ', agents: 'MULTI', error: 'ALERT', success: 'LOCK' }[ctx.activity] ?? 'STBY'
  const rpm = Math.round(60 / sweepSeconds(ctx))
  const colour = ctx.activity === 'error' ? ALERT : ctx.activity === 'success' ? LOCK : p.ink
  const wx = { spring: 'CLR/BIO', summer: 'CB 2', autumn: 'RA BND', winter: 'SN LGT' }[ctx.season] ?? ''
  const lines = [`MODE ${mode}`, `ANT  ${String(rpm).padStart(2, '0')} RPM`, `TRK  ${ctx.agents}/5`, `WX   ${wx}`]
  const text = lines.map((l, i) => `<text x="44" y="${812 + i * 20}">${l}</text>`).join('')
  // The A-scope: a trace of returns along one bearing, noisy grass with spikes where echoes are.
  const spikes = ctx.activity === 'working' ? 7 : ctx.activity === 'thinking' || ctx.activity === 'agents' ? 4 : ctx.activity === 'error' ? 2 : 1
  let d = 'M44 960'
  for (let x = 0; x <= 320; x += 4) {
    const grass = hash(x, 1, 41) * 5
    let spike = 0
    for (let s = 0; s < spikes; s += 1) {
      const at = 30 + hash(s, 2, 41) * 270
      spike += Math.max(0, 38 - Math.abs(x - at) * 5) * (0.5 + hash(s, 3, 41) * 0.5)
    }
    d += `L${44 + x} ${n(960 - grass - spike)}`
  }
  const box = `<path d="M40 892h328M40 964h328" stroke="${p.ink}" stroke-width="1" opacity=".3"/>`
  return `<g fill="${colour}" font-size="13" opacity=".75">${text}</g>${box}<path class="trace" d="${d}" stroke="${colour}" stroke-width="1.6" fill="none" opacity=".75"/><rect class="scanbar" x="44" y="896" width="3" height="66" fill="${p.bright}" opacity=".5"/>`
}

function defs(ctx: SceneCtx, p: { ink: string; bright: string; ground: string; deep: string }): string {
  let lines = ''
  for (let y = 0; y < 6; y += 3) lines += `M0 ${y + 0.5}h6`
  return `${glyphGrid(p)}
<pattern id="scanlines" width="6" height="6" patternUnits="userSpaceOnUse"><path d="${lines}" stroke="#000" stroke-width="1" opacity=".5"/></pattern>
<radialGradient id="bg" cx=".83" cy=".27" r=".95"><stop offset="0" stop-color="${mix(p.ground, p.ink, 0.06)}"/><stop offset=".45" stop-color="${p.ground}"/><stop offset="1" stop-color="${p.deep}"/></radialGradient>
<radialGradient id="glass" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${mix(p.ground, p.ink, 0.12)}"/><stop offset=".85" stop-color="${mix(p.ground, p.ink, 0.06)}"/><stop offset="1" stop-color="${p.deep}"/></radialGradient>
<radialGradient id="bezel" cx=".5" cy=".5" r=".5"><stop offset=".82" stop-color="${p.deep}"/><stop offset=".86" stop-color="${mix(p.deep, p.ink, 0.1)}"/><stop offset=".94" stop-color="${mix(p.deep, '#ffffff', 0.03)}"/><stop offset="1" stop-color="${p.ground}" stop-opacity="0"/></radialGradient>
<radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${p.ink}" stop-opacity=".1"/><stop offset=".6" stop-color="${p.ink}" stop-opacity=".03"/><stop offset="1" stop-color="${p.ink}" stop-opacity="0"/></radialGradient>
<radialGradient id="alertglow"><stop offset="0" stop-color="${ALERT}" stop-opacity=".35"/><stop offset="1" stop-color="${ALERT}" stop-opacity="0"/></radialGradient>
<radialGradient id="lockglow"><stop offset="0" stop-color="${LOCK}" stop-opacity=".1"/><stop offset=".8" stop-color="${LOCK}" stop-opacity=".25"/><stop offset="1" stop-color="${LOCK}" stop-opacity=".4"/></radialGradient>
<radialGradient id="calm" cx=".45" cy=".55" r=".5"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".7" stop-color="#000" stop-opacity=".25"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<clipPath id="disk"><circle cx="${CX}" cy="${CY}" r="${R}"/></clipPath>
<pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 .5h4" stroke="${ctx.phase === 'day' ? '#9fffc8' : '#ffd890'}" stroke-width="1" opacity=".12"/></pattern>`
}

function style(): string {
  return `text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.sweep{animation:sweep 8s linear infinite}
.blip{animation:fade 8s linear infinite}
.echo{opacity:.32;animation:echo 8s linear infinite}
.course{animation:course 50s linear infinite}
.ping{opacity:.4;animation:ping 2.4s ease-out infinite}
.lock{animation:lock 1.2s ease-in-out infinite alternate}
.alarm{opacity:0;animation:alarm 1.8s ease-out infinite}
.blink{animation:blink .8s steps(2,jump-none) infinite}
.rimflash{opacity:.5;animation:rimflash 1.6s ease-in-out infinite}
.flash{opacity:.5;animation:flash 2.4s ease-out infinite}
.spread{opacity:0;animation:spread 2.4s ease-out infinite}
.scanbar{animation:scanbar 3s linear infinite}
.trace{animation:trace .35s steps(2,jump-none) infinite alternate}
.breathe{animation:breathe 6s ease-in-out infinite alternate}
@keyframes sweep{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes fade{0%{opacity:1}70%{opacity:.08}100%{opacity:.04}}
@keyframes echo{0%{opacity:.9}55%{opacity:.3}100%{opacity:.22}}
@keyframes course{from{transform:translate(0,0)}to{transform:translate(var(--dx),var(--dy))}}
@keyframes ping{from{transform:scale(.4);opacity:.8}to{transform:scale(1.8);opacity:0}}
@keyframes lock{from{transform:scale(1.25);opacity:.6}to{transform:scale(1);opacity:1}}
@keyframes alarm{from{transform:scale(.2);opacity:1}to{transform:scale(2.6);opacity:0}}
@keyframes blink{0%{opacity:1}100%{opacity:.25}}
@keyframes rimflash{0%,100%{opacity:.15}50%{opacity:.8}}
@keyframes flash{0%{opacity:1}100%{opacity:.25}}
@keyframes spread{from{transform:scale(.1);opacity:1}to{transform:scale(1.3);opacity:0}}
@keyframes scanbar{from{transform:translateX(0)}to{transform:translateX(318px)}}
@keyframes trace{from{transform:translateY(0)}to{transform:translateY(-1.5px)}}
@keyframes breathe{from{opacity:.7}to{opacity:1}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`
}

function radarScene(ctx: SceneCtx): string {
  const p = PHOSPHOR[ctx.phase]
  const succeeded = ctx.activity === 'success'
  // On success there may be no subagents left: the scope then locks on to three standing contacts of its own.
  const tracked = succeeded ? Math.max(3, ctx.agents) : ctx.agents
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>${style()}</style><defs>${defs(ctx, p)}</defs>
<rect width="1600" height="1000" fill="url(#bg)"/>
<rect width="1600" height="1000" fill="url(#grid)"/>
<rect width="1600" height="1000" fill="url(#calm)"/>
${rulers(p)}
<circle class="breathe" cx="${CX}" cy="${CY}" r="${R + 220}" fill="url(#halo)"/>
${scopeBody(ctx, p)}
${weather(ctx, p)}
${blips(ctx, p)}
${sweep(ctx, p)}
${contacts(ctx, p, tracked, succeeded)}
${alert(ctx)}
${lockFlash(ctx)}
<circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#scanlines)" opacity=".5"/>
${readout(ctx, p)}
</svg>`
}

export const theme: LivingTheme = {
  id: 'radar',
  title: 'Radar',
  blurb: 'A phosphor radar scope in the top right of a dark console, a faint glyph grid over everything and a trace in the corner.',
  reacts: 'The sweep idles slowly, paints faint echoes while thinking and fast blips while working, tracks a labelled contact per subagent, shows a red contact and alert rings after an error and locks every contact with a green flash on success; amber phosphor by night, green by day, and snow, rain, bird or storm echoes by season.',
  window: 'dark',
  glass: ctx => ({ blur: 10, tint: ctx.phase === 'day' ? '#04100a' : '#0d0904', opacity: 0.3 }),
  scene: radarScene,
}
