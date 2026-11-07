// Pure logic for user-voice: is this a feature request, which user notes mention it, and the note for Claude.

// ---------- is it a feature or product request? ----------

const FEATURE_YES =
  /\b(add|build|create|make|implement|introduce|support|ship|launch|design|redesign|let (users|people|customers)|users? (can|should|want|need)|customers? (can|should|want|need)|feature|onboarding|signup|sign-up|checkout|pricing|dashboard|settings page|notification|integration|export|import|search|filter|invite|share|upload)\b/i
const FEATURE_NO =
  /\b(fix|bug|error|crash|failing|broken|typo|refactor|rename|bump|upgrade|lint|format|test|tests|why|what is|explain|how does|review|commit|push|merge|deploy|revert|debug|log|stack trace|install|config|setting up my)\b/i
const CODE_CONCRETE = /`[^`]+`|\b[\w-]+\.(ts|tsx|js|py|rs|go|css|html|json|md)\b|\bline \d+\b|\bfunction\b|\bendpoint\b.*\/\w+/i

export type Verdict = 'yes' | 'no' | 'maybe'

/** A cheap first pass; `maybe` goes to one small model call. */
export function featureVerdict(text: string): Verdict {
  const t = text.trim()
  if (t.length < 12 || t.startsWith('/')) return 'no'
  const yes = FEATURE_YES.test(t)
  const no = FEATURE_NO.test(t)
  if (yes && !no) return 'yes'
  if (no && !yes) return 'no'
  if (!yes && !no) return t.split(/\s+/).length >= 6 ? 'maybe' : 'no'
  return 'maybe'
}

/** Rough requests get options first; a request that names files, code or exact behaviour is built as asked. */
export function isConcrete(text: string): boolean {
  return CODE_CONCRETE.test(text) || /\b(acceptance criteria|DONE means|exactly|must:|spec:)\b/i.test(text)
}

// ---------- spec-sharpener's trigger, so the two never ask twice ----------

const BUILD = /\b(build|create|implement|make|design|ship|launch|develop|rewrite|re-?architect|architect|set ?up|scaffold|port|redesign|overhaul)\b/i
const SCOPE =
  /\b(app|application|product|platform|system|service|site|website|landing|page|mvp|company|startup|pipeline|engine|sdk|cli|tool|dashboard|api|backend|frontend|agent|bot|extension|plugin|mod|game|feature|integration|workflow|infra|deployment)s?\b/i
const SMALL = /\b(fix|typo|rename|bump|tiny|quick(ly)?|one-?liner|small tweak|just (add|change|update|rename))\b/i
const OPT_OUT = /\b(no questions|don'?t ask|just do it|go ahead|proceed|as discussed|as planned|continue from)\b/i
const ALREADY_SPECCED = /\b(DONE|acceptance criteria|definition of done|must:|requirements:)\b/

/** The same test spec-sharpener uses for a large, open build. */
export function sharpenerFires(text: string): boolean {
  const t = text.trim()
  if (t.startsWith('/') || t.length < 12) return false
  if (OPT_OUT.test(t) || SMALL.test(t) || ALREADY_SPECCED.test(t)) return false
  return BUILD.test(t) && SCOPE.test(t)
}

export const isOptOut = (text: string): boolean => OPT_OUT.test(text)

// ---------- keyword search over the notes (BM25 over paragraphs) ----------

const STOP = new Set(
  'a an and are as at be but by can could do does for from had has have how i if in into is it its just let like make me more my need no not of on or our please should so some than that the their them then there these they this to too up us use want we what when where which who why will with would you your add build create feature thing stuff able new get also very really'.split(
    ' ',
  ),
)

const stem = (w: string): string => w.replace(/(ings?|edly|ed|ies|es|s)$/, m => (m === 'ies' ? 'y' : '')).replace(/(.)\1$/, '$1')

export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g) ?? []).map(w => w.replace(/'s$/, '')).filter(w => w.length > 2 && !STOP.has(w)).map(stem)
}

export type Doc = { path: string; text: string }
export type Quote = { path: string; text: string; score: number }

/** Splits a note into paragraphs short enough to quote. */
function chunks(text: string): string[] {
  const out: string[] = []
  for (const para of text.split(/\n\s*\n/)) {
    const p = para.replace(/\s+/g, ' ').trim()
    if (p.length < 12) continue
    if (p.length <= 400) out.push(p)
    else for (const s of p.split(/(?<=[.!?])\s+/)) if (s.length >= 12) out.push(s)
  }
  return out
}

/** Up to `max` short quotes, one per note, with the note's path; best first. */
export function findQuotes(query: string, docs: readonly Doc[], max: number): Quote[] {
  const q = [...new Set(terms(query))]
  if (q.length === 0 || max <= 0) return []
  const units: { path: string; text: string; tf: Map<string, number>; len: number }[] = []
  for (const d of docs) {
    for (const c of chunks(d.text)) {
      const ts = terms(c)
      const tf = new Map<string, number>()
      for (const t of ts) tf.set(t, (tf.get(t) ?? 0) + 1)
      units.push({ path: d.path, text: c, tf, len: ts.length || 1 })
    }
  }
  if (units.length === 0) return []
  const avg = units.reduce((s, u) => s + u.len, 0) / units.length
  const df = new Map<string, number>()
  for (const t of q) df.set(t, units.filter(u => u.tf.has(t)).length)
  const k1 = 1.2
  const b = 0.75
  const N = units.length
  const need = q.length <= 2 ? 1 : 2 // a long request must share at least two words with the note
  const scored: Quote[] = []
  for (const u of units) {
    let score = 0
    let hits = 0
    for (const t of q) {
      const f = u.tf.get(t) ?? 0
      if (f === 0) continue
      hits += 1
      const n = df.get(t) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * u.len) / avg))
    }
    if (hits >= need) scored.push({ path: u.path, text: u.text, score })
  }
  scored.sort((x, y) => y.score - x.score)
  const out: Quote[] = []
  const seen = new Set<string>()
  for (const s of scored) {
    if (seen.has(s.path)) continue
    seen.add(s.path)
    out.push({ ...s, text: s.text.length > 220 ? `${s.text.slice(0, 219)}…` : s.text })
    if (out.length >= max) break
  }
  return out
}

// ---------- the note Claude reads ----------

export type NoteInput = { quotes: readonly Quote[]; proposeFirst: boolean; isConcrete: boolean; sharpenerFires: boolean; hasEvidenceDir: boolean }

export function buildNote(n: NoteInput): string {
  const lines: string[] = ['user-voice: this reads as a feature or product request.']
  if (n.hasEvidenceDir) {
    if (n.quotes.length === 0) lines.push('No user note mentions this yet. Say so to the owner in one line.')
    else {
      lines.push('What real users said (from the notes folder):')
      for (const q of n.quotes) lines.push(`- "${q.text}" (${q.path})`)
    }
  }
  if (n.sharpenerFires) {
    lines.push(
      'You are already asked to put pointed questions to the owner for this build. Put the 2-3 concrete options (grounded in the notes above, with your recommendation) into that SAME single AskUserQuestion round; never ask a second round.',
    )
  } else if (n.proposeFirst && !n.isConcrete) {
    lines.push(
      'The request is rough: do not build its literal words yet. First propose the concrete version: 2-3 concrete options grounded in what users said, your recommendation, what to leave out, and how we would know it worked. ' +
        'Then let the owner pick in ONE AskUserQuestion call, recommended option first. If the request is in fact already concrete, just build it.',
    )
  }
  return lines.join('\n')
}

/** `feedback` relative to the project, `~/x` under home, absolute as is. */
export function resolveDir(setting: string, root: string, home: string): string {
  const s = setting.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^~(\/|$)/.test(s)) return `${home.replace(/\\/g, '/')}${s.slice(1)}`
  if (/^([a-z]:)?\//i.test(s)) return s
  return `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/${s}`
}
