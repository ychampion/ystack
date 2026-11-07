// Pure logic for pin: rule detection, the compaction instructions, and the verbatim check.

const RULE = /\b(never|always|don'?t\s+ever|do\s+not\s+ever|must\s+not|mustn'?t|must\s+never)\b|\bdo\s+not\b.*\bever\b/i

/** The hard rules in a prompt ("never ...", "always ...", "must not ..."), sentence by sentence. Questions are not rules. */
export function detectRules(text: string): string[] {
  return text
    .split(/\r?\n|(?<=[.!])\s+/)
    .map(s => s.trim().replace(/^[-*>\d.)\s]+/, ''))
    .filter(s => s.length >= 8 && s.length <= 240 && !s.endsWith('?') && RULE.test(s))
}

/** Whitespace collapsed, so a summary that rewraps a line still holds it word for word. */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The pins that no compacted message holds verbatim. */
export function missingPins(pins: readonly string[], texts: readonly string[]): string[] {
  const all = flat(texts.join('\n'))
  return pins.filter(p => !all.includes(flat(p)))
}

export const BLOCK_HEAD = 'Pinned by the owner (verbatim):'

export const pinBlock = (pins: readonly string[]) => `${BLOCK_HEAD}\n${pins.map(p => `- ${p}`).join('\n')}`

/** What the summarizer is told on the way down, after any instructions it already has. */
export function compactInstructions(existing: string | undefined, pins: readonly string[]): string {
  const ours = `The owner pinned these rules. Copy each one into the summary word for word, under the heading "${BLOCK_HEAD}", and keep obeying them:\n${pins.map(p => `- ${p}`).join('\n')}`
  return existing?.trim() ? `${existing.trim()}\n\n${ours}` : ours
}

export type PinArgs = { kind: 'list' } | { kind: 'add'; text: string; isProject: boolean }

export function parsePinArgs(args: string): PinArgs {
  const a = args.trim()
  if (!a) return { kind: 'list' }
  const m = /^--project\b\s*(.*)$/s.exec(a)
  if (m) return m[1]?.trim() ? { kind: 'add', text: m[1].trim(), isProject: true } : { kind: 'list' }
  return { kind: 'add', text: a, isProject: false }
}

/** The $.store key for a project folder's pins: one spelling per folder. */
export const projectKey = (root: string) => `project:${root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()}`

export type Pin = { text: string; scope: 'session' | 'project' }

export function listText(pins: readonly Pin[]): string {
  if (pins.length === 0) return 'No pins yet. Add one with /pin <rule>, or /pin --project <rule> to keep it for this folder.'
  return pins.map((p, i) => `${i + 1}. ${p.text}${p.scope === 'project' ? '  (this project)' : ''}`).join('\n')
}
