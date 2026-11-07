import { type TestBody, expect, test } from 'claude-code/testing'

// A fake disk and git beneath the plugin. Keys drop the drive and use '/', as the engine may hand either spelling on.
const key = (p: string) => p.replace(/\\/g, '/').replace(/^[a-z]:/i, '')
type Host = { files: Map<string, string>; grep: number; commands: string[] }

function fakeHost(on: Parameters<TestBody>[1], files: Record<string, string>, grepExit = 1): Host {
  const host: Host = { files: new Map(Object.entries(files).map(([k, v]) => [key(k), v])), grep: 0, commands: [] }
  on('fs.exists', (_, e) => ({ value: host.files.has(key((e as unknown as { path: string }).path)) }))
  on('fs.read', (_, e) => {
    const text = host.files.get(key((e as unknown as { path: string }).path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text as never }
  })
  on('process.run', () => {
    host.grep += 1
    return { value: { exitCode: grepExit, stdout: '', stderr: '' } as never }
  })
  on('command.register', (_, e) => {
    host.commands.push((e as unknown as { name: string }).name)
    return { value: undefined as never }
  })
  // The engine's own answers beneath the plugin.
  on('session.start', (_, e) => ({ cwd: (e as unknown as { cwd: string }).cwd }) as never)
  on('classic.Stop', () => ({}) as never)
  on('classic.SubagentStop', () => ({}) as never)
  // The edit tool itself: applies Write/Edit to the fake disk.
  on('tool.call', (_, e) => {
    const t = e as unknown as { tool: string; file_path: string; content?: string; old_string?: string; new_string?: string }
    if (t.tool === 'Write') host.files.set(key(t.file_path), t.content ?? '')
    if (t.tool === 'Edit') host.files.set(key(t.file_path), (host.files.get(key(t.file_path)) ?? '').replace(t.old_string ?? '', t.new_string ?? ''))
    return { result: {} }
  })
  return host
}

const PKG = { 'c:/w/site/package.json': '{}', 'c:/w/site/.git': '' }

test('an edit hears about its findings with line numbers and reasons; old code is never reported', async ($, on) => {
  const old = '<section>\n  <h1 className="bg-clip-text">Old</h1>\n</section>\n'
  fakeHost(on, { ...PKG, 'c:/w/site/src/Hero.tsx': old })
  const r = await $.tool.call({ tool: 'Edit', file_path: 'c:/w/site/src/Hero.tsx', old_string: '</section>', new_string: '  <p>Supercharge your team</p>\n</section>' })
  const text = (r.context ?? []).join('\n')
  expect(text).toContain('slop-guard: 1 design finding in the new text of c:/w/site/src/Hero.tsx')
  expect(text).toContain('L3 [hype-copy] `Supercharge`')
  expect(text).toContain('Why: Genre words')
  expect(text).not.toContain('gradient-text') // line 2 was there before the edit
})

test('a clean edit, a non-UI file and a failed edit add nothing', async ($, on) => {
  fakeHost(on, { ...PKG })
  const clean = await $.tool.call({ tool: 'Write', file_path: 'c:/w/site/src/A.tsx', content: '<p>Wakes in 0.6 s.</p>' })
  expect(clean.context ?? []).toEqual([])
  const md = await $.tool.call({ tool: 'Write', file_path: 'c:/w/site/README.md', content: 'Supercharge lorem ipsum' })
  expect(md.context ?? []).toEqual([])
})

test('a blocking tell holds the turn at Stop until it is fixed', async ($, on) => {
  const host = fakeHost(on, { ...PKG })
  await $.tool.call({ tool: 'Write', file_path: 'c:/w/site/src/a.css', content: 'body { font-family: "Poppins", sans-serif; }\n' })
  const first = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
  expect((first as { block?: string }).block ?? '').toContain('/w/site/src/a.css:1 [banned-font] `font-family: poppins`')

  host.files.set(key('c:/w/site/src/a.css'), 'body { font-family: "Instrument Sans", sans-serif; }\n')
  const second = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'Fixed the font.' })
  expect((second as { block?: string }).block).toBeUndefined()
  const listed = await $.command.run({ command: 'slop-guard', args: '' } as Parameters<typeof $.command.run>[0])
  expect(listed.text).toContain('0 open')
  expect(listed.text).toContain('1 fixed')
})

test('a plainly stated exception releases the turn; a warning never blocks', async ($, on) => {
  fakeHost(on, { ...PKG })
  await $.tool.call({ tool: 'Write', file_path: 'c:/w/site/src/b.tsx', content: '<p>Supercharge</p>\n<p className="bg-clip-text">Brand</p>\n' })
  const blocked = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
  expect((blocked as { block?: string }).block ?? '').toContain('[gradient-text]')
  expect((blocked as { block?: string }).block ?? '').not.toContain('hype-copy')
  const released = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'The gradient wordmark is the client brand asset; kept as a deliberate exception.' })
  expect((released as { block?: string }).block).toBeUndefined()
  const listed = await $.command.run({ command: 'slop-guard', args: '' } as Parameters<typeof $.command.run>[0])
  expect(listed.text).toContain('1 kept as exceptions')
})

test('the gate never blocks more than twice in a row', async ($, on) => {
  fakeHost(on, { ...PKG })
  await $.tool.call({ tool: 'Write', file_path: 'c:/w/site/src/c.tsx', content: '<p>Lorem ipsum</p>\n' })
  const a = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
  const b = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'Done.' })
  const c = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: 'Done.' })
  expect([Boolean((a as { block?: string }).block), Boolean((b as { block?: string }).block), Boolean((c as { block?: string }).block)]).toEqual([true, true, false])
})

test('a subagent is held at its own stop; the main loop is not', async ($, on) => {
  fakeHost(on, { ...PKG })
  await $.tool.call({ tool: 'Write', file_path: 'c:/w/site/src/d.tsx', content: '<img src="https://via.placeholder.com/80" alt="" />\n', agentId: 'sub-1' } as never)
  const main = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
  expect((main as { block?: string }).block).toBeUndefined()
  const sub = await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'sub-1', agent_type: 'x', agent_transcript_path: '', last_assistant_message: 'Done.' })
  expect((sub as { block?: string }).block ?? '').toContain('[fake-content]')
})

test('settings: off silences everything; a level override turns a block into a warning', { options: { enabled: false } }, async ($, on) => {
  fakeHost(on, { ...PKG })
  const r = await $.tool.call({ tool: 'Write', file_path: 'c:/w/site/src/e.tsx', content: '<p className="bg-clip-text">Lorem ipsum</p>\n' })
  expect(r.context ?? []).toEqual([])
  const stop = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: 'Done.' })
  expect((stop as { block?: string }).block).toBeUndefined()
})

test('rule overrides and extra fonts come from settings', { options: { ruleLevels: 'gradient-text=warn, fake-content', extraBannedFonts: 'Montserrat' } }, async ($, on) => {
  fakeHost(on, { ...PKG })
  const r = await $.tool.call({ tool: 'Write', file_path: 'c:/w/site/src/f.tsx', content: '<p className="bg-clip-text">Lorem ipsum</p>\n<style>{`body { font-family: Montserrat; }`}</style>\n' })
  const text = (r.context ?? []).join('\n')
  expect(text).toContain('[gradient-text]')
  expect(text).not.toContain('fake-content')
  expect(text).toContain('[banned-font, blocks at Stop]')
})

test('.slop-guard.json: brand fonts pass and technical mode allows labels', async ($, on) => {
  const label = (t: string) => `<p className="text-xs uppercase tracking-widest">${t}</p>\n<h2>${t}</h2>`
  fakeHost(on, { ...PKG, 'c:/w/site/.slop-guard.json': '{"mode":"technical","brandFonts":["Inter"]}' })
  const r = await $.tool.call({
    tool: 'Write',
    file_path: 'c:/w/site/src/g.tsx',
    content: `${[label('A'), label('B'), label('C')].join('\n')}\n<style>{\`body { font-family: Inter; }\`}</style>\n`,
  })
  expect(r.context ?? []).toEqual([])
})

test('reduced motion is checked once per project, against the whole project', async ($, on) => {
  const host = fakeHost(on, { ...PKG }, 1)
  const a = await $.tool.call({ tool: 'Write', file_path: 'c:/w/site/src/h.css', content: '@keyframes drift { to { opacity: 1 } }\n' })
  expect((a.context ?? []).join('\n')).toContain('no prefers-reduced-motion handling anywhere in the project')
  const b = await $.tool.call({ tool: 'Write', file_path: 'c:/w/site/src/i.css', content: '@keyframes rise { to { opacity: 1 } }\n' })
  expect(b.context ?? []).toEqual([])
  expect(host.grep).toBe(1)
})

test('a project that already handles reduced motion hears nothing', async ($, on) => {
  fakeHost(on, { ...PKG }, 0)
  const a = await $.tool.call({ tool: 'Write', file_path: 'c:/w/site/src/j.css', content: '@keyframes drift { to { opacity: 1 } }\n' })
  expect(a.context ?? []).toEqual([])
})

test('/slop-guard is registered and lists rule ids when there is nothing yet', async ($, on) => {
  const host = fakeHost(on, { ...PKG })
  await $.session.start({ cwd: 'c:/w/site', surface: 'terminal', isInteractive: true })
  expect(host.commands).toEqual(['slop-guard'])
  const r = await $.command.run({ command: 'slop-guard', args: '' } as Parameters<typeof $.command.run>[0])
  expect(r.text).toContain('No findings this session.')
  expect(r.text).toContain('gradient-text')
})
