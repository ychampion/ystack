import { type TestBody, expect, mock, test } from 'claude-code/testing'

import { agentText } from '../hooks/items.ts'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

const DIR = '/home/u/.claude'
const SETTINGS = `${DIR}/settings.json`
const MEDIUM = `${DIR}/agents/opus-medium.md`
const HIGH = `${DIR}/agents/opus-high.md`
const PLUGIN = 'ystack-setup'

const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: 'ystack-setup',
  surface: 'terminal',
  props: { title: 'ystack setup', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
} as const

type Setup = { files?: Record<string, string>; model?: string; env?: Record<string, string>; store?: Record<string, unknown>; failWrite?: (path: string) => boolean }

async function setup($: $T, on: OnT, { files = {}, model = 'claude-opus-9-9[1m]', env = {}, store = {}, failWrite }: Setup = {}) {
  const fs = new Map(Object.entries(files))
  const kept = new Map(Object.entries(store))
  on('store.get', (_, e) => ({ value: kept.get(e.key) }) as never)
  on('store.set', (_, e) => {
    kept.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined } as never
  })
  const writes: string[] = []
  mock.clock(on, { now: Date.UTC(2026, 10, 9, 12) })
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: undefined }) as never)
  on('session.model', () => ({ value: model }) as never)
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : env[e.name] }) as never)
  on('fs.exists', (_, e) => ({ value: fs.has(P(e.path)) }) as never)
  on('fs.read', (_, e) => {
    if (!fs.has(P(e.path))) throw new Error(`ENOENT ${e.path}`)
    return { value: fs.get(P(e.path)) } as never
  })
  on('fs.write', (_, e) => {
    // A throwing mock is skipped and the call then rejects ("no implementation"): a failed write either way.
    if (failWrite?.(P(e.path))) throw new Error('ENOSPC')
    fs.set(P(e.path), e.text)
    writes.push(P(e.path))
    return { value: undefined } as never
  })
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  const press = (key: string) => $.ui.press({ plugin: PLUGIN, key, requestId: 'ystack-setup' })
  const check = async () => (await $.command.run({ command: 'ystack-setup', args: 'check' } as never)).text ?? ''
  return { fs, writes, press, check, kept }
}

// The engine hands fs mocks the absolute, OS-spelled path (C:\\home\\u\\...); compare in the mod's spelling.
const P = (path: string) => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`

test('check reports what is already in place and what is not', async ($, on) => {
  const { check, writes } = await setup($, on, {
    files: {
      [SETTINGS]: json({ modelSettings: { 'claude-opus-9-9': { autoCompactWindow: 400000 } }, env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' } }),
      [MEDIUM]: agentText('opus-medium'),
    },
  })
  const text = await check()
  expect(text).toMatch(/in place\s+Auto-compact the main model at 400k: in place \(claude-opus-9-9\)/)
  expect(text).toMatch(/Two subagent types.*opus-medium: in place; opus-high: missing/)
  expect(text).toMatch(/different value\s+Agent teams off: set to "1"/)
  expect(text).toMatch(/not set\s+Haiku compacts at 100k: not set \(claude-haiku-5-5\)/)
  expect(text).toContain('/plugin install context-meter --marketplace ychampion/ystack')
  expect(text).toContain('1 of 5 in place.')
  expect(writes).toEqual([])
})

test('the model id comes from the session, not from settings or a fixed value', async ($, on) => {
  const { fs, press } = await setup($, on, { model: 'claude-opus-7-1[1m]', files: { [SETTINGS]: json({ model: 'claude-sonnet-3-0' }) } })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /modelSettings\.claude-opus-7-1\.autoCompactWindow/ })).toBeDefined()
  await press('tick-main-compact')
  await press('apply')
  await ui.unmount()
  const after = JSON.parse(fs.get(SETTINGS) ?? '')
  expect(after.modelSettings).toEqual({ 'claude-opus-7-1': { autoCompactWindow: 400000 } })
  expect(after.model).toBe('claude-sonnet-3-0')
})

test('a model alias resolves through its env var', async ($, on) => {
  const { check } = await setup($, on, { model: 'opus', env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-8-2' } })
  expect(await check()).toMatch(/Auto-compact the main model at 400k: not set \(claude-opus-8-2\)/)
})

test('Apply writes only the ticked items and keeps every other key', async ($, on) => {
  const before = { theme: 'dark', permissions: { allow: ['Bash(ls)'] }, env: { FOO: '1' }, hooks: { Stop: [] } }
  const { fs, writes, press } = await setup($, on, { files: { [SETTINGS]: json(before) } })
  const ui = await $.ui.mount(PANE)
  await press('tick-teams-off')
  await press('tick-subagent-model')
  await press('pick-sonnet')
  expect(writes).toEqual([]) // ticking alone writes nothing
  await press('apply')
  await ui.unmount()
  const after = JSON.parse(fs.get(SETTINGS) ?? '')
  expect(after).toEqual({ ...before, env: { FOO: '1', CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0', CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' } })
  expect(Object.keys(after)).toEqual(['theme', 'permissions', 'env', 'hooks'])
  expect(fs.has(MEDIUM)).toBe(false)
  expect(fs.has(HIGH)).toBe(false)
  expect(writes).toEqual([`${SETTINGS}.bak-ystack-2026-11-09`, SETTINGS])
})

test('Apply backs files up and Undo restores them', async ($, on) => {
  const original = '{\n    "theme": "dark"\n}\n'
  const { fs, press } = await setup($, on, { files: { [SETTINGS]: original } })
  const ui = await $.ui.mount(PANE)
  await press('tick-haiku-compact')
  await press('tick-agents')
  await press('apply')
  const backup = `${SETTINGS}.bak-ystack-2026-11-09`
  expect(fs.get(backup)).toBe(original)
  expect(fs.get(SETTINGS)).toContain('    "modelSettings"') // the file's own indent is kept
  expect(fs.get(MEDIUM)).toBe(agentText('opus-medium'))
  expect(await ui.find({ type: 'Text', text: /Backups: .*settings\.json\.bak-ystack-2026-11-09/ })).toBeDefined()

  await press('undo')
  expect(fs.get(SETTINGS)).toBe(original)
  expect(await ui.find({ type: 'Text', text: /delete them to finish: .*opus-medium\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', text: 'Undo' })).toBeUndefined()

  // A second Apply the same day keeps the first backup and writes a new one beside it.
  await press('apply')
  expect(fs.get(backup)).toBe(original)
  expect(fs.has(`${backup}-2`)).toBe(true)
  await ui.unmount()
})

test('an existing, different agent file is kept unless "replace" is ticked', async ($, on) => {
  const mine = '---\nname: opus-high\nmodel: opus\neffort: max\n---\n\nMy own prompt.\n'
  const { fs, press } = await setup($, on, { files: { [SETTINGS]: json({}), [HIGH]: mine } })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /- effort: max/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+ effort: high/ })).toBeDefined()
  await press('tick-agents')
  await press('apply')
  expect(fs.get(HIGH)).toBe(mine)
  expect(fs.get(MEDIUM)).toBe(agentText('opus-medium'))
  expect(await ui.find({ type: 'Text', text: /Kept your opus-high\.md/ })).toBeDefined()

  await press('replace-opus-high')
  await press('apply')
  expect(fs.get(HIGH)).toBe(agentText('opus-high'))
  expect(fs.get(`${HIGH}.bak-ystack-2026-11-09`)).toBe(mine)
  await ui.unmount()
})

test('a malformed settings.json makes Apply refuse and write nothing', async ($, on) => {
  const broken = '{ "theme": "dark", '
  const { fs, writes, press, check } = await setup($, on, { files: { [SETTINGS]: broken } })
  const ui = await $.ui.mount(PANE)
  await press('tick-teams-off')
  await press('tick-agents')
  await press('apply')
  expect(writes).toEqual([])
  expect(fs.get(SETTINGS)).toBe(broken)
  expect(await ui.find({ type: 'Text', text: /Nothing changed: .*settings\.json is not valid JSON/ })).toBeDefined()
  await ui.unmount()
  expect(await check()).toContain("Can't read settings")
})

test('Apply with nothing ticked, or only what is already in place, changes nothing', async ($, on) => {
  const { writes, press } = await setup($, on, { files: { [SETTINGS]: json({ env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' } }) } })
  const ui = await $.ui.mount(PANE)
  await press('apply')
  expect(await ui.find({ type: 'Text', text: /Tick at least one item/ })).toBeDefined()
  await press('tick-teams-off')
  await press('apply')
  expect(await ui.find({ type: 'Text', text: /already in place\. Nothing changed/ })).toBeDefined()
  await ui.unmount()
  expect(writes).toEqual([])
})

// ---- review repros (each failed before the fix round) ----

test('R1: Undo is a stack; each press reverts one Apply, latest first', async ($, on) => {
  const orig = json({ theme: 'dark' })
  const { fs, press } = await setup($, on, { files: { [SETTINGS]: orig } })
  const ui = await $.ui.mount(PANE)
  await press('tick-main-compact')
  await press('apply')
  await press('tick-main-compact')
  await press('tick-teams-off')
  await press('apply')
  await press('undo')
  const mid = JSON.parse(fs.get(SETTINGS) ?? '')
  expect(mid.modelSettings).toEqual({ 'claude-opus-9-9': { autoCompactWindow: 400000 } })
  expect(mid.env).toBeUndefined()
  await press('undo')
  expect(fs.get(SETTINGS)).toBe(orig)
  expect(await ui.find({ type: 'Button', text: 'Undo' })).toBeUndefined()
  await ui.unmount()
})

test('R2: Undo keeps keys added or changed after Apply and reverts only what Apply set', async ($, on) => {
  const { fs, press } = await setup($, on, { files: { [SETTINGS]: json({ theme: 'dark' }) } })
  const ui = await $.ui.mount(PANE)
  await press('tick-teams-off')
  await press('tick-haiku-compact')
  await press('apply')
  const cur = JSON.parse(fs.get(SETTINGS) ?? '')
  cur.enabledPlugins = { 'context-meter@ystack': true } // e.g. /plugin install
  cur.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1' // the user changed an applied key
  cur.theme = 'light'
  fs.set(SETTINGS, json(cur))
  await press('undo')
  const after = JSON.parse(fs.get(SETTINGS) ?? '')
  expect(after).toEqual({ theme: 'light', env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }, enabledPlugins: { 'context-meter@ystack': true } })
  expect(await ui.find({ type: 'Text', text: /env\.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS \(left as you changed it\)/ })).toBeDefined()
  await ui.unmount()
})

test('R2b: an agent file edited after Apply is not restored by Undo', async ($, on) => {
  const mine = '---\nname: opus-high\neffort: max\n---\nMine.\n'
  const { fs, press } = await setup($, on, { files: { [SETTINGS]: json({}), [HIGH]: mine } })
  const ui = await $.ui.mount(PANE)
  await press('tick-agents')
  await press('replace-opus-high')
  await press('apply')
  const edited = `${agentText('opus-high')}\nMy later note.\n`
  fs.set(HIGH, edited)
  await press('undo')
  expect(fs.get(HIGH)).toBe(edited)
  expect(await ui.find({ type: 'Text', text: /opus-high\.md \(left as you changed it\)/ })).toBeDefined()
  await ui.unmount()
})

test('R2c: an agent file still as Apply wrote it is restored by Undo', async ($, on) => {
  const mine = '---\nname: opus-high\neffort: max\n---\nMine.\n'
  const { fs, press } = await setup($, on, { files: { [SETTINGS]: json({}), [HIGH]: mine } })
  const ui = await $.ui.mount(PANE)
  await press('tick-agents')
  await press('replace-opus-high')
  await press('apply')
  await press('undo')
  expect(fs.get(HIGH)).toBe(mine)
  await ui.unmount()
})

test('R2d: the Undo record lives in the store, so it survives a restart', async ($, on) => {
  const applied = json({ theme: 'dark', env: { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' } })
  const record = { at: 1, settingsFile: SETTINGS, settings: [{ path: ['env', 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'], after: '"0"', createdAt: 1 }], agents: [], backups: [] }
  const { fs, press, kept } = await setup($, on, { files: { [SETTINGS]: applied }, store: { 'undo-stack': [record] } })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', text: 'Undo' })).toBeDefined()
  await press('undo')
  expect(fs.get(SETTINGS)).toBe(json({ theme: 'dark' }))
  expect(kept.get('undo-stack')).toEqual([])
  await ui.unmount()
})

test('R3: an existing subagent model is kept unless the user picks another', async ($, on) => {
  const { fs, writes, press } = await setup($, on, { files: { [SETTINGS]: json({ env: { CLAUDE_CODE_SUBAGENT_MODEL: 'claude-opus-9-9[1m]' } }) } })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', text: '(*) keep current (claude-opus-9-9[1m])' })).toBeDefined()
  await press('tick-subagent-model')
  await press('apply')
  expect(writes).toEqual([])
  await press('pick-sonnet')
  await press('apply')
  expect(JSON.parse(fs.get(SETTINGS) ?? '').env.CLAUDE_CODE_SUBAGENT_MODEL).toBe('sonnet')
  await ui.unmount()
})

test('R4: a failed write is caught and reported; backups stay; only written files go on the Undo record', async ($, on) => {
  const orig = json({ theme: 'dark' })
  const { fs, press, kept } = await setup($, on, { files: { [SETTINGS]: orig }, failWrite: p => p === SETTINGS })
  const ui = await $.ui.mount(PANE)
  await press('tick-teams-off')
  await press('tick-agents')
  await press('apply')
  expect(fs.get(SETTINGS)).toBe(orig)
  expect(fs.get(MEDIUM)).toBe(agentText('opus-medium'))
  expect(fs.get(`${SETTINGS}.bak-ystack-2026-11-09`)).toBe(orig)
  expect(await ui.find({ type: 'Text', text: /Apply partly failed[\s\S]*Not written: .*settings\.json \(.+\)/ })).toBeDefined()
  const stack = kept.get('undo-stack') as { settings: unknown[]; agents: unknown[] }[]
  expect(stack[0]?.settings).toEqual([])
  expect(stack[0]?.agents.length).toBe(2)
  await ui.unmount()
})

test('R5: a settings file with a byte-order mark is edited and keeps it', async ($, on) => {
  const { fs, press } = await setup($, on, { files: { [SETTINGS]: `﻿${json({ theme: 'dark' })}` } })
  const ui = await $.ui.mount(PANE)
  await press('tick-teams-off')
  await press('apply')
  const out = fs.get(SETTINGS) ?? ''
  expect(out.startsWith('﻿{')).toBe(true)
  expect(JSON.parse(out.slice(1)).env).toEqual({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' })
  await ui.unmount()
})

test('R6: key order and numbers over 2^53 are kept exactly', async ($, on) => {
  const raw = '{\n  "zeta": {"b": 1, "10": 2},\n  "cleanupPeriodDays": 12345678901234567890\n}\n'
  const { fs, press } = await setup($, on, { files: { [SETTINGS]: raw } })
  const ui = await $.ui.mount(PANE)
  await press('tick-teams-off')
  await press('apply')
  expect(fs.get(SETTINGS)).toBe('{\n  "zeta": {"b": 1, "10": 2},\n  "cleanupPeriodDays": 12345678901234567890,\n  "env": {\n    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "0"\n  }\n}\n')
  await press('undo')
  expect(fs.get(SETTINGS)).toBe(raw)
  await ui.unmount()
})

test('a Haiku main model skips the main-model item', async ($, on) => {
  const { check } = await setup($, on, { model: 'claude-haiku-5-5' })
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Button', text: /Auto-compact the main model/ })).toBeUndefined()
  await ui.unmount()
  expect(await check()).toMatch(/info\s+Auto-compact the main model at 400k: skipped: your main model is a Haiku model/)
})

test("measured gains are labelled as one heavy user's numbers, with a docs link; the restart line shows", async ($, on) => {
  const { check } = await setup($, on)
  expect(await check()).not.toContain('Measured:')
  const ui = await $.ui.mount(PANE)
  expect(await ui.find({ type: 'Text', text: /Measured on one heavy user's logs, not yours: replaying .*https:\/\/github\.com\/ychampion\/ystack/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Restart Claude Code or run /reload-plugins to apply. Undo stays available after a restart.' })).toBeDefined()
  await ui.unmount()
})
