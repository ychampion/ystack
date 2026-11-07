import { expect, mock, test } from 'claude-code/testing'

import { applyEdit, bandText, findMarkers, labelOf, locate, numstat, parsePairs, rootOf, syncContext } from '../hooks/twins.ts'

const CONFIG = JSON.stringify({
  pairs: [{ name: 'mods', a: '~/.claude/mods/*', b: '~/shared/claude/mods/*', note: 'generalise: no personal values' }],
})
const PAIRS = parsePairs(CONFIG, 'C:\\Users\\me')

test('pairs parse, with ~ expanded and bad pairs dropped', async () => {
  expect(PAIRS).toEqual([{ name: 'mods', a: 'C:/Users/me/.claude/mods/*', b: 'C:/Users/me/shared/claude/mods/*', note: 'generalise: no personal values' }])
  expect(parsePairs('[{"name":"x","a":"/a/*/*","b":"/b/*"}, {"a":"/a/*","b":"/b/*"}]', '/h')).toEqual([])
  expect(parsePairs('not json', '/h')).toEqual([])
})

test('a file is located on its side, with the item and the file inside it', async () => {
  const hit = locate(PAIRS, 'c:\\users\\me\\.claude\\mods\\verify\\hooks\\register.tsx')
  expect(hit?.side).toBe('a')
  expect(hit?.item).toBe('verify')
  expect(hit?.sub).toBe('hooks/register.tsx')
  expect(locate(PAIRS, 'C:/Users/me/shared/claude/mods/verify/tests/x.test.ts')?.side).toBe('b')
  expect(locate(PAIRS, 'C:/Users/me/other/file.ts')).toBeUndefined()
  const p = PAIRS[0]
  if (!p) throw new Error('no pair')
  expect(rootOf(p, 'b', 'verify')).toBe('C:/Users/me/shared/claude/mods/verify')
  expect(labelOf(p, 'a')).toBe('claude')
  expect(labelOf(p, 'b')).toBe('shared')
  expect(labelOf({ ...p, bLabel: 'generic' }, 'b')).toBe('generic')
})

test('edits mark the other side behind; syncing edits clear it file by file', async () => {
  const a1 = locate(PAIRS, 'C:/Users/me/.claude/mods/verify/hooks/register.tsx')
  const a2 = locate(PAIRS, 'C:/Users/me/.claude/mods/verify/hooks/detect.ts')
  const b1 = locate(PAIRS, 'C:/Users/me/shared/claude/mods/verify/hooks/register.tsx')
  const b2 = locate(PAIRS, 'C:/Users/me/shared/claude/mods/verify/hooks/detect.ts')
  const bOther = locate(PAIRS, 'C:/Users/me/shared/claude/mods/verify/README.md')
  if (!a1 || !a2 || !b1 || !b2 || !bOther) throw new Error('not located')
  let m = applyEdit({}, a1, 1)
  m = applyEdit(m, a2, 2)
  m = applyEdit(m, a1, 3)
  expect(m['mods/verify']?.behind).toBe('b')
  expect(m['mods/verify']?.files).toEqual(['hooks/register.tsx', 'hooks/detect.ts'])
  expect(bandText(m, PAIRS)).toBe('twins: the shared copy of verify is behind (2 files) · /twins')
  expect(applyEdit(m, bOther, 4)).toBe(m)
  m = applyEdit(m, b1, 5)
  expect(m['mods/verify']?.files).toEqual(['hooks/detect.ts'])
  m = applyEdit(m, b2, 6)
  expect(m).toEqual({})
  expect(bandText(m, PAIRS)).toBeUndefined()
})

test('markers are found by item or pair/item; numstat and the sync note', async () => {
  const hit = locate(PAIRS, 'C:/Users/me/.claude/mods/pin/hooks/register.tsx')
  if (!hit) throw new Error('not located')
  const m = applyEdit({}, hit, 1)
  expect(findMarkers(m, 'pin').length).toBe(1)
  expect(findMarkers(m, 'mods/pin').length).toBe(1)
  expect(findMarkers(m, 'nope')).toEqual([])
  expect(numstat('3\t1\ta\n10\t0\tb\n-\t-\timg.png')).toBe('+13 -1')
  const marker = m['mods/pin']
  const p = PAIRS[0]
  if (!marker || !p) throw new Error('missing')
  const note = syncContext(marker, p, 'diff --git ...')
  expect(note).toContain('Rule for this pair: generalise: no personal values')
  expect(note).toContain('/twins done pin')
  expect(note).toContain('from the claude copy to the shared copy')
})

test('two edits that land at once (parallel helpers) both stay on the list', async ($, on) => {
  const store = new Map<string, unknown>()
  const slow = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve() // a store round trip, so the edits interleave
  }
  on('store.get', async (_, e) => {
    await slow()
    return { value: store.get(e.key) }
  })
  on('store.set', async (_, e) => {
    await slow()
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('clock.now', () => ({ value: 10 }))
  mock.env(on, { USERPROFILE: 'C:\\Users\\me' })
  on('session.root', () => ({ value: 'C:/proj' }))
  on('fs.read', (_, e) => (/Users[\\/]me[\\/]\.claude[\\/]twins\.json$/.test(e.path) ? { value: CONFIG } : { deny: 'missing' }))
  on('fs.exists', () => ({ value: true }))
  on('tool.call', () => ({ result: {} }))
  type Call = Parameters<typeof $.tool.call>[0]
  await Promise.all([
    $.tool.call({ tool: 'Edit', file_path: 'C:/Users/me/.claude/mods/verify/hooks/a.ts', old_string: 'a', new_string: 'b' } as Call),
    $.tool.call({ tool: 'Edit', file_path: 'C:/Users/me/.claude/mods/verify/hooks/b.ts', old_string: 'a', new_string: 'b' } as Call),
    $.tool.call({ tool: 'Write', file_path: 'C:/Users/me/.claude/mods/verify/README.md', content: 'x' } as Call),
  ])
  const m = store.get('markers') as Record<string, { files: string[] }>
  expect([...(m['mods/verify']?.files ?? [])].sort()).toEqual(['README.md', 'hooks/a.ts', 'hooks/b.ts'])
})

test('an edit through the session marks the pair; the owner sees it, Claude is told nothing', async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on, { now: 10 })
  mock.env(on, { USERPROFILE: 'C:\\Users\\me' })
  on('session.root', () => ({ value: 'C:/proj' }))
  on('fs.read', (_, e) => (/Users[\\/]me[\\/]\.claude[\\/]twins\.json$/.test(e.path) ? { value: CONFIG } : { deny: 'missing' }))
  on('fs.exists', () => ({ value: true }))
  on('tool.call', () => ({ result: {} }))
  const submitted: string[] = []
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  const r = await $.tool.call({ tool: 'Edit', file_path: 'C:/Users/me/.claude/mods/verify/hooks/register.tsx', old_string: 'a', new_string: 'b' } as Parameters<typeof $.tool.call>[0])
  expect(r.context ?? []).toEqual([])
  const sync = await $.command.run({ command: 'twins', args: 'sync verify' } as Parameters<typeof $.command.run>[0])
  expect(sync.text).toContain('asked Claude to port the claude change in verify to the shared copy (1 file)')
  expect((sync.context ?? []).join('\n')).toContain('Rule for this pair: generalise: no personal values')
  await clock.advance(1)
  expect(submitted.join('\n')).toContain('Sync the twin copies of verify')
  const reply = await $.command.run({ command: 'twins', args: 'ignore verify' } as Parameters<typeof $.command.run>[0])
  expect(reply.text).toBe('twins: cleared verify without syncing.')
  const again = await $.command.run({ command: 'twins', args: 'done verify' } as Parameters<typeof $.command.run>[0])
  expect(again.text).toContain('nothing marked behind')
})
