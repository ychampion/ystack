// Pure parsing of codex invocations and the effort ladder.

export const LADDER = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof LADDER)[number]
/** What codex runs at when the command names no effort; the `defaultEffort` setting overrides it. */
export const CONFIG_DEFAULT: Effort = 'xhigh'

export function asEffort(v: unknown): Effort | undefined {
  return typeof v === 'string' && (LADDER as readonly string[]).includes(v) ? (v as Effort) : undefined
}

export type CodexCall = {
  effort: Effort | 'ultra' | undefined
  profile: string | undefined
  hasServiceTier: boolean
  briefFile: string | undefined
  inlineBrief: string | undefined
}

export function isCodexExec(command: string): boolean {
  return /(^|[\s;&|(])codex(\.exe|\.cmd)?\s+(exec|e)\b/.test(command) || /codex-companion[^\n]*\b(task|rescue)\b/.test(command)
}

export function parseCodex(command: string): CodexCall {
  // Every effort setting in the command; the highest wins (fail closed), so text in a prompt can only make the check stricter.
  const found = [...command.matchAll(/model_reasoning_effort\s*=\s*["']?(\w+)|--effort[=\s]+["']?(\w+)/g)].map(m => (m[1] ?? m[2] ?? '').toLowerCase())
  const known = found.map(asEffort).filter((x): x is Effort => x !== undefined)
  const effort = found.includes('ultra') ? 'ultra' : known.length ? LADDER[Math.max(...known.map(x => LADDER.indexOf(x)))] : undefined
  const profile = command.match(/--profile[=\s]+["']?([\w-]+)/)?.[1]
  const hasServiceTier = /service_tier|--fast\b|priority_tier/.test(command)
  const briefFile =
    command.match(/<\s*["']?([^\s"'|;&]+\.(?:md|txt))/)?.[1] ??
    command.match(/(?:Get-Content|cat|type)\s+(?:-Raw\s+)?["']?([^\s"'|;&]+\.(?:md|txt))["']?[^|\n]*\|\s*codex/)?.[1] ??
    command.match(/codex(?:\.exe|\.cmd)?\s+(?:exec|e)\b[^\n]*?\s["']?([^\s"'|;&]+\.md)["']?\s*$/m)?.[1]
  const quoted = [...command.matchAll(/"((?:[^"\\]|\\.){80,})"|'([^']{80,})'/g)].map(m => m[1] ?? m[2] ?? '')
  const inlineBrief = quoted.sort((a, b) => b.length - a.length)[0]
  return { effort, profile, hasServiceTier, briefFile, inlineBrief }
}

export function effectiveEffort(call: CodexCall, configDefault: Effort = CONFIG_DEFAULT): Effort {
  if (call.effort === undefined || call.effort === 'ultra') return configDefault
  return call.effort
}

/** Which required parts a brief lacks: DONE criteria, verification, an iteration cap. */
export function missingBriefParts(brief: string): string[] {
  const missing: string[] = []
  if (!/\bDONE\b|definition of done|done means|acceptance criteria/i.test(brief)) missing.push('DONE criteria')
  if (!/verif|run the tests|tests? (must|should) pass|acceptance test|check that/i.test(brief)) missing.push('verification steps')
  if (!/stop after|at most \d+|max(imum)? (of )?\d+ (fix )?(cycles|iterations|attempts|rounds)|iteration cap|stop conditions/i.test(brief))
    missing.push('an iteration cap / stop condition')
  return missing
}

export function nextUp(effort: Effort): Effort {
  const i = LADDER.indexOf(effort)
  return LADDER[Math.min(i + 1, LADDER.indexOf('xhigh'))] ?? 'xhigh'
}

/** A stable key for "the same task": the brief file, else the brief's opening. */
export function taskKey(call: CodexCall): string | undefined {
  if (call.briefFile) return `file:${call.briefFile.replace(/\\/g, '/').toLowerCase()}`
  if (call.inlineBrief) return `text:${call.inlineBrief.slice(0, 160).replace(/\s+/g, ' ').trim().toLowerCase()}`
  return undefined
}
