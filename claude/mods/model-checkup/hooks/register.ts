import type { EngineInterface, Register } from 'claude-code'

import { AUDIT, isAudit, isNew, modelKey, remember } from './checkup'

// Models reminded about (or audited), kept across sessions: each model is mentioned once, ever.
const SEEN = 'seen'

async function seen($: EngineInterface): Promise<string[]> {
  const v = await $.store.get(SEEN)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/** The current model is new: suggest the audit once, then remember the model. */
async function check($: EngineInterface): Promise<void> {
  const model = await $.session.model()
  const list = await seen($)
  if (!isNew(model, list)) return
  await $.store.set(SEEN, remember(model, list))
  $.ui.toast(`First time on ${modelKey(model)}: ${AUDIT} checks your CLAUDE.md, skills and agents for wording that works against it. Tab to take it.`, { timeoutMs: 12_000 })
  void $.prompt.suggest({ text: AUDIT })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    if (e.isInteractive) void check($)
    return started
  })

  // A /model switch has no event of its own: look again when a turn ends, the moment a suggestion is shown.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await check($)
    return done
  })

  // Running the audit counts: no reminder later for this model.
  on('prompt.submit', async ($, e, next) => {
    if (isAudit(e.text)) {
      const model = await $.session.model()
      await $.store.set(SEEN, remember(model, await seen($)))
    }
    return next(e)
  })
}
