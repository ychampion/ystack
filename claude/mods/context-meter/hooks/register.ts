import type { EngineInterface, Register, SessionUsage, Timer } from 'claude-code'

// Every turn re-reads the whole context, so a big one costs on every turn: hand off at the end of a phase.
// Both thresholds are settings (handoffAt, compactAt); the defaults suit a 400k auto-compact window.
let HANDOFF_AT = 250_000
let COMPACT_AT = 400_000
let HANDOFF_DIR = '~/.claude/plans'
const IDLE_WARN_MS = 50 * 60_000 // the prompt cache lapses after 1h idle

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)
let idleTimer: Timer | undefined
let lastTokens = 0
let saidHandoff = false
const saidLimit = new Set<string>()

function line(u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): string {
  const t = u.context.tokens ?? 0
  lastTokens = t
  const parts = [`ctx ${k(t)}/${k(COMPACT_AT)}`]
  if (t >= HANDOFF_AT) parts.push('handoff due at phase end (/handoff)')
  const limits = u.rateLimits.filter(r => r.percentUsed >= 50).map(r => `${r.kind.replace('_hour', 'h').replace('_day', 'd').replace('five', '5').replace('seven', '7')} ${Math.round(r.percentUsed)}%`)
  parts.push(...limits)
  if (u.cost) parts.push(`$${u.cost.usd.toFixed(2)}`)
  return parts.join(' · ')
}

async function projectName($: EngineInterface): Promise<string> {
  const root = (await $.session.root()).replace(/\\/g, '/').replace(/\/$/, '')
  return (root.split('/').pop() || 'session').replace(/[^\w.-]/g, '-')
}

const HANDOFF_PROMPT = `Write the phase handoff document for this session, so a fresh session can pick the work up. Output ONLY the markdown document, no preamble. Sections:
# <project> handoff (<today's date>)
## Goal
## State (what is done, what is verified and how)
## Decisions and why
## Open questions (the user's, and technical)
## Next steps (ordered, concrete)
## Key files (paths with one line each)
Be specific: real paths, commands, branch names, PR numbers. Under 120 lines.`

export const register: Register = (on, options) => {
  const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d)
  HANDOFF_AT = num(options.handoffAt, HANDOFF_AT)
  COMPACT_AT = num(options.compactAt, COMPACT_AT)
  if (typeof options.handoffDir === 'string' && options.handoffDir.trim()) HANDOFF_DIR = options.handoffDir.trim().replace(/\\/g, '/').replace(/\/+$/, '')

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'handoff', description: 'Write <project>-handoff.md from this session (a cache-read fork; the main context does not grow)' })
    await $.command.register({ name: 'ctx', description: 'Context size, usage limits and session cost, once' })
    $.ui.status(undefined) // clear the line an earlier version pinned
    return next(e)
  })

  // No standing status line: speak once, only when something needs doing.
  on('session.measure', async ($, e, next) => {
    line(e) // keeps lastTokens current for /handoff
    const t = e.context.tokens ?? 0
    if (t >= HANDOFF_AT && !saidHandoff) {
      saidHandoff = true
      $.ui.toast(`Context passed ${k(HANDOFF_AT)}: at the end of this phase, /handoff then /clear.`, { timeoutMs: 8000 })
    }
    if (t < HANDOFF_AT) saidHandoff = false // after /clear or a compaction
    for (const r of e.rateLimits) {
      if (r.percentUsed >= 90 && !saidLimit.has(r.kind)) {
        saidLimit.add(r.kind)
        $.ui.toast(`${r.kind.replace('_', ' ')} usage at ${Math.round(r.percentUsed)}%.`, { timeoutMs: 8000 })
      }
    }
    return next(e)
  })

  on('command.run', { command: 'ctx' }, async $ => ({ text: line(await $.session.usage()) }))

  on('command.run', { command: 'handoff' }, async $ => {
    const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
    const path = `${HANDOFF_DIR.replace(/^~(?=\/|$)/, home)}/${await projectName($)}-handoff.md`
    $.ui.toast('handoff: writing from the cached transcript…')
    const r = await $.model.fork({ prompt: HANDOFF_PROMPT })
    if (!r.isAnswered) return { text: `handoff: the fork gave no text (${r.reason}). Ask me to write it instead.` }
    await $.fs.write(path, r.text.trim() + '\n')
    return {
      text: `handoff written: ${path}\nPhase done, context at ${k(lastTokens)}. Run /clear, then say "continue from ${path}".`,
    }
  })

  // A push or merge often ends a phase: suggest the handoff when the context is big.
  {
    on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
      const ran = await next(e)
      if (e.agentId !== undefined || ran.isError === true || ran.deny !== undefined) return ran
      if (!/\bgit\s+push\b|\bgh\s+pr\s+(merge|create)\b/.test(e.command)) return ran
      const { context } = await $.session.usage()
      if ((context.tokens ?? 0) >= HANDOFF_AT) {
        $.ui.toast(`Phase end? Context is ${k(context.tokens ?? 0)}: /handoff, then /clear.`, { timeoutMs: 8000 })
        void $.prompt.suggest({ text: '/handoff' })
      }
      return ran
    })
  }

  // Before the cache lapses on a big context, offer the handoff.
  on('prompt.submit', ($, e, next) => {
    idleTimer?.cancel()
    return next(e)
  })
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    idleTimer?.cancel()
    idleTimer = $.clock.after(IDLE_WARN_MS, () => {
      void (async () => {
        const { context } = await $.session.usage()
        if ((context.tokens ?? 0) < 200_000) return
        await $.ui.notify(`Idle 50 min at ${k(context.tokens ?? 0)} context: the cache lapses in ~10 min. /handoff now if you're taking a break.`, {
          title: 'context-meter',
        })
      })()
    })
    return done
  })
}
