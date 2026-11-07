import { expect, test } from 'claude-code/testing'


test('a pin the summary dropped is put back verbatim; one it kept is not doubled', async ($, on) => {
  let told = ''
  on('session.compact', (_, e) => {
    told = e.instructions ?? ''
    return { messages: [{ role: 'user' as const, text: 'Summary: we fixed login. Always use bun, not npm.', toolUses: [] }] }
  })
  on('session.root', () => ({ value: '/work/app' }))
  on('store.get', () => ({ value: undefined }))
  type Cmd = Parameters<typeof $.command.run>[0]
  await $.command.run({ command: 'pin', args: 'Never make this repo public.' } as Cmd)
  await $.command.run({ command: 'pin', args: 'Always use bun, not npm.' } as Cmd)
  const listed = await $.command.run({ command: 'pin', args: '' } as Cmd)
  expect(listed.text).toContain('2. Always use bun, not npm.')

  // the engine hands a compaction the transcript; a test states one
  const transcript = [{ role: 'user', text: 'Fix login. Never make this repo public.', toolUses: [] }]
  const r = await $.session.compact({ instructions: 'Keep the API notes.', trigger: 'manual', messages: transcript } as never)
  expect(told).toContain('Keep the API notes.')
  expect(told).toContain('- Never make this repo public.')
  const texts = (r.messages ?? []).map(m => m.text)
  expect(texts.length).toBe(2)
  expect(texts[1]).toBe('Pinned by the owner (verbatim):\n- Never make this repo public.')
})

test('/unpin removes one; after /clear the session pins are gone', async ($, on) => {
  on('session.root', () => ({ value: '/work/app' }))
  on('store.get', () => ({ value: undefined }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  type Cmd = Parameters<typeof $.command.run>[0]
  await $.command.run({ command: 'pin', args: 'Never A.' } as Cmd)
  await $.command.run({ command: 'pin', args: 'Never B.' } as Cmd)
  expect((await $.command.run({ command: 'unpin', args: '1' } as Cmd)).text).toBe('Removed: Never A.')
  expect((await $.command.run({ command: 'pin', args: '' } as Cmd)).text).toBe('1. Never B.')
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: {} as never })
  expect((await $.command.run({ command: 'pin', args: '' } as Cmd)).text).toContain('No pins yet')
})

test('a project pin is kept per folder and joins the compaction check', async ($, on) => {
  const store = new Map<string, unknown>()
  on('session.root', () => ({ value: '/work/app' }))
  on('store.get', (_, e) => ({ value: store.get((e as unknown as { key: string }).key) }))
  on('store.set', (_, e) => {
    const { key, value } = e as unknown as { key: string; value: unknown }
    store.set(key, value)
    return { value: undefined }
  })
  on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'Summary.', toolUses: [] }] }))
  type Cmd = Parameters<typeof $.command.run>[0]
  await $.command.run({ command: 'pin', args: '--project Never deploy on Fridays.' } as Cmd)
  expect(store.get('project:/work/app')).toEqual(['Never deploy on Fridays.'])
  expect((await $.command.run({ command: 'pin', args: '' } as Cmd)).text).toBe('1. Never deploy on Fridays.  (this project)')
  const r = await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'hi', toolUses: [] }] } as never)
  expect((r.messages ?? []).at(-1)?.text).toContain('- Never deploy on Fridays.')
})
