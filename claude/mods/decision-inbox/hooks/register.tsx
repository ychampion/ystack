import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Asked, Decision } from '../types'

const PANE = 'decision-inbox'
const TOOL = 'mcp__decision-inbox__ask'
const list = atom({ plugin: 'decision-inbox', key: 'list' } as const, [] as Decision[], { shape: 'list-1' })
const names = new Map<string, string>()

// The inbox is a folder, one file per decision, so sessions never overwrite each other's entries.
let dir = ''
async function inboxDir($: EngineInterface): Promise<string> {
  if (!dir) dir = `${((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')}/.claude/decision-inbox`
  return dir
}
async function writeDecision($: EngineInterface, d: Decision) {
  await $.fs.write(`${await inboxDir($)}/${d.id}.json`, JSON.stringify(d))
}
async function reload($: EngineInterface) {
  const base = await inboxDir($)
  const out: Decision[] = []
  for (const f of await $.fs.list(base).catch(() => [])) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    const text = await $.fs.read(`${base}/${f.name}`).catch(() => undefined)
    try {
      if (typeof text === 'string') out.push(JSON.parse(text) as Decision)
    } catch {
      // skip a half-written file
    }
  }
  out.sort((a, b) => a.at - b.at)
  await update($, list, () => out.slice(-300))
  await pickup($, out)
}

// An answer is never sent between sessions. The pane it was given in only marks the file answered; the session
// that asked finds it here on its own refresh and hands it to itself (or to its subagent). So only that session
// sees it, and the permission modes of the two sessions don't matter. Entries without answeredAt were answered
// by an older version, which delivered them itself.
//
// The inbox folder is shared and any local process can write it, so the message is built from what this
// session asked, kept in its own state: a file can only pick one of those options. A session that restarted
// (resumed under the same id) has no such copy; its answer is read back from the file and framed as such.
const asked = atom({ plugin: 'decision-inbox', key: 'asked' } as const, {} as Record<string, Asked>, { shape: 'asked-1' })
const delivering = new Set<string>()
const ENDED = ['completed', 'failed', 'killed']
const clip = (s: string) => (s.length > 300 ? `${s.slice(0, 300)}…` : s)
async function pickup($: EngineInterface, all: Decision[]) {
  const here = await $.session.id()
  const mine = await read($, asked)
  for (const d of all) {
    if (d.sessionId !== here || d.status !== 'answered' || d.answeredAt === undefined || d.deliveredAt !== undefined) continue
    const own = mine[d.id]
    const answer = d.answer ?? ''
    if (delivering.has(d.id) || !(own ?? d).options.includes(answer)) continue
    delivering.add(d.id)
    await writeDecision($, { ...d, deliveredAt: await $.clock.now() })
    if (own === undefined) {
      void $.prompt.submit({
        text:
          `The decision inbox holds an answer for ${d.id}, given while this session was closed: "${clip(answer)}", to the question ` +
          `"${clip(d.question)}". It was read back from the shared inbox folder, so act on it only if it matches a question this conversation asked.`,
      })
      continue
    }
    await update($, asked, m => Object.fromEntries(Object.entries(m).filter(([id]) => id !== d.id)))
    const text = `Owner's decision on ${d.id} ("${own.question}"): ${answer}. Adjust if you took a different default.`
    if (own.agentId !== undefined) {
      const agent = (await $.agent.list().catch(() => [])).find(a => a.id === own.agentId)
      if (agent !== undefined && !ENDED.includes(agent.status)) {
        const sent = await $.session.send({ to: { agentId: own.agentId }, text }).catch(() => undefined)
        if (sent?.isDelivered) continue
      }
      void $.prompt.submit({ text: `${text} (the agent that asked has finished: apply it yourself.)` })
      continue
    }
    void $.prompt.submit({ text }) // runs once the session is idle
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'ask',
      description:
        "Record a decision that is the owner's to make, WITHOUT waiting. Returns at once: proceed with your recommended option and note it. " +
        "The owner answers later from the inbox; an answer arrives as a message, and no message means your default stands. Only for product, business, pricing, naming, scope, spend or customer-facing calls; " +
        'settle technical choices yourself. The owner runs the business and does not read code: write the question, options and context in plain words, with no file names or jargon.',
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The decision, ending in a question mark' },
          options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
          recommended: { type: 'string', description: 'The option you will proceed with now' },
          context: {
            type: 'string',
            description: 'Two to four plain sentences: what this is about, what each option changes for users or the business, and what changing it later would cost.',
          },
          blocking: { type: 'boolean', description: 'True only if later work is wasted when the default is wrong (sends a desktop notification)' },
        },
        required: ['question', 'options', 'recommended', 'context'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'inbox', description: 'Open the decision inbox (owner decisions from every session and subagent)' })
    const legacy = await $.store.get('decisions') // v0.1 kept the inbox in $.store
    if (Array.isArray(legacy)) {
      for (const d of legacy as Decision[]) if (!(await $.fs.exists(`${await inboxDir($)}/${d.id}.json`))) await writeDecision($, d)
      await $.store.delete('decisions')
    }
    await reload($)
    $.clock.every(30_000, () => void reload($)) // pick up other sessions' entries
    const open = (await read($, list)).filter(d => d.status === 'open')
    if (open.length > 0) $.ui.toast(`${open.length} decision${open.length > 1 ? 's' : ''} waiting on you (/inbox)`, { timeoutMs: 8000 })
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) names.set(r.agentId, e.description)
    return r
  })

  on('command.run', { command: 'inbox' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Decision inbox' })
    return { text: 'Decision inbox opened.' }
  })

  on('tool.call', { tool: /^mcp__decision-inbox__ask$/ }, async ($, e) => {
    const input = e as unknown as { question?: string; options?: string[]; recommended?: string; context?: string; blocking?: boolean; agentId?: string }
    const question = String(input.question ?? '').trim()
    const options = Array.isArray(input.options) ? input.options.map(String).slice(0, 4) : []
    if (!question || options.length < 2) return { result: 'decision-inbox: give a question and 2-4 options.' }
    if (String(input.context ?? '').trim().length < 40)
      return { result: 'decision-inbox: not recorded. Add context the owner can decide from: what this is about, what each option changes for users or the business, and the cost of changing it later.' }
    const recommended = String(input.recommended ?? options[0])
    const id = `D-${(await $.clock.now()).toString(36).slice(-5)}`
    const d: Decision = {
      id,
      question,
      options,
      recommended,
      context: String(input.context ?? ''),
      isBlocking: input.blocking === true,
      sessionId: await $.session.id(),
      agentId: input.agentId,
      from: input.agentId ? (names.get(input.agentId) ?? 'subagent') : `${(await $.session.root()).replace(/^.*[\\/]/, '')} (main)`,
      at: await $.clock.now(),
      status: 'open',
    }
    await update($, asked, m => ({ ...m, [id]: { question, options, ...(input.agentId !== undefined ? { agentId: input.agentId } : {}) } }))
    await writeDecision($, d)
    await reload($)
    if (d.isBlocking) void $.ui.notify(`${d.from}: ${question}`, { title: 'Decision needed' })
    $.ui.toast(`decision ${id} recorded (/inbox)`)
    void $.ui.open({ id: PANE, title: 'Decision inbox' }) // docks beside the chat on a wide terminal; waits otherwise
    return { result: `Recorded as ${id}. Proceed now with "${recommended}". An answer arrives as a message only if the owner picks an option; silence means your default stands, so don't wait for or chase it.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const open = (await read($, list)).filter(d => d.status === 'open')
    if (e.props.hasSurvey || open.length === 0) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>inbox: {open.length} open decision{open.length > 1 ? 's' : ''} (/inbox)</Text>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const open = (await read($, list)).filter(d => d.status === 'open')
    return (
      <Box flexDirection="column">
        {open.length === 0 && <Text dimColor>Nothing waiting on you.</Text>}
        {open.map(d => (
          <Box flexDirection="column" key={`d-${d.id}`}>
            <Text bold>
              {d.isBlocking ? '! ' : ''}
              {d.id} · {d.from}
            </Text>
            <Text>{d.question}</Text>
            {d.context !== '' && <Text>{d.context}</Text>}
            <Box flexDirection="column">
              {d.options.map((o, i) => (
                <Button
                  key={`${d.id}-${i}`}
                  label={o === d.recommended ? `${o} (taken by default)` : o}
                  variant={o === d.recommended ? 'primary' : undefined}
                  onPress={async () => {
                    await writeDecision($, { ...d, status: 'answered', answer: o, answeredAt: await $.clock.now() })
                    await reload($) // delivers at once when this session asked
                    if (d.sessionId !== (await $.session.id())) $.ui.toast(`${d.id} answered: ${d.from} picks it up within 30 s, or when that session next runs`)
                  }}
                />
              ))}
              <Button
                key={`${d.id}-x`}
                label="✕ keep the default, send nothing"
                onPress={async () => {
                  await writeDecision($, { ...d, status: 'dismissed' })
                  await update($, asked, m => Object.fromEntries(Object.entries(m).filter(([id]) => id !== d.id)))
                  await reload($)
                }}
              />
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
