import { expect, test } from 'claude-code/testing'

import { RULE_IDS, contrast, exceptionStated, isUiFile, parseColor, parseLevels, parseProjectConfig, rangesOf, scan } from '../hooks/rules.ts'

const ids = (path: string, src: string, o = {}) => scan(path, src, o).map(f => f.rule)
const has = (path: string, src: string, rule: string, o = {}) => ids(path, src, o).includes(rule as never)

test('files: UI sources only, never vendored, built, minified or test fixtures', async () => {
  for (const p of ['src/app/page.tsx', 'a/b.css', 'x.scss', 'index.html', 'C.vue', 'D.svelte', 'E.astro', 'F.jsx', 'tailwind.config.ts'])
    expect(isUiFile(p)).toBe(true)
  for (const p of ['src/a.ts', 'README.md', 'node_modules/x/a.css', 'dist/app.css', 'a.min.css', 'src/__tests__/a.tsx', 'tests/fixtures/page.html', 'Page.test.tsx', 'C:\\w\\vendor\\b.css'])
    expect(isUiFile(p)).toBe(false)
})

test('rangesOf finds every occurrence of the new text as 1-based line ranges', async () => {
  expect(rangesOf('a\nb\nc\nb', 'b')).toEqual([[2, 2], [4, 4]])
  expect(rangesOf('a\nb\nc', 'b\nc')).toEqual([[2, 3]])
  expect(rangesOf('a', '')).toEqual([])
})

test('only findings inside the edited range come back', async () => {
  const src = '.a { background-clip: text; }\n.b { color: red; }\n.c { background-clip: text; }'
  expect(scan('x.css', src, { ranges: [[2, 3]] }).map(f => f.line)).toEqual([3])
})

// 1
test('purple-gradient: violet/indigo gradients warn; neutral scrims, blue gradients and mask fades pass', async () => {
  expect(has('a.css', '.hero { background: linear-gradient(135deg, #6366f1, #a855f7); }', 'purple-gradient')).toBe(true)
  expect(has('a.tsx', '<div className="bg-gradient-to-r from-indigo-500 to-purple-600" />', 'purple-gradient')).toBe(true)
  expect(has('a.tsx', '<div className="bg-gradient-to-r from-[#7c3aed] to-black" />', 'purple-gradient')).toBe(true)
  expect(has('a.css', '.scrim { background: linear-gradient(to top, rgba(0,0,0,.6), transparent); }', 'purple-gradient')).toBe(false)
  expect(has('a.css', '.x { background: linear-gradient(#2563eb, #1e40af); }', 'purple-gradient')).toBe(false)
  expect(has('a.css', '.fade { mask-image: linear-gradient(90deg, #7c3aed, transparent); }', 'purple-gradient')).toBe(false)
})

// 2
test('gradient-text blocks; a prefixed twin is one finding', async () => {
  const f = scan('a.css', 'h1 {\n  -webkit-background-clip: text;\n  background-clip: text;\n}')
  expect(f.filter(x => x.rule === 'gradient-text').length).toBe(1)
  expect(f[0]?.blocks).toBe(true)
  expect(has('a.tsx', '<h1 className="bg-clip-text text-transparent bg-gradient-to-r">Hi</h1>', 'gradient-text')).toBe(true)
  expect(has('a.tsx', '<span style={{ backgroundClip: "text" }}>x</span>', 'gradient-text')).toBe(true)
  expect(has('a.css', '.card { background-clip: padding-box; }', 'gradient-text')).toBe(false)
})

// 3
test('glow: halos, rings and coloured shadows block; offset shadows, 1px hairlines and neutral menu shadows pass', async () => {
  expect(has('a.css', '.card { box-shadow: 0 0 40px rgba(124, 58, 237, .5); }', 'glow')).toBe(true)
  expect(has('a.css', '.card { box-shadow: 0 0 20px rgba(0,0,0,.1); }', 'glow')).toBe(true) // a soft halo around a box
  expect(has('a.css', 'input:focus { box-shadow: 0 0 0 3px #93c5fd; }', 'glow')).toBe(true)
  expect(has('a.tsx', '<button className="focus:ring-2 focus:ring-indigo-500">Go</button>', 'glow')).toBe(true)
  expect(has('a.tsx', '<div className="shadow-lg shadow-indigo-500/50" />', 'glow')).toBe(true)
  expect(has('a.tsx', '<div className="shadow-[0_0_30px_rgba(124,58,237,0.5)]" />', 'glow')).toBe(true)
  expect(has('a.css', '.t { text-shadow: 0 0 12px #22d3ee; }', 'glow')).toBe(true)
  expect(scan('a.css', '.x { box-shadow: 0 0 8px #f0f; }')[0]?.blocks).toBe(true)

  expect(has('a.css', '.card { box-shadow: 0 1px 2px rgba(0,0,0,.06); }', 'glow')).toBe(false)
  expect(has('a.css', '.card { box-shadow: 0 0 0 1px rgba(0,0,0,.08); }', 'glow')).toBe(false) // one hairline
  expect(has('a.tsx', '<div className="ring-1 ring-black/5 ring-0 ring-inset" />', 'glow')).toBe(false)
  expect(has('a.css', '.dropdown-menu { box-shadow: 0 0 24px rgba(0,0,0,.18); }', 'glow')).toBe(false)
  expect(has('a.css', '.caption { text-shadow: 0 0 4px rgba(0,0,0,.6); }', 'glow')).toBe(false) // legibility over a photo
  expect(has('a.css', '.dialog { box-shadow: 0 0 30px #a855f7; }', 'glow')).toBe(true) // coloured glow is a glow anywhere
  expect(has('a.css', '.radio.is-picked { box-shadow: inset 0 0 0 4px var(--ember); }', 'glow')).toBe(false) // a border drawn inside
  expect(has('a.css', '.well { box-shadow: inset 0 0 18px rgba(124,58,237,.6); }', 'glow')).toBe(true) // an inner glow is still a glow
})

test('corpus regressions: @supports conditions, dialog backdrops, focus patterns', async () => {
  const sup = '@supports (background-clip: text) {\n  .a { background-clip: text; }\n}'
  expect(scan('a.css', sup).filter(f => f.rule === 'gradient-text').map(f => f.line)).toEqual([2])
  expect(has('a.css', '.nav { backdrop-filter: blur(8px); }\ndialog::backdrop { backdrop-filter: blur(6px); }', 'glass')).toBe(false)
  expect(has('a.css', ':focus:not(:focus-visible) { outline: none; }', 'focus-removed')).toBe(false)
  const bare = scan('a.css', '.link:focus-visible { outline: none; }')
  expect(bare.map(f => [f.rule, f.project])).toEqual([['focus-removed', undefined]])
})

// 4
test('glass: one blur per file is allowed, the second warns; a -webkit- twin is not a second', async () => {
  expect(has('a.css', '.nav { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }', 'glass')).toBe(false)
  expect(has('a.css', '.nav {\n  backdrop-filter: blur(8px);\n  -webkit-backdrop-filter: blur(8px);\n}', 'glass')).toBe(false)
  const two = scan('a.tsx', '<nav className="backdrop-blur" />\n<div className="backdrop-blur-md bg-white/10" />')
  expect(two.map(f => [f.rule, f.line])).toEqual([['glass', 2]])
})

// 5
test('banned-font: page faces, theme tokens, configs and imports block; fallbacks, brand fonts and good faces pass', async () => {
  const body = scan('a.css', "body { font-family: 'Inter', sans-serif; }")
  expect(body.map(f => [f.rule, f.blocks])).toEqual([['banned-font', true]])
  expect(has('a.css', ':root { --font-sans: "Poppins", system-ui; }', 'banned-font')).toBe(true)
  expect(has('a.css', 'html { font-family: var(--font-inter), sans-serif; }', 'banned-font')).toBe(true)
  expect(has('tailwind.config.ts', "    sans: ['DM Sans', ...defaultTheme.fontFamily.sans],", 'banned-font')).toBe(true)
  expect(has('app/layout.tsx', "import { Inter, Fraunces } from 'next/font/google'", 'banned-font')).toBe(true)
  expect(has('app/layout.tsx', "import { DM_Sans as Sans } from 'next/font/google'", 'banned-font')).toBe(true)
  expect(has('index.html', '<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;700" rel="stylesheet">', 'banned-font')).toBe(true)

  expect(has('a.css', "body { font-family: 'Instrument Sans', 'Inter', sans-serif; }", 'banned-font')).toBe(false) // Inter only as a fallback
  expect(has('a.css', "body { font-family: 'Geist', sans-serif; }", 'banned-font')).toBe(false)
  expect(has('a.css', "code, pre { font-family: 'JetBrains Mono', monospace; }", 'banned-font')).toBe(false)
  expect(has('a.css', "body { font-family: 'Inter', sans-serif; }", 'banned-font', { brandFonts: ['Inter'] })).toBe(false)
  expect(has('a.css', "body { font-family: 'Montserrat'; }", 'banned-font', { extraFonts: ['Montserrat'] })).toBe(true)

  // On one component it is reported but never blocks; a system-ui-only page face is advisory too.
  const comp = scan('a.css', '.g-signin { font-family: Roboto, arial; }')
  expect(comp.map(f => [f.rule, f.blocks])).toEqual([['banned-font', false]])
  const sys = scan('a.css', 'body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }')
  expect(sys.map(f => [f.rule, f.blocks])).toEqual([['banned-font', false]])
})

// 6
test('icon-tile-cards: repeated icon-in-tinted-tile cards warn; a single icon passes', async () => {
  const mapped = [
    "import { Zap } from 'lucide-react'",
    '{features.map(f => (',
    '  <div key={f.title}>',
    '    <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">',
    '      <f.icon className="w-6 h-6" />',
    '    </div>',
    '    <h3>{f.title}</h3>',
    '  </div>',
    '))}',
  ].join('\n')
  expect(has('a.tsx', mapped, 'icon-tile-cards')).toBe(true)
  const single = ['<div className="w-12 h-12 rounded-xl bg-indigo-50"><ZapIcon /></div>', '<h3>Fast</h3>'].join('\n')
  expect(has('a.tsx', single, 'icon-tile-cards')).toBe(false)
})

// 7
test('emoji-ui: emoji in rendered text warn; ©, ™, arrows and data files pass', async () => {
  expect(has('a.tsx', '<h2>🚀 Ship faster</h2>', 'emoji-ui')).toBe(true)
  expect(has('a.tsx', '<button>Start ✨</button>', 'emoji-ui')).toBe(true)
  expect(has('a.tsx', '<footer>© 2026 Boat™ · Docs ↗</footer>', 'emoji-ui')).toBe(false)
  expect(has('src/locales/en.tsx', '<h2>🚀 Ship</h2>', 'emoji-ui')).toBe(false)
  expect(has('a.tsx', '// 🚀 launch helper\nconst x = 1', 'emoji-ui')).toBe(false)
})

// 8
test('left-border-card: rounded card with a thick left border warns; blockquotes and callouts pass', async () => {
  expect(has('a.tsx', '<div className="rounded-lg border-l-4 border-indigo-500 p-4">', 'left-border-card')).toBe(true)
  expect(has('a.css', '.feature { border-left: 4px solid #6366f1; border-radius: 12px; }', 'left-border-card')).toBe(true)
  expect(has('a.css', 'blockquote { border-left: 4px solid #ccc; border-radius: 4px; }', 'left-border-card')).toBe(false)
  expect(has('a.tsx', '<aside className="callout rounded border-l-4">', 'left-border-card')).toBe(false)
})

// 9
test('hype-copy: genre words in rendered copy warn; identifiers, imports and comments never', async () => {
  expect(has('a.tsx', '<h1>Supercharge your workflow</h1>', 'hype-copy')).toBe(true)
  expect(has('a.tsx', '<p>\n  Seamless deploys for every team.\n</p>', 'hype-copy')).toBe(true)
  expect(has('a.tsx', "const features = [{ title: 'Unlock insights', body: 'x' }]", 'hype-copy')).toBe(true)
  expect(has('a.html', '<h1>Welcome to Acmeless</h1>', 'hype-copy')).toBe(true)
  expect(has('a.tsx', "<p>It's not just a sandbox, it's a fleet.</p>", 'hype-copy')).toBe(true)
  expect(has('a.tsx', "import { unlockSession } from './seamless'\nconst elevate = useElevate()", 'hype-copy')).toBe(false)
  expect(has('a.tsx', '{/* seamless fallback */}\n<p>Wakes in 0.6 s.</p>', 'hype-copy')).toBe(false)
})

// 10
test('lazy-cta: a lone stock label warns; a nav link or a specific neighbour passes', async () => {
  expect(has('a.tsx', '<section>\n  <h2>Pricing</h2>\n  <Button onClick={() => go()}>Learn more</Button>\n</section>', 'lazy-cta')).toBe(true)
  expect(has('a.tsx', '<nav>\n  <a href="/login">Log in</a>\n  <a href="/start">Get started</a>\n</nav>', 'lazy-cta')).toBe(false)
  expect(has('a.tsx', '<div>\n  <a href="/new">Start a sandbox</a>\n  <a href="/docs">Learn more</a>\n</div>', 'lazy-cta')).toBe(false)
})

// 11
test('fake-content blocks: lorem, placeholder images, stock avatars, Acme, star rows, invented proof counts', async () => {
  for (const src of [
    '<p>Lorem ipsum dolor sit amet</p>',
    '<img src="https://via.placeholder.com/600x400" alt="" />',
    '<img src="https://i.pravatar.cc/80?img=3" alt="Sarah" />',
    '<cite>Jane Doe, CEO at Acme Inc</cite>',
    '<span aria-hidden>★★★★★</span>',
    '<p>Trusted by 10,000+ teams worldwide</p>',
    "const hero = { tagline: 'Join over 50,000 developers' }",
  ]) {
    const f = scan('a.tsx', src).filter(x => x.rule === 'fake-content')
    expect(f.length).toBe(1)
    expect(f[0]?.blocks).toBe(true)
  }
})

test('fake-content guards: input placeholders, comments, stories and slop-ok with a reason', async () => {
  expect(has('a.tsx', '<input name="name" placeholder="John Doe" />', 'fake-content')).toBe(false)
  expect(has('a.tsx', '{/* lorem ipsum until copy lands */}\n<p>Real copy.</p>', 'fake-content')).toBe(false)
  expect(has('Hero.stories.tsx', '<p>Lorem ipsum</p>', 'fake-content')).toBe(false)
  expect(has('a.tsx', '<p>Trusted by 12,000+ teams</p> {/* slop-ok: source=https://example.com/annual-report */}', 'fake-content')).toBe(false)
  expect(has('a.tsx', '{/* slop-ok: source=https://example.com/report */}\n<p>Trusted by 12,000+ teams</p>', 'fake-content')).toBe(false)
  expect(has('a.tsx', '<p>Trusted by 12,000+ teams</p> {/* slop-ok */}', 'fake-content')).toBe(true) // a reason is required
})

// 12
test('unsourced-proof: round numbers and trust claims warn; prices and real specs pass', async () => {
  expect(has('a.tsx', '<strong>99.99% uptime</strong>', 'unsourced-proof')).toBe(true)
  expect(has('a.tsx', '<p>10x faster builds</p>', 'unsourced-proof')).toBe(true)
  expect(has('a.tsx', '<p>Trusted by Meta and Mayo Clinic</p>', 'unsourced-proof')).toBe(true)
  expect(has('a.tsx', '<p>From $0.011 / hour awake. Wakes in 0.6 s.</p>', 'unsourced-proof')).toBe(false)
  expect(has('a.tsx', '<p>The key used by the CLI lives in your keychain.</p>', 'unsourced-proof')).toBe(false)
})

// 13
test('eyebrow-every-heading: three or more warn; one or two pass; technical mode relaxes it', async () => {
  const label = (t: string) => `<p className="text-xs uppercase tracking-widest">${t}</p>\n<h2>${t} heading</h2>`
  const three = [label('Applications'), label('Company'), label('Public sector')].join('\n')
  expect(scan('a.tsx', three).filter(f => f.rule === 'eyebrow-every-heading').length).toBe(3)
  expect(has('a.tsx', [label('Applications'), label('Company')].join('\n'), 'eyebrow-every-heading')).toBe(false)
  expect(has('a.tsx', three, 'eyebrow-every-heading', { technical: true })).toBe(false)
})

test('devices the owner allows are never flagged: a mono caption with data, hairline grids, index numbers, pill nav', async () => {
  const src = [
    '<nav className="fixed top-4 rounded-full px-4">',
    '<figcaption className="font-mono text-xs">$ boat new my-app → 4 active</figcaption>',
    '<div className="grid grid-cols-3 divide-x divide-neutral-200 border-t border-neutral-200">',
    '<span className="text-xs uppercase tracking-wide">Step 1 of 3</span>',
    '<ol><li>01 Create</li></ol>',
  ].join('\n')
  expect(ids('a.tsx', src)).toEqual([])
})

// 14
test('autopilot-motion: transition all, bounce easing, pulsing dots and fade-up everywhere warn; loaders pass', async () => {
  expect(has('a.css', '.btn { transition: all .3s ease; }', 'autopilot-motion')).toBe(true)
  expect(has('a.tsx', '<a className="transition-all hover:-translate-y-1">x</a>', 'autopilot-motion')).toBe(true)
  expect(has('a.css', '.x { transition-timing-function: cubic-bezier(.34, 1.56, .64, 1); }', 'autopilot-motion')).toBe(true)
  expect(has('a.tsx', '<span className="h-2 w-2 rounded-full bg-green-500 animate-ping" />', 'autopilot-motion')).toBe(true)
  const fades = Array.from({ length: 4 }, (_, i) => `<section className="fade-in-up">${i}</section>`).join('\n')
  expect(scan('a.tsx', fades).filter(f => f.rule === 'autopilot-motion').length).toBe(4)
  expect(has('a.tsx', fades.split('\n').slice(0, 3).join('\n'), 'autopilot-motion')).toBe(false)
  expect(has('a.css', '.btn { transition: background-color .15s ease, color .15s ease; }', 'autopilot-motion')).toBe(false)
  expect(has('Skeleton.tsx', '<div className="h-2 w-2 rounded-full animate-pulse transition-all" />', 'autopilot-motion')).toBe(false)
})

// 15
test('no-reduced-motion: a project-level candidate unless the file already handles it', async () => {
  const f = scan('a.css', '@keyframes drift { to { transform: translateX(10px) } }')
  expect(f.map(x => [x.rule, x.project])).toEqual([['no-reduced-motion', 'reduced-motion']])
  expect(has('a.css', '@keyframes drift {}\n@media (prefers-reduced-motion: reduce) { * { animation: none } }', 'no-reduced-motion')).toBe(false)
})

// 16
test('focus-removed: outline none with no replacement is a project-level candidate; a fill-change focus passes', async () => {
  expect(scan('a.tsx', '<button className="outline-none">x</button>').map(x => x.project)).toEqual(['focus-visible'])
  expect(has('a.tsx', '<button className="focus:outline-none focus-visible:bg-neutral-100">x</button>', 'focus-removed')).toBe(false)
  expect(has('a.css', 'a:focus-visible { outline: none; background: #eef; }', 'focus-removed')).toBe(false)
})

// 17
test('a11y-floor: img without alt, blocked zoom, low literal contrast; alt="" and large text pass', async () => {
  expect(has('a.tsx', '<img src="/hero.jpg" />', 'a11y-floor')).toBe(true)
  expect(has('a.tsx', '<Image\n  src={hero}\n  onLoad={() => setReady(true)}\n/>', 'a11y-floor')).toBe(true)
  expect(has('a.html', '<meta name="viewport" content="width=device-width, user-scalable=no">', 'a11y-floor')).toBe(true)
  expect(has('a.css', '.muted { color: #999; background: #fff; }', 'a11y-floor')).toBe(true)
  expect(has('a.tsx', '<img src="/rule.svg" alt="" />', 'a11y-floor')).toBe(false)
  expect(has('a.tsx', '<img {...props} />', 'a11y-floor')).toBe(false)
  expect(has('a.css', '.big { color: #888; background: #fff; font-size: 32px; }', 'a11y-floor')).toBe(false)
  expect(has('a.css', 'button:disabled { color: #bbb; background: #fff; }', 'a11y-floor')).toBe(false)
})

test('code blocks and data-ui fragments are left alone', async () => {
  const src = ['<pre><code>', 'box-shadow: 0 0 40px #a855f7;', '</code></pre>', '<div data-ui="dashboard">', '  <div className="ring-2 rounded-xl">Lorem ipsum</div>', '</div>', '<p>Real copy</p>'].join('\n')
  expect(ids('a.tsx', src)).toEqual([])
})

test('level overrides: off silences, warn stops blocking, block makes a warning hold the turn', async () => {
  const { levels, unknown } = parseLevels('hype-copy, glow=warn lazy-cta=block nonsense banned-font=loud')
  expect([...levels]).toEqual([['hype-copy', 'off'], ['glow', 'warn'], ['lazy-cta', 'block']])
  expect(unknown).toEqual(['nonsense', 'banned-font=loud'])
  expect(has('a.tsx', '<h1>Supercharge</h1>', 'hype-copy', { levels })).toBe(false)
  expect(scan('a.css', '.x { box-shadow: 0 0 20px #f0f; }', { levels })[0]?.blocks).toBe(false)
  expect(scan('a.tsx', '<section><a href="/x">Learn more</a></section>', { levels })[0]?.blocks).toBe(true)
})

test('project config, colour maths and the exception statement', async () => {
  expect(parseProjectConfig('{"mode":"technical","ignore":["glass","bogus"],"brandFonts":["Inter"]}')).toEqual({ mode: 'technical', ignore: ['glass'], brandFonts: ['Inter'] })
  expect(parseProjectConfig('not json')).toEqual({ mode: 'default', ignore: [], brandFonts: [] })
  expect(Math.round(contrast(parseColor('#000') as never, parseColor('#fff') as never))).toBe(21)
  expect(parseColor('hsl(0 100% 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
  expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
  expect(has('a.css', '.x { background: linear-gradient(hsl(258 90% 66%), hsl(271 91% 65%)); }', 'purple-gradient')).toBe(true)
  expect(exceptionStated('Inter is the client brand font, kept on purpose.', false)).toBe(true)
  expect(exceptionStated('Inter is kept on purpose.', true)).toBe(false)
  expect(exceptionStated('slop-guard exception: Inter is the client brand font.', true)).toBe(true)
  expect(RULE_IDS.length).toBe(17)
})
