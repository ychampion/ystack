import type { EngineInterface, Register } from 'claude-code'

import { CLASSIFIER_SYSTEM, NUDGE, buildClassifierInput, excerpt, looksLikeOffer, parseVerdict } from './nudge.ts'

// Sends Claude back to work when it stops to offer an in-scope, reversible next step it could just take.
// Never loops (stop_hook_active), at most maxNudges per owner prompt, and allows the stop whenever unsure.

let isEnabled = true // the `enabled` setting
let isSessionOff = false // /keep-going off
let maxNudges = 2
const CLASSIFIER_MODEL = 'haiku'

const asks = new Map<string, string>() // loop ('main' or a subagent id) -> the request it is working on
const counts = new Map<string, number>() // loop -> nudges since that request
const nudges: { at: number; loop: string; said: string }[] = []

/** The block reason when Claude should keep going, else undefined. */
async function judge($: EngineInterface, loop: string, message: string, background: readonly unknown[] | undefined): Promise<string | undefined> {
  if (!isEnabled || isSessionOff) return undefined
  if (background && background.length > 0) return undefined // waiting on background work is a fine stop
  if ((counts.get(loop) ?? 0) >= maxNudges) return undefined
  if (!looksLikeOffer(message)) return undefined
  const r = await $.model
    .complete({ model: CLASSIFIER_MODEL, system: CLASSIFIER_SYSTEM, prompt: buildClassifierInput(asks.get(loop) ?? '', message), maxTokens: 5 })
    .catch(() => undefined)
  if (!r || !r.isAnswered || parseVerdict(r.text) !== 'CONTINUE') return undefined
  counts.set(loop, (counts.get(loop) ?? 0) + 1)
  nudges.push({ at: await $.clock.now(), loop, said: excerpt(message) })
  $.ui.toast('keep-going: sent Claude back to work', { timeoutMs: 5000 })
  return NUDGE
}

function listing(): string {
  const state = !isEnabled ? 'off (the enabled setting)' : isSessionOff ? 'off for this session' : `on, at most ${maxNudges} nudge(s) per request`
  if (nudges.length === 0) return `keep-going is ${state}. No nudges this session.`
  const rows = nudges.map((n, i) => {
    const t = new Date(n.at).toTimeString().slice(0, 5)
    return `${i + 1}. ${t} ${n.loop === 'main' ? 'main' : `subagent ${n.loop.slice(0, 8)}`}: "${n.said}"`
  })
  return [`keep-going is ${state}. Nudges this session: ${nudges.length}`, ...rows].join('\n')
}

export const register: Register = (on, options) => {
  isEnabled = options.enabled !== false
  if (typeof options.maxNudges === 'number' && options.maxNudges >= 0) maxNudges = Math.floor(options.maxNudges)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'keep-going', description: 'keep-going: list the nudges this session, or `off` / `on`', argumentHint: '[on|off]' })
    return next(e)
  })

  on('command.run', { command: 'keep-going' }, async (_$, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      isSessionOff = arg === 'off'
      return { text: `keep-going ${arg} for this session.${arg === 'on' && !isEnabled ? ' (The enabled setting is off, so it stays off: change it in /config.)' : ''}` }
    }
    return { text: listing() }
  })

  // A new request from the owner resets the main loop's count.
  on('prompt.submit', async ($, e, next) => {
    if ((e.origin.kind === 'composer' || e.origin.kind === 'bridge') && e.command === undefined) {
      asks.set('main', e.text)
      counts.delete('main')
    }
    return next(e)
  })

  // A subagent's request is its task prompt.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    const id = (r as { agentId?: string }).agentId
    if (id !== undefined && e.resume === undefined) asks.set(id, e.prompt)
    return r
  })

  on('classic.Stop', async ($, e, next) => {
    if (e.stop_hook_active) return next(e)
    const reason = await judge($, 'main', e.last_assistant_message ?? '', e.background_tasks)
    return reason ? { block: reason } : next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    if (e.stop_hook_active) return next(e)
    const reason = await judge($, e.agent_id, e.last_assistant_message ?? '', e.background_tasks)
    if (!reason) {
      asks.delete(e.agent_id)
      counts.delete(e.agent_id)
    }
    return reason ? { block: reason } : next(e)
  }).catch(($, e, next) => next(e))
}
