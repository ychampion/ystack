import { type MockClock, type TestBody, expect, mock, test } from 'claude-code/testing'

type $T = Parameters<TestBody>[0]
type OnT = Parameters<TestBody>[1]

const NOW = new Date(2026, 10, 9, 12, 0, 0).getTime()
const H = 3_600_000
const DAY = 24 * H
const PROJ = '/home/t/.claude/projects'
const INBOX = '/home/t/.claude/decision-inbox'
const key = (p: string) => p.replace(/\\/g, '/').replace(/^[a-z]:/i, '')
const PANE = {
  plugin: 'weekly-digest',
  component: 'Pane',
  requestId: 'weekly-digest',
  surface: 'terminal',
  props: { title: 'Digest', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const row = (id: string, at: number, cwd: string, input: number) =>
  JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), cwd, message: { id, model: 'm', usage: { input_tokens: input, output_tokens: 0 } } })

type F = { text: string; mtimeMs: number; size?: number }
type Opts = { gh?: 'ok' | 'missing' | 'fails'; files?: Record<string, F>; polish?: 'ok' | 'fails'; evilBranch?: boolean; configDir?: string }
type Host = {
  clock: MockClock
  files: Map<string, F>
  writes: Map<string, string>
  runs: { argv: string[]; cwd: string }[]
  spawns: string[][]
  models: string[]
  toasts: string[]
}

const baseFiles = (proj = PROJ): Record<string, F> => ({
  [`${proj}/-work-shop/s1.jsonl`]: {
    text: [row('a', NOW - 2 * H, '/work/shop', 3000), row('b', NOW - 26 * H, '/work/shop/sub', 1000), row('old', NOW - 9 * DAY, '/work/shop', 50_000)].join('\n') + '\n',
    mtimeMs: NOW - 2 * H,
  },
  [`${proj}/-work-shop/s1/subagents/agent-1.jsonl`]: { text: `${row('s', NOW - 3 * H, '/work/shop', 2000)}\n`, mtimeMs: NOW - 3 * H },
  [`${proj}/-home-t/s2.jsonl`]: { text: `${row('h', NOW - 5 * H, '/home/t', 4000)}\n`, mtimeMs: NOW - 5 * H },
  [`${proj}/-work-gone/s3.jsonl`]: { text: `${row('g', NOW - 20 * DAY, '/work/gone', 1)}\n`, mtimeMs: NOW - 20 * DAY },
  // written to this week, but its replies are all older: the folder had no session in the window
  [`${proj}/-work-quiet/s4.jsonl`]: { text: `${row('q', NOW - 10 * DAY, '/work/quiet', 7000)}\n`, mtimeMs: NOW - DAY },
  [`${INBOX}/D-1.json`]: { text: JSON.stringify({ id: 'D-1', question: 'Which price?', recommended: '$8', sessionId: 's1', from: 'shop (main)', status: 'open' }), mtimeMs: NOW },
  [`${INBOX}/D-2.json`]: { text: JSON.stringify({ id: 'D-2', question: 'Rename the app?', recommended: 'No', sessionId: 'zz', from: 'elsewhere (main)', status: 'open' }), mtimeMs: NOW },
  [`${INBOX}/D-3.json`]: { text: JSON.stringify({ id: 'D-3', question: 'Done one?', recommended: 'Yes', sessionId: 's1', from: 'shop (main)', status: 'answered' }), mtimeMs: NOW },
})

// Commits: on origin (the user's and a collaborator's), and one only on upstream (the project this repo forked).
const COMMITS = [
  { hash: 'a1', email: 'me@x.com', subject: 'Add checkout (#12)', on: 'origin' },
  { hash: 'b2', email: 'me@x.com', subject: 'fix: tax rounding', on: 'origin' },
  { hash: 'c3', email: 'you@y.com', subject: 'docs: update guide', on: 'origin' },
  { hash: 'd4', email: 'me+x@x.com', subject: 'Plus address work', on: 'origin' },
  { hash: 'u9', email: 'they@z.com', subject: 'Upstream work', on: 'upstream' },
]
const REPOS = ['/work/shop', '/work/Shop']

function git(args: string[], cwd: string, opts: Opts): { exitCode: number; stdout: string; stderr: string } {
  const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })
  const top = REPOS.find(r => cwd === r || cwd.startsWith(`${r}/`))
  if (!top) return { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }
  const has = (a: string) => args.includes(a)
  switch (args[0]) {
    case 'rev-parse':
      return ok(`${top}\n`)
    case 'remote':
      return has('get-url') ? ok('https://github.com/me/shop.git\n') : ok('origin\nupstream\n')
    case 'config':
      return ok('me@x.com\n')
    case 'log': {
      // git matches --author as a basic regex unless --fixed-strings: there "\+" means "one or more", not a plus.
      const fixed = has('--fixed-strings') || has('-F')
      const authors = args.filter(a => a.startsWith('--author=')).map(a => a.slice('--author='.length))
      const match = (email: string) => authors.length === 0 || authors.some(p => (fixed ? email.includes(p) : new RegExp(p.replace(/\\\+/g, '+')).test(email)))
      const refs = has('--remotes') ? ['origin', 'upstream'] : has('--remotes=origin') ? ['origin'] : has('--branches') ? ['origin'] : []
      return ok(COMMITS.filter(c => refs.includes(c.on) && match(c.email)).map(c => `${c.hash}\x1f${c.email}\x1f${c.subject}`).join('\n') + '\n')
    }
    case 'for-each-ref': {
      const recent = Math.floor((NOW - H) / 1000)
      const refs = [`refs/heads/feature/cart\x1f${recent}`, `refs/heads/main\x1f${Math.floor((NOW - 30 * DAY) / 1000)}`]
      if (opts.evilBranch) refs.push(`refs/heads/--output=x.txt\x1f${recent}`)
      return ok(`${refs.join('\n')}\n`)
    }
    case 'rev-list':
      return ok('3\n')
    case 'status':
      return ok(' M a.ts\n?? b.ts\n')
    default:
      return { exitCode: 1, stdout: '', stderr: 'unknown' }
  }
}

function fakeHost(on: OnT, opts: Opts = {}): Host {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  const files = new Map(Object.entries(opts.files ?? baseFiles()))
  const host: Host = { clock, files, writes: new Map(), runs: [], spawns: [], models: [], toasts: [] }
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/t' : e.name === 'CLAUDE_CONFIG_DIR' ? opts.configDir : undefined }) as never)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', (_, e) => {
    host.toasts.push(e.text)
    return { value: undefined } as never
  })
  on('fs.list', (_, e) => {
    const dir = key(e.path)
    const kids = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
    for (const [p, f] of files) {
      if (!p.startsWith(`${dir}/`)) continue
      const [name = '', ...more] = p.slice(dir.length + 1).split('/')
      kids.set(name, more.length ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false } : { name, kind: 'file', size: f.size ?? f.text.length, mtimeMs: f.mtimeMs, isLink: false })
    }
    if (kids.size === 0) throw new Error('ENOENT')
    return { value: [...kids.values()] } as never
  })
  on('fs.read', (_, e) => {
    const f = files.get(key(e.path))
    if (!f) throw new Error('ENOENT')
    return { value: f.text } as never
  })
  on('fs.write', (_, e) => {
    host.writes.set(key(e.path), e.text)
    files.set(key(e.path), { text: e.text, mtimeMs: NOW })
    return { value: undefined } as never
  })
  on('process.run', (_, e) => {
    const argv = [...e.argv]
    const cwd = key(e.init?.cwd ?? '/')
    host.runs.push({ argv, cwd })
    if (argv[0] === 'git') return { value: git(argv.slice(1), cwd, opts) } as never
    if (argv[0] === 'gh') {
      if (opts.gh === 'missing') throw new Error('spawn gh ENOENT')
      if (argv[1] === '--version') return { value: { exitCode: 0, stdout: 'gh version 2', stderr: '' } } as never
      if (argv[1] === 'repo') return { value: { exitCode: 0, stdout: JSON.stringify({ nameWithOwner: 'me/shop' }), stderr: '' } } as never
      if (opts.gh === 'fails') return { value: { exitCode: 1, stdout: '', stderr: 'HTTP 401: Bad credentials\nmore' } } as never
      const merged = argv.includes('merged')
      const out = merged ? [{ number: 12, title: 'Add checkout' }] : [{ number: 14, title: 'New pricing page', isDraft: true }]
      return { value: { exitCode: 0, stdout: JSON.stringify(out), stderr: '' } } as never
    }
    return { value: { exitCode: 127, stdout: '', stderr: 'not found' } } as never
  })
  // Stands for the filter over a big transcript: its reply rows, cut mid-row into two pieces.
  on('process.spawn', async function* (_, e) {
    host.spawns.push([...e.argv])
    const f = files.get(key(e.env?.WD_PATH ?? e.argv[e.argv.length - 1] ?? ''))
    const text = f?.text ?? ''
    const cut = Math.floor(text.length / 2)
    yield { stream: 'stdout' as const, text: text.slice(0, cut) }
    yield { stream: 'stdout' as const, text: text.slice(cut) }
    return { value: { code: f ? 0 : 2, signal: null } } as never
  })
  on('model.complete', (_, e) => {
    host.models.push(e.prompt)
    if (opts.polish === 'fails') return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: {} } } as never
    return { value: { isAnswered: true, text: 'We shipped checkout this week.', usage: {} } } as never
  })
  return host
}

/** Runs /digest and lets the work it schedules finish. */
async function digest($: $T, h: Host, args = '') {
  await $.session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'digest', args } as never)
  await h.clock.settle()
  return r
}
const PATH = '/home/t/.claude/digests/digest-2026-11-09.md'

test('the command answers at once; the digest is built after it, then the pane and a toast say where it went', async ($, on) => {
  const h = fakeHost(on)
  await $.session.start({ cwd: '/work/shop', surface: 'terminal', isInteractive: true })
  const r = await $.command.run({ command: 'digest', args: '' } as never)
  expect(r.text).toBe('Building your digest for the last 7 days…')
  expect(h.writes.size).toBe(0)
  expect(h.runs.length).toBe(0)
  await h.clock.settle()
  expect(h.toasts).toEqual([`Digest saved to ${PATH}: 1 repo, 1 merged PR, 2 commits.`])
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /^Saved to/ }))?.text).toBe(`Saved to ${PATH}. Nothing was sent anywhere.`)
  await ui.unmount()
})

test('groups what shipped, what is in flight, what needs you, and time and usage by repo', async ($, on) => {
  const h = fakeHost(on)
  await digest($, h)
  const md = h.writes.get(PATH) ?? ''
  expect(md).toContain('# Digest: 2 Nov 2026 to 9 Nov 2026 (7 days)')
  expect(md).toContain('## shop\n\nFolder: /work/shop\n\n**Shipped**\n\n- 1 merged PR, 2 pushed commits.\n- Add checkout (#12)\n- Tax rounding\n')
  expect(md).toContain('**In flight**\n\n- Open PR #14: New pricing page (draft)\n- Branch feature/cart: 3 commits not pushed\n- 2 files changed, not committed\n')
  expect(md).toContain('**Needs you**\n\n- D-1: Which price? (default: $8)\n')
  expect(md).toContain('## Other decisions waiting on you\n\n- D-2: Rename the app? (default: No; from elsewhere (main))')
  expect(md).not.toContain('D-3')
  // shop: 3000 + 1000 (a subfolder of the same repo) + 2000 (its subagent); the 9-day-old reply is outside the window
  expect(md).toContain('6k input-token equivalents (60% of the total)')
  expect(md).toContain('## Outside any repo\n\n- About 0.5 active hours, 4k input-token equivalents (40% of the total).')
  expect(md).not.toContain('gone')
  expect(md).not.toContain('quiet') // a file touched this week whose replies are all older
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Markdown' }))?.text).toBe(md)
  await ui.unmount()
})

test('in a fork, shipped is the user\'s own commits on origin, and gh is pinned to origin\'s repo', async ($, on) => {
  const h = fakeHost(on)
  await digest($, h)
  const md = h.writes.get(PATH) ?? ''
  expect(md).not.toContain('Upstream work') // only on upstream
  expect(md).not.toContain('Update guide') // a collaborator's
  const log = h.runs.find(x => x.argv[1] === 'log')?.argv ?? []
  expect(log).toContain('--remotes=origin')
  expect(log).not.toContain('--remotes')
  expect(log).toContain('--fixed-strings')
  expect(log).toContain('--author=me@x.com') // from git config user.email, as none are set
  const view = h.runs.find(x => x.argv[0] === 'gh' && x.argv[1] === 'repo')?.argv ?? []
  expect(view).toEqual(['gh', 'repo', 'view', 'https://github.com/me/shop.git', '--json', 'nameWithOwner'])
  const prs = h.runs.filter(x => x.argv[0] === 'gh' && x.argv[1] === 'pr').map(x => x.argv)
  expect(prs.length).toBe(2)
  for (const a of prs) expect(a.slice(3, 5)).toEqual(['-R', 'me/shop'])
})

test('an author email with a plus is matched as written', { options: { authorEmails: 'me+x@x.com' } }, async ($, on) => {
  const h = fakeHost(on)
  await digest($, h)
  const md = h.writes.get(PATH) ?? ''
  expect(md).toContain('- 1 merged PR, 1 pushed commit.')
  expect(md).toContain('- Plus address work')
  expect(h.runs.find(x => x.argv[1] === 'log')?.argv).toContain('--author=me+x@x.com')
  expect(h.runs.filter(x => x.argv[0] === 'gh' && x.argv[1] === 'pr').every(x => x.argv.join(' ').endsWith('--author @me'))).toBe(true)
})

test('a branch named like an option is passed as a full ref after --end-of-options', async ($, on) => {
  const h = fakeHost(on, { evilBranch: true })
  await digest($, h)
  const counts = h.runs.filter(x => x.argv[1] === 'rev-list').map(x => x.argv.slice(1))
  expect(counts).toContainEqual(['rev-list', '--count', '--not', '--remotes=origin', '--not', '--end-of-options', 'refs/heads/--output=x.txt'])
  expect(h.runs.flatMap(x => x.argv).some(a => a.startsWith('--output'))).toBe(false) // never a bare option-like argument
  expect(h.writes.get(PATH)).toContain('- Branch --output=x.txt: 3 commits not pushed')
})

test('the window follows the days asked for, in git and in the PR search (as UTC)', async ($, on) => {
  const h = fakeHost(on)
  await digest($, h, '1')
  const since = new Date(NOW - DAY).toISOString()
  expect(h.runs.find(x => x.argv[1] === 'log')?.argv).toContain(`--since=${since}`)
  const search = h.runs.find(x => x.argv[0] === 'gh' && x.argv.includes('merged'))?.argv ?? []
  expect(search[search.indexOf('--search') + 1]).toBe(`merged:>=${since.slice(0, 19)}+00:00`)
  const md = h.writes.get(PATH) ?? ''
  expect(md).toContain('(1 day)')
  expect(md).toContain('5k input-token equivalents (56% of the total)') // 3000 + the 3-hour-old subagent's 2000; the 26-hour-old reply is outside
})

test('a second digest the same day gets its own file', async ($, on) => {
  const h = fakeHost(on)
  await digest($, h)
  await digest($, h)
  expect([...h.writes.keys()]).toEqual([PATH, '/home/t/.claude/digests/digest-2026-11-09-2.md'])
})

test('without gh the digest still lists commits and says why PRs are missing', async ($, on) => {
  const h = fakeHost(on, { gh: 'missing' })
  await digest($, h)
  expect(h.toasts.at(-1)).toContain('0 merged PRs, 2 commits')
  const md = h.writes.get(PATH) ?? ''
  expect(md).toContain('- 0 merged PRs, 2 pushed commits.\n- Add checkout (#12)')
  expect(md).not.toContain('Open PR')
  expect(md).toContain('The GitHub CLI (gh) was not found')
  expect(h.runs.filter(x => x.argv[0] === 'gh').length).toBe(1) // only the check
})

test('gh that fails for a repo leaves a short note there', async ($, on) => {
  const h = fakeHost(on, { gh: 'fails' })
  await digest($, h)
  expect(h.writes.get(PATH)).toContain('_GitHub PRs not listed here: HTTP 401: Bad credentials_')
})

test('no repos and no decisions: a short digest that says so', async ($, on) => {
  const h = fakeHost(on, { files: {} })
  await digest($, h)
  expect(h.toasts).toEqual([`Digest saved to ${PATH}: 0 repos, 0 merged PRs, 0 commits.`])
  const md = h.writes.get(PATH) ?? ''
  expect(md).toContain('No repos were touched in this period.')
  expect(md).not.toContain('Needs you')
  expect(md).not.toContain('gh')
})

test('polish off makes no model call', async ($, on) => {
  const h = fakeHost(on)
  await digest($, h)
  expect(h.models).toEqual([])
  expect(h.writes.get(PATH)).not.toContain('Update draft')
})

test('polish on asks a model once, says what it sent, and shows its update marked as a draft', { options: { polish: true } }, async ($, on) => {
  const h = fakeHost(on)
  await digest($, h)
  expect(h.models.length).toBe(1)
  expect(h.models[0]).toContain('<digest>\n# Digest:')
  expect(h.writes.get(PATH)).toContain('## Update draft\n\n_Written by a model from the digest above. Check it before you share it._\n\nWe shipped checkout this week.\n')
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Markdown', key: 'polished' }))?.text).toBe('We shipped checkout this week.')
  expect((await ui.find({ type: 'Text', text: /^Saved to/ }))?.text).toBe(
    `Saved to ${PATH}. Folder paths, commit and PR titles and open decisions went to haiku to write the summary.`,
  )
  await ui.unmount()
})

test('a failed polish keeps the digest and says so', { options: { polish: true } }, async ($, on) => {
  const h = fakeHost(on, { polish: 'fails' })
  await digest($, h)
  expect(h.writes.get(PATH)).not.toContain('Update draft')
  const ui = await $.ui.mount(PANE)
  expect((await ui.find({ type: 'Text', text: /could not be written/ }))?.text).toBe('The polished update could not be written (api-error).')
  await ui.unmount()
})

test('a relative digestDir is under the home folder', { options: { digestDir: 'notes/weekly' } }, async ($, on) => {
  const h = fakeHost(on)
  await digest($, h)
  expect([...h.writes.keys()]).toEqual(['/home/t/notes/weekly/digest-2026-11-09.md'])
})

test('a big transcript is streamed through a filter, rows cut between pieces still counted', async ($, on) => {
  const files = baseFiles()
  const big = files[`${PROJ}/-work-shop/s1.jsonl`]
  if (!big) throw new Error('missing')
  big.size = 9_000_000
  const h = fakeHost(on, { files })
  await digest($, h)
  expect(h.spawns.length).toBe(1)
  expect(h.spawns[0]?.[0]).toBe('grep')
  expect(h.writes.get(PATH)).toContain('6k input-token equivalents (60% of the total)')
})

test('a config folder on a Windows share is read with the Windows filter', async ($, on) => {
  const proj = '//server/share/.claude/projects'
  const files = baseFiles(proj)
  const big = files[`${proj}/-work-shop/s1.jsonl`]
  if (!big) throw new Error('missing')
  big.size = 9_000_000
  const h = fakeHost(on, { files, configDir: '\\\\server\\share\\.claude' })
  await digest($, h)
  expect(h.spawns[0]?.[0]).toBe('powershell')
  expect(h.writes.get(PATH)).toContain('6k input-token equivalents (60% of the total)')
})

test('repo folders that differ only in case stay apart off Windows', { options: { extraRepos: '/work/Shop' } }, async ($, on) => {
  const h = fakeHost(on)
  await digest($, h)
  const md = h.writes.get(PATH) ?? ''
  expect(md).toContain('## shop\n')
  expect(md).toContain('## Shop\n\nFolder: /work/Shop')
})

test('extraRepos adds a repo no session ran in, and names a folder that is not one', { options: { extraRepos: '/work/shop/sub; /not/a/repo' } }, async ($, on) => {
  const h = fakeHost(on, { files: {} })
  await digest($, h)
  const md = h.writes.get(PATH) ?? ''
  expect(md).toContain('## shop')
  expect(md).toContain('/not/a/repo (in extraRepos) is not a git repo, so it was skipped.')
})
