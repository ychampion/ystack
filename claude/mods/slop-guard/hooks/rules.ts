// slop-guard: pure detection of objectively detectable AI-design tells in UI source.
// Nothing here touches the engine; register.ts wires it to edits, Stop and the /slop-guard command.
//
// Principle: ban meaningless defaults, never devices. Monospace, hairlines, numbers, pill nav and
// uppercase labels are not rules here; meaning decides those, and meaning is the taste skill's job.

export type Level = 'off' | 'warn' | 'block'

export type RuleId =
  | 'purple-gradient'
  | 'gradient-text'
  | 'glow'
  | 'glass'
  | 'banned-font'
  | 'icon-tile-cards'
  | 'emoji-ui'
  | 'left-border-card'
  | 'hype-copy'
  | 'lazy-cta'
  | 'fake-content'
  | 'unsourced-proof'
  | 'eyebrow-every-heading'
  | 'autopilot-motion'
  | 'no-reduced-motion'
  | 'focus-removed'
  | 'a11y-floor'

export type Rule = { id: RuleId; level: Exclude<Level, 'off'>; why: string; fix: string }

/** The 17 rules. `block` rules are reported on every edit and hold the turn at Stop until fixed or explained. */
export const RULES: readonly Rule[] = [
  { id: 'purple-gradient', level: 'warn', why: 'Violet/indigo gradients are the first-wave generated look; they say "AI made this" before a word is read.', fix: 'A flat colour from the palette, or a real image. A neutral scrim over a photo is fine.' },
  { id: 'gradient-text', level: 'block', why: 'Gradient-filled text is the most recognisable generated-UI tell, and it fails contrast on half its letters.', fix: 'Solid ink. Emphasis comes from the words or from size.' },
  { id: 'glow', level: 'block', why: 'Glows, halos and rings around boxes read as generated (owner rule: never outline or glow a box).', fix: 'Separate surfaces with a flat fill one shade off the ground and spacing; show focus with a fill change, not a ring.' },
  { id: 'glass', level: 'warn', why: 'Frosted glass panels are a 2024 tell; one blurred sticky bar is the most a page can carry.', fix: 'Opaque surfaces one tone step from the ground.' },
  { id: 'banned-font', level: 'block', why: 'Rounded "friendly" sans faces and default Inter/Roboto are the generic model fonts.', fix: 'One crisp neutral sans with character (e.g. Instrument Sans, Geist) or the project\'s brand font; list a brand font in .slop-guard.json "brandFonts".' },
  { id: 'icon-tile-cards', level: 'warn', why: 'Rows of cards topped by an icon in a tinted square: 1% of top-scored sites against 28% of weak ones.', fix: 'One composed section: a list set large, a real product fragment per item, or a narrative split.' },
  { id: 'emoji-ui', level: 'warn', why: 'Emoji as icons, bullets or heading decoration read as a template.', fix: 'Words, a real picture, or a drawn icon in the page\'s own line weight.' },
  { id: 'left-border-card', level: 'warn', why: 'The rounded card with a thick coloured left border is a stock generated component.', fix: 'A tone step, a heading, or nothing. Keep left borders for real blockquotes and doc callouts.' },
  { id: 'hype-copy', level: 'warn', why: 'Genre words (unlock, supercharge, seamless...) carry no information; buyers skip them.', fix: 'Say what it does in plain words with a concrete noun or number.' },
  { id: 'lazy-cta', level: 'warn', why: '"Get started" / "Learn more" alone says nothing about what happens next.', fix: 'Name the action ("Start a sandbox", "See pricing"), or pair it with a specific second action.' },
  { id: 'fake-content', level: 'block', why: 'Placeholder or invented proof (lorem ipsum, stock avatars, "Acme", star rows, "Trusted by 10,000+ teams") is dishonest and reads as unfinished.', fix: 'Real content, or leave the slot out. A real claim stays with `slop-ok: source=<url>`.' },
  { id: 'unsourced-proof', level: 'warn', why: 'Big round numbers and "trusted by" claims persuade only when they are true and checkable.', fix: 'Confirm the source and mark it `slop-ok: source=<url>`, or cut the number.' },
  { id: 'eyebrow-every-heading', level: 'warn', why: 'A tiny tracked uppercase label above every heading is decoration; one or two that name real categories are fine.', fix: 'Keep labels that name a real category; fold the rest into the heading or delete them.' },
  { id: 'autopilot-motion', level: 'warn', why: 'Motion with no reason (transition: all, the same fade-up everywhere, bounce easing, pulsing dots) reads as a template.', fix: 'Transition named properties; one signature move tied to the story; standard easing.' },
  { id: 'no-reduced-motion', level: 'warn', why: 'Animation without a prefers-reduced-motion fallback makes some visitors ill.', fix: 'Add a prefers-reduced-motion: reduce rule (or useReducedMotion / motion-reduce:) that keeps content and drops travel.' },
  { id: 'focus-removed', level: 'warn', why: 'Removing the focus outline with no replacement strands keyboard users.', fix: 'Show focus with a fill or colour change in :focus-visible (no ring), or keep the outline.' },
  { id: 'a11y-floor', level: 'warn', why: 'Missing alt text, blocked zoom and low contrast fail real people before any taste question.', fix: 'alt on every image (alt="" if decorative), allow zoom, text contrast of at least 4.5:1 (3:1 for large text).' },
]

export const RULE_IDS: readonly RuleId[] = RULES.map(r => r.id)
const RULE_BY_ID = new Map(RULES.map(r => [r.id, r]))
export const ruleOf = (id: RuleId): Rule => RULE_BY_ID.get(id) as Rule

export type Finding = {
  rule: RuleId
  /** 1-based line in the file. */
  line: number
  /** Whether this finding holds the turn at Stop (after level overrides). */
  blocks: boolean
  /** What matched, short. */
  match: string
  /** The offending line, trimmed: also the key used to tell at Stop whether it was fixed. */
  text: string
  /** A rule-specific note, when the generic why is not enough. */
  note?: string
  /** Set when the finding only stands if the project as a whole lacks something (checked once per project). */
  project?: 'reduced-motion' | 'focus-visible'
}

type Hit = Finding & { advisory?: boolean }

export type ScanOptions = {
  /** 1-based inclusive line ranges holding the new text; findings outside them are dropped. Absent = whole file. */
  ranges?: readonly (readonly [number, number])[]
  levels?: ReadonlyMap<RuleId, Level>
  extraFonts?: readonly string[]
  brandFonts?: readonly string[]
  technical?: boolean
}

// ---------------------------------------------------------------- settings

/** Parses "hype-copy, banned-font=warn lazy-cta=off glass=block" into rule levels. Unknown ids are returned apart. */
export function parseLevels(text: string): { levels: Map<RuleId, Level>; unknown: string[] } {
  const levels = new Map<RuleId, Level>()
  const unknown: string[] = []
  for (const raw of text.split(/[\s,;]+/)) {
    const tok = raw.trim()
    if (!tok) continue
    const [id, lvl] = tok.split(/[=:]/) as [string, string | undefined]
    const level: Level | undefined = lvl === undefined ? 'off' : lvl === 'off' || lvl === 'warn' || lvl === 'block' ? lvl : undefined
    if (RULE_BY_ID.has(id as RuleId) && level) levels.set(id as RuleId, level)
    else unknown.push(tok)
  }
  return { levels, unknown }
}

export const parseList = (text: string): string[] =>
  text
    .split(/[,;\n]+/)
    .map(s => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)

export type ProjectConfig = { mode: 'default' | 'technical'; ignore: RuleId[]; brandFonts: string[] }

/** Reads a `.slop-guard.json`; anything malformed is ignored rather than trusted. */
export function parseProjectConfig(json: string): ProjectConfig {
  const out: ProjectConfig = { mode: 'default', ignore: [], brandFonts: [] }
  let v: unknown
  try {
    v = JSON.parse(json)
  } catch {
    return out
  }
  if (!v || typeof v !== 'object') return out
  const o = v as Record<string, unknown>
  if (o.mode === 'technical') out.mode = 'technical'
  if (Array.isArray(o.ignore)) out.ignore = o.ignore.filter((x): x is RuleId => typeof x === 'string' && RULE_BY_ID.has(x as RuleId))
  if (Array.isArray(o.brandFonts)) out.brandFonts = o.brandFonts.filter((x): x is string => typeof x === 'string')
  return out
}

// ---------------------------------------------------------------- files

const UI_EXT = /\.(css|scss|sass|less|tsx|jsx|html?|vue|svelte|astro)$/i
const TW_CONFIG = /(^|[\\/])tailwind\.config\.(js|cjs|mjs|ts)$/i
const MARKUP_EXT = /\.(tsx|jsx|html?|vue|svelte|astro)$/i
const SKIP_PATH =
  /(^|[\\/])(node_modules|vendor|dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.astro|\.turbo|\.vercel|__tests__|__fixtures__|fixtures|__snapshots__)([\\/]|$)|\.(test|spec)\.[jt]sx?$|\.min\.(css|js)$/i
const STORY_PATH = /\.stories\.[jt]sx?$|\.story\.[jt]sx?$/i

export const isUiFile = (path: string): boolean => (UI_EXT.test(path) || TW_CONFIG.test(path)) && !SKIP_PATH.test(path)

/** 1-based line ranges where `needle` sits in `content` (every occurrence, up to 50). */
export function rangesOf(content: string, needle: string): [number, number][] {
  if (!needle) return []
  const out: [number, number][] = []
  const span = needle.split('\n').length - 1
  let at = content.indexOf(needle)
  while (at !== -1 && out.length < 50) {
    const start = content.slice(0, at).split('\n').length
    out.push([start, start + span])
    at = content.indexOf(needle, at + Math.max(1, needle.length))
  }
  return out
}

// ---------------------------------------------------------------- masking

/** Replaces every char of [from, to) except newlines with a space, keeping offsets. */
function blank(chars: string[], from: number, to: number): void {
  for (let i = from; i < to && i < chars.length; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '
}

function stripComments(text: string): string {
  const chars = [...text]
  const src = chars.join('')
  const re = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|(^|[\s;{}])\/\/[^\n]*/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const lead = m[1] ?? ''
    blank(chars, m.index + lead.length, m.index + m[0].length)
  }
  return chars.join('')
}

/** Blanks <pre>/<code> contents and any element marked `data-ui` (a real app fragment keeps its own conventions). */
function stripSkipped(text: string): string {
  const chars = [...text]
  const lower = text.toLowerCase()
  for (const tag of ['pre', 'code']) {
    const open = new RegExp(`<${tag}\\b`, 'g')
    for (let m = open.exec(lower); m; m = open.exec(lower)) {
      const end = lower.indexOf(`</${tag}>`, m.index)
      if (end === -1) break
      blank(chars, m.index, end + tag.length + 3)
      open.lastIndex = end
    }
  }
  const ui = /<([A-Za-z][\w.-]*)\b[^>]*\bdata-ui\b[^>]*?(\/?)>/g
  for (let m = ui.exec(text); m; m = ui.exec(text)) {
    const tag = m[1] as string
    if (m[2] === '/') {
      blank(chars, m.index, m.index + m[0].length)
      continue
    }
    const walker = new RegExp(`<${tag.replace(/[.]/g, '\\.')}\\b[^>]*?(/?)>|</${tag.replace(/[.]/g, '\\.')}\\s*>`, 'g')
    walker.lastIndex = m.index + m[0].length
    let depth = 1
    let end = text.length
    for (let w = walker.exec(text); w; w = walker.exec(text)) {
      if (w[0].startsWith('</')) depth -= 1
      else if (w[1] !== '/') depth += 1
      if (depth === 0) {
        end = w.index + w[0].length
        break
      }
    }
    blank(chars, m.index, end)
    ui.lastIndex = end
  }
  return chars.join('')
}

type Block = { selector: string; start: number; end: number; body: string }

/** Every innermost `{...}` block with the selector before it: CSS rules (and, harmlessly, JS braces). */
function blocksOf(code: string): { blocks: Block[]; selectorsByLine: string[] } {
  const lineCount = code.split('\n').length
  const selectorsByLine: string[] = Array.from({ length: lineCount }, () => '')
  const stack: { selector: string; start: number; at: number; hasChild: boolean }[] = []
  const blocks: Block[] = []
  let line = 0
  let segStart = 0
  const note = (l: number) => {
    const sel = stack.map(s => s.selector).join(' | ')
    if (sel && !selectorsByLine[l]?.includes(sel)) selectorsByLine[l] = selectorsByLine[l] ? `${selectorsByLine[l]} || ${sel}` : sel
  }
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    if (c === '\n') {
      note(line)
      line += 1
      continue
    }
    if (c === '{') {
      const selector = code.slice(segStart, i).replace(/\s+/g, ' ').trim().slice(-200)
      const parent = stack[stack.length - 1]
      if (parent) parent.hasChild = true
      stack.push({ selector, start: line, at: i + 1, hasChild: false })
      note(line)
      segStart = i + 1
    } else if (c === '}') {
      note(line)
      const top = stack.pop()
      if (top && !top.hasChild) blocks.push({ selector: top.selector, start: top.start, end: line, body: code.slice(top.at, i) })
      segStart = i + 1
    } else if (c === ';') {
      segStart = i + 1
    }
  }
  note(line)
  return { blocks, selectorsByLine }
}

// ---------------------------------------------------------------- colour

type RGBA = { r: number; g: number; b: number; a: number }
const NAMED: Record<string, string> = {
  white: '#ffffff', black: '#000000', violet: '#ee82ee', indigo: '#4b0082', purple: '#800080', blueviolet: '#8a2be2',
  mediumpurple: '#9370db', rebeccapurple: '#663399', darkviolet: '#9400d3', mediumslateblue: '#7b68ee', slateblue: '#6a5acd',
  darkorchid: '#9932cc', darkslateblue: '#483d8b', gray: '#808080', grey: '#808080', red: '#ff0000', blue: '#0000ff',
}

export function parseColor(raw: string): RGBA | undefined {
  const s = raw.trim().toLowerCase()
  const named = NAMED[s]
  if (named) return parseColor(named)
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  let m = /^#([0-9a-f]{3,8})$/.exec(s)
  if (m) {
    const h = m[1] as string
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = [...h].map(x => parseInt(x + x, 16)) as [number, number, number, number | undefined]
      return { r, g, b, a: a === undefined ? 1 : a / 255 }
    }
    if (h.length === 6 || h.length === 8) {
      const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
      return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
    }
    return undefined
  }
  m = /^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(s)
  if (m) {
    const a = m[4] === undefined ? 1 : m[5] === '%' ? Number(m[4]) / 100 : Number(m[4])
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a }
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(s)
  if (m) {
    const h = Number(m[1]) % 360
    const sat = Number(m[2]) / 100
    const l = Number(m[3]) / 100
    const k = (n: number) => (n + h / 30) % 12
    const f = (n: number) => l - sat * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
    const a = m[4] === undefined ? 1 : m[5] === '%' ? Number(m[4]) / 100 : Number(m[4])
    return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255), a }
  }
  return undefined
}

function hsl({ r, g, b }: RGBA): { h: number; s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255]
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === R ? ((G - B) / d + (G < B ? 6 : 0)) * 60 : max === G ? ((B - R) / d + 2) * 60 : ((R - G) / d + 4) * 60
  return { h, s, l }
}

export const isPurple = (c: RGBA): boolean => {
  const { h, s, l } = hsl(c)
  return c.a > 0.15 && h >= 235 && h <= 290 && s >= 0.3 && l >= 0.15 && l <= 0.88
}

/** Grey or black-ish, the neutral of an elevation shadow rather than a coloured glow. */
const isNeutralDark = (c: RGBA): boolean => {
  const { s, l } = hsl(c)
  return s < 0.2 && l < 0.5
}

function luminance({ r, g, b }: RGBA): number {
  const ch = (v: number) => {
    const x = v / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

export function contrast(a: RGBA, b: RGBA): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number]
  return (x + 0.05) / (y + 0.05)
}

const COLOR_TOKEN = /#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?)\([^)]*\)|\b(?:white|black|violet|indigo|purple|blueviolet|mediumpurple|rebeccapurple|darkviolet|mediumslateblue|slateblue|darkorchid|darkslateblue|gray|grey|transparent)\b/gi
const colorsIn = (s: string): RGBA[] => (s.match(COLOR_TOKEN) ?? []).map(parseColor).filter((c): c is RGBA => c !== undefined)

// ---------------------------------------------------------------- fonts

const norm = (font: string) =>
  font
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

export const BANNED_FONTS = [
  'Nunito', 'Nunito Sans', 'Quicksand', 'Comfortaa', 'Varela Round', 'Poppins', 'Figtree', 'DM Sans',
  'Inter', 'Inter var', 'Inter Variable', 'InterVariable', 'Inter Display', 'Roboto', 'Roboto Flex',
]
const SYSTEM_FACES = new Set(['system ui', 'apple system', 'blinkmacsystemfont', 'ui sans serif', 'segoe ui', 'sans serif'])

function bannedSet(o: ScanOptions): Set<string> {
  const set = new Set([...BANNED_FONTS, ...(o.extraFonts ?? [])].map(norm))
  for (const b of o.brandFonts ?? []) set.delete(norm(b))
  return set
}

const firstFamily = (stack: string): string => norm(stack.split(',')[0] ?? '')

// ---------------------------------------------------------------- text extraction

const TEXT_PROPS =
  /\b(title|subtitle|heading|subheading|headline|description|desc|tagline|label|text|cta|body|quote|caption|summary|blurb|name|role|company|author|content|message)\s*[:=]\s*\{?\s*(["'`])((?:(?!\2).){2,})\2/g
const TEXT_ATTRS = /\b(title|alt|aria-label|placeholder|label)\s*=\s*(["'])([^"']{2,})\2/g
const CODE_START = /^\s*(import|export|const|let|var|return|if|else|function|type|interface|case|default|from|class|async|await|for|while|switch|try|catch|throw|new|@|\.|\}|\)|\]|<\/?script|<\/?style)\b/

type Seg = { kind: 'node' | 'attr' | 'prop'; name: string; text: string }

/** The human-readable copy on one line of markup: text nodes, copy attributes and copy-like object props. */
function segments(line: string, isMarkup: boolean, inStyle: boolean): Seg[] {
  if (!isMarkup || inStyle) return []
  const out: Seg[] = []
  const noExpr = line.replace(/\{[^{}]*\}/g, ' ')
  for (const m of noExpr.matchAll(/(?<![=\-])>([^<>]+)/g)) {
    const t = (m[1] ?? '').trim()
    if (/[A-Za-z\p{Extended_Pictographic}]/u.test(t)) out.push({ kind: 'node', name: '', text: t })
  }
  if (!/[<>]/.test(noExpr) && !CODE_START.test(line) && !/[=;(){}[\]]/.test(noExpr) && /\p{L}{2,}\W+\p{L}{2,}|\p{Extended_Pictographic}/u.test(noExpr)) {
    out.push({ kind: 'node', name: '', text: noExpr.trim() })
  }
  for (const m of line.matchAll(TEXT_ATTRS)) out.push({ kind: 'attr', name: (m[1] ?? '').toLowerCase(), text: m[3] ?? '' })
  for (const m of line.matchAll(TEXT_PROPS)) out.push({ kind: 'prop', name: (m[1] ?? '').toLowerCase(), text: m[3] ?? '' })
  return out
}

/** Tailwind-ish class tokens on a line, with variant prefixes (hover:, md:, dark:) removed. */
function tokens(line: string): string[] {
  const out: string[] = []
  const strings = line.match(/"[^"]*"|'[^']*'|`[^`]*`/g) ?? []
  const apply = /@apply\s+([^;]+)/.exec(line)
  const sources = [...strings.map(s => s.slice(1, -1)), ...(apply ? [apply[1] as string] : [])]
  for (const src of sources) for (const t of src.split(/\s+/)) if (t) out.push(t.replace(/^!/, ''))
  return out
}
const base = (t: string) => t.slice(t.lastIndexOf(':') + 1)

// ---------------------------------------------------------------- patterns

const HYPE =
  /\b(unlock(?:s|ed|ing)?|supercharg(?:e|es|ed|ing)|seamless(?:ly)?|elevat(?:e|es|ing)|effortless(?:ly)?|cutting[- ]edge|revolutioni[sz](?:e|es|ed|ing)|game[- ]?chang(?:er|ers|ing)|all[- ]in[- ]one|unleash(?:es|ed|ing)?|next[- ]level|world[- ]class|best[- ]in[- ]class)\b|\bwelcome to\b|\bin today['’]s\b|\b(?:not|isn['’]t) just\b[^.!?]{1,60}[,;—–-]\s*(?:it['’]?s|it is|we['’]re|but)\b/i
const LAZY_CTA = /^(get started|learn more|click here|read more|find out more)$/i
const PLACEHOLDER_URL =
  /\b(?:via\.placeholder\.com|placehold\.(?:co|it)|placekitten\.com|placebear\.com|picsum\.photos|dummyimage\.com|fakeimg\.pl|source\.unsplash\.com|(?:i\.)?pravatar\.cc|randomuser\.me|loremflickr\.com|logoipsum\.com)\b/i
const LOREM = /\blorem ipsum\b|\bdolor sit amet\b|\bconsectetur adipiscing\b/i
const FAKE_NAMES =
  /\b(?:John|Jane) (?:Doe|Smith)\b|\bAcme(?: (?:Inc|Corp|Co|Corporation|Labs))?\b|\b(?:Globex|Initech|Hooli|Cyberdyne|Wonka Industries|Stark Industries|Wayne Enterprises|Umbrella Corp(?:oration)?)\b|\b(?:Logo ?ipsum|Your (?:Company|Brand|Logo)|Company Name|Brand Name)\b/
const STAR_ROW = /[★⭐]{4,}/u
const PROOF_NOUNS =
  '(?:teams|companies|developers|devs|users|customers|businesses|people|engineers|brands|startups|founders|creators|professionals|organi[sz]ations|marketers|designers|clients|enterprises)'
const PROOF_COUNT = new RegExp(
  `\\b(?:(?:trusted|loved|used|chosen|relied on|backed|adopted)\\s+by|join(?:ed by)?)\\s+(?:over\\s+|more than\\s+)?\\d[\\d,.]*\\s*[kKmM]?\\+?\\s+${PROOF_NOUNS}\\b`,
  'i',
)
const PROOF_NUMBER =
  /\b\d{1,3}(?:,\d{3})+\+|\b\d+(?:\.\d+)?\s?[kKmMbB]\+|\b99(?:\.\d+)?%|\b\d+(?:\.\d+)?\s?[x×]\s+(?:faster|cheaper|more|better|quicker|less)\b|\b\d{1,3}%\s+(?:faster|cheaper|more|less|better|fewer|of (?:teams|companies|developers|customers|users|businesses))\b|\b(?:trusted|loved) by\b|\bused by (?:\d|over\b|more than\b|thousands\b|millions\b|teams\b|companies\b|developers\b)/i
const FLOATING = /menu|popover|dialog|modal|tooltip|dropdown|popup|toast|combobox|listbox|sheet|drawer|overlay|flyout/i
const EXEMPT_EMOJI = /[©®™‼⁉↔↕↖↗↘↙↩↪▪▫▶◀◻◼◽◾]/gu
const LOADING = /skeleton|loading|loader|spinner|shimmer|placeholder-anim|progress/i
const MOTION_SRC = /@keyframes\b|\bgsap\b|from\s+["'](?:framer-motion|motion\/react|motion)["']|\banimation\s*:|\banimate-\[|\bwhileInView\b/
const REDUCED_SRC = /prefers-reduced-motion|useReducedMotion|motion-reduce:|motion-safe:|reducedMotion/

// ---------------------------------------------------------------- shadows

type Shadow = { inset: boolean; x: number; y: number; blur: number; spread: number; color: RGBA | undefined }

function splitTop(value: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const c of value) {
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map(s => s.trim()).filter(Boolean)
}

function parseShadows(value: string): Shadow[] {
  return splitTop(value.replace(/_/g, ' '))
    .map(part => {
      const color = colorsIn(part)[0]
      const rest = part.replace(COLOR_TOKEN, ' ').replace(/var\([^)]*\)/g, ' ')
      const nums = [...rest.matchAll(/(-?[\d.]+)(px|rem|em)?\b/g)].map(m => Number(m[1]) * (m[2] === 'rem' || m[2] === 'em' ? 16 : 1))
      if (nums.length < 2) return undefined
      return { inset: /\binset\b/.test(part), x: nums[0] ?? 0, y: nums[1] ?? 0, blur: nums[2] ?? 0, spread: nums[3] ?? 0, color }
    })
    .filter((s): s is Shadow => s !== undefined)
}

/** 'glow' (zero-offset blur), 'ring' (zero-offset spread of 2px+), or undefined. A 1px ring is a hairline and passes. */
function shadowKind(s: Shadow): 'glow' | 'ring' | undefined {
  if (s.x !== 0 || s.y !== 0) return undefined
  if (s.blur > 2) return 'glow'
  // An inset spread with no blur is a border drawn inside the shape (a radio dot, a hollow node), not a halo.
  if (s.blur === 0 && s.spread >= 2 && !s.inset) return 'ring'
  return undefined
}

// ---------------------------------------------------------------- the scan

type Ctx = {
  path: string
  raw: string[]
  code: string[]
  selectors: string[]
  blocks: Block[]
  isMarkup: boolean
  isCss: boolean
  isTwConfig: boolean
  isStory: boolean
  styleLines: Set<number>
  exempt: Set<number>
  o: ScanOptions
}

/** Lines exempted by `slop-ok: <reason>` on the line itself, or on a comment-only line just above. A bare `slop-ok` with no reason exempts nothing. */
function exemptLines(raw: string[]): Set<number> {
  const out = new Set<number>()
  raw.forEach((l, i) => {
    if (!/slop-ok\s*:\s*[^\s*/>}-]/i.test(l)) return
    out.add(i)
    const rest = l.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/\/.*$/g, '').trim()
    if (rest === '') out.add(i + 1) // a comment-only line covers the line below it
  })
  return out
}

function styleRegionLines(text: string): Set<number> {
  const out = new Set<number>()
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = text.slice(0, m.index).split('\n').length - 1
    const end = start + m[0].split('\n').length - 1
    for (let i = start; i <= end; i++) out.add(i)
  }
  return out
}

function build(path: string, content: string, o: ScanOptions): Ctx {
  const raw = content.split('\n')
  const masked = stripSkipped(stripComments(content))
  const code = masked.split('\n').map(l => (l.length > 2000 ? '' : l))
  const { blocks, selectorsByLine } = blocksOf(masked)
  return {
    path,
    raw,
    code,
    selectors: selectorsByLine,
    blocks,
    isMarkup: MARKUP_EXT.test(path),
    isCss: /\.(css|scss|sass|less)$/i.test(path),
    isTwConfig: TW_CONFIG.test(path),
    isStory: STORY_PATH.test(path),
    styleLines: styleRegionLines(content),
    exempt: exemptLines(raw),
    o,
  }
}

const prop = (css: string) => {
  const camel = css.replace(/^-webkit-/, 'Webkit-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  return `(?<![\\w-])(?:${css}|${camel})\\s*:\\s*["'\`]?`
}
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Scans a UI file. With `ranges`, only findings on those lines come back (whole-file context is still used). */
export function scan(path: string, content: string, o: ScanOptions = {}): Finding[] {
  const c = build(path, content, o)
  const found: Hit[] = []
  const add = (rule: RuleId, i: number, match: string, extra: Partial<Hit> = {}) => {
    if (c.exempt.has(i)) return
    if (found.some(f => f.rule === rule && f.line === i + 1)) return
    found.push({ rule, line: i + 1, blocks: false, match: clip(match.trim()), text: (c.raw[i] ?? '').trim().slice(0, 200), ...extra })
  }

  purpleGradient(c, add)
  gradientText(c, add)
  glow(c, add)
  glass(c, add)
  bannedFont(c, add)
  iconTiles(c, add)
  emoji(c, add)
  leftBorder(c, add)
  copyRules(c, add)
  eyebrows(c, add)
  motion(c, add)
  focus(c, add)
  a11y(c, add)

  const levels = o.levels ?? new Map<RuleId, Level>()
  const inRange = (line: number) => !o.ranges || o.ranges.some(([a, b]) => line >= a && line <= b)
  return found
    .filter(f => inRange(f.line))
    .map(f => {
      const level = levels.get(f.rule) ?? ruleOf(f.rule).level
      if (level === 'off') return undefined
      // An advisory hit (a banned face on one component, a system-ui stack) never blocks, even under a block override.
      const { advisory, ...rest } = f
      return { ...rest, blocks: level === 'block' && advisory !== true }
    })
    .filter((f): f is Finding => f !== undefined)
    .sort((a, b) => a.line - b.line)
}

type Add = (rule: RuleId, i: number, match: string, extra?: Partial<Hit>) => void

function purpleGradient(c: Ctx, add: Add) {
  c.code.forEach((l, i) => {
    for (const m of l.matchAll(/(?:repeating-)?(?:linear|radial|conic)-gradient\(/g)) {
      // Gather the gradient's arguments, which may run over a few lines.
      let args = ''
      let depth = 0
      const tail = [l.slice(m.index ?? 0), ...c.code.slice(i + 1, i + 6)].join('\n')
      for (const ch of tail) {
        if (ch === '(') depth++
        if (ch === ')') depth--
        args += ch
        if (depth === 0 && args.includes('(')) break
      }
      if (/mask(-image)?\s*:|mask(Image)?\s*:/i.test(l)) continue // a mask fade, not a fill
      if (colorsIn(args).some(isPurple)) add('purple-gradient', i, args)
    }
    for (const t of tokens(l)) {
      const b = base(t)
      const tw = /^(?:from|via|to)-(violet|indigo|purple)-\d{2,3}(?:\/\d+)?$/.exec(b)
      const arb = /^(?:from|via|to)-\[([^\]]+)\]$/.exec(b)
      if (tw || (arb && colorsIn((arb[1] ?? '').replace(/_/g, ' ')).some(isPurple))) add('purple-gradient', i, t)
    }
  })
}

function gradientText(c: Ctx, add: Add) {
  c.code.forEach((l, i) => {
    const css = new RegExp(`${prop('background-clip')}\\s*text\\b|${prop('-webkit-background-clip')}\\s*text\\b`).exec(l)
    if (css && !/^\s*@supports\b/.test(l)) {
      // A prefixed twin beside the unprefixed declaration is one finding.
      const isPrefixed = /webkit/i.test(css[0])
      const twin = c.code.slice(Math.max(0, i - 2), i + 3).some((x, j) => j !== Math.min(2, i) && new RegExp(prop('background-clip')).test(x) && !/webkit/i.test(x))
      if (!(isPrefixed && twin)) add('gradient-text', i, css[0])
    }
    if (tokens(l).some(t => base(t) === 'bg-clip-text')) add('gradient-text', i, 'bg-clip-text')
  })
}

function glow(c: Ctx, add: Add) {
  c.code.forEach((l, i) => {
    const ctx = `${c.selectors[i] ?? ''} ${l}`
    const isFloating = FLOATING.test(ctx)
    const judge = (value: string, label: string) => {
      const shadows = parseShadows(value)
      for (const s of shadows) {
        const kind = shadowKind(s)
        if (!kind) continue
        const neutral = s.color ? isNeutralDark(s.color) : true
        // A menu, dialog or tooltip may float on a neutral shadow; a coloured glow is a glow anywhere.
        if (isFloating && neutral) continue
        if (label === 'text-shadow' && neutral) continue // a dark legibility shadow, not neon
        add('glow', i, `${label}: ${clip(value, 40)}`, { note: kind === 'ring' ? 'a ring/halo around the box' : 'a zero-offset glow' })
        return
      }
    }
    for (const name of ['box-shadow', 'text-shadow']) {
      const m = new RegExp(`${prop(name)}([^;}"'\`]+)`).exec(l)
      if (m) judge(m[1] ?? '', name)
    }
    const ds = /drop-shadow\(([^)]*\)?[^)]*)\)/.exec(l)
    if (ds && !/drop-shadow-/.test(ds[0])) judge(ds[1] ?? '', 'drop-shadow')
    for (const t of tokens(l)) {
      const b = base(t)
      const isRing = /^ring(?:-(?:[2-9]|\d{2,})|-\[(?:[2-9]|\d{2,})px\])?$/.test(b) && b !== 'ring-0' && b !== 'ring-1'
      const coloured = /^shadow-(?!black|white|gray|grey|slate|zinc|neutral|stone|transparent|inner|none|sm|md|lg|xl|2xl)[a-z]+-\d{2,3}(?:\/\d+)?$/.exec(b)
      const arbitrary = /^(?:shadow|drop-shadow)-\[(.+)\]$/.exec(b)
      if (isRing) add('glow', i, t, { note: 'a ring around the box' })
      else if (coloured) add('glow', i, t, { note: 'a coloured glow' })
      else if (arbitrary) {
        const shadows = parseShadows(arbitrary[1] ?? '')
        if (shadows.some(s => shadowKind(s) && !(isFloating && (!s.color || isNeutralDark(s.color))))) add('glow', i, t, { note: 'a zero-offset glow' })
      }
    }
  })
}

function glass(c: Ctx, add: Add) {
  const uses: number[] = []
  c.code.forEach((l, i) => {
    const css = new RegExp(`${prop('backdrop-filter')}[^;}]*blur`).test(l)
    const prefixed = new RegExp(`${prop('-webkit-backdrop-filter')}[^;}]*blur`).test(l)
    const tw = tokens(l).some(t => /^backdrop-blur(?:-\w+|-\[.+\])?$/.test(base(t)) && base(t) !== 'backdrop-blur-none')
    if (prefixed && !css) {
      const near = c.code.slice(Math.max(0, i - 2), i + 3).some(x => /(?<!-webkit-)backdrop-filter\s*:[^;]*blur/.test(x))
      if (near) return
    }
    // Blurring what sits behind an open dialog is a scrim, not a glass panel.
    if ((css || prefixed) && /::backdrop|backdrop\b|scrim|overlay/i.test(c.selectors[i] ?? '')) return
    if (css || prefixed || tw) uses.push(i)
  })
  uses.slice(1).forEach((i, n) => add('glass', i, 'backdrop blur', { note: `blur surface #${n + 2} in this file; one sticky bar is the allowance` }))
}

function bannedFont(c: Ctx, add: Add) {
  const banned = bannedSet(c.o)
  const isBanned = (f: string) => banned.has(norm(f))
  const ROOT = /(^|[\s,>+~(|`'"])(html|body|:root|\*|h[1-3]|main)\b/i
  c.code.forEach((l, i) => {
    const sel = c.selectors[i] ?? ''
    const isRootSel = ROOT.test(sel) || /@theme/.test(sel)
    // Declarations: font-family / fontFamily.
    for (const m of l.matchAll(new RegExp(`${prop('font-family')}([^;}\`]+)`, 'g'))) {
      const stack = (m[1] ?? '').replace(/["'`]\s*,?\s*$/, '')
      const first = firstFamily(stack)
      const varName = /^\s*["'`]?var\(\s*--font-([\w-]+)/.exec(stack)
      const viaVar = varName ? norm(varName[1] ?? '') : ''
      const face = isBanned(first) ? first : viaVar && isBanned(viaVar) ? viaVar : ''
      if (face) {
        if (isRootSel) add('banned-font', i, `font-family: ${face}`)
        else add('banned-font', i, `font-family: ${face}`, { advisory: true, note: 'set on one component or element, not the page; still a banned face' })
      } else if (isRootSel && SYSTEM_FACES.has(first) && splitTop(stack).every(f => SYSTEM_FACES.has(norm(f)) || /^(helvetica|arial|roboto|ubuntu|cantarell|noto sans|helvetica neue|oxygen|fira sans|droid sans|apple color emoji|segoe ui emoji|segoe ui symbol)$/.test(norm(f)))) {
        add('banned-font', i, 'system-ui as the only face', { advisory: true, note: 'a system stack as the page face is the default look; pick one real face' })
      }
    }
    // Theme tokens: --font-*: <stack>.
    for (const m of l.matchAll(/--font[\w-]*\s*:\s*([^;}]+)/g)) {
      const first = firstFamily(m[1] ?? '')
      if (isBanned(first)) add('banned-font', i, `${clip((m[0] ?? '').trim(), 40)}`)
    }
    // tailwind.config fontFamily keys.
    if (c.isTwConfig) {
      const m = /\b(sans|serif|display|heading|body|text|primary|base)\s*:\s*\[\s*["'`]([^"'`]+)["'`]/.exec(l)
      if (m && isBanned(m[2] ?? '')) add('banned-font', i, `fontFamily.${m[1]}: ${m[2]}`)
    }
    // next/font and @fontsource imports, Google Fonts loads.
    const nf = /import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/.exec(l)
    if (nf) for (const name of (nf[1] ?? '').split(',')) if (isBanned(name.split(/\s+as\s+/)[0] ?? '')) add('banned-font', i, `next/font ${name.trim()}`)
    const fs = /["']@fontsource(?:-variable)?\/([\w-]+)/.exec(l)
    if (fs && isBanned(fs[1] ?? '')) add('banned-font', i, `@fontsource/${fs[1]}`)
    for (const g of l.matchAll(/fonts\.googleapis\.com\/css2?\?[^"')\s]*/g)) {
      for (const fam of (g[0] ?? '').matchAll(/family=([^:&"')]+)/g)) {
        const name = decodeURIComponent((fam[1] ?? '').replace(/\+/g, ' '))
        if (isBanned(name)) add('banned-font', i, `Google Fonts load: ${name}`)
      }
    }
    for (const t of tokens(l)) {
      const m = /^font-\[['"]?([^'"\]]+)/.exec(base(t))
      if (m && isBanned((m[1] ?? '').split(',')[0] ?? '')) add('banned-font', i, t, { advisory: true, note: 'set on one element' })
    }
  })
}

function iconTiles(c: Ctx, add: Add) {
  if (!c.isMarkup) return
  const tiles: number[] = []
  const hasIconLib = c.code.some(l => /from\s+["'](?:lucide-react|@heroicons\/react[^"']*|react-icons[^"']*|@tabler\/icons-react|@phosphor-icons\/react|lucide-vue-next|lucide-svelte)["']/.test(l))
  c.code.forEach((l, i) => {
    const ts = tokens(l).map(base)
    const rounded = ts.some(t => /^rounded(?:-(?:md|lg|xl|2xl|3xl|full))?$/.test(t))
    const tint = ts.some(t => /^bg-[a-z]+-(?:50|100|500\/(?:5|10|15|20))$/.test(t) || /^bg-[a-z]+-\d{2,3}\/\d+$/.test(t))
    const size = ts.find(t => /^(?:w|h|size)-(?:8|9|10|11|12|14|16)$/.test(t))
    const square = size?.startsWith('size-') || ts.some(t => /^w-(\d+)$/.test(t) && ts.includes(t.replace(/^w/, 'h')))
    if (!(rounded && tint && square)) return
    const near = c.code.slice(i, i + 4).join('\n')
    const hasIcon = /<[A-Z]\w*Icon\b|<Icon\b|<\w+\.icon\b|<\w+\.Icon\b|<[A-Z]\w*\s[^>]*\b(?:className|class)=["'][^"']*\b(?:w|h|size)-\d/.test(near) || (hasIconLib && /<[A-Z]\w*\s*[^>]*\/>/.test(near))
    if (hasIcon) tiles.push(i)
  })
  for (const i of tiles) {
    const inMap = c.code.slice(Math.max(0, i - 12), i).some(l => /\.map\(/.test(l))
    const heading = c.code.slice(i, i + 10).some(l => /<h[2-5]\b|<(?:Title|Heading|CardTitle)\b/.test(l))
    if ((tiles.length >= 3 || inMap) && heading) add('icon-tile-cards', i, 'icon in a tinted tile atop a card')
  }
}

function emoji(c: Ctx, add: Add) {
  if (!c.isMarkup || /[\\/](i18n|locales?|data|content)[\\/]/i.test(c.path)) return
  c.code.forEach((l, i) => {
    for (const s of segments(l, c.isMarkup, c.styleLines.has(i))) {
      const m = s.text.replace(EXEMPT_EMOJI, '').match(/\p{Extended_Pictographic}/u)
      if (m) {
        add('emoji-ui', i, m[0])
        return
      }
    }
  })
}

function leftBorder(c: Ctx, add: Add) {
  const CALLOUT = /blockquote|callout|admonition|\bnote\b|alert|quote|\btip\b|warning|aside|cite/i
  c.code.forEach((l, i) => {
    const ts = tokens(l).map(base)
    const left = ts.find(t => /^border-[ls]-(?:[2-8]|\[[2-8]px\])$/.test(t))
    if (left && ts.some(t => /^rounded/.test(t)) && !CALLOUT.test(l)) add('left-border-card', i, left)
  })
  for (const b of c.blocks) {
    const m = /border-left\s*:\s*([2-6])px\s+solid/.exec(b.body)
    if (m && /border-radius\s*:/.test(b.body) && !CALLOUT.test(b.selector)) {
      const line = b.start + b.body.slice(0, b.body.indexOf(m[0])).split('\n').length - 1
      add('left-border-card', line, m[0])
    }
  }
}

function copyRules(c: Ctx, add: Add) {
  const text = c.code.join('\n')
  c.code.forEach((l, i) => {
    const segs = segments(l, c.isMarkup, c.styleLines.has(i))
    // Hype copy: rendered text only.
    for (const s of segs) {
      const m = HYPE.exec(s.text)
      if (m) {
        add('hype-copy', i, m[0])
        break
      }
    }
    // Fake content. Lorem and placeholder services anywhere in live code; names only in copy, never in an input's placeholder.
    if (!c.isStory) {
      const lorem = LOREM.exec(l)
      const url = PLACEHOLDER_URL.exec(l)
      const stars = STAR_ROW.exec(l)
      const count = PROOF_COUNT.exec(l)
      const name = segs.filter(s => !(s.kind === 'attr' && s.name === 'placeholder')).map(s => FAKE_NAMES.exec(s.text)).find(Boolean)
      const hit = lorem?.[0] ?? url?.[0] ?? stars?.[0] ?? count?.[0] ?? name?.[0]
      if (hit) add('fake-content', i, hit, count && hit === count[0] ? { note: 'an invented-looking proof count' } : {})
      else
        for (const s of segs) {
          const p = PROOF_NUMBER.exec(s.text)
          if (p) {
            add('unsourced-proof', i, p[0])
            break
          }
        }
    }
  })
  // Lazy CTA: a button or link whose whole text is a stock label.
  if (!c.isMarkup) return
  const tag = /<(button|a|Button|Link|NavLink)\b(?:=>|[^>])*?>\s*([^<{}]{2,40}?)\s*(?:→|&rarr;|›|<[A-Z]\w*\s*[^>]*\/>)?\s*<\/\1\s*>/g
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    if (!LAZY_CTA.test((m[2] ?? '').trim())) continue
    const before = text.slice(0, m.index)
    const line = before.split('\n').length - 1
    const inNav = before.lastIndexOf('<nav') > before.lastIndexOf('</nav>') || before.lastIndexOf('<header') > before.lastIndexOf('</header>')
    const around = c.code.slice(Math.max(0, line - 5), line + 6).join('\n')
    const others = [...around.matchAll(/<(?:button|a|Button|Link|NavLink)\b(?:=>|[^>])*?>\s*([^<{}]{2,40}?)\s*</g)].map(x => (x[1] ?? '').trim())
    const hasSpecific = others.some(t => t && !LAZY_CTA.test(t))
    if (!inNav && !hasSpecific) add('lazy-cta', line, (m[2] ?? '').trim())
  }
}

function eyebrows(c: Ctx, add: Add) {
  if (c.o.technical || !c.isMarkup) return
  const hits: number[] = []
  c.code.forEach((l, i) => {
    const ts = tokens(l).map(base)
    const tw = ts.includes('uppercase') && ts.some(t => /^tracking-(?:wide|wider|widest|\[[^\]]+\])$/.test(t)) && ts.some(t => /^text-(?:xs|\[(?:9|10|11|12|13)px\]|\[0?\.[67]\d*rem\])$/.test(t))
    const named = /\b(?:class|className)\s*=\s*["'`{][^"'`}]*\b(?:eyebrow|kicker|overline|pretitle|section-label)\b/.test(l)
    if (!(tw || named)) return
    const next = c.code.slice(i, i + 4).join('\n')
    if (/<h[1-3]\b|<(?:Heading|Title)\b/.test(next)) hits.push(i)
  })
  if (hits.length >= 3) for (const i of hits) add('eyebrow-every-heading', i, 'small tracked uppercase label above a heading', { note: `${hits.length} in this file` })
}

function motion(c: Ctx, add: Add) {
  const fade: number[] = []
  c.code.forEach((l, i) => {
    if (LOADING.test(l) || LOADING.test(c.path)) return
    const ts = tokens(l).map(base)
    const all = new RegExp(`${prop('transition')}\\s*all\\b`).exec(l) ?? (ts.includes('transition-all') ? ['transition-all'] : null)
    if (all) add('autopilot-motion', i, all[0], { note: 'transition: all animates layout and colour you did not mean to' })
    const bez = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(l)
    if (bez && [bez[2], bez[4]].some(y => Number(y) >= 1.3 || Number(y) <= -0.3)) add('autopilot-motion', i, bez[0], { note: 'bounce/overshoot easing' })
    if (ts.includes('animate-bounce') || ts.includes('ease-bounce')) add('autopilot-motion', i, 'animate-bounce', { note: 'bounce' })
    if (ts.some(t => t === 'animate-ping' || t === 'animate-pulse') && ts.includes('rounded-full') && ts.some(t => /^(?:h|w|size)-(?:1|1\.5|2|2\.5|3)$/.test(t)))
      add('autopilot-motion', i, 'pulsing dot', { note: 'a pulsing "live" dot that says nothing' })
    if (/\b(?:fade-in-up|fadeInUp|fade-up|fadeUp|animate-fade-up|animate-fade-in-up|slide-up|slideUp)\b|\bdata-aos=|\bwhileInView\b/.test(l)) fade.push(i)
  })
  if (fade.length >= 4) for (const i of fade) add('autopilot-motion', i, 'same entrance on every block', { note: `${fade.length} identical fade-up entrances in this file` })
  // Reduced motion: only a candidate here; register.ts confirms against the whole project once.
  if (!REDUCED_SRC.test(c.code.join('\n')))
    c.code.forEach((l, i) => {
      const m = MOTION_SRC.exec(l)
      if (m) add('no-reduced-motion', i, m[0], { project: 'reduced-motion' })
    })
}

function focus(c: Ctx, add: Add) {
  const REPLACE = /^(?:focus|focus-visible|focus-within):(?!outline-none)(?:bg|text|border|underline|decoration|shadow|ring|outline|font|opacity)/
  c.code.forEach((l, i) => {
    const css = new RegExp(`${prop('outline')}\\s*(?:none|0)\\b`).exec(l)
    const ts = tokens(l)
    const tw = ts.find(t => base(t) === 'outline-none' || base(t) === 'outline-0')
    if (!css && !tw) return
    if (tw && ts.some(t => REPLACE.test(t))) return
    if (css) {
      const b = c.blocks.find(x => i >= x.start && i <= x.end)
      const sel = b?.selector ?? c.selectors[i] ?? ''
      if (/:not\(\s*:focus-visible\s*\)/.test(sel)) return // the right pattern: no outline for mouse focus only
      if (b && /:focus/.test(sel) && /(?:background|color|border|text-decoration|box-shadow)\s*:/.test(b.body)) return
      // Removing the focus-visible outline itself with nothing in its place is a definite removal, whatever else the project has.
      if (/:focus-visible/.test(sel)) {
        add('focus-removed', i, css[0], { note: 'the :focus-visible outline is removed with nothing in its place' })
        return
      }
    }
    add('focus-removed', i, css?.[0] ?? tw ?? '', { project: 'focus-visible' })
  })
}

function a11y(c: Ctx, add: Add) {
  const text = c.code.join('\n')
  if (c.isMarkup) {
    const img = /<(img|Image)\b((?:=>|[^>])*?)\/?>/g
    for (let m = img.exec(text); m; m = img.exec(text)) {
      const attrs = m[2] ?? ''
      if (/\balt\s*=/.test(attrs) || /\{\s*\.\.\./.test(attrs)) continue
      add('a11y-floor', text.slice(0, m.index).split('\n').length - 1, `<${m[1]}> without alt`)
    }
    c.code.forEach((l, i) => {
      const vp = /user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\.0)?\b/.exec(l)
      if (vp) add('a11y-floor', i, vp[0], { note: 'blocks pinch zoom' })
    })
  }
  for (const b of c.blocks) {
    if (/disabled|placeholder/i.test(b.selector)) continue
    const fg = /(?:^|[;\s{])color\s*:\s*([^;!]+)/.exec(b.body)
    const bg = /background(?:-color)?\s*:\s*([^;!]+)/.exec(b.body)
    if (!fg || !bg || /gradient|url\(|var\(/.test(bg[1] ?? '') || /var\(/.test(fg[1] ?? '')) continue
    const f = parseColor((fg[1] ?? '').trim())
    const g = parseColor((bg[1] ?? '').trim())
    if (!f || !g || f.a < 1 || g.a < 1) continue
    const size = /font-size\s*:\s*([\d.]+)(px|rem)/.exec(b.body)
    const px = size ? Number(size[1]) * (size[2] === 'rem' ? 16 : 1) : 16
    const bold = /font-weight\s*:\s*(?:bold|[6-9]00)/.test(b.body)
    const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5
    const ratio = contrast(f, g)
    if (ratio < need) {
      const line = b.start + b.body.slice(0, b.body.indexOf(fg[0])).split('\n').length - 1
      add('a11y-floor', line, `contrast ${ratio.toFixed(2)}:1`, { note: `needs ${need}:1` })
    }
  }
}

// ---------------------------------------------------------------- reporting

export const PROJECT_PATTERN: Record<NonNullable<Finding['project']>, string> = {
  'reduced-motion': 'prefers-reduced-motion|useReducedMotion|motion-reduce:|motion-safe:|reducedMotion',
  'focus-visible': 'focus-visible',
}

export function formatFindings(file: string, findings: readonly Finding[]): string {
  const name = file.replace(/\\/g, '/')
  const lines = findings.map(f => {
    const r = ruleOf(f.rule)
    const tag = f.blocks ? `${f.rule}, blocks at Stop` : f.rule
    const note = f.note ? ` (${f.note})` : ''
    return `- L${f.line} [${tag}] \`${f.match}\`${note}. Why: ${r.why} Fix: ${r.fix}`
  })
  const blocking = findings.some(f => f.blocks)
  return [
    `slop-guard: ${findings.length} design finding${findings.length === 1 ? '' : 's'} in the new text of ${name}:`,
    ...lines,
    blocking
      ? 'Fix them now. A deliberate exception stays with `slop-ok: <reason>` on that line (or a comment line just above); otherwise the blocking ones hold the turn at Stop.'
      : 'Fix them, or keep one deliberately with `slop-ok: <reason>` on that line.',
  ].join('\n')
}

/** A plain statement that a blocking finding is a deliberate exception. `strict` is used before any block was shown. */
export function exceptionStated(text: string, strict: boolean): boolean {
  const said = /\b(deliberate|intentional(?:ly)?|on purpose|exception|brand(?:'s)? (?:font|face|asset|colour|color)|client(?:'s)? brand)\b/i.test(text)
  return strict ? said && /slop-guard/i.test(text) : said
}
