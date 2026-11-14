import { expect, test } from 'claude-code/testing'

import { ACTIVITIES, MAX_AGENTS, NAME_LIMIT, PHASES, SEASONS, decodeScene, encodeScene } from '../hooks/moment'
import { SCENE_RULES } from '../hooks/scenes/contract'
import type { SceneCtx } from '../hooks/scenes/contract'
import { CACHE_LIMIT, THEMES, cachedScenes, sceneFor } from '../hooks/themes'

/** Every moment a scene can be asked for: agents 0 to 5 only where subagents can run. */
function everyCtx(): SceneCtx[] {
  const all: SceneCtx[] = []
  for (const activity of ACTIVITIES)
    for (const phase of PHASES)
      for (const season of SEASONS)
        for (let agents = 0; agents <= (activity === 'agents' ? MAX_AGENTS : 0); agents++) all.push({ activity, phase, season, agents })
  return all
}

test('the table holds themes with unique ids, and each id is a valid scene-name part', () => {
  expect(THEMES.length).toBeGreaterThan(0)
  const ids = THEMES.map(theme => theme.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const id of ids) expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)).toBe(true)
})

for (const theme of THEMES) {
  // One test per activity: the whole table at once outruns a test's time.
  for (const activity of ACTIVITIES) {
    // Up to 96 builds per test (4 phases x 4 seasons x up to 6 agent counts); the slowest scene takes ~70 ms a build here
    // and several times that in the test sandbox, so 5 s is too tight.
    test(`${theme.id}: every ${activity} moment builds a scene inside the rules`, { timeoutMs: 60_000 }, () => {
      for (const ctx of everyCtx().filter(one => one.activity === activity)) {
        const source = theme.scene(ctx)
        const where = `${theme.id} ${JSON.stringify(ctx)}`
        expect({ where, ok: source.length < SCENE_RULES.maxChars }).toEqual({ where, ok: true })
        expect({ where, ok: source.includes(`viewBox="${SCENE_RULES.viewBox}"`) || source.includes(`viewBox='${SCENE_RULES.viewBox}'`) }).toEqual({ where, ok: true })
        expect({ where, ok: !/<script/i.test(source) }).toEqual({ where, ok: true })
        expect({ where, ok: source.trimStart().startsWith('<svg') }).toEqual({ where, ok: true })
        expect(typeof theme.glass(ctx)).toBe('object')
      }
    })
  }

  test(`${theme.id}: the same moment gives the same scene`, () => {
    const ctx: SceneCtx = { activity: 'agents', phase: 'dusk', season: 'winter', agents: 3 }
    expect(theme.scene(ctx) === theme.scene(ctx)).toBe(true)
  })

  test(`${theme.id}: every moment's name is valid and decodes back to the same moment`, () => {
    for (const ctx of everyCtx()) {
      const name = encodeScene(theme.id, ctx)
      expect(name.length <= NAME_LIMIT && /^[A-Za-z0-9_-]+$/.test(name)).toBe(true)
      expect(decodeScene(name)).toEqual({ id: theme.id, ctx })
    }
  })
}

test('names this mod did not make decode to nothing', () => {
  for (const name of ['shark-shoal', 'shark-shoal_idle_day_spring', 'shark-shoal_nap_day_spring_0', 'shark-shoal_idle_noon_spring_0', 'shark-shoal_idle_day_spring_9', 'x_y_z_w_v_u']) {
    expect(decodeScene(name)).toBeUndefined()
  }
})

test('the scene cache keeps at most its limit and hands back what it built', () => {
  const theme = THEMES[0]!
  const ctxs = everyCtx().slice(0, CACHE_LIMIT + 10)
  for (const ctx of ctxs) sceneFor(theme, encodeScene(theme.id, ctx), ctx)
  expect(cachedScenes()).toBe(CACHE_LIMIT)
  const last = ctxs.at(-1)!
  expect(sceneFor(theme, encodeScene(theme.id, last), last)).toBe(theme.scene(last))
})
