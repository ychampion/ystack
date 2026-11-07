import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { type Pin, compactInstructions, detectRules, listText, missingPins, parsePinArgs, pinBlock, projectKey } from './pins.ts'

// Session pins live in $.state (this session only); project pins in $.store, keyed by folder.
const pins = atom({ plugin: 'pin', key: 'pins' } as const, [] as string[], { shape: 'pins-1' })

let isProjectOn = true // false after a /clear, which is a deliberate reset
let isInjectPending = false // project pins go to the model with the session's first prompt
let lastSuggested = ''

async function projectPins($: EngineInterface): Promise<string[]> {
  const v = await $.store.get(projectKey(await $.session.root())).catch(() => undefined)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

async function allPins($: EngineInterface): Promise<Pin[]> {
  const own = (await read($, pins)).map((text): Pin => ({ text, scope: 'session' }))
  const proj = isProjectOn ? (await projectPins($)).map((text): Pin => ({ text, scope: 'project' })) : []
  return [...own, ...proj]
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'pin', description: 'Pin a rule so it survives compaction word for word; no text lists the pins', argumentHint: '[--project] <rule>' })
    await $.command.register({ name: 'unpin', description: 'Remove pin number n (see /pin)', argumentHint: '<n>' })
    isProjectOn = true
    isInjectPending = (await projectPins($)).length > 0
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, pins, () => [])
      isProjectOn = false
      isInjectPending = false
    }
    return next(e)
  })

  on('command.run', { command: 'pin' }, async ($, e) => {
    const a = parsePinArgs(e.args)
    if (a.kind === 'list') return { text: listText(await allPins($)) }
    if (a.isProject) {
      const key = projectKey(await $.session.root())
      const cur = await projectPins($)
      if (!cur.includes(a.text)) await $.store.set(key, [...cur, a.text])
      isProjectOn = true
      return { text: `Pinned for this project (every session in this folder): ${a.text}` }
    }
    await update($, pins, ps => (ps.includes(a.text) ? ps : [...ps, a.text]))
    return { text: `Pinned for this session: ${a.text}` }
  })

  on('command.run', { command: 'unpin' }, async ($, e) => {
    const all = await allPins($)
    const n = Number.parseInt(e.args.trim(), 10)
    const hit = Number.isInteger(n) ? all[n - 1] : undefined
    if (!hit) return { text: `No pin number "${e.args.trim()}". ${all.length ? `Pick 1 to ${all.length}:\n${listText(all)}` : listText(all)}` }
    if (hit.scope === 'session') await update($, pins, ps => ps.filter(p => p !== hit.text))
    else await $.store.set(projectKey(await $.session.root()), (await projectPins($)).filter(p => p !== hit.text))
    return { text: `Removed: ${hit.text}` }
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.command || (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge')) return next(e)
    const have = await allPins($)
    const rule = detectRules(e.text).find(r => !have.some(p => p.text === r))
    if (rule && rule !== lastSuggested) {
      lastSuggested = rule
      $.ui.toast(`Pin this rule? /pin ${rule}`, { timeoutMs: 10_000 })
    }
    if (!isInjectPending) return next(e)
    isInjectPending = false
    const proj = have.filter(p => p.scope === 'project').map(p => p.text)
    if (proj.length === 0) return next(e)
    return next({ ...e, context: [...(e.context ?? []), `Rules the owner pinned for this project. Follow them word for word:\n${pinBlock(proj)}`] })
  }).catch(($, e, next) => next(e))

  // Pins ride into the summary on the way down and are checked on the way up.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const texts = (await allPins($)).map(p => p.text)
    if (texts.length === 0) return next(e)
    const r = await next({ ...e, instructions: compactInstructions(e.instructions, texts) })
    if (r.skip !== undefined) return r
    const missing = missingPins(
      texts,
      r.messages.map(m => m.text),
    )
    if (missing.length === 0) return r
    return { ...r, messages: [...r.messages, { role: 'user' as const, text: pinBlock(missing), toolUses: [] }] }
  }).catch(($, e, next) => next(e))
}
