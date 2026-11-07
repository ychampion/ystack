import { type TestBody, expect, test } from 'claude-code/testing'

import { IDLE_MS, type SessionRecord, repoHash } from '../hooks/lanes.ts'

const NOW = 1_700_000_000_000
const REPO = repoHash('c:/work/app/.git')
const DIR = `/home/t/.claude/lanes/${REPO}`

// A fake disk: the engine may hand paths on in the platform's own spelling, so keys drop the drive and use '/'.
const key = (p: string) => p.replace(/\\/g, '/').replace(/^[a-z]:/i, '')
function fakeHost(on: Parameters<TestBody>[1], files: Map<string, string>, clock: () => number = () => NOW) {
  on('env.get', () => ({ value: '/home/t' }))
  on('session.id', () => ({ value: 'me' }))
  on('session.root', () => ({ value: 'c:/work/app' }))
  on('clock.now', () => ({ value: clock() }))
  on('process.run', (_, e) => {
    const { cwd } = e as unknown as { cwd?: string }
    const top = (cwd ?? '').replace(/\\/g, '/').startsWith('c:/work/app-feature') ? 'c:/work/app-feature' : 'c:/work/app'
    return { value: { exitCode: 0, stdout: `c:/work/app/.git\n${top}\nmain\n`, stderr: '' } as never }
  })
  on('fs.list', (_, e) => {
    const dir = key((e as unknown as { path: string }).path)
    const names = [...files.keys()].filter(k => k.startsWith(`${dir}/`)).map(k => k.slice(dir.length + 1))
    return { value: names.map(name => ({ name, kind: 'file' as const })) as never }
  })
  on('fs.read', (_, e) => {
    const text = files.get(key((e as unknown as { path: string }).path))
    if (text === undefined) throw new Error('ENOENT')
    return { value: text as never }
  })
  on('fs.write', (_, e) => {
    const { path, text } = e as unknown as { path: string; text: string }
    files.set(key(path), text)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: {} }))
}

const peer = (over: Partial<SessionRecord>): SessionRecord => ({
  sessionId: 'b',
  label: 'app: tidy styles',
  repoId: REPO,
  worktree: 'c:/work/app',
  branch: 'main',
  lastActive: NOW - 60_000,
  files: { 'src/a.ts': { since: NOW - 10 * 60_000, at: NOW - 60_000 } },
  ...over,
})

test('an edit to a file another session in this folder holds gets a note, and is claimed', async ($, on) => {
  const files = new Map([[`${DIR}/b.json`, JSON.stringify(peer({}))]])
  fakeHost(on, files)
  const r = await $.tool.call({ tool: 'Edit', file_path: 'c:/work/app/src/a.ts', old_string: 'a', new_string: 'b' })
  expect((r.context ?? []).join('\n')).toContain('another Claude session ("app: tidy styles") has been editing src/a.ts since 10 minutes ago')
  const mine = JSON.parse(files.get(`${DIR}/me.json`) ?? '{}') as SessionRecord
  expect(mine.files['src/a.ts']?.at).toBe(NOW)
})

test('with the block setting on, that edit is refused', { options: { block: true } }, async ($, on) => {
  fakeHost(on, new Map([[`${DIR}/b.json`, JSON.stringify(peer({}))]]))
  const r = await $.tool.call({ tool: 'Write', file_path: 'c:/work/app/src/a.ts', content: 'x' })
  expect(r.deny ?? '').toContain('blocked while the other session holds it')
})

test('two worktrees changing one file: both are told now', async ($, on) => {
  const files = new Map([[`${DIR}/c.json`, JSON.stringify(peer({ sessionId: 'c', worktree: 'c:/work/app-feature', branch: 'feature' }))]])
  fakeHost(on, files)
  const r = await $.tool.call({ tool: 'Edit', file_path: 'c:/work/app/src/a.ts', old_string: 'a', new_string: 'b' })
  expect((r.context ?? []).join('\n')).toContain('likely conflict on this file when merged')
  const notice = files.get(`${DIR}/notice-c-me.json`) ?? ''
  expect(notice).toContain('src/a.ts')
})

test('git stash is refused while another session is live in the repo, allowed when alone', async ($, on) => {
  const files = new Map([[`${DIR}/c.json`, JSON.stringify(peer({ sessionId: 'c', worktree: 'c:/work/app-feature', branch: 'feature' }))]])
  fakeHost(on, files)
  const r = await $.tool.call({ tool: 'Bash', command: 'git stash' })
  expect(r.deny ?? '').toContain('work-in-progress commit')
  files.set(`${DIR}/c.json`, JSON.stringify(peer({ sessionId: 'c', isEnded: true, files: {} })))
  const alone = await $.tool.call({ tool: 'Bash', command: 'git stash' })
  expect(alone.deny).toBeUndefined()
})

test('a long autonomous turn stays live: its tool calls keep the record fresh without prompts', async ($, on) => {
  let now = NOW
  const files = new Map<string, string>()
  fakeHost(on, files, () => now)
  await $.tool.call({ tool: 'Edit', file_path: 'c:/work/app/src/a.ts', old_string: 'a', new_string: 'b' })
  for (let m = 5; m <= 40; m += 5) {
    now = NOW + m * 60_000
    await $.tool.call({ tool: 'Bash', command: 'bun test' })
  }
  const mine = JSON.parse(files.get(`${DIR}/me.json`) ?? '{}') as SessionRecord
  expect(NOW + 40 * 60_000 - mine.lastActive).toBeLessThan(IDLE_MS)
})

test('a commit message that mentions git stash is not a stash', async ($, on) => {
  fakeHost(on, new Map([[`${DIR}/c.json`, JSON.stringify(peer({ sessionId: 'c', worktree: 'c:/work/app-feature', branch: 'feature' }))]]))
  const verb = ['com', 'mit'].join('')
  const msg = [`git ${verb} -m "$(cat <<'EOF'`, 'Refuse git stash while peers are live', '', 'git reset --hard is held back once.', 'EOF', ')"'].join('\n')
  const r = await $.tool.call({ tool: 'Bash', command: msg })
  expect(r.deny).toBeUndefined()
})
