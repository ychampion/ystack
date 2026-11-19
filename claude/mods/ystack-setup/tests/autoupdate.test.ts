import { expect, test } from 'claude-code/testing'

import { COOLDOWN_MS, LAST_RUN, LAST_SETUP, autoUpdate, bashPath, findCheckout, type Io, nativePath, type RunResult } from '../hooks/autoupdate.ts'

const HOME = '/home/u'
const YS = `${HOME}/ystack`
const MARKET = `${HOME}/.claude/plugins/marketplaces/ystack`
const OK = (stdout = ''): RunResult => ({ exitCode: 0, stdout, stderr: '' })
const NO = (stderr = 'error'): RunResult => ({ exitCode: 1, stdout: '', stderr })
const A = 'a'.repeat(40)
const B = 'b'.repeat(40)
const T0 = 1_000_000_000

type World = {
  upstream?: null // null: no upstream
  behind?: number
  diverged?: boolean
  dirty?: boolean // a modified tracked file
  stray?: boolean // an untracked or ignored file under what setup copies
  toplevel?: string
  detached?: boolean
  inProgress?: string // e.g. 'rebase-merge'
  fetchFails?: boolean
  mergeFails?: string
  setup?: RunResult
  claude?: 'native' | 'shim' | 'none'
  markets?: Array<{ name: string; installLocation: string }>
  installed?: Array<{ id: string; version: string }>
  marketVersions?: Record<string, string>
  files?: Record<string, string>
  dirs?: Record<string, string[]>
  links?: Record<string, string>
  env?: Record<string, string>
  isWindows?: boolean
  store?: Record<string, unknown>
}

function fake(w: World = {}) {
  const calls: string[] = []
  const envs: Array<Record<string, string> | undefined> = []
  const store = new Map(Object.entries(w.store ?? {}))
  let now = T0
  let head = A
  const files: Record<string, string> = {
    [`${YS}/setup`]: '#!/bin/sh',
    [`${YS}/.claude-plugin/marketplace.json`]: '{ "name": "ystack" }',
    [`${MARKET}/.claude-plugin/marketplace.json`]: JSON.stringify({
      name: 'ystack',
      plugins: Object.keys(w.marketVersions ?? {}).map(name => ({ name, source: `./claude/mods/${name}` })),
    }),
    ...Object.fromEntries(Object.entries(w.marketVersions ?? {}).map(([n, v]) => [`${MARKET}/claude/mods/${n}/.claude-plugin/plugin.json`, JSON.stringify({ name: n, version: v })])),
    ...(w.inProgress ? { [`${YS}/.git/${w.inProgress}`]: '' } : {}),
    ...w.files,
  }
  const claudeCmd = (a: string): RunResult => {
    if (a === '--version') return OK('2.1.0 (Claude Code)')
    if (a === 'plugin marketplace list --json') return OK(JSON.stringify(w.markets ?? []))
    if (a === 'plugin marketplace update ystack') return OK()
    if (a === 'plugin list --json') return OK(JSON.stringify(w.installed ?? []))
    if (a.startsWith('plugin update ')) return OK()
    throw new Error(`unexpected claude ${a}`)
  }
  const io: Io = {
    run: async (argv, init) => {
      const cmd = argv.join(' ')
      calls.push(cmd)
      envs.push(init?.env)
      if (argv[0] === 'git' && argv[1] === '-C') {
        const a = argv.slice(3).join(' ')
        if (a === 'rev-parse --show-toplevel') return OK(`${w.toplevel ?? YS}\n`)
        if (a === 'symbolic-ref -q HEAD') return w.detached ? NO('') : OK('refs/heads/main\n')
        if (a.startsWith('rev-parse --git-path ')) return OK(`.git/${argv[argv.length - 1]}\n`)
        if (a === 'rev-parse HEAD') return OK(`${head}\n`)
        if (a.startsWith('status') && a.includes('--ignored')) return OK(w.stray ? '?? skills/new/SKILL.md\n' : '')
        if (a.startsWith('status')) return OK(w.dirty ? ' M setup\n' : '')
        if (a.startsWith('rev-parse --abbrev-ref')) return w.upstream === null ? NO('no upstream') : OK('origin/main\n')
        if (a === 'fetch --quiet') return w.fetchFails ? NO('could not resolve host') : OK()
        if (a === 'rev-list --count HEAD..@{u}') return OK(`${head === B ? 0 : (w.behind ?? 0)}\n`)
        if (a.startsWith('merge-base')) return w.diverged ? NO('') : OK()
        if (a.startsWith('merge --ff-only')) {
          if (w.mergeFails) return NO(w.mergeFails)
          head = B
          return OK()
        }
      }
      if (argv[0] === 'git' && argv[1] === '--exec-path') return OK('C:/Program Files/Git/mingw64/libexec/git-core\n')
      if (argv[0] === 'claude') {
        if ((w.claude ?? 'native') !== 'native') throw new Error('spawn claude ENOENT')
        return claudeCmd(argv.slice(1).join(' '))
      }
      if (argv[0] === 'cmd.exe') {
        if (w.claude !== 'shim') throw new Error('not here')
        return claudeCmd(argv.slice(5).join(' '))
      }
      if (argv.some(x => x.endsWith('/setup'))) return w.setup ?? OK()
      throw new Error(`unexpected: ${cmd}`)
    },
    exists: async p => p in files || p === 'C:/Program Files/Git/bin/bash.exe',
    read: async p => files[p],
    list: async d => {
      if (w.dirs?.[d]) return w.dirs[d]
      throw new Error('ENOENT')
    },
    realPath: async p => w.links?.[p],
    env: async n => (n === 'HOME' ? HOME : w.env?.[n]),
    isWindows: w.isWindows ?? false,
    get: async k => store.get(k),
    set: async (k, v) => void store.set(k, v),
    now: async () => now,
  }
  return { io, calls, envs, store, later: () => void (now += COOLDOWN_MS + 1) }
}

const setupCalls = (calls: string[]) => calls.filter(c => c.includes('/setup '))
const merged = (calls: string[]) => calls.some(c => c.includes('merge --ff-only'))

test('a newer ystack on a clean checkout is pulled, then setup refreshes the agents that have it, under a lock', async () => {
  const f = fake({ behind: 3 })
  const said = await autoUpdate(f.io)
  expect(merged(f.calls)).toBe(true)
  const s = setupCalls(f.calls)
  expect(s).toHaveLength(1)
  expect(s[0]).toContain(`ystack-setup ${YS}/.git/ystack-setup.lock bash ${YS}/setup --host installed -q`)
  expect(f.store.get(LAST_SETUP)).toBe(B)
  expect(said).toMatch(/ystack updated to bbbbbbb \(3 new commits\)/)
})

test('git never prompts: every git call runs with prompts and credential windows off', async () => {
  const f = fake({ behind: 1 })
  await autoUpdate(f.io)
  const gitEnvs = f.calls.map((c, i) => [c, f.envs[i]] as const).filter(([c]) => c.startsWith('git -C'))
  expect(gitEnvs.length).toBeGreaterThan(5)
  for (const [, env] of gitEnvs) expect(env).toMatchObject({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' })
  const own = fake({ env: { GIT_SSH_COMMAND: 'ssh -i key' } })
  await autoUpdate(own.io)
  expect(own.envs.find(e => e?.GIT_TERMINAL_PROMPT)?.GIT_SSH_COMMAND).toBeUndefined()
})

test('a folder inside another repository, a detached HEAD or a rebase under way: git does nothing more and setup does not run', async () => {
  for (const w of [{ toplevel: HOME }, { detached: true }, { inProgress: 'rebase-merge' }] as World[]) {
    const f = fake({ behind: 2, ...w })
    expect(await autoUpdate(f.io)).toBeUndefined()
    expect(f.calls.some(c => c.includes('fetch'))).toBe(false)
    expect(setupCalls(f.calls)).toEqual([])
  }
})

test('local changes: nothing is pulled, and the person is told once, not at every start', async () => {
  const f = fake({ behind: 2, dirty: true, store: { [LAST_SETUP]: A } })
  expect(await autoUpdate(f.io)).toMatch(/local changes, so it wasn't pulled/)
  expect(merged(f.calls)).toBe(false)
  f.later()
  expect(await autoUpdate(f.io)).toBeUndefined()
  f.later()
  expect(await autoUpdate(f.io, { force: true })).toMatch(/local changes/)
})

test('untracked or ignored files under what setup copies: pulled, but nothing is copied out, said once', async () => {
  const f = fake({ behind: 1, stray: true })
  const said = await autoUpdate(f.io)
  expect(merged(f.calls)).toBe(true)
  expect(setupCalls(f.calls)).toEqual([])
  expect(said).toMatch(/untracked or ignored files under skills/)
  f.later()
  expect(await autoUpdate(f.io)).toBeUndefined()
})

test('uncommitted work and nothing upstream: setup does not copy it out', async () => {
  const f = fake({ dirty: true })
  await autoUpdate(f.io)
  expect(setupCalls(f.calls)).toEqual([])
})

test('diverged checkout: not pulled, told to run /ystack-upgrade', async () => {
  const f = fake({ behind: 1, diverged: true })
  expect(await autoUpdate(f.io)).toMatch(/commits that aren't on its remote/)
  expect(merged(f.calls)).toBe(false)
})

test('a failed fast-forward is reported once, with git\'s reason', async () => {
  const f = fake({ behind: 1, mergeFails: 'error: The following untracked working tree files would be overwritten by merge' })
  expect(await autoUpdate(f.io)).toMatch(/pulling it failed \(error: The following untracked/)
  f.later()
  expect(await autoUpdate(f.io)).toBeUndefined()
})

test('up to date and already set up from this commit: no setup run, nothing said', async () => {
  const f = fake({ store: { [LAST_SETUP]: A } })
  expect(await autoUpdate(f.io)).toBeUndefined()
  expect(setupCalls(f.calls)).toEqual([])
})

test('commits made here since the last setup (nothing to pull) still refresh the agents', async () => {
  const f = fake({ store: { [LAST_SETUP]: 'c'.repeat(40) } })
  expect(await autoUpdate(f.io)).toMatch(/refreshed to aaaaaaa/)
  expect(f.store.get(LAST_SETUP)).toBe(A)
})

test('offline: nothing said about the network, and commits made here are still refreshed', async () => {
  const f = fake({ fetchFails: true, store: { [LAST_SETUP]: 'c'.repeat(40) } })
  expect(await autoUpdate(f.io)).toMatch(/refreshed to aaaaaaa/)
  expect(f.calls.some(c => c.includes('rev-list'))).toBe(false)
})

test('a failed setup says why once, is not recorded, and is retried next time', async () => {
  const f = fake({ behind: 1, setup: { exitCode: 1, stdout: '  Antigravity plugins: FAILED (folder in use)\n', stderr: '' } })
  expect(await autoUpdate(f.io)).toMatch(/couldn't refresh the skills and guards: Antigravity plugins: FAILED \(folder in use\)/)
  expect(f.store.get(LAST_SETUP)).toBeUndefined()
  f.later()
  expect(await autoUpdate(f.io)).toBeUndefined()
  expect(setupCalls(f.calls)).toHaveLength(2)
})

test('another session holding the setup lock: this pass stays quiet and retries later', async () => {
  const f = fake({ behind: 1, setup: { exitCode: 75, stdout: '', stderr: '' } })
  expect(await autoUpdate(f.io)).toMatch(/ystack updated/)
  expect(f.store.get(LAST_SETUP)).toBeUndefined()
})

test('a checkout too old for --host installed is reported once per commit, not retried', async () => {
  const f = fake({ setup: { exitCode: 1, stdout: '', stderr: "setup: unknown host 'installed' (expected claude, codex, opencode, antigravity, devin, all or auto)" } })
  expect(await autoUpdate(f.io)).toMatch(/older than auto-update; run \/ystack-upgrade once/)
  expect(f.store.get(LAST_SETUP)).toBe(A)
})

test('the cooldown stops a second pass soon after the first; the manual command ignores it', async () => {
  const f = fake({ store: { [LAST_RUN]: T0 - COOLDOWN_MS / 2 } })
  expect(await autoUpdate(f.io)).toBeUndefined()
  expect(f.calls).toEqual([])
  await autoUpdate(f.io, { force: true })
  expect(f.calls.length).toBeGreaterThan(0)
})

test('only installed ystack mods whose version changed are updated', async () => {
  const f = fake({
    store: { [LAST_SETUP]: A },
    markets: [{ name: 'ystack', installLocation: MARKET }],
    marketVersions: { verify: '0.3.0', pin: '0.1.0' },
    installed: [
      { id: 'verify@ystack', version: '0.2.0' },
      { id: 'pin@ystack', version: '0.1.0' },
      { id: 'verify@other', version: '0.0.1' },
    ],
  })
  const said = await autoUpdate(f.io)
  expect(f.calls.filter(c => c.startsWith('claude plugin update'))).toEqual(['claude plugin update verify@ystack'])
  expect(said).toMatch(/1 ystack mod updated \(verify\): restart Claude Code or run \/reload-plugins/)
})

test('on Windows an npm install (claude.cmd) is reached through cmd.exe', async () => {
  const f = fake({
    isWindows: true,
    claude: 'shim',
    store: { [LAST_SETUP]: A },
    markets: [{ name: 'ystack', installLocation: MARKET }],
    marketVersions: { pin: '0.2.0' },
    installed: [{ id: 'pin@ystack', version: '0.1.0' }],
  })
  expect(await autoUpdate(f.io)).toMatch(/1 ystack mod updated \(pin\)/)
  expect(f.calls).toContain('cmd.exe /d /s /c claude plugin update pin@ystack')
})

test('no claude CLI or no ystack marketplace: mods are skipped quietly', async () => {
  for (const w of [{ claude: 'none' }, { markets: [{ name: 'other', installLocation: '/x' }] }] as World[]) {
    const f = fake({ store: { [LAST_SETUP]: A }, ...w })
    expect(await autoUpdate(f.io)).toBeUndefined()
  }
})

test('the checkout is found from a copied skill marker, a linked skill, or ~/ystack', async () => {
  const other = '/opt/ys'
  const files = { [`${other}/setup`]: '', [`${other}/.claude-plugin/marketplace.json`]: '{"name": "ystack"}' }
  const byMarker = fake({ dirs: { [`${HOME}/.claude/skills`]: ['tdd'] }, files: { ...files, [`${HOME}/.claude/skills/tdd/.ystack`]: `# note\nsource=${other}\nskill=tdd\n` } })
  expect(await findCheckout(byMarker.io)).toBe(other)
  const byLink = fake({ dirs: { [`${HOME}/.codex/skills`]: ['tdd'] }, links: { [`${HOME}/.codex/skills/tdd`]: `${other}/skills/tdd` }, files })
  expect(await findCheckout(byLink.io)).toBe(other)
  expect(await findCheckout(fake().io)).toBe(YS)
  const none = fake()
  none.io.read = async () => undefined // no marketplace file anywhere: nothing is a ystack checkout
  expect(await findCheckout(none.io)).toBeUndefined()
})

test("on Windows, Git Bash's /c/ paths in a skill marker become C:/ paths", async () => {
  expect(nativePath('/c/Users/u/ystack', true)).toBe('C:/Users/u/ystack')
  expect(nativePath('/c/Users/u/ystack', false)).toBe('/c/Users/u/ystack')
  expect(nativePath('/opt/ystack', true)).toBe('/opt/ystack')
  const ys = 'C:/Users/u/ystack'
  const f = fake({
    isWindows: true,
    dirs: { [`${HOME}/.claude/skills`]: ['tdd'] },
    files: { [`${HOME}/.claude/skills/tdd/.ystack`]: 'source=/c/Users/u/ystack\n', [`${ys}/setup`]: '', [`${ys}/.claude-plugin/marketplace.json`]: '{"name": "ystack"}' },
  })
  expect(await findCheckout(f.io)).toBe(ys)
})

test('on Windows, setup runs under Git Bash found from git, never a bare bash (which may be WSL)', async () => {
  const f = fake({ isWindows: true })
  expect(await bashPath(f.io)).toBe('C:/Program Files/Git/bin/bash.exe')
  const given = fake({ isWindows: true, env: { CLAUDE_CODE_GIT_BASH_PATH: 'D:/Git/bin/bash.exe' }, files: { 'D:/Git/bin/bash.exe': '' } })
  expect(await bashPath(given.io)).toBe('D:/Git/bin/bash.exe')
  expect(await bashPath(fake().io)).toBe('bash')
})
