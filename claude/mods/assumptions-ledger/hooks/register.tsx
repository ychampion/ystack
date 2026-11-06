import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Assumption } from '../types'
import { parseAssumptions, triageNote } from './parse.ts'

const PANE = 'assumptions'
const items = atom({ plugin: 'assumptions-ledger', key: 'items' } as const, [] as Assumption[], { shape: 'items-1' })
const names = new Map<string, string>() // agentId -> the task's description
let pending: string[] = [] // triage notes the main loop has not read yet

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'assumptions', description: 'Log of the assumptions subagents reported (Claude triages them; your calls go to /inbox)' })
    return next(e)
  })

  on('command.run', { command: 'assumptions' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Assumptions' })
    return { text: 'Assumptions log opened.' }
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) names.set(r.agentId, e.description)
    return r
  })

  // A subagent's report: log its assumptions and queue them for the main loop to triage. Nothing pops up for the owner.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) return done
    const found = parseAssumptions(e.answer)
    if (found.length === 0) return done
    const agent = names.get(e.agentId) ?? e.agentId.slice(0, 8)
    const at = await $.clock.now()
    await update($, items, list => [
      ...list,
      ...found.map((text, i) => ({ id: `${e.agentId}-${e.turnId}-${i}`, agent, text, status: 'open' as const, at })),
    ].slice(-200))
    pending.push(triageNote(agent, found))
    return done
  })

  // Background agents: the note rides on the completion notification the main loop wakes up to.
  on('prompt.submit', async ($, e, next) => {
    if (pending.length === 0 || e.origin.kind === 'plugin') return next(e)
    const notes = pending
    pending = []
    return next({ ...e, context: [...(e.context ?? []), ...notes] })
  })

  // Foreground agents (and anything else): the note rides on the main loop's next tool result.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined || pending.length === 0 || ran.deny !== undefined) return ran
    const notes = pending
    pending = []
    return { ...ran, context: [...(ran.context ?? []), ...notes] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const all = await read($, items)
    const open = all.filter(a => a.status === 'open')
    return (
      <Box flexDirection="column">
        <Text dimColor>Claude checks these itself. Anything that needs you goes to /inbox, with context.</Text>
        {all.length === 0 && <Text dimColor>No assumptions reported yet.</Text>}
        {open.length > 0 && <Button key="clear" label="Clear log" onPress={() => update($, items, l => l.map(a => ({ ...a, status: 'ok' as const })))} />}
        {open.slice(-30).map(a => (
          <Box flexDirection="column" key={`row-${a.id}`}>
            <Text dimColor>{a.agent}</Text>
            <Text>{a.text}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
