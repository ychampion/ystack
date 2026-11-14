// Every living theme, by the order the list and the card show them. Each scene file exports `theme: LivingTheme`.
import type { LivingTheme, SceneCtx } from './scenes/contract'
import { theme as sharkShoal } from './scenes/shark-shoal'
import { theme as lighthouse } from './scenes/lighthouse'
import { theme as cityGrid } from './scenes/city-grid'
import { theme as seasonsTree } from './scenes/seasons-tree'
import { theme as tideClock } from './scenes/tide-clock'
import { theme as reefAquarium } from './scenes/reef-aquarium'
import { theme as forge } from './scenes/forge'
import { theme as radar } from './scenes/radar'
import { theme as rainWindow } from './scenes/rain-window'
import { theme as orbitOps } from './scenes/orbit-ops'
import { theme as gardenPlot } from './scenes/garden-plot'
import { theme as desertCaravan } from './scenes/desert-caravan'

export const THEMES: readonly LivingTheme[] = [
  sharkShoal,
  lighthouse,
  cityGrid,
  seasonsTree,
  tideClock,
  reefAquarium,
  forge,
  radar,
  rainWindow,
  orbitOps,
  gardenPlot,
  desertCaravan,
]

export function themeOf(id: string | undefined): LivingTheme | undefined {
  return id === undefined ? undefined : THEMES.find(theme => theme.id === id)
}

/** How many built scenes are kept: a moment change rebuilds nothing it has already built. */
export const CACHE_LIMIT = 40
const built = new Map<string, string>()

/**
 * A theme's SVG for one moment, built the first time it is asked for and kept under its encoded name. The cache holds
 * CACHE_LIMIT scenes; past that the one used longest ago goes.
 */
export function sceneFor(theme: LivingTheme, name: string, ctx: SceneCtx): string {
  const ready = built.get(name)
  if (ready !== undefined) {
    // Used again: to the back of the line.
    built.delete(name)
    built.set(name, ready)
    return ready
  }
  const source = theme.scene(ctx)
  built.set(name, source)
  while (built.size > CACHE_LIMIT) {
    const oldest = built.keys().next().value
    if (oldest === undefined) break
    built.delete(oldest)
  }
  return source
}

/** How many scenes the cache holds now (for the tests). */
export function cachedScenes(): number {
  return built.size
}

/** Why a theme's scene cannot be drawn for a moment, in the fault's own words; nothing where it builds. */
export function sceneFault(theme: LivingTheme, ctx: SceneCtx): string | undefined {
  try {
    theme.scene(ctx)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
