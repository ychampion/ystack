import type { EngineInterface, Register, SessionUsage, Timer } from 'claude-code'

// Every turn re-reads the whole context, so a big one costs on every call: hand off at a boundary, not at the limit.
// Thresholds and the folder are settings (handoffAt, compactAt, handoffDir, autoHandoff); defaults suit a 400k window.
let HANDOFF_AT = 250_000
let COMPACT_AT = 400_000
let HANDOFF_DIR = '~/.claude/plans'
let AUTO_HANDOFF = true
const IDLE_AT = 200_000 // below this, re-caching after a break costs little
const IDLE_MS = 50 * 60_000 // the prompt cache lapses after 1h idle: hand off while it is still warm
const AWAY_MS = 15 * 60_000 // the user hasn't typed for this long: the session is running on its own
// Prompt origins that are machines, not the user. Anything else (typed, Slack ping, unknown) counts as the user.
const AUTO = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'coordinator', 'observer', 'observer-activity'])
const MAX_WAIT_TURNS = 3 // other turns that may finish before the checkpoint's own does

const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)

type Handoff = { path: string; doc: string; last: string; before: number }

let idleTimer: Timer | undefined
let phaseEnded = false // a push or merge ran in this turn with a big context
let userAt = 0 // when the user last sent a prompt or interrupted a turn
let turnByUser = true // the running turn began with the user's prompt (or a mod's), not an agent report
let autoOff = '' // why automatic handoffs stopped for this session ('' while they run)
let lastTokens = 0
let saidHandoff = false
const saidLimit = new Set<string>()
// A checkpoint is under way: its turn's answer is the handoff. `why` is said when it lands ('' for /handoff);
// `arrived` is set when something was delivered into a turn meanwhile, which a swap would erase.
let asking: { last: string; before: number; why: string; waited: number; arrived: boolean } | undefined
// Set only while this mod's own compaction runs: the session.compact hook answers with it.
let swap: Handoff | undefined

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

const CHECKPOINT = `[context-meter, not the user] Handoff checkpoint. Write the phase handoff document for this session. It will REPLACE this conversation: the session continues from it alone, plus your last message to the user. Use no tools. Answer with ONLY the markdown document, starting with its # title line, no preamble. Sections:
# <project> handoff (<today's date>)
## Goal
## State (what is done, what is verified and how)
## Running now (background agents, workflows, jobs, watchers: name or id, what each will report, how to check it)
## Waiting on the user (decisions, approvals, logins)
## Decisions and why
## Open questions (technical)
## Next steps (ordered, concrete)
## Key files (paths with one line each)
Be specific: real paths, commands, branch names, PR numbers, agent ids. Under 120 lines.`

/** The handoff, when a turn's answer is one: it starts with the title and has the checkpoint's own sections. */
export const handoffIn = (answer: string): string | undefined => {
  const doc = answer.trim()
  if (!doc.startsWith('# ')) return undefined
  return /^## Running now/m.test(doc) && /^## Waiting on/m.test(doc) && /^## Next steps/m.test(doc) ? `${doc}\n` : undefined
}

/** What a handoff leaves of the conversation: the handoff (marked as not the user's words) and the last reply. */
export const swapIn = (s: { path: string; doc: string; last: string }) => [
  {
    role: 'user' as const,
    text:
      `[context-meter] This conversation was handed off to keep the context small; the user did not write this. ` +
      `Earlier turns are gone and the handoff below replaces them (also saved at ${s.path}). It was written by this ` +
      `session from its own context: re-read files rather than guess at details it leaves out.\n\n${s.doc}`,
    toolUses: [],
  },
  { role: 'assistant' as const, text: s.last || 'Handoff loaded; ready to continue.', toolUses: [] },
]

/**
 * Starts a checkpoint turn: one read of the context, while its cache is warm, whose answer is the handoff.
 * Its turn.complete writes the file and swaps it in (the engine compacts only from there, between turns).
 */
async function checkpoint($: EngineInterface, why: string, fromCommand = false): Promise<string | undefined> {
  if (asking !== undefined) return 'handoff: one is already under way.'
  const before = lastTokens || ((await $.session.usage()).context.tokens ?? 0)
  const msgs = await $.session.messages()
  const last = [...msgs].reverse().find(m => m.role === 'assistant' && m.text.trim() !== '')?.text.trim() ?? ''
  asking = { last, before, why, waited: 0, arrived: false }
  // A command's hook holds the prompt: submit once it has returned.
  if (fromCommand) $.clock.after(0, () => void $.prompt.submit({ text: CHECKPOINT }))
  else await $.prompt.submit({ text: CHECKPOINT })
  return undefined
}

/** Swaps the conversation for the handoff and the last reply: no summarizer call. Same session, so running agents still report. */
async function swapNow($: EngineInterface, h: Handoff): Promise<string> {
  swap = h
  try {
    const c = await $.session.compact({ instructions: 'context-meter handoff' })
    if (c.skip !== undefined) throw new Error(c.skip)
    return `Handed off (${k(h.before)} → ${c.tokensAfter ? k(c.tokensAfter) : 'small'}): the conversation is now the handoff plus my last reply. ${h.path}`
  } catch (err) {
    autoOff = 'a swap failed'
    return `handoff written: ${h.path}, but the swap didn't run (${err instanceof Error ? err.message : String(err)}). Automatic handoffs are off for this session. Run /clear, then say "continue from ${h.path}".`
  } finally {
    swap = undefined
  }
}

/** A main-loop turn ended while a checkpoint is under way: if it is the checkpoint's answer, keep it and swap it in. */
async function land($: EngineInterface, e: { reason?: string; answer: string }): Promise<void> {
  const a = asking
  if (a === undefined) return
  const say = (text: string) => (a.why ? $.ui.notify(`${a.why}\n${text}`, { title: 'context-meter' }) : $.ui.toast(text, { timeoutMs: 12_000 }))
  const cut = e.reason !== undefined && e.reason !== 'answer' // aborted (Esc), error or refusal
  const doc = cut ? undefined : handoffIn(e.answer)
  if (doc === undefined) {
    // Another turn (an agent report that got in first), or the checkpoint cut short: never swap a partial answer.
    a.waited++
    if (cut || a.waited >= MAX_WAIT_TURNS) {
      asking = undefined
      if (!cut && a.why) autoOff = 'no handoff came back' // don't keep asking a session that can't answer
      await say(cut ? `handoff: the checkpoint turn ended (${e.reason}); nothing changed.` : 'handoff: no handoff came back; nothing changed.')
    }
    return
  }
  asking = undefined
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  if (!home && HANDOFF_DIR.startsWith('~')) {
    await say('handoff: no home folder (USERPROFILE/HOME) to save it in; nothing changed.')
    return
  }
  const path = `${HANDOFF_DIR.replace(/^~(?=\/|$)/, home)}/${await projectName($)}-handoff.md`
  await $.fs.write(path, doc)
  if (a.arrived) {
    // A report or message landed inside a turn meanwhile; swapping would erase it. The file stands; the conversation stays.
    await say(`handoff written: ${path}, but a message arrived during it, so the conversation was kept. /handoff again when it's quiet.`)
    return
  }
  await say(await swapNow($, { path, doc, last: a.last, before: a.before }))
}

export const register: Register = (on, options) => {
  const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d)
  HANDOFF_AT = num(options.handoffAt, HANDOFF_AT)
  COMPACT_AT = num(options.compactAt, COMPACT_AT)
  if (typeof options.handoffDir === 'string' && options.handoffDir.trim()) HANDOFF_DIR = options.handoffDir.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (options.autoHandoff === false) AUTO_HANDOFF = false

  on('session.start', async ($, e, next) => {
    if (!AUTO_HANDOFF) autoOff = 'turned off in settings'
    await $.command.register({ name: 'handoff', description: 'Write the phase handoff and continue from it alone (no /clear; running agents keep reporting)' })
    await $.command.register({ name: 'ctx', description: 'Context size, usage limits and session cost, once' })
    $.ui.status(undefined) // clear the line an earlier version pinned
    return next(e)
  })

  // This mod's own compaction: the handoff replaces the transcript.
  // Anyone else's (auto, /compact, a subagent's, a precompute) runs as usual.
  on('session.compact', async ($, e, next) => {
    const s = swap
    if (s === undefined || e.agentId !== undefined || e.trigger === 'precompute') return next(e)
    swap = undefined
    return { messages: swapIn(s) }
  })

  // No standing status line. Speak once, only when something needs doing.
  on('session.measure', async ($, e, next) => {
    line(e) // keeps lastTokens current for /handoff
    const t = e.context.tokens ?? 0
    if (t >= HANDOFF_AT && !saidHandoff) {
      saidHandoff = true
      $.ui.toast(`Context passed ${k(HANDOFF_AT)}: at the end of this phase, /handoff.`, { timeoutMs: 8000 })
    }
    if (t < HANDOFF_AT) saidHandoff = false // after a handoff or a compaction
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
    const busy = await checkpoint($, '', true)
    return { text: busy ?? 'handoff: writing it in one turn, then this conversation continues from it alone (no /clear needed).' }
  })

  // A push or merge often ends a phase: with a big context, hand off once the turn ends.
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || ran.isError === true || ran.deny !== undefined) return ran
    if (!/\bgit\s+push\b|\bgh\s+pr\s+(merge|create)\b/.test(e.command)) return ran
    const { context } = await $.session.usage()
    if ((context.tokens ?? 0) >= HANDOFF_AT) phaseEnded = true
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    idleTimer?.cancel()
    const kind = e.origin?.kind ?? ''
    const byUser = !AUTO.has(kind) && kind !== 'plugin'
    if (byUser) userAt = await $.clock.now()
    if (e.turnId !== undefined) {
      if (asking !== undefined) asking.arrived = true // delivered into a running turn: a swap now would erase it
    } else {
      turnByUser = !AUTO.has(kind) // a new turn
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    idleTimer?.cancel()
    const now = await $.clock.now()
    if (e.reason === 'aborted') {
      userAt = now // the user pressed Esc: they're here
      phaseEnded = false
    }
    if (asking !== undefined) {
      phaseEnded = false
      await land($, e)
      return done
    }
    const tokens = (await $.session.usage()).context.tokens ?? 0
    if (phaseEnded) {
      phaseEnded = false
      if (!autoOff && tokens >= HANDOFF_AT) {
        await checkpoint($, 'Phase ended (push or merge) with a big context.')
        return done
      }
    }
    // Running on its own (agent reports, peers, schedules wake it; the user hasn't typed lately): hand off between turns.
    if (!autoOff && !turnByUser && tokens >= HANDOFF_AT && now - userAt >= AWAY_MS) {
      await checkpoint($, `Running on its own at ${k(tokens)} (no message from you in 15+ min): handed off between turns.`)
      return done
    }
    // Before the cache lapses on a big context, hand off: the checkpoint turn still reads it at the cached price.
    idleTimer = $.clock.after(IDLE_MS, () => {
      void (async () => {
        if (autoOff) return
        const { context } = await $.session.usage()
        if ((context.tokens ?? 0) < IDLE_AT) return
        await checkpoint($, `Idle 50 min at ${k(context.tokens ?? 0)}: handed off before the cache lapsed.`)
      })()
    })
    return done
  })
}
