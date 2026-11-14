// Living themes: animated backdrops behind the chat that follow what the agent does, the local time of day and the season.
// The ways of setting a backdrop, the Backdrop render hook, the card and `quietly` are adapted from Anthropic's
// theme-examples plugin (Apache-2.0; see NOTICE.md).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import {
  Coalescer,
  FLASH_MS,
  SUCCESS_WORDS,
  activityOf,
  decodeScene,
  encodeScene,
  localTime,
  newTracker,
  onAgents,
  onFlash,
  onPromptSubmit,
  onToolEnd,
  onToolStart,
  onTurnComplete,
  parseOffset,
  phaseOf,
  seasonOf,
} from './moment'
import type { CoalescerIo, Tracker } from './moment'
import type { LivingTheme, Phase, SceneCtx } from './scenes/contract'
import { THEMES, sceneFault, sceneFor, themeOf } from './themes'
import type { LiveChoice } from '../types'

const PLUGIN = 'living-themes'
const CARD = 'live-theme-card'
const COMMAND = 'live-theme'
const PREVIEW_MS = 20_000
/** At most one backdrop change in this long: a burst of tool calls lands as one change, on the latest moment. */
export const GAP_MS = 1500
/** How often the time of day and the season are read again. */
const TICK_MS = 5 * 60_000
/** How often the running subagents are counted while any run (their end has no event of its own on every engine). */
const AGENT_POLL_MS = 4000
// The store, shared by every session: the default theme's id, and 'on' where the person asked for calm.
const DEFAULT_KEY = 'default'
const CALM_KEY = 'calm'
/** The agent statuses that count as running. */
const RUNNING = new Set(['running', 'pending', 'waiting'])

// The loader's scan reads this reference: both names are written as string literals.
const choice = atom({ plugin: 'living-themes', key: 'choice' } as const, {}, { shape: 'choice-1' })

/** What a set comes to on any engine, as far as this mod reads it: drawn or not. */
type BackdropAnswer = { isDrawn: boolean }
type Glass = ReturnType<LivingTheme['glass']>
type BackdropChoice = { id: string; glass: Glass; colorScheme?: 'light' | 'dark' }
/** The engines this mod meets, for the type checker alone: the theme noun or the older call may be absent. */
type AnyEngine = {
  theme?: { set(args: unknown): Promise<BackdropAnswer>; clear(): Promise<unknown> }
  // `toast` is named only so that this type shares a member with every engine's ui noun.
  ui: { toast: EngineInterface['ui']['toast']; backdrop?(args: BackdropChoice | undefined): Promise<BackdropAnswer> }
}

// The module's own variables start over on a reload; the state and the store do not.
let taken: 'beside' | 'nested' | 'older' | 'none' | undefined
let tracker: Tracker = newTracker()
let ticker: Timer | undefined
let agentPoll: Timer | undefined
let flashEnding: Timer | undefined
let previewEnding: Timer | undefined
let pushing: Promise<void> = Promise.resolve()
let settings = { offset: undefined as number | undefined, hemisphere: 'north' as 'north' | 'south', reactToAgent: true }

/** The engine's way is not this one: a missing call (TypeError) or a shape it says it does not know. */
function isNotThisEnginesWay(error: unknown, member?: string): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      (error.message.includes('does not know the attribute') || (member !== undefined && error.message.includes(member))))
  )
}

/**
 * Sets a backdrop by whichever call this engine has: the theme noun with the colour scheme beside the backdrop, the
 * theme noun with it inside, or the older call on the ui noun. Each call is made on the spot inside its own try.
 */
async function setByAWay($: AnyEngine, backdrop: BackdropChoice): Promise<BackdropAnswer | undefined> {
  if (taken === undefined || taken === 'beside') {
    try {
      const set = await $.theme!.set({
        backdrop: { scene: backdrop.id, id: backdrop.id, glass: backdrop.glass },
        ...(backdrop.colorScheme !== undefined && { overrideColorScheme: backdrop.colorScheme }),
      })
      if (backdrop.colorScheme !== undefined) taken = 'beside'
      return set
    } catch (error) {
      if (!isNotThisEnginesWay(error, 'overrideColorScheme')) throw error
    }
  }
  if (taken === undefined || taken === 'nested') {
    try {
      const set = await $.theme!.set({
        backdrop: {
          id: backdrop.id,
          glass: backdrop.glass,
          ...(backdrop.colorScheme !== undefined && { colorScheme: backdrop.colorScheme }),
        },
      })
      taken = 'nested'
      return set
    } catch (error) {
      if (!isNotThisEnginesWay(error)) throw error
    }
  }
  if (taken === undefined || taken === 'older') {
    try {
      const set = await $.ui.backdrop!({ id: backdrop.id, glass: backdrop.glass })
      taken = 'older'
      return set
    } catch (error) {
      if (!isNotThisEnginesWay(error)) throw error
    }
  }
  return undefined
}

/** A way once learnt is the only one tried; where it fails the ways are walked anew. None at all draws nothing. */
async function setBackdrop($: AnyEngine, backdrop: BackdropChoice): Promise<BackdropAnswer> {
  if (taken === 'none') return { isDrawn: false }
  const learnt = taken
  const set = await setByAWay($, backdrop)
  if (set !== undefined) return set
  if (learnt !== undefined) {
    taken = undefined
    const again = await setByAWay($, backdrop)
    if (again !== undefined) return again
  }
  taken = 'none'
  return { isDrawn: false }
}

/** Clears the backdrop by whichever call this engine has; an engine with neither is left alone. */
async function clearBackdrop($: AnyEngine): Promise<void> {
  try {
    await $.theme!.clear()
    return
  } catch (error) {
    if (!isNotThisEnginesWay(error)) throw error
  }
  try {
    await $.ui.backdrop!(undefined)
  } catch (error) {
    if (!isNotThisEnginesWay(error)) throw error
  }
}

/** The scene's name as the engine hands it to the Backdrop hook: `scene` on the newest engines, `id` before them. */
function sceneNameOf(props: { scene?: unknown; id?: unknown }): string | undefined {
  if (typeof props.scene === 'string') return props.scene
  return typeof props.id === 'string' ? props.id : undefined
}

/** The app's colour scheme for a theme at a time of day: an 'auto' theme is light at dawn and day, dark after. */
export function schemeOf(theme: LivingTheme, phase: Phase): 'light' | 'dark' {
  if (theme.window !== 'auto') return theme.window
  return phase === 'dawn' || phase === 'day' ? 'light' : 'dark'
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs a step that must never cost a person their prompt, a tool call or a turn: its fault goes to the debug log alone
 * (with no option the engine's log call appends a line to the transcript), and nothing else happens.
 */
async function quietly($: EngineInterface, step: () => Promise<void>): Promise<void> {
  try {
    await step()
  } catch (error) {
    try {
      await $.ui.log(`a backdrop step failed and the window stays as it is (${reasonOf(error)})`, { to: 'debug' })
    } catch {
      // Nothing more to tell.
    }
  }
}

/** A theme a person named: by its id or its title, in any case, with spaces or hyphens between the words. */
function keyOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
function themeNamed(text: string): LivingTheme | undefined {
  const key = keyOf(text)
  return THEMES.find(theme => theme.id === key || keyOf(theme.title) === key)
}

/** The default every session shares, from the store; a fault or an id no longer in the table counts as none. */
async function defaultTheme($: EngineInterface): Promise<string | undefined> {
  try {
    const kept = await $.store.get(DEFAULT_KEY)
    return typeof kept === 'string' && themeOf(kept) !== undefined ? kept : undefined
  } catch {
    return undefined
  }
}

/** The theme that should stand now: a look first, then this session's own choice, then the shared default. */
async function standingTheme($: EngineInterface): Promise<LivingTheme | undefined> {
  const now = await read($, choice)
  if (now.preview !== undefined) return themeOf(now.preview)
  if (now.session !== undefined) return now.session === null ? undefined : themeOf(now.session)
  return themeOf(await defaultTheme($))
}

/** Calm: the scene follows only the time and the season. By the setting for every session, or /live-theme calm on. */
async function isCalm($: EngineInterface): Promise<boolean> {
  if (!settings.reactToAgent) return true
  try {
    return (await $.store.get(CALM_KEY)) === 'on'
  } catch {
    return false
  }
}

/** The whole moment at `now`. */
async function momentAt($: EngineInterface, now: number): Promise<SceneCtx> {
  const { activity, agents } = activityOf(tracker, now, await isCalm($))
  const { hour, month } = localTime(now, settings.offset)
  return { activity, phase: phaseOf(hour), season: seasonOf(month, settings.hemisphere), agents }
}

/** Whether any surface of this session draws a backdrop: none in a headless run, none in a terminal. */
async function drawsBackdrops($: EngineInterface): Promise<boolean> {
  try {
    return (await $.session.surfaces()).some(surface => surface !== 'terminal')
  } catch {
    return false
  }
}

const coalescer = new Coalescer(GAP_MS)

/** Lands one scene name: its theme's glass and colour scheme for that moment. */
async function applyScene($: EngineInterface, name: string): Promise<void> {
  const decoded = decodeScene(name)
  const theme = themeOf(decoded?.id)
  if (decoded === undefined || theme === undefined) return
  await setBackdrop($, { id: name, glass: theme.glass(decoded.ctx), colorScheme: schemeOf(theme, decoded.ctx.phase) })
}

function ioOf($: EngineInterface): CoalescerIo {
  return {
    now: () => $.clock.now(),
    after: (ms, fn) => $.clock.after(ms, fn),
    apply: name => applyScene($, name),
  }
}

/** Offers the moment as it stands now. Nothing of this mod's standing: the window is left as it is. */
async function push($: EngineInterface): Promise<void> {
  const theme = await standingTheme($)
  if (theme === undefined || !(await drawsBackdrops($))) return
  const ctx = await momentAt($, await $.clock.now())
  await coalescer.offer(encodeScene(theme.id, ctx), ioOf($))
}

/**
 * Reads the moment again and offers it, one read at a time in the order asked, so the last ask reads the latest
 * moment. Never awaited by a hook that the agent waits on: a backdrop must not slow a tool call.
 */
function refresh($: EngineInterface): Promise<void> {
  wake($)
  pushing = pushing.then(() => quietly($, () => push($)))
  return pushing
}

/** The first hook of a load starts the clock that reads the time of day again: a reload does not run session.start. */
function wake($: EngineInterface): void {
  if (ticker !== undefined) return
  try {
    ticker = $.clock.every(TICK_MS, () => void refresh($))
  } catch {
    // Tried again at the next hook.
  }
}

/** Counts the running subagents, and while any run counts them again every few seconds. */
async function countAgents($: EngineInterface): Promise<void> {
  const agents = await $.agent.list()
  const running = agents.filter(agent => RUNNING.has(agent.status)).length
  const was = tracker.agents
  tracker = onAgents(tracker, running)
  if (running > 0 && agentPoll === undefined) {
    agentPoll = $.clock.every(AGENT_POLL_MS, () => void quietly($, () => countAgents($)))
  } else if (running === 0 && agentPoll !== undefined) {
    agentPoll.cancel()
    agentPoll = undefined
  }
  if (running !== was) void refresh($)
}

/** A short flash; the moment is read again when it ends. */
function flash($: EngineInterface, kind: 'error' | 'success', now: number): void {
  tracker = onFlash(tracker, kind, now)
  flashEnding?.cancel()
  flashEnding = $.clock.after(FLASH_MS, () => {
    flashEnding = undefined
    void refresh($)
  })
  void refresh($)
}

/** Applies a look's end, the default's change or the session's own; nothing standing clears what this mod showed. */
async function showStanding($: EngineInterface): Promise<BackdropAnswer | undefined> {
  const theme = await standingTheme($)
  if (theme === undefined) {
    if (coalescer.applied !== undefined) {
      coalescer.reset()
      await clearBackdrop($)
    }
    return undefined
  }
  await refresh($)
  return { isDrawn: taken !== 'none' }
}

/** Makes a theme (or none) this session's own, or the default for every session. */
async function choose($: EngineInterface, id: string | undefined, forSession: boolean): Promise<BackdropAnswer | undefined> {
  if (forSession) {
    await update($, choice, (was): LiveChoice => ({ ...was, session: id ?? null, preview: undefined }))
  } else {
    await (id === undefined ? $.store.delete(DEFAULT_KEY) : $.store.set(DEFAULT_KEY, id))
    await update($, choice, (was): LiveChoice => ({ ...was, session: undefined, preview: undefined }))
  }
  previewEnding?.cancel()
  previewEnding = undefined
  return showStanding($)
}

async function preview($: EngineInterface, theme: LivingTheme): Promise<void> {
  await update($, choice, (was): LiveChoice => ({ ...was, preview: theme.id }))
  previewEnding?.cancel()
  previewEnding = $.clock.after(PREVIEW_MS, () => {
    previewEnding = undefined
    void quietly($, async () => {
      if ((await read($, choice)).preview !== theme.id) return
      await update($, choice, (was): LiveChoice => ({ ...was, preview: undefined }))
      await showStanding($)
    })
  })
  await showStanding($)
}

const UNSHOWN = 'It shows in the desktop app; this window does not draw backdrops.'

function themeList(): string {
  return [
    `Living themes (${THEMES.length}):`,
    ...THEMES.map(theme => `  ${theme.id}: ${theme.title}. ${theme.blurb} Reacts: ${theme.reacts}`),
    `/${COMMAND} <name> makes it the default for every session; add "session" for this one only. /${COMMAND} off clears it; /${COMMAND} calm on stops it reacting to Claude.`,
  ].join('\n')
}

type CardElements = Pick<ReturnType<EngineInterface['ui']['resolve']>, 'Box' | 'Text' | 'Button'>

async function putCardAway($: EngineInterface): Promise<void> {
  await update($, choice, was => ({ ...was, cardInBand: false, cardAway: true }))
}

async function pick($: EngineInterface, theme: LivingTheme | undefined, forSession: boolean): Promise<void> {
  const fault = theme === undefined ? undefined : sceneFault(theme, { activity: 'idle', phase: 'day', season: 'spring', agents: 0 })
  if (theme !== undefined && fault !== undefined) {
    void $.ui.toast(`${theme.title} could not be drawn: ${fault}`)
    return
  }
  try {
    await choose($, theme?.id, forSession)
  } catch (error) {
    void $.ui.toast(`${theme?.title ?? 'The theme'} could not be applied: ${reasonOf(error)}`)
    return
  }
  await putCardAway($)
}

/** The card: No theme and Close at its head, then each theme's title, what it is, how it reacts, and three buttons. */
function card($: EngineInterface, { Box, Text, Button }: CardElements, now: LiveChoice, shared: string | undefined) {
  const standing = now.session !== undefined ? now.session : shared
  return (
    <Box flexDirection="column" paddingX={1} gap="md">
      <Box flexDirection="row" gap={1}>
        <Text bold>Living themes</Text>
        <Button key="off" label="No theme" onPress={() => pick($, undefined, false)}>
          No theme
        </Button>
        <Button key="close" label="Close" role="dismiss" autoFocus onPress={() => putCardAway($)}>
          Close
        </Button>
      </Box>
      {THEMES.map(theme => {
        const applyWord = now.session === undefined && shared === theme.id ? 'Applied' : 'Apply'
        const sessionWord = now.session === theme.id ? '✓ This session' : 'This session'
        const previewWord = now.preview === theme.id ? 'Previewing' : 'Preview'
        return (
          <Box key={`theme-${theme.id}`} flexDirection="column" gap="xs">
            <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" columnGap="md" rowGap="xs">
              <Text bold={standing === theme.id}>
                {standing === theme.id ? '✓ ' : ''}
                {theme.title}
              </Text>
              <Box flexDirection="row" gap={1}>
                <Button key={`apply-${theme.id}`} label={applyWord} onPress={() => pick($, theme, false)}>
                  {applyWord}
                </Button>
                <Button key={`session-${theme.id}`} label={sessionWord} onPress={() => pick($, theme, true)}>
                  {sessionWord}
                </Button>
                <Button
                  key={`preview-${theme.id}`}
                  label={previewWord}
                  onPress={async () => {
                    try {
                      await preview($, theme)
                    } catch (error) {
                      void $.ui.toast(`${theme.title} could not be shown: ${reasonOf(error)}`)
                    }
                  }}
                >
                  {previewWord}
                </Button>
              </Box>
            </Box>
            <Text dimColor>{theme.blurb}</Text>
            <Text dimColor>{`Reacts: ${theme.reacts}`}</Text>
          </Box>
        )
      })}
    </Box>
  )
}

/** One /live-theme line, answered in words. */
async function runCommand($: EngineInterface, args: string): Promise<string> {
  const words = args.trim().split(/\s+/).filter(word => word !== '')
  const lower = words.map(word => word.toLowerCase())
  if (lower[0] === 'list' && words.length === 1) return themeList()
  if (lower[0] === 'calm' && words.length === 2 && (lower[1] === 'on' || lower[1] === 'off')) {
    await (lower[1] === 'on' ? $.store.set(CALM_KEY, 'on') : $.store.delete(CALM_KEY))
    await refresh($)
    return lower[1] === 'on'
      ? 'Calm: the backdrop follows only the time of day and the season.'
      : settings.reactToAgent
        ? 'The backdrop reacts to Claude again.'
        : 'Calm is off here, but the "React to Claude" setting is off, so the backdrop stays calm.'
  }
  const forSession = words.length > 1 && lower.at(-1) === 'session'
  const name = (forSession ? words.slice(0, -1) : words).join(' ')
  if (keyOf(name) === 'off') {
    await choose($, undefined, forSession)
    return forSession ? 'No backdrop in this session.' : 'Living themes off for every session.'
  }
  const theme = themeNamed(name)
  if (theme === undefined) {
    return `No living theme named "${name}". /${COMMAND} list names all ${THEMES.length}.`
  }
  const fault = sceneFault(theme, { activity: 'idle', phase: 'day', season: 'spring', agents: 0 })
  if (fault !== undefined) return `${theme.title} could not be drawn: ${fault}`
  const set = await choose($, theme.id, forSession)
  const said = forSession ? `${theme.title} in this session only.` : `${theme.title} is the backdrop for every session.`
  return set?.isDrawn === false || !(await drawsBackdrops($)) ? `${said} ${UNSHOWN}` : said
}

export const register: Register = (on, options) => {
  settings = {
    offset: parseOffset(options.utcOffset),
    hemisphere: options.hemisphere === 'south' ? 'south' : 'north',
    reactToAgent: options.reactToAgent !== false,
  }

  on('session.start', async ($, e, next) => {
    wake($)
    try {
      await $.command.register({
        name: COMMAND,
        description:
          'Living backdrops that react to Claude, the time of day and the season: alone it shows the card; with a name it sets the default ("session" as the last word: this session only); also list, off, calm on|off.',
      })
    } catch {
      // A refused name must not cost the session its backdrop.
    }
    await quietly($, async () => {
      // A look left in the state has no timer in this load: drop it.
      if ((await read($, choice)).preview !== undefined) {
        await update($, choice, was => ({ ...was, preview: undefined }))
      }
    })
    void refresh($)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    tracker = onPromptSubmit(tracker)
    void refresh($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A subagent's own calls show as the subagents running, not as tool work of the main loop.
    if (e.agentId !== undefined) return next(e)
    tracker = onToolStart(tracker)
    void refresh($)
    let isError = false
    try {
      const result = await next(e)
      isError = 'isError' in result && result.isError === true
      return result
    } finally {
      tracker = onToolEnd(tracker)
      if (isError) {
        await quietly($, async () => flash($, 'error', await $.clock.now()))
      } else {
        void refresh($)
      }
    }
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    void quietly($, () => countAgents($))
    return result
  })

  on('classic.SubagentStop', async ($, e, next) => {
    void quietly($, () => countAgents($))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      tracker = onTurnComplete(tracker)
      void quietly($, () => countAgents($))
      void refresh($)
    }
    return next(e)
  })

  // Every block of the model's reply comes through here once, as text, before it is stored.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    if (e.agentId === undefined) {
      const said = e.message.content.some(
        block => block.type === 'text' && typeof block.text === 'string' && SUCCESS_WORDS.test(block.text),
      )
      if (said) await quietly($, async () => flash($, 'success', await $.clock.now()))
    }
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    wake($)
    if (e.args.trim() === '') {
      const placed = await $.ui.place({ id: CARD })
      await update($, choice, was => ({ ...was, cardInBand: !placed.isPlaced, cardAway: false }))
      return { text: 'Pick a living theme on the card.' }
    }
    try {
      return { text: await runCommand($, e.args) }
    } catch (error) {
      return { text: `That could not be done: ${reasonOf(error)}` }
    }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    // Only a window has room behind the chat, and only its table has `Svg`.
    if (e.props.plugin !== PLUGIN || (e.surface !== 'desktop' && e.surface !== 'mobile')) return next(e)
    const name = sceneNameOf(e.props)
    const decoded = name === undefined ? undefined : decodeScene(name)
    const theme = themeOf(decoded?.id)
    if (name === undefined || decoded === undefined || theme === undefined) return next(e)
    let source: string
    try {
      source = sceneFor(theme, name, decoded.ctx)
    } catch {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    return <Svg isInteractive alt={`${theme.title}: ${theme.blurb}`} source={source} />
  })

  on('ui.render', { component: 'Placed' }, async ($, e, next) => {
    if (e.props.plugin !== PLUGIN || e.props.id !== CARD) return next(e)
    const now = await read($, choice)
    if (now.cardAway === true) return next(e)
    return card($, $.ui.resolve(e), now, await defaultTheme($))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const now = await read($, choice)
    if (now.cardInBand !== true) return next(e)
    return card($, $.ui.resolve(e), now, await defaultTheme($))
  })
}
