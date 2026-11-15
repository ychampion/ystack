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
  return `<g opacity=".32"><path class="au" d="M-40 250C200 150 420 300 700 200S1200 120 1640 230L1640 330C1200 230 960 330 700 300S220 260 -40 350Z" fill="url(#auG)"/><path class="au b" d="M-40 170C300 90 520 220 820 150S1300 90 1640 160L1640 230C1300 170 1060 250 820 220S300 170 -40 250Z" fill="url(#auV)"/></g>`
}

function moonOrSun(p: Sky, phase: Phase): string {
  if (p.moon) {
    return `<circle cx="1440" cy="150" r="90" fill="url(#moonGlow)"/><circle cx="1440" cy="150" r="46" fill="#f4efd9"/><circle cx="1424" cy="138" r="9" fill="#e2dbbd"/><circle cx="1456" cy="166" r="6" fill="#e2dbbd"/><circle cx="1452" cy="132" r="4" fill="#e2dbbd"/>`
  }
  const y = phase === 'dawn' ? 560 : 170
  return `<circle cx="1420" cy="${y}" r="140" fill="url(#sunGlow)"/><circle cx="1420" cy="${y}" r="40" fill="#fff4d6" opacity=".9"/>`
}

function mountains(p: Sky): string {
  const far = '#5a5f9a'
  const near = '#3d4278'
  return `<g opacity=".55"><path d="M0 700L120 600L210 660L330 540L470 690L560 640L700 720L0 760Z" fill="${far}"/><path d="M1600 690L1500 560L1420 620L1330 520L1210 680L1120 640L1000 720L1600 760Z" fill="${far}"/></g>
<g opacity=".7"><path d="M0 760L90 690L170 730L260 650L380 760Z" fill="${near}"/><path d="M1600 750L1530 650L1450 720L1380 670L1250 770Z" fill="${near}"/></g>
<g fill="${p.snow}" opacity=".55"><path d="M330 540L300 568L318 566L330 580L344 566L360 570Z"/><path d="M1330 520L1305 548L1322 545L1334 560L1348 546L1360 548Z"/><path d="M120 600L100 618L114 617L124 628L134 618L142 620Z"/><path d="M1500 560L1478 582L1494 580L1504 592L1514 582L1524 584Z"/></g>`
}

function pine(x: number, base: number, h: number, p: Sky, dark: string): string {
  const w = h * 0.42
  const tiers = 4
  const parts: string[] = []
  for (let i = 0; i < tiers; i++) {
    const top = base - h + (i * h) / (tiers + 0.6)
    const bot = top + h / 2.6
    const hw = (w * (i + 1.4)) / (tiers + 0.4)
    parts.push(`<path d="M${x} ${r1(top)}L${r1(x - hw)} ${r1(bot)}L${r1(x + hw)} ${r1(bot)}Z" fill="${dark}"/>`)
    parts.push(`<path d="M${r1(x - hw)} ${r1(bot)}q${r1(hw * 0.25)} -9 ${r1(hw * 0.5)} -2t${r1(hw * 0.5)} -1t${r1(hw * 0.5)} 0t${r1(hw * 0.5)} 2l-${r1(hw * 0.3)} -9q-${r1(hw * 0.7)} 4 -${r1(hw * 1.4)} 0Z" fill="${p.snow}"/>`)
  }
  return parts.join('')
}

function backPines(p: Sky): string {
  const dark = '#1f3550'
  return `<g opacity=".85">${pine(30, 880, 260, p, dark)}${pine(330, 860, 170, p, dark)}${pine(1262, 880, 230, p, dark)}${pine(1580, 870, 250, p, dark)}</g>`
}

const LIGHT_COLOURS = ['#ff5a5a', '#ffd166', '#5ee6a0', '#6fb7ff', '#ff9adf']

/** The decorated tree: snow caps grow with the context fill, the lights dim under the snow and follow the activity. */
function tree(ctx: SceneCtx, s: number): string {
  const tiers = 6
  const parts: string[] = []
  const lights: string[] = []
  const cap = 7 + s * 22
  for (let i = 0; i < tiers; i++) {
    const top = 400 + i * 72
    const bot = top + 118
    const hw = 40 + i * 20
    const left = TREE_X - hw
    const right = TREE_X + hw
    parts.push(`<path d="M${TREE_X} ${top}L${left} ${bot}Q${TREE_X} ${bot + 14} ${right} ${bot}Z" fill="url(#needles)"/>`)
    // Snow along the tier's lower edge: lumps at each branch end, thicker as the context fills.
    const lumps = 3 + i
    let d = `M${left - 6} ${bot + 2}`
    for (let k = 0; k < lumps; k++) {
      const x0 = left - 6 + ((right - left + 12) * k) / lumps
      const x1 = left - 6 + ((right - left + 12) * (k + 1)) / lumps
      const sag = bot + 2 + Math.sin(((k + 0.5) / lumps) * Math.PI) * 9
      d += `Q${r1((x0 + x1) / 2)} ${r1(sag + cap * 0.55)} ${r1(x1)} ${r1(sag)}`
    }
    d += `L${right + 6} ${r1(bot - cap * 0.6)}`
    for (let k = lumps - 1; k >= 0; k--) {
      const x0 = left - 6 + ((right - left + 12) * k) / lumps
      const x1 = left - 6 + ((right - left + 12) * (k + 1)) / lumps
      const lift = bot - cap * (0.7 + hash(i, k) * 0.5)
      d += `Q${r1((x0 + x1) / 2)} ${r1(lift - cap * 0.5)} ${r1(x0)} ${r1(bot - cap * 0.6)}`
    }
    parts.push(`<path d="${d}Z" fill="url(#snowFill)"/>`)
    if (s > 0.45) {
      // Deep snow also settles on the slopes.
      const k = (s - 0.45) / 0.55
      parts.push(`<path d="M${TREE_X} ${top + 4}L${r1(TREE_X - hw * 0.55)} ${r1(top + 60)}Q${TREE_X} ${r1(top + 60 - 22 * k)} ${r1(TREE_X + hw * 0.5)} ${r1(top + 58)}Z" fill="url(#snowFill)" opacity="${r1(0.5 + k * 0.5)}"/>`)
    }
    // A garland of lights across the tier.
    const n = 4 + i
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n
      const x = left + 12 + (right - left - 24) * t
      const y = top + 62 + i * 3 + Math.sin(t * Math.PI) * 16
      const colour =
        ctx.activity === 'error' ? '#ff4040' : ctx.activity === 'success' ? '#ffd76a' : (LIGHT_COLOURS[(i * 3 + k) % LIGHT_COLOURS.length] ?? '#ffd166')
      lights.push(`<circle class="${ctx.activity === 'error' ? 'blink' : 'tw'}" style="animation-delay:-${r1(hash(i * 13 + k, 9) * 3)}s" cx="${r1(x)}" cy="${r1(y)}" r="5" fill="${colour}"/>`)
    }
  }
  const lightOpacity = r1(1 - s * 0.55)
  const trunk = `<rect x="${TREE_X - 14}" y="${400 + 5 * 72 + 118}" width="28" height="40" fill="#5b3a26"/>`
  const starGlow = ctx.activity === 'success' ? 'pulseBig' : 'pulse'
  const star = `<circle class="${starGlow}" cx="${TREE_X}" cy="380" r="46" fill="url(#starGlow)"/><path d="M${TREE_X} 352L${TREE_X + 8} 372L${TREE_X + 29} 373L${TREE_X + 12} 386L${TREE_X + 18} 407L${TREE_X} 395L${TREE_X - 18} 407L${TREE_X - 12} 386L${TREE_X - 29} 373L${TREE_X - 8} 372Z" fill="#ffd25a"/>`
  const sparks =
    ctx.activity === 'success'
      ? `<g fill="#ffe9a0">${Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2
          return `<circle class="spark" style="--dx:${r1(Math.cos(a) * 90)}px;--dy:${r1(Math.sin(a) * 90)}px;animation-delay:-${r1(hash(i, 31) * 1.6)}s" cx="${TREE_X}" cy="380" r="3.5"/>`
        }).join('')}</g>`
      : ''
  return `${trunk}${parts.join('')}<g opacity="${lightOpacity}"><g filter="url(#soft)">${lights.join('')}</g>${lights.join('')}</g>${star}${sparks}`
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

/** Snow falling in two layers; each layer holds its flakes twice, a screen apart, so the loop never shows a seam. */
function snowfall(s: number): string {
  const layer = (seed: number, count: number, rMin: number, rSpan: number, cls: string, opacity: number) => {
    const flakes: string[] = []
    for (let i = 0; i < count; i++) {
      const x = Math.round(hash(i, seed) * 1600)
      const y = Math.round(hash(i, seed + 1) * 1000)
      const r = r1(rMin + hash(i, seed + 2) * rSpan)
      flakes.push(`<circle cx="${x}" cy="${y}" r="${r}"/><circle cx="${x}" cy="${y - 1000}" r="${r}"/>`)
    }
    return `<g class="${cls}" fill="#ffffff" opacity="${opacity}"><g class="drift">${flakes.join('')}</g></g>`
  }
  const near = Math.round(18 + s * 40)
  const far = Math.round(30 + s * 50)
  return `${layer(51, far, 1, 1.4, 'fallSlow', 0.6)}${layer(61, near, 2, 2, 'fall', 0.85)}`
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
.fall{animation:fall 16s linear infinite}.fallSlow{animation:fall 28s linear infinite}
.drift{animation:drift 6s ease-in-out infinite alternate}
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
<filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5"/></filter>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" width="100%" height="100%" preserveAspectRatio="xMidYMid slice"><style>${style}</style><defs>${defs}</defs>
<rect width="1600" height="1000" fill="url(#sky)"/>
<rect y="560" width="1600" height="340" fill="url(#haze)"/>
${stars(p)}
${aurora(p)}
${moonOrSun(p, ctx.phase)}
${shootingStar(ctx)}
${mountains(p)}
${backPines(p)}
${cabin(ctx, p)}
${tree(ctx, s)}
${gifts()}
${lampPost(ctx)}
${snowman()}
${drifts(p, s)}
${signs(ctx, g)}
${snowfall(s)}
</svg>`
}

function glass(ctx: SceneCtx): { blur: number; tint: string; opacity: number } {
  return ctx.phase === 'day' ? { blur: 12, tint: '#16224a', opacity: 0.38 } : { blur: 12, tint: '#0a1030', opacity: 0.42 }
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
