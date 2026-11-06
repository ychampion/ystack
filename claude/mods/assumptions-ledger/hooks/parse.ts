/**
 * The note the main loop reads when a subagent reports assumptions. The orchestrator triages them:
 * technical ones it settles itself; only product or business calls reach the owner, with context.
 */
export function triageNote(agent: string, found: readonly string[]): string {
  return [
    `assumptions-ledger: the agent "${agent}" reported these assumptions:`,
    ...found.map(a => `- ${a}`),
    'Check each one yourself against the code, the brief and what the owner said. Settle technical ones without asking the owner: fix the work if a reading was wrong.',
    'Send only product, business, pricing, naming, scope or customer-facing calls to the owner, through mcp__decision-inbox__ask. The owner runs the business and does not read code, so its context must say in plain words what was assumed, what it changes for users or the business, and what changing it later would cost.',
    'Do not relay the rest to the owner.',
  ].join('\n')
}

/** The bullets under an "Assumptions I made" heading, until the next heading or the end. */
export function parseAssumptions(report: string): string[] {
  const lines = report.split(/\r?\n/)
  const start = lines.findIndex(l => /^\s*(#{1,6}\s*|\*\*)?\s*assumptions i made\b/i.test(l))
  if (start < 0) return []
  const out: string[] = []
  const inline = lines[start]?.replace(/^.*assumptions i made\**:?\**\s*/i, '').trim()
  if (inline && !/^none\.?$/i.test(inline)) out.push(inline)
  for (const l of lines.slice(start + 1)) {
    if (/^\s*#{1,6}\s/.test(l) || /^\s*\*\*[^*]+\*\*\s*:?\s*$/.test(l)) break
    const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*\S)/)
    if (m?.[1]) out.push(m[1].replace(/\*\*/g, ''))
    else if (out.length > 0 && /^\s{2,}\S/.test(l)) out[out.length - 1] += ' ' + l.trim()
  }
  return out.filter(a => !/^none\b/i.test(a)).slice(0, 20)
}
