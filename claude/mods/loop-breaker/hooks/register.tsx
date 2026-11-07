import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelEffort, Register } from 'claude-code'

import type { LoopFlag } from '../types'
import {
  type LoopState,
  type Signal,
  bandWhat,
  describe,
  escalate,
  evidencePack,
  firstNote,
  hashText,
  newLoop,
  observeCommand,
  observeFile,
} from './signals.ts'

const flags = atom({ plugin: 'loop-breaker', key: 'flags' } as const, [] as LoopFlag[], { shape: 'flags-1' })

const loops = new Map<string, LoopState>() // 'main' or a subagent id
const tasks = new Map<string, string>() // the text each loop's run began with
const models = new Map<string, { model: string; effort?: ModelEffort }>() // the model each loop's last request named
const names = new Map<string, string>() // subagent id -> its task description
const stopped = new Set<string>()
let mainTurn: string | undefined

const STOP_TEXT =
  'loop-breaker: you have been stopped because you kept going in circles, and the owner has been told. Do not call more tools. Reply now with what you tried, what failed, and what you believe the cause is.'

const loopOf = (key: string): LoopState => {
  let l = loops.get(key)
  if (!l) loops.set(key, (l = newLoop(tasks.get(key) ?? '')))
  return l
}
const whoOf = (loop: string) => (loop === 'main' ? 'the main session' : `subagent "${names.get(loop) ?? loop.slice(0, 8)}"`)

async function hashOf($: EngineInterface, path: string): Promise<string | undefined> {
  const text = await $.fs.read(path).catch(() => undefined)
  return typeof text === 'string' ? hashText(text) : undefined
}

async function setFlag($: EngineInterface, loop: string, sig: Signal) {
  const flag: LoopFlag = { loop, who: whoOf(loop), what: bandWhat(sig), count: sig.count }
  await update($, flags, fs => [...fs.filter(f => f.loop !== loop), flag])
}
const clearFlags = ($: EngineInterface, keep: (f: LoopFlag) => boolean) => update($, flags, fs => fs.filter(keep))

async function secondOpinion($: EngineInterface, loop: string, s: LoopState, sig: Signal): Promise<string> {
  const m = models.get(loop)
  if (!m) return firstNote(sig) // unreachable: the ladder skips this step when the model is unknown
  const r = await $.model
    .complete({
      model: m.model, // the stuck loop's own model, never another
      ...(m.effort ? { effort: m.effort } : {}),
      system: 'You give short, concrete second opinions to a stuck coding agent.',
      prompt: evidencePack(s, sig),
      maxTokens: 1500,
      timeoutMs: 120_000,
    })
    .catch(() => undefined)
  if (!r || !r.isAnswered)
    return `${firstNote(sig)} (A second opinion was asked for but did not come back${r ? `: ${r.reason}` : ''}.)`
  return `loop-breaker: ${describe(sig)}.\nSECOND OPINION (a fresh look by the same model, ${m.model}, which saw none of your conversation):\n${r.text.trim()}\n\nWeigh this, write down what you now believe the cause is, then try something different.`
}

async function stopLoop($: EngineInterface, loop: string, sig: Signal) {
  stopped.add(loop) // first, so the stop holds even if telling the owner fails below
  await tellOwner($, loop, sig).catch(() => undefined)
  if (loop === 'main' && mainTurn) {
    const turnId = mainTurn
    $.clock.after(50, () => void $.turn.abort({ turnId }).catch(() => undefined)) // after this tool result lands
  }
}

async function tellOwner($: EngineInterface, loop: string, sig: Signal) {
  const who = whoOf(loop)
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  const now = await $.clock.now()
  const folder = (await $.session.root()).replace(/^.*[\\/]/, '')
  const decision = {
    id: `D-${now.toString(36).slice(-5)}`,
    question: `${who} kept going in circles (${describe(sig)}) and was stopped. How should it go on?`,
    options: ['I will look at it myself', 'Try a different approach', 'Drop this task'],
    recommended: 'I will look at it myself',
    context: `It repeated the same thing several times, got a note to change course${loopOf(loop).level >= 2 ? ' and a second opinion' : ''}, and still did not move forward, so it was stopped to save time and cost. Nothing more happens until you decide.`,
    isBlocking: true,
    sessionId: await $.session.id(),
    ...(loop === 'main' ? {} : { agentId: loop }),
    from: loop === 'main' ? `${folder} (main)` : (names.get(loop) ?? 'subagent'),
    at: now,
    status: 'open',
  }
  if (home) await $.fs.write(`${home}/.claude/decision-inbox/${decision.id}.json`, JSON.stringify(decision)).catch(() => undefined)
  void $.ui.notify(`${who} kept going in circles and was stopped. Your call is in the inbox.`, { title: 'loop-breaker' }).catch(() => undefined)
  $.ui.toast(`loop-breaker: stopped ${who} (see /inbox)`, { timeoutMs: 8000 })
}

export const register: Register = (on, options) => {
  const repeats = Math.max(2, Math.floor(Number(options.repeats ?? 3)) || 3)
  const isSecondOpinionOn = options.secondOpinion !== false

  // A new prompt from the owner starts every loop's counters fresh and lifts any stop. The owner's answer
  // in the decision inbox arrives as that plugin's prompt: it is the owner speaking too.
  on('prompt.submit', async ($, e, next) => {
    const o = e.origin
    if (o.kind === 'composer' || o.kind === 'bridge' || (o.kind === 'plugin' && o.name === 'decision-inbox')) {
      loops.clear()
      stopped.clear()
      await clearFlags($, () => false)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const loop = e.agentId ?? 'main'
    if (e.agentId === undefined) mainTurn = e.turnId
    if (e.text.trim()) {
      tasks.set(loop, e.text.slice(0, 2000))
      const l = loops.get(loop)
      if (l && !l.task) loops.set(loop, { ...l, task: e.text.slice(0, 2000) })
    }
    return next(e)
  })

  // The model each loop actually runs on, as the engine resolved it for its latest request.
  on('turn.step', async function* ($, e, next) {
    models.set(e.agentId ?? 'main', { model: e.model, ...(typeof e.effort === 'string' ? { effort: e.effort } : {}) })
    return yield* next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      names.set(r.agentId, e.description ?? 'subagent')
      if (r.model && !models.has(r.agentId)) models.set(r.agentId, { model: r.model })
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const id = e.agentId
      loops.delete(id)
      stopped.delete(id)
      await clearFlags($, f => f.loop !== id).catch(() => undefined)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const loop = e.agentId ?? 'main'
    if (stopped.has(loop)) return { deny: STOP_TEXT }
    const isCmd = e.tool === 'Bash' || e.tool === 'PowerShell'
    const isEdit = e.tool === 'Edit' || e.tool === 'Write'
    if (!isCmd && !isEdit) return next(e)

    const before = e.tool === 'Edit' ? await hashOf($, e.file_path) : undefined
    const ran = await next(e)
    if (ran.deny !== undefined) return ran

    let observed
    if (isCmd) {
      const text = ran.text ?? ''
      const isOk = ran.isError !== true && !/^Exit code [1-9]/.test(text)
      observed = observeCommand(loopOf(loop), { cmd: e.command, isOk, output: text }, repeats)
    } else {
      if (ran.isError === true) return ran
      const path = e.file_path
      const after = e.tool === 'Write' ? hashText(e.content) : await hashOf($, path)
      if (after === undefined) return ran
      observed = observeFile(loopOf(loop), path, after, before)
    }
    loops.set(loop, observed.state)
    if (observed.isProgress) await clearFlags($, f => f.loop !== loop)
    const sig = observed.signals[0]
    if (!sig) return ran

    const step = escalate(observed.state, isSecondOpinionOn && models.has(loop))
    loops.set(loop, step.state)
    await setFlag($, loop, sig)
    let note: string
    if (step.action === 'note') note = firstNote(sig)
    else if (step.action === 'second-opinion') note = await secondOpinion($, loop, step.state, sig)
    else {
      await stopLoop($, loop, sig)
      note = `loop-breaker: ${describe(sig)}. ${STOP_TEXT.replace(/^loop-breaker: /, '')}`
    }
    return { ...ran, context: [...(ran.context ?? []), note] }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const fs = await read($, flags)
    const first = fs[0]
    if (e.props.hasSurvey || !first) return next(e)
    const { Text } = $.ui.resolve(e)
    return (
      <Text color="warning">
        loop-breaker: {first.who} retried {first.what} {first.count} times
        {fs.length > 1 ? ` (+${fs.length - 1} more)` : ''}
      </Text>
    )
  })
}
