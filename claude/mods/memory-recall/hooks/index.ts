// A tiny inverted index over memory notes and skill descriptions, matched against error text.

export type Entry = { name: string; description: string; path: string; tokens: string[]; strong: string[]; weak: string[] }

const STOP = new Set(
  'about above after again against also because been before being below between both cannot could does doing down during each from further have having here into itself more most once only other ought ours over same should some such than that their them then there these they this those through under until very were what when where which while whom with would your yours user users claude using used uses file files path paths error errors fails fixed issue issues instead never always must note notes memory skill skills code work works session sessions run runs running command commands tool tools'.split(
    ' ',
  ),
)

/** Specific codes identify a failure on their own: 0xC0000142, LNK1117, TS2322. */
const STRONG = /\b0x[0-9A-Fa-f]{5,}\b|\b[A-Z]{2,6}\d{3,}\b/g
/** Generic codes need corroborating words: ENOENT, EINVAL, MAX_PATH. */
const WEAK = /\bE[A-Z]{3,8}\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g

export type Tokens = { words: string[]; strong: string[]; weak: string[] }

export function tokenize(text: string): Tokens {
  const words = new Set<string>()
  for (const raw of text.toLowerCase().match(/0x[0-9a-f]+|[a-z][a-z0-9_]{3,}/g) ?? []) {
    if (!STOP.has(raw) && raw.length <= 32) words.add(raw)
  }
  const strong = [...new Set((text.match(STRONG) ?? []).map(s => s.toLowerCase()))]
  const weak = [...new Set((text.match(WEAK) ?? []).map(s => s.toLowerCase()))].filter(w => !strong.includes(w))
  for (const c of [...strong, ...weak]) words.add(c)
  return { words: [...words], strong, weak }
}

export function parseNote(path: string, text: string, isSkill: boolean): Entry | undefined {
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const front = fm?.[1] ?? ''
  const name = front.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? path.replace(/^.*[\\/]/, '').replace(/\.md$/, '')
  const block = front.match(/^description:\s*[|>][-+]?\s*\r?\n((?:[ \t]+.*(?:\r?\n|$))+)/m)?.[1]
  const description = (block ? block.replace(/\s*\r?\n\s*/g, ' ') : (front.match(/^description:\s*"?(.+?)"?\s*$/m)?.[1] ?? '')).trim()
  if (!description && isSkill) return undefined
  const start = fm ? fm[0].length : 0
  const body = isSkill ? description : `${description}\n${text.slice(start, start + 1500)}`
  const t = tokenize(`${name.replace(/[-_]/g, ' ')} ${body}`)
  return { name, description: description || name, path, tokens: t.words, strong: t.strong, weak: t.weak }
}

export type Index = { entries: Entry[]; df: Map<string, number> }

export function buildIndex(entries: Entry[]): Index {
  const df = new Map<string, number>()
  for (const e of entries) for (const t of e.tokens) df.set(t, (df.get(t) ?? 0) + 1)
  return { entries, df }
}

export type Match = { entry: Entry; score: number; shared: string[] }

const ERROR_LINE = /error|fail|fatal|exception|cannot|can't|unable|denied|not found|no such|traceback|panic|refused|timed? ?out|did not|0x[0-9a-f]{5,}|\bE[A-Z]{3,8}\b/i

/** The lines of a tool's output that state the failure; the tail when none do. */
export function focus(output: string): string {
  const tail = output.slice(-6000)
  const lines = tail.split(/\r?\n/).filter(l => ERROR_LINE.test(l) && !/\b0 fail\b|\(pass\)/i.test(l))
  return (lines.length > 0 ? lines.join('\n') : tail).slice(-3000)
}

/** Best entries for an error text: rare shared words; strong codes x3, weak codes x2. */
export function match(index: Index, errorText: string, max = 2): Match[] {
  const n = Math.max(index.entries.length, 1)
  const err = tokenize(errorText.slice(0, 4000))
  const errWords = new Set(err.words)
  const errStrong = new Set(err.strong)
  const errWeak = new Set(err.weak)
  const scored: Match[] = []
  for (const entry of index.entries) {
    let score = 0
    let strongHits = 0
    const shared: string[] = []
    for (const t of entry.tokens) {
      if (!errWords.has(t)) continue
      const df = index.df.get(t) ?? 1
      const isStrong = errStrong.has(t) && entry.strong.includes(t)
      const isWeak = errWeak.has(t) && entry.weak.includes(t)
      if (df > n * 0.15 && !isStrong) continue // too common across notes to mean anything
      score += Math.log(n / df) * (isStrong ? 3 : isWeak ? 2 : 1)
      if (isStrong) strongHits += 1
      shared.push(t)
    }
    // Words alone must be rare on average (log-idf >= 4): shared dev words like pass/fail/exit match by accident.
    const isRareEnough = shared.length >= 3 && score >= 12 && score / shared.length >= 4
    if ((strongHits >= 1 && score >= 8) || isRareEnough) scored.push({ entry, score, shared })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, max)
}
