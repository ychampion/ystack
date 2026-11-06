import type { Register } from 'claude-code'

// Signals that a turn found something worth saving as a skill (long debugging, a "turns out" discovery).
const DISCOVERY =
  /\b(turns out|the (actual|real) (problem|issue|cause) (was|is)|root cause (was|is)|the issue was|was actually caused by|misleading error|workaround (is|was)|undocumented)\b/i
const LONG_MS = 10 * 60_000
const COOLDOWN_MS = 30 * 60_000

let failures = 0
let lastNudge = 0

export const register: Register = on => {
  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) failures = 0
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && ran.isError === true) failures += 1
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return done
    const isLongDebug = e.durationMs > LONG_MS && failures >= 3
    const isDiscovery = DISCOVERY.test(e.answer)
    if (!isLongDebug && !isDiscovery) return done
    const now = await $.clock.now()
    if (now - lastNudge < COOLDOWN_MS) return done
    lastNudge = now
    const why = isDiscovery ? 'a non-obvious root cause' : `${Math.round(e.durationMs / 60000)} min and ${failures} failed calls`
    $.ui.toast(`claudeception: this turn found ${why}. Tab to save it as a skill.`, { timeoutMs: 8000 })
    void $.prompt.suggest({ text: '/claudeception' })
    return done
  })
}
