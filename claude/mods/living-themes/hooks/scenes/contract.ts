// The contract every living theme follows. A scene is a pure function from the moment (what the agent is doing, the time of
// day, the season, how many subagents run) to one SVG string that animates itself with CSS. The mod swaps the scene each
// time the moment changes, so the scenes of one theme share their layout and differ in motion, light and detail: a change
// reads as the same place reacting, never as a cut to a new picture.
import type { ThemeBackdropGlass } from 'claude-code'

/** What the agent is doing right now. */
export type Activity =
  | 'idle' // waiting for the person
  | 'thinking' // a prompt was sent, the model is working it out, no tool running
  | 'working' // tools are running (edits, commands, searches)
  | 'agents' // one or more subagents are running (see SceneCtx.agents)
  | 'error' // a short flash (about 8 s) after a tool failed
  | 'success' // a short flash (about 8 s) after a merge, a passing test run or a push

/** The time of day, from the person's local clock. dawn 5-8, day 8-17, dusk 17-20, night 20-5. */
export type Phase = 'dawn' | 'day' | 'dusk' | 'night'

/** The season, from the local month (northern-hemisphere months unless the person flips it in settings). */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'

export type SceneCtx = {
  activity: Activity
  phase: Phase
  season: Season
  /** Subagents running now, 0 to 5 (capped). Above 0 only when activity is 'agents', 'working' or 'thinking'. */
  agents: number
}

export type LivingTheme = {
  /** The name typed after /live-theme: lower case, hyphens. */
  id: string
  title: string
  /** One line for the list and the card: what it shows. */
  blurb: string
  /** One line: what changes with the agent, the time and the season. */
  reacts: string
  /**
   * Which kind of window the scene is made for. 'auto' follows the time of day: light at dawn and day, dark at dusk and
   * night (the mod then switches the app's colour scheme with it).
   */
  window: 'light' | 'dark' | 'auto'
  /** The veil over the scene, for the given moment (it may differ by phase). */
  glass: (ctx: SceneCtx) => ThemeBackdropGlass
  /** The whole scene for the given moment. Pure and deterministic: the same ctx gives the same string. */
  scene: (ctx: SceneCtx) => string
}

/** Every rule a scene must keep (checked by tests/scenes.test.ts). */
export const SCENE_RULES = {
  /** The engine refuses a larger SVG. Stay well under it. */
  maxChars: 131_072,
  viewBox: '0 0 1600 1000',
} as const
