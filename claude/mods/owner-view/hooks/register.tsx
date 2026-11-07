import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { BriefView, StripView } from '../types'
import {
  BRIEF_PROMPT,
  type Input,
  STAGES,
  type Track,
  captionPrompt,
  cleanCaption,
  emptyTrack,
  fold,
  isAway,
  missing,
  ruleCaption,
  signalOf,
  signalOfCommand,
  stageOf,
  suggestionFor,
} from './caption.ts'

const PANE = 'owner-brief'
const MAX_MODEL_CAPTIONS = 150 // per session, so a long run never spends much on captions
const MAX_IN_FLIGHT = 3

const captionFamily = { plugin: 'owner-view', key: 'caption' } as const
const strip = atom({ plugin: 'owner-view', key: 'strip' } as const, { stage: '', missing: [] } as StripView, { shape: 'strip-1' })
const brief = atom({ plugin: 'owner-view', key: 'brief' } as const, { status: 'idle', text: '', at: 0, isAway: false } as BriefView, { shape: 'brief-1' })

// Settings
let captionsOn = true
let suggestionsOn = true
let awayMinutes = 45

// Session state (none of it is drawn from directly: drawings read the atoms)
let track: Track = emptyTrack()
let isQuiet = false
let hasReviewPanel = false
let pendingSuggestion: string | undefined
let lastActiveAt = 0
let workSinceBrief = 0
let idleTimer: Timer | undefined
/** The idle timer already wrote this break's brief: until the owner next types, turns that run on their own don't fork again. */
let isBreakBriefWritten = false

// Captions no rule knows: one small model call each, off the drawing path.
const queue: { id: string; tool: string; input: Input }[] = []
const asked = new Set<string>()
let inFlight = 0
let modelCaptions = 0

function drain($: EngineInterface) {
  while (inFlight < MAX_IN_FLIGHT && queue.length > 0 && modelCaptions < MAX_MODEL_CAPTIONS) {
    const job = queue.shift()
    if (!job) break
    inFlight += 1
    modelCaptions += 1
    void (async () => {
      try {
        const r = await $.model.complete({ model: 'haiku', prompt: captionPrompt(job.tool, job.input), maxTokens: 30, timeoutMs: 10_000 })
        const text = r.isAnswered ? cleanCaption(r.text) : undefined
        if (text) await $.state.set({ ...captionFamily, id: job.id }, text)
      } catch {
        // no caption is fine: the row stands as it was
      } finally {
        inFlight -= 1
        drain($)
      }
    })()
  }
}

function askCaption($: EngineInterface, id: string, tool: string, input: Input) {
  if (!captionsOn || !id || asked.has(id) || modelCaptions >= MAX_MODEL_CAPTIONS) return
  asked.add(id)
  queue.push({ id, tool, input })
  $.clock.after(0, () => drain($)) // a timer, so the call outlives this tool call's dispatch
}

async function publishStrip($: EngineInterface) {
  const next: StripView = { stage: stageOf(track) ?? '', missing: missing(track.needs) }
  const cur = await read($, strip)
  if (cur.stage === next.stage && cur.missing.join('|') === next.missing.join('|')) return
  await update($, strip, () => next)
}

function plainReason(reason: string): string {
  if (reason === 'nothing-to-fork') return 'Nothing to brief yet: no work has happened in this session.'
  if (reason === 'aborted') return 'The brief was cut off. Run /brief-me again.'
  return 'The brief could not be written just now. Run /brief-me again in a minute.'
}

async function writeBrief($: EngineInterface, isAwayBrief: boolean) {
  const cur = await read($, brief)
  if (cur.status === 'writing') return
  await update($, brief, (v): BriefView => ({ ...v, status: 'writing', isAway: isAwayBrief }))
  // A fork reads the session's own cached transcript and adds nothing to the main context.
  const r = await $.model.fork({ prompt: BRIEF_PROMPT }).catch(() => undefined)
  const at = await $.clock.now()
  if (r?.isAnswered) {
    workSinceBrief = 0
    await update($, brief, (): BriefView => ({ status: 'ready', text: r.text.trim(), at, isAway: isAwayBrief }))
  } else {
    await update($, brief, (): BriefView => ({ status: 'error', text: plainReason(r?.reason ?? 'error'), at, isAway: isAwayBrief }))
  }
}

export const register: Register = (on, options) => {
  captionsOn = options.captions !== false
  suggestionsOn = options.suggestions !== false
  if (typeof options.awayMinutes === 'number' && options.awayMinutes > 0) awayMinutes = options.awayMinutes

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'brief-me', description: 'A plain-English brief: what is done, what is left, what is risky, what needs you' })
    await $.command.register({ name: 'owner-view', description: 'owner-view: `quiet` stops next-step suggestions, `on` brings them back', argumentHint: '[quiet|on]' })
    isQuiet = (await $.store.get('quiet')) === true
    hasReviewPanel = (await $.command.list().catch(() => [])).some(c => c.name === 'review-panel')
    lastActiveAt = await $.clock.now()
    // A new conversation (startup, /clear, /resume) starts with nothing missing and nothing to suggest.
    track = emptyTrack()
    pendingSuggestion = undefined
    workSinceBrief = 0
    isBreakBriefWritten = false
    idleTimer?.cancel()
    await publishStrip($)
    return next(e)
  })

  // ---------- 1. plain captions under tool rows ----------
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (!captionsOn || !row) return row
    const input = (e.props.input && typeof e.props.input === 'object' ? e.props.input : {}) as Input
    const text = ruleCaption(e.props.tool, input) ?? ((await $.state.get(memberOf(captionFamily, e))).value ?? '')
    if (!text) return row
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {row}
        <Text dimColor>  {text}</Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // ---------- activity: captions to ask for, the stage, what is missing ----------
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Input
    if (captionsOn && ruleCaption(e.tool, input) === undefined) askCaption($, e.tool_use_id, e.tool, input)
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    const s = signalOf(e.tool, input)
    const isOk = ran.isError !== true
    // A failed test run still ran the tests; an edit or a push that failed did nothing.
    if (!isOk && (s.kind === 'edit' || s.kind === 'ship')) return ran
    if (isOk && e.agentId === undefined && e.tool === 'EnterPlanMode') track = { ...track, isPlanMode: true }
    if (isOk && e.agentId === undefined && e.tool === 'ExitPlanMode') track = { ...track, isPlanMode: false }
    const before = track
    track = fold(track, s)
    // Subagents change what is missing, but their own reading does not move the main task's stage.
    if (e.agentId !== undefined) track = { ...track, recent: before.recent }
    await publishStrip($)
    return ran
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const isPlan = e.permission_mode === 'plan'
    if (isPlan !== track.isPlanMode) {
      track = { ...track, isPlanMode: isPlan }
      await publishStrip($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // ---------- 2. the brief, and "While you were away" ----------
  on('prompt.submit', async ($, e, next) => {
    const isPerson = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    if (!isPerson || e.isMeta) return next(e)
    pendingSuggestion = undefined
    idleTimer?.cancel()
    const now = await $.clock.now()
    const cmd = e.command?.name
    if (cmd) {
      const s = signalOfCommand(cmd)
      if (s) {
        track = fold(track, s)
        await publishStrip($)
      }
    }
    // A break: idle past the setting, or the idle timer wrote a brief since the owner last typed (turns that ran on
    // their own since then, a loop or a finished background job, don't end the owner's break).
    if (cmd !== 'brief-me' && (isAway(lastActiveAt, now, awayMinutes) || isBreakBriefWritten)) {
      const b = await read($, brief)
      // Written while they were away (the idle timer), or work happened since the last brief.
      const isFresh = b.status === 'ready' && b.at >= lastActiveAt
      if (isFresh || workSinceBrief > 0) {
        if (isFresh) await update($, brief, v => ({ ...v, isAway: true }))
        else $.clock.after(0, () => void writeBrief($, true))
        void $.ui.open({ id: PANE, title: 'While you were away' })
      }
    }
    isBreakBriefWritten = false
    lastActiveAt = now
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'brief-me' }, async $ => {
    await update($, brief, v => ({ ...v, isAway: false }))
    $.clock.after(0, () => void writeBrief($, false))
    await $.ui.open({ id: PANE, title: 'Brief' })
    return { text: 'Writing your brief from the session so far (it does not add to the conversation).' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const b = await read($, brief)
    const head = b.isAway ? 'While you were away' : 'Brief'
    if (b.status === 'idle') return <Text dimColor>Run /brief-me for a plain-English brief.</Text>
    if (b.status === 'writing') return <Text dimColor>{head}: writing…</Text>
    if (b.status === 'error') return <Text>{b.text}</Text>
    const lines = b.text.split('\n').filter(l => l.trim() !== '')
    return (
      <Box flexDirection="column">
        <Text bold>{head}</Text>
        {lines.map(l => {
          const t = l.replace(/^#+\s*/, '').replace(/\*\*/g, '')
          const isHeading = /^(#|\*\*)?\s*(done|left|risky|needs you)\b/i.test(l.trim()) && !/^\s*-/.test(l)
          return isHeading ? <Text bold>{t}</Text> : <Text>{t}</Text>
        })}
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    workSinceBrief += 1
    lastActiveAt = await $.clock.now()
    idleTimer?.cancel()
    // Write the brief while the owner is away and the prompt cache is still warm, so it is ready when they return.
    // Once per break: a fork reads the whole conversation, so turns that run on their own while the owner is away
    // (a loop, a finished background job) re-arm the timer but never fork a second brief.
    idleTimer = $.clock.after(awayMinutes * 60_000, () => {
      if (isBreakBriefWritten || workSinceBrief === 0) return
      isBreakBriefWritten = true
      void writeBrief($, true)
    })

    // ---------- 4. next-step suggestion ----------
    const s = suggestionsOn && !isQuiet ? suggestionFor(track.needs, hasReviewPanel) : undefined
    pendingSuggestion = s
    if (s) $.clock.after(500, () => void $.prompt.suggest({ text: s }).catch(() => undefined))
    return done
  }).catch(($, e, next) => next(e))

  // The engine's own guess after a turn gives way to the missing step.
  on('prompt.suggest', { origin: { kind: 'suggestion' } }, ($, e, next) => {
    if (pendingSuggestion && suggestionsOn && !isQuiet) return next({ ...e, text: pendingSuggestion })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'owner-view' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'quiet' || arg === 'on') {
      isQuiet = arg === 'quiet'
      await $.store.set('quiet', isQuiet)
      if (isQuiet) pendingSuggestion = undefined
      return { text: isQuiet ? 'owner-view: next-step suggestions are off (remembered). /owner-view on brings them back.' : 'owner-view: next-step suggestions are on.' }
    }
    const v = await read($, strip)
    const parts = [
      `stage: ${v.stage || 'not started'}`,
      v.missing.length > 0 ? `still needs: ${v.missing.join(', ')}` : 'nothing missing',
      `suggestions ${!suggestionsOn ? 'off in settings' : isQuiet ? 'quiet' : 'on'}`,
    ]
    return { text: `owner-view: ${parts.join(' · ')}. Use /owner-view quiet|on.` }
  })

  // ---------- 3. the stage strip ----------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, strip)
    if (e.props.hasSurvey || v.missing.length === 0) return next(e)
    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Box>
          {STAGES.map((s, i) => (
            <Text bold={s === v.stage} dimColor={s !== v.stage}>
              {i > 0 ? ' › ' : ''}
              {s}
            </Text>
          ))}
        </Box>
        <Text dimColor>Before it ships: {v.missing.join(' · ')}</Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
