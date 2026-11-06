import type { Register } from 'claude-code'

import { footer, kindOf, missing } from './lint.ts'

export const register: Register = on => {
  on('agent.spawn', async ($, e, next) => {
    if (e.fork || e.resume !== undefined) return next(e)
    const hasInbox = (await $.tool.list()).some(t => t.name === 'mcp__decision-inbox__ask')
    const reqs = missing(e.prompt, kindOf(e.subagentType), hasInbox)
    if (reqs.length === 0) return next(e)

    const spawned = await next({ ...e, prompt: e.prompt + footer(reqs) })
    if (spawned.deny === undefined) $.ui.toast(`brief-linter: added ${reqs.map(r => r.id).join(', ')} to "${e.description}"`)
    return spawned
  }).catch(($, e, next) => next(e)) // a lint bug never blocks a dispatch
}
