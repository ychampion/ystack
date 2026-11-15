// Winter cabin: a snowy night with a decorated tree, a snowman and a lamp post at the left edge, an A-frame cabin with
// lit windows and a smoking chimney at the right. Two wooden signs hang from the top left, a robin in a Santa hat on the
// upper one: it shows how full the context window is, and the lower one a candle that burns down with the minutes left
// on the prompt cache. As the context fills, snow piles on the tree and the drift rises until the snowman is buried; a
// compaction clears it all. The agent's activity sets the smoke, the windows, the robin and the tree lights; each
// subagent hangs a lantern on the cabin's balcony; a failed tool turns the lights red, a merge or a green test run sends
// a shooting star and sparks round the tree's star. The time of day sets the sky.
// Pure string building: no Math.random, no Date, the same string for the same moment.
import type { Gauges, LivingTheme, SceneCtx } from './contract'

type Phase = SceneCtx['phase']

function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const r1 = (v: number): number => Math.round(v * 10) / 10

type Sky = { top: string; mid: string; low: string; haze: string; stars: number; moon: boolean; aurora: boolean; snow: string; snowShade: string; window: number }

const SKIES: Record<Phase, Sky> = {
  dawn: { top: '#26305f', mid: '#6d5f9a', low: '#e3a9a6', haze: '#f2c6b4', stars: 0.35, moon: false, aurora: false, snow: '#eef0fb', snowShade: '#b9bfe0', window: 0.8 },
  day: { top: '#3d64a0', mid: '#7b9dcb', low: '#c9dbee', haze: '#e6eef8', stars: 0, moon: false, aurora: false, snow: '#f6f9ff', snowShade: '#c4d3ea', window: 0.55 },
  dusk: { top: '#141a44', mid: '#423a7c', low: '#b07393', haze: '#d896a6', stars: 0.7, moon: true, aurora: false, snow: '#e2e4f6', snowShade: '#a3a7d2', window: 1 },
  night: { top: '#0b1030', mid: '#202a62', low: '#3f4686', haze: '#5c5f9e', stars: 1, moon: true, aurora: true, snow: '#dfe5f8', snowShade: '#95a0d0', window: 1 },
}

const TREE_X = 150
const SNOWMAN_X = 228
const GROUND = 905

/** Where the left drift's top sits for a context fill of `s` (0 to 1): it climbs past the snowman's head near the top. */
const leftDrift = (s: number) => GROUND - s * 150
const rightDrift = (s: number) => GROUND + 5 - s * 80

function sky(p: Sky): string {
  return `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.top}"/><stop offset="0.55" stop-color="${p.mid}"/><stop offset="1" stop-color="${p.low}"/></linearGradient>`
}

function stars(p: Sky): string {
  if (p.stars === 0) return ''
  const out: string[] = []
  for (let i = 0; i < 90; i++) {
    const x = Math.round(hash(i, 1) * 1600)
    const y = Math.round(hash(i, 2) * 560)
    const r = r1(0.6 + hash(i, 3) * 1.4)
    out.push(`<circle class="tw" style="animation-delay:-${r1(hash(i, 4) * 5)}s" cx="${x}" cy="${y}" r="${r}"/>`)
  }
  return `<g fill="#ffffff" opacity="${p.stars}">${out.join('')}</g>`
}

function aurora(p: Sky): string {
  if (!p.aurora) return ''
  return `<g opacity=".5"><path class="au c" d="M-40 300C260 230 520 330 780 270S1250 210 1640 290L1640 340C1250 280 1000 360 780 330S260 300 -40 360Z" fill="url(#auG)" opacity=".6"/><path class="au" d="M-40 250C200 150 420 300 700 200S1200 120 1640 230L1640 330C1200 230 960 330 700 300S220 260 -40 350Z" fill="url(#auG)"/><path class="au b" d="M-40 170C300 90 520 220 820 150S1300 90 1640 160L1640 230C1300 170 1060 250 820 220S300 170 -40 250Z" fill="url(#auV)"/></g>`
}

function moonOrSun(p: Sky, phase: Phase): string {
  if (p.moon) {
    return `<circle cx="1440" cy="150" r="90" fill="url(#moonGlow)"/><circle cx="1440" cy="150" r="46" fill="#f4efd9"/><circle cx="1424" cy="138" r="9" fill="#e2dbbd"/><circle cx="1456" cy="166" r="6" fill="#e2dbbd"/><circle cx="1452" cy="132" r="4" fill="#e2dbbd"/>`
  }
  const y = phase === 'dawn' ? 560 : 170
  return `<circle cx="1420" cy="${y}" r="140" fill="url(#sunGlow)"/><circle cx="1420" cy="${y}" r="40" fill="#fff4d6" opacity=".9"/>`
}

function mountains(p: Sky): string {
  const far = mixHex(p.mid, '#9aa3d8', 0.35)
  const near = mixHex(p.top, '#5a62a0', 0.45)
  const cap = (d: string) => `<path d="${d}" fill="${p.snow}" opacity=".8"/>`
  return `<g opacity=".7"><path d="M0 690L110 560L200 630L330 500L470 670L560 620L720 720L0 760Z" fill="${far}"/><path d="M1600 680L1500 530L1410 610L1310 480L1180 660L1090 620L960 720L1600 760Z" fill="${far}"/>
${cap('M330 500L292 544L312 538L330 556L348 538L372 548Z')}${cap('M110 560L84 590L102 586L114 598L128 586L140 590Z')}${cap('M1310 480L1276 520L1296 514L1312 532L1330 516L1350 522Z')}${cap('M1500 530L1472 562L1490 558L1502 572L1516 558L1530 562Z')}</g>
<g opacity=".85"><path d="M0 760L90 680L170 720L260 640L400 760Z" fill="${near}"/><path d="M1600 750L1530 640L1450 710L1370 660L1220 770Z" fill="${near}"/>
${cap('M260 640L240 662L254 660L262 670L272 660L284 664Z')}${cap('M1530 640L1512 660L1524 658L1532 668L1542 658L1552 660Z')}</g>`
}

/** Blend two #rrggbb colours: t = 0 gives a, 1 gives b. */
function mixHex(a: string, b: string, t: number): string {
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

/** A snow-laden pine: dark tiers with a clump of snow at each branch end. */
function pine(x: number, base: number, h: number, dark: string, seed: number): string {
  const tiers = 4
  const parts: string[] = []
  const snow: string[] = []
  for (let i = 0; i < tiers; i++) {
    const top = base - h + (i * h) / (tiers + 0.4)
    const bot = top + h / 2.5
    const hw = (h * 0.4 * (i + 1.3)) / (tiers + 0.3)
    parts.push(`<path d="M${x} ${r1(top)}L${r1(x + hw)} ${r1(bot)}Q${x} ${r1(bot - 8)} ${r1(x - hw)} ${r1(bot)}Z" fill="${dark}"/>`)
    const r = Math.max(4, h / 26)
    snow.push(clump(x - hw, bot - r * 0.3, r, seed * 7 + i), clump(x + hw, bot - r * 0.3, r, seed * 7 + i + 50), clump(x - hw * 0.35, bot - r * 0.6, r * 0.8, seed * 7 + i + 90))
  }
  return parts.join('') + snow.join('')
}

/** A far forest line and snow-laden pines framing both sides. */
function forest(): string {
  const far: string[] = []
  for (let i = 0; i < 26; i++) {
    const side = i < 13 ? 0 : 1
    const x = side === 0 ? 10 + i * 30 + hash(i, 5) * 14 : 1170 + (i - 13) * 34 + hash(i, 5) * 14
    const h = 50 + hash(i, 6) * 60
    const y = 770 + hash(i, 7) * 20
    far.push(`<path d="M${r1(x)} ${r1(y - h)}L${r1(x + h * 0.22)} ${r1(y)}L${r1(x - h * 0.22)} ${r1(y)}Z"/>`)
  }
  const dark = '#112a40'
  return `<g fill="#22355a" opacity=".8">${far.join('')}</g>
<g>${pine(28, 900, 300, dark, 1)}${pine(360, 880, 190, dark, 2)}${pine(1255, 890, 250, dark, 3)}${pine(1590, 890, 290, dark, 4)}</g>`
}

const LIGHT_COLOURS = ['#ff5a5a', '#ffd166', '#5ee6a0', '#6fb7ff', '#ff9adf']

/** A clump of snow: three overlapping rounds with a shaded underside, `r` across. */
function clump(x: number, y: number, r: number, seed: number): string {
  const a = r * (0.55 + hash(seed, 1) * 0.2)
  const b = r * (0.5 + hash(seed, 2) * 0.2)
  return `<ellipse cx="${r1(x)}" cy="${r1(y + r * 0.18)}" rx="${r1(r * 1.05)}" ry="${r1(r * 0.55)}" fill="url(#clumpShade)"/><circle cx="${r1(x - r * 0.45)}" cy="${r1(y)}" r="${r1(a)}" fill="#ffffff"/><circle cx="${r1(x + r * 0.42)}" cy="${r1(y + 1)}" r="${r1(b)}" fill="#ffffff"/><circle cx="${r1(x)}" cy="${r1(y - r * 0.28)}" r="${r1(r * 0.62)}" fill="#ffffff"/>`
}

/** The decorated tree: snow clumps on every branch tip grow and spread with the context fill; glowing lights follow the activity. */
function tree(ctx: SceneCtx, s: number): string {
  const tiers = 6
  const body: string[] = []
  const snow: string[] = []
  const halos: string[] = []
  const cores: string[] = []
  for (let i = 0; i < tiers; i++) {
    const top = 400 + i * 70
    const bot = top + 122
    const hw = 42 + i * 19
    const left = TREE_X - hw
    const right = TREE_X + hw
    const tips = 3 + i
    // The tier: two flanks and a bottom edge of drooping branch tips.
    let d = `M${TREE_X} ${top}L${right} ${bot}`
    for (let k = tips; k > 0; k--) {
      const x0 = left + ((right - left) * k) / tips
      const x1 = left + ((right - left) * (k - 1)) / tips
      d += `Q${r1((x0 + x1) / 2)} ${r1(bot - 16)} ${r1(x1)} ${bot}`
    }
    body.push(`<path d="${d}Z" fill="url(#needles)"/><path d="M${TREE_X} ${top + 10}L${r1(TREE_X + hw * 0.55)} ${r1(bot - 8)}L${TREE_X} ${r1(bot - 14)}Z" fill="#0f4a30" opacity=".35"/>`)
    // Snow: a clump on each tip, bigger as the context fills; past a third, more up the tier; past two thirds, the crown.
    const r = 9 + s * 13 + i * 0.6
    for (let k = 0; k <= tips; k++) {
      const x = left + ((right - left) * k) / tips
      snow.push(clump(x, bot - r * 0.35, r * (k === 0 || k === tips ? 0.85 : 1), i * 17 + k))
    }
    if (s > 0.3) {
      const t = (s - 0.3) / 0.7
      const n = 1 + Math.round(t * (2 + i))
      for (let k = 0; k < n; k++) {
        const fx = (k + 0.5) / n
        const y = top + 42 + hash(i, k + 7) * 40
        const span = ((y - top) / (bot - top)) * hw * 1.6
        snow.push(clump(TREE_X - span / 2 + span * fx, y, 7 + t * 9, i * 31 + k + 400))
      }
    }
    if (s > 0.65) snow.push(clump(TREE_X, top + 16, 8 + (s - 0.65) * 30, i + 900))
    // A garland of lights across the tier.
    const n = 4 + i
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      const x = left + 14 + (right - left - 28) * t
      const y = top + 66 + i * 2 + Math.sin(t * Math.PI) * 18
      const c = ctx.activity === 'error' ? 0 : ctx.activity === 'success' ? 1 : (i * 3 + k) % LIGHT_COLOURS.length
      const cls = ctx.activity === 'error' ? 'blink' : 'tw'
      const delay = r1(hash(i * 13 + k, 9) * 3)
      halos.push(`<circle class="${cls}" style="animation-delay:-${delay}s" cx="${r1(x)}" cy="${r1(y)}" r="15" fill="url(#halo${c})"/>`)
      cores.push(`<circle class="${cls}" style="animation-delay:-${delay}s" cx="${r1(x)}" cy="${r1(y)}" r="4.6" fill="${ctx.activity === 'error' ? '#ff4a4a' : ctx.activity === 'success' ? '#ffe08a' : (LIGHT_COLOURS[c] ?? '#ffd166')}"/>`)
    }
  }
  // Snow buries the lights as it deepens: dimmer, never gone.
  const lightOpacity = r1(1 - s * 0.5)
  const trunk = `<rect x="${TREE_X - 15}" y="${400 + 5 * 70 + 110}" width="30" height="44" fill="#5b3a26"/>`
  const starGlow = ctx.activity === 'success' ? 'pulseBig' : 'pulse'
  const star = `<circle class="${starGlow}" cx="${TREE_X}" cy="380" r="56" fill="url(#starGlow)"/><path d="M${TREE_X} 350L${TREE_X + 8} 371L${TREE_X + 30} 372L${TREE_X + 13} 386L${TREE_X + 19} 408L${TREE_X} 395L${TREE_X - 19} 408L${TREE_X - 13} 386L${TREE_X - 30} 372L${TREE_X - 8} 371Z" fill="#ffd25a"/><path d="M${TREE_X} 356L${TREE_X + 5} 371L${TREE_X} 382Z" fill="#fff2b0" opacity=".8"/>`
  const sparks =
    ctx.activity === 'success'
      ? `<g fill="#ffe9a0">${Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2
          return `<circle class="spark" style="--dx:${r1(Math.cos(a) * 90)}px;--dy:${r1(Math.sin(a) * 90)}px;animation-delay:-${r1(hash(i, 31) * 1.6)}s" cx="${TREE_X}" cy="380" r="3.5"/>`
        }).join('')}</g>`
      : ''
  return `${trunk}${body.join('')}<g opacity="${lightOpacity}">${halos.join('')}</g>${snow.join('')}<g opacity="${r1(0.55 + lightOpacity * 0.45)}">${cores.join('')}</g>${star}${sparks}`
}

function gifts(): string {
  return `<g><rect x="70" y="858" width="44" height="38" fill="#c8403f"/><rect x="88" y="858" width="8" height="38" fill="#ffd166"/><rect x="66" y="852" width="52" height="10" fill="#a83232"/>
<rect x="190" y="866" width="36" height="30" fill="#3f8f5a"/><rect x="204" y="866" width="7" height="30" fill="#f4f1e8"/><rect x="186" y="861" width="44" height="8" fill="#34774b"/></g>`
}

function snowman(): string {
  const x = SNOWMAN_X
  return `<g><circle cx="${x}" cy="860" r="38" fill="url(#ball)"/><circle cx="${x}" cy="808" r="28" fill="url(#ball)"/><circle cx="${x}" cy="768" r="20" fill="url(#ball)"/>
<circle cx="${x}" cy="800" r="2.6" fill="#2b2b36"/><circle cx="${x}" cy="814" r="2.6" fill="#2b2b36"/>
<path d="M${x - 22} 784Q${x} 794 ${x + 22} 784L${x + 22} 792Q${x} 802 ${x - 22} 792Z" fill="#c8403f"/><path d="M${x + 10} 790L${x + 16} 812L${x + 24} 810L${x + 18} 790Z" fill="#a83232"/>
<circle cx="${x - 7}" cy="763" r="2.4" fill="#2b2b36"/><circle cx="${x + 6}" cy="763" r="2.4" fill="#2b2b36"/><path d="M${x} 769L${x + 18} 772L${x} 774Z" fill="#f08a2c"/>
<path d="M${x - 22} 808L${x - 52} 790M${x - 44} 795L${x - 50} 784" stroke="#5b3a26" stroke-width="3" stroke-linecap="round" fill="none"/>
<path d="M${x + 24} 806L${x + 52} 792M${x + 44} 796L${x + 54} 788" stroke="#5b3a26" stroke-width="3" stroke-linecap="round" fill="none"/>
<rect x="${x - 22}" y="748" width="44" height="6" rx="2" fill="#1d1d26"/><rect x="${x - 14}" y="718" width="28" height="32" rx="2" fill="#1d1d26"/><rect x="${x - 14}" y="740" width="28" height="5" fill="#c8403f"/></g>`
}

function lampPost(ctx: SceneCtx): string {
  const x = 300
  const cls = ctx.activity === 'error' ? 'flicker' : 'breathe'
  return `<g><rect x="${x - 3}" y="700" width="6" height="200" fill="#26283a"/><circle class="${cls}" cx="${x}" cy="690" r="64" fill="url(#lampGlow)"/><path d="M${x - 15} 672L${x + 15} 672L${x + 12} 708L${x - 12} 708Z" fill="#ffe7a0" class="${cls}"/><path d="M${x - 19} 672L${x + 19} 672L${x} 660Z" fill="#26283a"/><rect x="${x - 14}" y="708" width="28" height="5" fill="#26283a"/><path d="M${x - 20} 670Q${x} 650 ${x + 20} 670Q${x} 664 ${x - 20} 670Z" fill="#f4f7ff"/></g>`
}

/** The left drift, in front of the snowman and the gifts: it rises with the context fill. */
function drifts(p: Sky, s: number): string {
  const l = leftDrift(s)
  const r = rightDrift(s)
  const mid = 948 - s * 30
  const left = `<path d="M-20 ${r1(l + 6)}C80 ${r1(l - 14)} 200 ${r1(l - 8)} 300 ${r1(l + 10)}S520 ${r1(mid)} 800 ${r1(mid + 4)}S1150 ${r1(mid)} 1260 ${r1(r + 6)}S1500 ${r1(r - 10)} 1620 ${r1(r)}L1620 1000L-20 1000Z" fill="url(#ground)"/>`
  const sheen = `<path d="M-20 ${r1(l + 6)}C80 ${r1(l - 14)} 200 ${r1(l - 8)} 300 ${r1(l + 10)}" stroke="#ffffff" stroke-opacity=".6" stroke-width="3" fill="none"/><path d="M1260 ${r1(r + 6)}S1500 ${r1(r - 10)} 1620 ${r1(r)}" stroke="#ffffff" stroke-opacity=".5" stroke-width="3" fill="none"/>`
  const sparkle = Array.from({ length: 14 }, (_, i) => `<circle class="tw" style="animation-delay:-${r1(hash(i, 41) * 4)}s" cx="${Math.round(20 + hash(i, 42) * 320)}" cy="${Math.round(l + 20 + hash(i, 43) * 60)}" r="1.6" fill="#ffffff"/>`).join('')
  return `${left}${sheen}<g opacity="${p.stars > 0 ? 0.9 : 0.5}">${sparkle}</g>`
}

/** The A-frame cabin: lit windows, a wreath, a chimney whose smoke follows the activity; a lantern per subagent. */
function cabin(ctx: SceneCtx, p: Sky): string {
  const glowCls = ctx.activity === 'working' ? 'busy' : 'breathe'
  const win = p.window
  const smokeCls = ctx.activity === 'working' || ctx.activity === 'agents' ? 'smoke fast' : ctx.activity === 'thinking' ? 'smoke' : 'smoke slow'
  const puffs = Array.from({ length: ctx.activity === 'idle' ? 4 : 7 }, (_, i) => `<circle class="${smokeCls}" style="animation-delay:-${r1((i * 6) / 7)}s" cx="1500" cy="505" r="${10 + (i % 3) * 3}"/>`).join('')
  const lanterns = Array.from({ length: ctx.activity === 'agents' ? ctx.agents : 0 }, (_, i) => {
    const x = 1366 + i * 27
    return `<g class="sway" style="animation-delay:-${r1(i * 0.37)}s;transform-origin:${x}px 700px"><path d="M${x} 700V712" stroke="#2a1d16" stroke-width="1.5"/><circle cx="${x}" cy="722" r="20" fill="url(#lampGlow)"/><rect x="${x - 6}" y="712" width="12" height="18" rx="3" fill="#ffcf6a"/><rect x="${x - 7}" y="710" width="14" height="3" fill="#2a1d16"/></g>`
  }).join('')
  const errorTint = ctx.activity === 'error' ? `<path d="M1420 540L1322 880L1518 880Z" fill="#ff3b3b" class="blink" opacity=".18"/>` : ''
  return `<g>
<g fill="#cfd6ea" opacity=".75">${puffs}</g>
<rect x="1488" y="520" width="26" height="78" fill="#6b6578"/><rect x="1484" y="512" width="34" height="12" rx="5" fill="${p.snow}"/>
<path d="M1420 448L1272 892L1568 892Z" fill="${p.snow}"/>
<path d="M1420 470L1290 880L1550 880Z" fill="#5a3322"/>
<path d="M1420 470L1290 880M1420 470L1550 880" stroke="#3d2216" stroke-width="5"/>
<path d="M1420 532L1322 880L1518 880Z" fill="#9a5b34"/>
<path d="M1352 780V880M1372 708V880M1392 640V880M1448 640V880M1468 708V880M1488 780V880" stroke="#7e4727" stroke-width="2"/>
<g class="${glowCls}" opacity="${win}"><circle cx="1420" cy="645" r="120" fill="url(#winGlow)"/><path d="M1420 565L1372 700L1468 700Z" fill="#ffd77a"/></g>
<path d="M1420 565L1372 700L1468 700ZM1420 565V700M1396 632H1444" stroke="#3d2216" stroke-width="4" fill="none"/>
<rect x="1356" y="700" width="128" height="7" fill="#3d2216"/><path d="M1362 707V722M1384 707V722M1406 707V722M1434 707V722M1456 707V722M1478 707V722" stroke="#3d2216" stroke-width="3"/><rect x="1356" y="720" width="128" height="4" fill="#3d2216"/>
<rect x="1356" y="696" width="128" height="6" rx="3" fill="${p.snow}"/>
<g opacity="${win}" class="${glowCls}"><rect x="1336" y="796" width="34" height="38" fill="#ffd77a"/><rect x="1470" y="796" width="34" height="38" fill="#ffd77a"/></g>
<path d="M1336 796h34v38h-34zM1353 796v38M1336 815h34M1470 796h34v38h-34zM1487 796v38M1470 815h34" stroke="#3d2216" stroke-width="3" fill="none"/>
<rect x="1396" y="792" width="48" height="88" rx="3" fill="#8f2a2a"/><rect x="1396" y="792" width="48" height="88" rx="3" fill="none" stroke="#3d2216" stroke-width="3"/>
<circle cx="1420" cy="818" r="13" fill="none" stroke="#2f7d4f" stroke-width="7"/><path d="M1414 828l6 -4l6 4l-2 6l-4 -3l-4 3Z" fill="#d23c3c"/><circle cx="1437" cy="842" r="3" fill="#e0b050"/>
${errorTint}${lanterns}</g>`
}

/** The two signs hanging from the top left, the robin on the upper one. */
function signs(ctx: SceneCtx, g: Gauges): string {
  const ctxText = `${g.context}%`
  const cold = g.cacheMin === null
  const left = g.cacheMin ?? 0
  const cacheText = cold ? '' : `${left}m`
  const frac = cold ? 0 : Math.max(0.08, Math.min(1, left / 60))
  const candleH = r1(6 + 30 * frac)
  const candleTop = r1(296 - candleH)
  const low = !cold && left <= 5
  const flame = cold ? '' : `<g class="flame" style="transform-origin:120px ${candleTop}px"><ellipse cx="120" cy="${r1(candleTop - 9)}" rx="${low ? 3.5 : 5}" ry="${low ? 6 : 10}" fill="#ffcf5a"/><ellipse cx="120" cy="${r1(candleTop - 6)}" rx="2.2" ry="4" fill="#fff6d8"/></g><circle cx="120" cy="${r1(candleTop - 8)}" r="22" fill="url(#lampGlow)" class="breathe"/>`
  const robinCls = ctx.activity === 'error' ? 'flap' : ctx.activity === 'success' ? 'hop' : ctx.activity === 'idle' ? '' : 'bob'
  const robin = `<g class="${robinCls}" style="transform-origin:140px 150px">
<ellipse cx="140" cy="126" rx="30" ry="26" fill="#7a5034"/><ellipse cx="150" cy="132" rx="19" ry="18" fill="#e2552d"/><ellipse cx="146" cy="145" rx="16" ry="8" fill="#f4ece0"/>
<path d="M112 120Q96 112 92 98Q106 108 118 112Z" fill="#5f3c26"/><path d="M126 124Q140 118 148 132Q134 136 126 124Z" fill="#62402a"/>
<circle cx="157" cy="112" r="3.2" fill="#1d1d26"/><circle cx="158" cy="111" r="1" fill="#ffffff"/><path d="M166 116L180 120L166 123Z" fill="#e9a23b"/>
<path d="M128 104Q146 66 176 84L160 104Z" fill="#d23c3c"/><circle cx="177" cy="84" r="6" fill="#ffffff"/><rect x="124" y="100" width="40" height="9" rx="4.5" fill="#ffffff"/>
<path d="M134 150V158M146 150V158" stroke="#5b3a26" stroke-width="2.5"/></g>`
  return `<g>
<path d="M92 0V160M188 0V160M104 238V256M176 238V256" stroke="#c9b48a" stroke-width="3"/>
<rect x="72" y="158" width="136" height="82" rx="10" fill="url(#wood)"/><rect x="72" y="158" width="136" height="82" rx="10" fill="none" stroke="#4a2c18" stroke-width="4"/>
<rect x="70" y="152" width="140" height="13" rx="6.5" fill="#f4f7ff"/>
<text x="140" y="212" text-anchor="middle" font-family="'Trebuchet MS', 'Segoe UI', system-ui, sans-serif" font-weight="700" font-size="44" fill="#fff3dc">${ctxText}</text>
<text x="140" y="232" text-anchor="middle" font-family="'Trebuchet MS', 'Segoe UI', system-ui, sans-serif" font-size="15" fill="#f1dcbc">context</text>
<rect x="88" y="254" width="104" height="58" rx="9" fill="url(#wood)"/><rect x="88" y="254" width="104" height="58" rx="9" fill="none" stroke="#4a2c18" stroke-width="4"/>
<rect x="114" y="${candleTop}" width="12" height="${candleH}" rx="2" fill="#f6ecd6"/><rect x="106" y="296" width="28" height="5" rx="2" fill="#c99a52"/>${flame}
<text x="159" y="${cold ? 288 : 286}" text-anchor="middle" font-family="'Trebuchet MS', 'Segoe UI', system-ui, sans-serif" font-weight="700" font-size="${cold ? 28 : left >= 100 ? 19 : 24}" fill="${low ? '#ffb08a' : '#fff3dc'}">${cacheText}</text>
${cold ? '<rect x="147" y="275" width="24" height="5" rx="2.5" fill="#fff3dc"/>' : ''}<text x="159" y="304" text-anchor="middle" font-family="'Trebuchet MS', 'Segoe UI', system-ui, sans-serif" font-size="12" fill="#f1dcbc">cache</text>
${robin}</g>`
}

/** Fairy lights along the cabin's roof edges and icicles under the eaves and the balcony. */
function cabinTrim(ctx: SceneCtx): string {
  const bulbs: string[] = []
  const n = 15
  for (let side = 0; side < 2; side++) {
    for (let k = 1; k < n; k++) {
      const t = k / n
      const x = 1420 + (side === 0 ? -1 : 1) * 140 * t
      const y = 458 + 428 * t
      const c = ctx.activity === 'error' ? 0 : (k + side) % 2 === 0 ? 1 : 5
      bulbs.push(`<circle class="tw" style="animation-delay:-${r1(hash(k, side + 70) * 3)}s" cx="${r1(x)}" cy="${r1(y)}" r="10" fill="url(#halo${c})"/><circle class="tw" style="animation-delay:-${r1(hash(k, side + 70) * 3)}s" cx="${r1(x)}" cy="${r1(y)}" r="3.2" fill="${c === 0 ? '#ff6a6a' : c === 1 ? '#ffe08a' : '#fff4d8'}"/>`)
    }
  }
  const icicles: string[] = []
  for (let k = 0; k < 18; k++) {
    const x = 1360 + k * 7
    const len = 6 + hash(k, 80) * 14
    icicles.push(`<path d="M${x - 2.5} 724L${x + 2.5} 724L${x} ${r1(724 + len)}Z"/>`)
  }
  return `<g fill="#e8f2ff" opacity=".9">${icicles.join('')}</g>${bulbs.join('')}`
}

/** Warm light from the windows spilled on the snow in front of the cabin. */
function windowSpill(p: Sky): string {
  return `<ellipse cx="1420" cy="905" rx="170" ry="26" fill="url(#spill)" opacity="${p.window}"/>`
}

/**
 * Liquid glass behind the chat: a frosted column with soft sides that blurs the still sky and hills behind it, a faint
 * sheen from the top and mist at its foot. The scene's edges stay bright and sharp.
 */
function glassColumn(p: Sky): string {
  return `<g mask="url(#colMask)">
<g filter="url(#frost)"><rect width="1600" height="1000" fill="url(#sky)"/>${mountains(p)}</g>
<rect width="1600" height="1000" fill="#0a1030" opacity=".42"/>
<rect width="1600" height="1000" fill="url(#sheen)"/>
<rect y="760" width="1600" height="240" fill="url(#mist)"/>
</g>`
}

/** Snow in three depths: far fine flakes, middle, and big soft near ones; each layer holds its flakes twice, a screen apart, so the loop never shows a seam. */
function snowfall(s: number, front: boolean): string {
  const layer = (seed: number, count: number, rMin: number, rSpan: number, cls: string, sway: string, opacity: number, soft: boolean) => {
    const flakes: string[] = []
    for (let i = 0; i < count; i++) {
      const x = Math.round(hash(i, seed) * 1600)
      const y = Math.round(hash(i, seed + 1) * 1000)
      const r = r1(rMin + hash(i, seed + 2) * rSpan)
      const fill = soft ? ' fill="url(#flake)"' : ''
      flakes.push(`<circle cx="${x}" cy="${y}" r="${r}"${fill}/><circle cx="${x}" cy="${y - 1000}" r="${r}"${fill}/>`)
    }
    return `<g class="${cls}" fill="#ffffff" opacity="${opacity}"><g class="${sway}">${flakes.join('')}</g></g>`
  }
  if (!front) return `${layer(51, Math.round(50 + s * 50), 0.8, 1.2, 'fallSlow', 'drift', 0.55, false)}${layer(61, Math.round(30 + s * 40), 1.6, 1.6, 'fall', 'driftB', 0.8, false)}`
  return layer(71, Math.round(10 + s * 14), 4, 4, 'fallFast', 'driftC', 0.9, true)
}

function shootingStar(ctx: SceneCtx): string {
  if (ctx.activity !== 'success') return ''
  return `<g class="shoot" transform="translate(860 210)"><path d="M0 0L-160 60" stroke="url(#trail)" stroke-width="3" stroke-linecap="round"/><circle r="3.5" fill="#ffffff"/></g>`
}

function scene(ctx: SceneCtx): string {
  const p = SKIES[ctx.phase]
  const g: Gauges = ctx.gauges ?? { context: 0, cacheMin: null }
  const s = Math.max(0, Math.min(1, g.context / 100))
  const style = `.tw{animation:tw 3.2s ease-in-out infinite alternate}
.blink{animation:blink .5s steps(2) infinite}
.pulse{animation:pulse 3s ease-in-out infinite alternate;transform-origin:${TREE_X}px 380px}
.pulseBig{animation:pulseBig 1.2s ease-in-out infinite alternate;transform-origin:${TREE_X}px 380px}
.spark{animation:spark 1.6s ease-out infinite}
.breathe{animation:breathe 4s ease-in-out infinite alternate}
.busy{animation:busy 1.1s ease-in-out infinite alternate}
.flicker{animation:flicker 1.3s steps(1) infinite}
.flame{animation:flame .35s ease-in-out infinite alternate}
.smoke{animation:smoke 6s linear infinite}.smoke.fast{animation-duration:3s}.smoke.slow{animation-duration:9s}
.sway{animation:sway 2.4s ease-in-out infinite alternate}
.bob{animation:bob .9s ease-in-out infinite alternate}
.hop{animation:hop .7s ease-in-out infinite}
.flap{animation:flap .25s ease-in-out infinite alternate}
.au{animation:au 14s ease-in-out infinite alternate}.au.b{animation-duration:19s}
.fall{animation:fall 16s linear infinite}.fallSlow{animation:fall 30s linear infinite}.fallFast{animation:fall 9s linear infinite}
.drift{animation:drift 6s ease-in-out infinite alternate}.driftB{animation:driftB 4.5s ease-in-out infinite alternate}.driftC{animation:driftC 3.2s ease-in-out infinite alternate}
.au.c{animation-duration:23s}
.shoot{animation:shoot 2.6s ease-in infinite}
@keyframes tw{from{opacity:.35}to{opacity:1}}
@keyframes blink{0%{opacity:1}100%{opacity:.2}}
@keyframes pulse{from{transform:scale(.9);opacity:.75}to{transform:scale(1.1);opacity:1}}
@keyframes pulseBig{from{transform:scale(1);opacity:.8}to{transform:scale(1.7);opacity:1}}
@keyframes spark{from{transform:translate(0,0);opacity:1}to{transform:translate(var(--dx),var(--dy));opacity:0}}
@keyframes breathe{from{opacity:.75}to{opacity:1}}
@keyframes busy{from{opacity:.7}to{opacity:1}}
@keyframes flicker{0%{opacity:1}12%{opacity:.25}18%{opacity:.9}40%{opacity:.4}46%{opacity:1}}
@keyframes flame{from{transform:scale(.9,1) rotate(-4deg)}to{transform:scale(1.05,1.1) rotate(4deg)}}
@keyframes smoke{from{transform:translate(0,0) scale(.6);opacity:.8}to{transform:translate(-60px,-260px) scale(2.2);opacity:0}}
@keyframes sway{from{transform:rotate(-7deg)}to{transform:rotate(7deg)}}
@keyframes bob{from{transform:translateY(0)}to{transform:translateY(-4px)}}
@keyframes hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-16px)}}
@keyframes flap{from{transform:rotate(-3deg)}to{transform:rotate(3deg)}}
@keyframes au{from{transform:translateX(-40px) skewX(-4deg)}to{transform:translateX(40px) skewX(4deg)}}
@keyframes fall{from{transform:translateY(0)}to{transform:translateY(1000px)}}
@keyframes drift{from{transform:translateX(-14px)}to{transform:translateX(14px)}}
@keyframes driftB{from{transform:translateX(20px)}to{transform:translateX(-26px)}}
@keyframes driftC{from{transform:translateX(-40px)}to{transform:translateX(30px)}}
@keyframes shoot{0%{transform:translate(1180px,90px);opacity:0}10%{opacity:1}60%{transform:translate(560px,330px);opacity:0}100%{transform:translate(560px,330px);opacity:0}}
@media (prefers-reduced-motion: reduce){*{animation:none!important}}`
  const defs = `${sky(p)}
<linearGradient id="auG" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#53f0b0" stop-opacity="0"/><stop offset=".35" stop-color="#53f0b0"/><stop offset=".7" stop-color="#7ad8ff"/><stop offset="1" stop-color="#7ad8ff" stop-opacity="0"/></linearGradient>
<linearGradient id="auV" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b48cff" stop-opacity="0"/><stop offset=".5" stop-color="#b48cff"/><stop offset="1" stop-color="#53f0b0" stop-opacity="0"/></linearGradient>
<radialGradient id="moonGlow"><stop offset="0" stop-color="#fff6d8" stop-opacity=".45"/><stop offset="1" stop-color="#fff6d8" stop-opacity="0"/></radialGradient>
<radialGradient id="sunGlow"><stop offset="0" stop-color="#fff1c8" stop-opacity=".7"/><stop offset="1" stop-color="#ffe0b0" stop-opacity="0"/></radialGradient>
<radialGradient id="lampGlow"><stop offset="0" stop-color="#ffe6a0" stop-opacity=".75"/><stop offset=".45" stop-color="#ffcf6a" stop-opacity=".25"/><stop offset="1" stop-color="#ffcf6a" stop-opacity="0"/></radialGradient>
<radialGradient id="winGlow"><stop offset="0" stop-color="#ffd77a" stop-opacity=".5"/><stop offset="1" stop-color="#ffd77a" stop-opacity="0"/></radialGradient>
<radialGradient id="starGlow"><stop offset="0" stop-color="#fff0a8" stop-opacity=".85"/><stop offset=".4" stop-color="#ffd25a" stop-opacity=".3"/><stop offset="1" stop-color="#ffd25a" stop-opacity="0"/></radialGradient>
<linearGradient id="needles" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2f8a55"/><stop offset="1" stop-color="#17573a"/></linearGradient>
<linearGradient id="snowFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${p.snow}"/></linearGradient>
<linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.snow}"/><stop offset="1" stop-color="${p.snowShade}"/></linearGradient>
<radialGradient id="ball" cx=".4" cy=".35"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${p.snowShade}"/></radialGradient>
<linearGradient id="wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5432"/><stop offset="1" stop-color="#6a3c22"/></linearGradient>
<linearGradient id="trail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p.haze}" stop-opacity="0"/><stop offset=".55" stop-color="${p.haze}" stop-opacity=".22"/><stop offset="1" stop-color="${p.haze}" stop-opacity="0"/></linearGradient>
<radialGradient id="halo0"><stop offset="0" stop-color="#ff5a5a" stop-opacity=".85"/><stop offset=".35" stop-color="#ff5a5a" stop-opacity=".35"/><stop offset="1" stop-color="#ff5a5a" stop-opacity="0"/></radialGradient><radialGradient id="halo1"><stop offset="0" stop-color="#ffd166" stop-opacity=".85"/><stop offset=".35" stop-color="#ffd166" stop-opacity=".35"/><stop offset="1" stop-color="#ffd166" stop-opacity="0"/></radialGradient><radialGradient id="halo2"><stop offset="0" stop-color="#5ee6a0" stop-opacity=".85"/><stop offset=".35" stop-color="#5ee6a0" stop-opacity=".35"/><stop offset="1" stop-color="#5ee6a0" stop-opacity="0"/></radialGradient><radialGradient id="halo3"><stop offset="0" stop-color="#6fb7ff" stop-opacity=".85"/><stop offset=".35" stop-color="#6fb7ff" stop-opacity=".35"/><stop offset="1" stop-color="#6fb7ff" stop-opacity="0"/></radialGradient><radialGradient id="halo4"><stop offset="0" stop-color="#ff9adf" stop-opacity=".85"/><stop offset=".35" stop-color="#ff9adf" stop-opacity=".35"/><stop offset="1" stop-color="#ff9adf" stop-opacity="0"/></radialGradient><radialGradient id="halo5"><stop offset="0" stop-color="#fff2c8" stop-opacity=".85"/><stop offset=".35" stop-color="#fff2c8" stop-opacity=".35"/><stop offset="1" stop-color="#fff2c8" stop-opacity="0"/></radialGradient>
<radialGradient id="clumpShade" cy=".3"><stop offset="0" stop-color="#b9c4e6"/><stop offset="1" stop-color="#8f9bc8" stop-opacity="0"/></radialGradient>
<radialGradient id="flake"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#ffffff" stop-opacity=".7"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
<radialGradient id="spill"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".45"/><stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/></radialGradient>
<linearGradient id="colG" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1600" y2="0"><stop offset=".15" stop-color="#000"/><stop offset=".29" stop-color="#fff"/><stop offset=".71" stop-color="#fff"/><stop offset=".85" stop-color="#000"/></linearGradient>
<mask id="colMask" maskUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><rect width="1600" height="1000" fill="url(#colG)"/></mask>
<filter id="frost" filterUnits="userSpaceOnUse" x="0" y="0" width="1600" height="1000"><feGaussianBlur stdDeviation="16"/></filter>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8d4ff" stop-opacity=".10"/><stop offset=".35" stop-color="#c8d4ff" stop-opacity="0"/></linearGradient>
<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe6ff" stop-opacity="0"/><stop offset="1" stop-color="#dfe6ff" stop-opacity=".22"/></linearGradient>
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>${style}</style><defs>${defs}</defs>
<rect width="1600" height="1000" fill="url(#sky)"/>
<rect y="560" width="1600" height="340" fill="url(#haze)"/>
${stars(p)}
${aurora(p)}
${moonOrSun(p, ctx.phase)}
${shootingStar(ctx)}
${mountains(p)}
${forest()}
${snowfall(s, false)}
${windowSpill(p)}
${cabin(ctx, p)}
${cabinTrim(ctx)}
${tree(ctx, s)}
${gifts()}
${lampPost(ctx)}
${snowman()}
${drifts(p, s)}
${glassColumn(p)}
${signs(ctx, g)}
${snowfall(s, true)}
</svg>`
}

function glass(ctx: SceneCtx): { blur: number; tint: string; opacity: number } {
  // The frosted column is drawn in the scene itself, so the veil over the whole window stays light and the edges bright.
  return ctx.phase === 'day' ? { blur: 16, tint: '#16224a', opacity: 0.12 } : { blur: 16, tint: '#0a1030', opacity: 0.1 }
}

export const theme: LivingTheme = {
  id: 'winter-cabin',
  title: 'Winter cabin',
  blurb: 'A snowy night: a decorated tree, a snowman and a lamp post at the left, an A-frame cabin at the right, and a robin on two hanging signs.',
  reacts:
    'The upper sign shows how full the context is and snow piles on the tree until the snowman is buried; a compaction clears it. The candle burns down with the minutes left on the prompt cache. Smoke, windows and the robin follow the agent, a lantern hangs out for each subagent, the lights turn red on an error and a shooting star crosses on success.',
  window: 'dark',
  gauges: true,
  glass,
  scene,
}
