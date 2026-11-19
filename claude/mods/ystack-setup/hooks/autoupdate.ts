// Keeps ystack current on its own: at session start (a /reload-plugins included) it pulls the ystack
// checkout when its remote has something newer, re-runs setup for every agent that already holds ystack
// skills (so Codex, OpenCode, Antigravity and Devin copies follow too), and updates the installed ystack
// mods. Quiet unless something changed or needs the person; one toast says what happened, and a warning
// is said once, not at every start.
//
// Safety:
// - git only touches a folder that is the top of its own repository, on a branch, with no merge, rebase or
//   bisect under way; it only fast-forwards, never over local changes, and never resets or stashes.
// - git never prompts (no password, passphrase or sign-in window): a fetch that needs one just fails.
// - setup runs only when nothing under the folders it copies is modified, untracked or ignored, so neither
//   uncommitted work nor a stray file (a .env) is copied out to the agents; a lock keeps two setups apart.

/** The environment variables auto-update reads (the engine lists each one a mod reads). */
export type EnvName = 'HOME' | 'USERPROFILE' | 'CODEX_HOME' | 'APPDATA' | 'LOCALAPPDATA' | 'ProgramFiles' | 'CLAUDE_CODE_GIT_BASH_PATH' | 'GIT_SSH_COMMAND'

export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type Io = {
  /** Runs argv (no shell); rejects when the program can't start or times out. */
  run: (argv: readonly string[], init?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }) => Promise<RunResult>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string | undefined>
  list: (dir: string) => Promise<string[]>
  realPath: (path: string) => Promise<string | undefined>
  env: (name: EnvName) => Promise<string | undefined>
  isWindows: boolean
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  now: () => Promise<number>
}

export const LAST_RUN = 'autoUpdate.lastRun'
export const LAST_SETUP = 'autoUpdate.lastSetupHead'
export const SAID = 'autoUpdate.said'
/** A second session (or a reload) within this long of the last run does nothing. */
export const COOLDOWN_MS = 2 * 60_000
/** The folders setup copies out to the agents. */
export const COPIED = ['skills', 'antigravity/plugins', 'devin/plugins', 'claude/agents']

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const short = (sha: string) => sha.slice(0, 7)
/** Git Bash writes `/c/Users/x`; Windows programs and the engine need `C:/Users/x`. */
export const nativePath = (p: string, isWindows: boolean) => (isWindows ? p.replace(/^\/([A-Za-z])(?=\/|$)/, (_, d: string) => `${d.toUpperCase()}:`) : p)
const firstLine = (t: string) => t.trim().split('\n')[0]?.trim() ?? ''
const samePath = (a: string, b: string, isWindows: boolean) => {
  const x = norm(nativePath(a, isWindows))
  const y = norm(nativePath(b, isWindows))
  return isWindows ? x.toLowerCase() === y.toLowerCase() : x === y
}

async function home(io: Io): Promise<string> {
  return norm((await io.env('HOME')) ?? (await io.env('USERPROFILE')) ?? '')
}

async function isCheckout(io: Io, dir: string): Promise<boolean> {
  if (!(await io.exists(`${dir}/setup`))) return false
  const m = await io.read(`${dir}/.claude-plugin/marketplace.json`).catch(() => undefined)
  return typeof m === 'string' && /"name"\s*:\s*"ystack"/.test(m)
}

/** The skills folders setup installs into, one per agent. */
export async function skillDirs(io: Io): Promise<string[]> {
  const h = await home(io)
  const codex = norm((await io.env('CODEX_HOME')) ?? `${h}/.codex`)
  let devin = `${h}/.config/devin`
  const appData = await io.env('APPDATA')
  if (io.isWindows && appData) devin = `${norm(appData)}/devin`
  return [`${h}/.claude/skills`, `${codex}/skills`, `${h}/.config/opencode/skills`, `${h}/.gemini/config/skills`, `${devin}/skills`]
}

/**
 * The ystack checkout the installed skills came from: a copied skill's `.ystack` marker names it in its
 * `source=` line, a linked skill resolves into `<checkout>/skills/`. Else `~/ystack`. Undefined if none.
 */
export async function findCheckout(io: Io): Promise<string | undefined> {
  for (const dir of await skillDirs(io)) {
    const names = await io.list(dir).catch(() => [] as string[])
    for (const name of names) {
      const marker = await io.read(`${dir}/${name}/.ystack`).catch(() => undefined)
      let root: string | undefined
      if (typeof marker === 'string') root = /^source=(.+)$/m.exec(marker)?.[1]?.trim()
      else {
        const real = await io.realPath(`${dir}/${name}`).catch(() => undefined)
        if (real && norm(real).endsWith(`/skills/${name}`)) root = norm(real).slice(0, -`/skills/${name}`.length)
      }
      if (root) root = norm(nativePath(root, io.isWindows))
      if (root && (await isCheckout(io, root))) return root
    }
  }
  const fallback = `${await home(io)}/ystack`
  return (await isCheckout(io, fallback)) ? fallback : undefined
}

export type Pull =
  | { state: 'current' | 'pulled'; head: string; from?: string; commits?: number; clean: boolean }
  | { state: 'dirty' | 'diverged'; head: string; commits: number }
  | { state: 'merge-failed'; head: string; why: string }
  | { state: 'skipped'; why: string }

/** Git that never asks anything: no terminal prompt, no credential window, ssh in batch mode. */
async function gitEnv(io: Io): Promise<Record<string, string>> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_ASKPASS: '', SSH_ASKPASS: '' }
  if (!(await io.env('GIT_SSH_COMMAND'))) env.GIT_SSH_COMMAND = 'ssh -o BatchMode=yes'
  return env
}

/** Fast-forwards the checkout to its upstream when that is safe. Never touches local changes. */
export async function pull(io: Io, dir: string): Promise<Pull> {
  const env = await gitEnv(io)
  const git = (args: string[], timeoutMs = 30_000) => io.run(['git', '-C', dir, ...args], { timeoutMs, env })
  // Only a folder that is the top of its own repository: never an enclosing repo (a zip extracted inside
  // another project, a home folder that is itself a repo).
  const top = await git(['rev-parse', '--show-toplevel']).catch(() => undefined)
  if (!top || top.exitCode !== 0 || !samePath(top.stdout.trim(), dir, io.isWindows)) return { state: 'skipped', why: 'not the top of its own git repository' }
  // On a branch, with nothing half done: a bisect, rebase, merge or checked-out tag is left alone.
  if ((await git(['symbolic-ref', '-q', 'HEAD'])).exitCode !== 0) return { state: 'skipped', why: 'detached HEAD' }
  for (const f of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'BISECT_LOG', 'CHERRY_PICK_HEAD']) {
    const p = (await git(['rev-parse', '--git-path', f])).stdout.trim()
    if (p && (await io.exists(p.startsWith('/') || /^[A-Za-z]:/.test(p) ? p : `${dir}/${p}`))) return { state: 'skipped', why: `a ${f} is in progress` }
  }
  const head = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  const status = await git(['status', '--porcelain', '--untracked-files=no'])
  const tracked = status.exitCode === 0 && status.stdout.trim() === ''
  // Nothing modified, untracked or ignored under what setup copies out.
  const copied = await git(['status', '--porcelain', '--untracked-files=all', '--ignored=matching', '--', ...COPIED])
  const clean = tracked && copied.exitCode === 0 && copied.stdout.trim() === ''
  const up = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (up.exitCode !== 0) return { state: 'current', head, clean }
  // Offline, no access, or it would have needed a password: check again next time; what is here can
  // still be refreshed.
  const fetched = await git(['fetch', '--quiet'], 90_000).catch(() => undefined)
  if (!fetched || fetched.exitCode !== 0) return { state: 'current', head, clean }
  const behind = Number((await git(['rev-list', '--count', 'HEAD..@{u}'])).stdout.trim()) || 0
  if (behind === 0) return { state: 'current', head, clean }
  if ((await git(['merge-base', '--is-ancestor', 'HEAD', '@{u}'])).exitCode !== 0) return { state: 'diverged', head, commits: behind }
  if (!tracked) return { state: 'dirty', head, commits: behind }
  const merged = await git(['merge', '--ff-only', '--quiet', '@{u}'], 300_000).catch(err => ({ exitCode: -1, stdout: '', stderr: String(err?.message ?? err) }))
  if (merged.exitCode !== 0) return { state: 'merge-failed', head, why: firstLine(merged.stderr) || `exit ${merged.exitCode}` }
  const now = (await git(['rev-parse', 'HEAD'])).stdout.trim()
  return { state: 'pulled', head: now, from: head, commits: behind, clean }
}

/** Git Bash on Windows (never WSL's bash.exe), plain `bash` elsewhere. */
export async function bashPath(io: Io): Promise<string | undefined> {
  if (!io.isWindows) return 'bash'
  const given = await io.env('CLAUDE_CODE_GIT_BASH_PATH')
  if (given && (await io.exists(given))) return given
  // git --exec-path is <Git>/mingw64/libexec/git-core (or usr/libexec/git-core); bash is <Git>/bin/bash.exe.
  const ep = await io.run(['git', '--exec-path']).catch(() => undefined)
  const candidates: string[] = []
  if (ep && ep.exitCode === 0) {
    const m = /^(.*?)\/(?:mingw64|mingw32|clangarm64|usr)\/libexec\/git-core$/i.exec(norm(ep.stdout.trim()))
    if (m) candidates.push(`${m[1]}/bin/bash.exe`)
  }
  for (const v of ['ProgramFiles', 'LOCALAPPDATA'] as const) {
    const base = await io.env(v)
    if (base) candidates.push(`${norm(base)}/${v === 'LOCALAPPDATA' ? 'Programs/' : ''}Git/bin/bash.exe`)
  }
  for (const c of candidates) if (await io.exists(c)) return c
  return undefined
}

/**
 * Runs `"$@"` holding a lock folder (mkdir is atomic), so two sessions never run setup at once; exit 75
 * when another holds it. A lock left by a crash is taken over after 15 minutes.
 */
export const LOCKED_RUN =
  'L="$1"; shift; find "$L" -maxdepth 0 -mmin +15 -exec rmdir {} \\; 2>/dev/null; mkdir "$L" 2>/dev/null || exit 75; trap \'rmdir "$L" 2>/dev/null\' EXIT; "$@"'

export type SetupRun = { ok: true } | { ok: false; busy: true } | { ok: false; why: string; tooOld?: boolean }

/** Re-runs setup for the agents that already hold ystack skills (and agent files, if setup installed them). */
export async function runSetup(io: Io, dir: string): Promise<SetupRun> {
  const bash = await bashPath(io)
  if (!bash) return { ok: false, why: 'Git Bash was not found' }
  // Inside git's own folder (a worktree's .git is a file, so ask git where).
  const gp = await io.run(['git', '-C', dir, 'rev-parse', '--git-path', 'ystack-setup.lock'], { env: await gitEnv(io) }).catch(() => undefined)
  const rel = gp && gp.exitCode === 0 ? gp.stdout.trim() : '.git/ystack-setup.lock'
  const lock = rel.startsWith('/') || /^[A-Za-z]:/.test(rel) ? rel : `${dir}/${rel}`
  const args = [bash, '-c', LOCKED_RUN, 'ystack-setup', lock, bash, `${dir}/setup`, '--host', 'installed', '-q']
  if (await io.exists(`${await home(io)}/.claude/agents/.ystack-manifest`)) args.push('--agents')
  const r = await io.run(args, { cwd: dir, timeoutMs: 600_000 }).catch(err => ({ exitCode: -1, stdout: '', stderr: String(err?.message ?? err) }))
  if (r.exitCode === 0) return { ok: true }
  if (r.exitCode === 75) return { ok: false, busy: true }
  if (/unknown host 'installed'/.test(`${r.stdout}\n${r.stderr}`)) return { ok: false, tooOld: true, why: 'this ystack checkout is older than auto-update; run /ystack-upgrade once' }
  const failed = `${r.stdout}\n${r.stderr}`.split('\n').find(l => /FAILED/.test(l))
  return { ok: false, why: (failed ?? firstLine(r.stderr) ?? `exit ${r.exitCode}`).trim() }
}

export type ModsRun = { updated: string[]; failed: string[] } | { skipped: string }

/** The claude CLI: the native binary, or on Windows the npm `.cmd` shim through cmd.exe. */
async function claudeRunner(io: Io): Promise<((args: string[]) => Promise<RunResult>) | undefined> {
  const probe = (argv: string[]) => io.run(argv, { timeoutMs: 120_000 })
  const direct = await probe(['claude', '--version']).catch(() => undefined)
  if (direct && direct.exitCode === 0) return args => probe(['claude', ...args])
  if (!io.isWindows) return undefined
  // Every argument here is a fixed word or a plugin id ([a-z0-9-]@ystack): nothing cmd.exe would read specially.
  const shim = await probe(['cmd.exe', '/d', '/s', '/c', 'claude', '--version']).catch(() => undefined)
  if (shim && shim.exitCode === 0) return args => probe(['cmd.exe', '/d', '/s', '/c', 'claude', ...args])
  return undefined
}

/** Updates every installed `<mod>@ystack` whose version differs from the marketplace's, after refreshing it. */
export async function updateMods(io: Io): Promise<ModsRun> {
  const claude = await claudeRunner(io)
  if (!claude) return { skipped: 'no claude CLI' }
  const mk = await claude(['plugin', 'marketplace', 'list', '--json']).catch(() => undefined)
  if (!mk || mk.exitCode !== 0) return { skipped: 'marketplace list failed' }
  let markets: Array<{ name?: string; installLocation?: string }> = []
  try {
    markets = JSON.parse(mk.stdout)
  } catch {
    return { skipped: 'unreadable marketplace list' }
  }
  const market = markets.find(m => m.name === 'ystack')
  if (!market?.installLocation) return { skipped: 'ystack marketplace not added' }
  const upd = await claude(['plugin', 'marketplace', 'update', 'ystack']).catch(() => undefined)
  if (!upd || upd.exitCode !== 0) return { skipped: 'marketplace update failed' }

  const loc = norm(market.installLocation)
  const want = new Map<string, string>()
  try {
    const mf = JSON.parse((await io.read(`${loc}/.claude-plugin/marketplace.json`)) ?? '{}') as { plugins?: Array<{ name?: string; source?: unknown; version?: string }> }
    for (const p of mf.plugins ?? []) {
      if (!p.name) continue
      let version = p.version
      if (!version && typeof p.source === 'string') {
        const pj = await io.read(`${loc}/${p.source.replace(/^\.\//, '')}/.claude-plugin/plugin.json`).catch(() => undefined)
        if (pj) version = (JSON.parse(pj) as { version?: string }).version
      }
      if (version) want.set(p.name, version)
    }
  } catch {
    return { skipped: 'unreadable ystack marketplace' }
  }

  const pl = await claude(['plugin', 'list', '--json']).catch(() => undefined)
  if (!pl || pl.exitCode !== 0) return { skipped: 'plugin list failed' }
  let installed: Array<{ id?: string; version?: string }> = []
  try {
    installed = JSON.parse(pl.stdout)
  } catch {
    return { skipped: 'unreadable plugin list' }
  }
  const updated: string[] = []
  const failed: string[] = []
  const seen = new Set<string>()
  for (const p of installed) {
    if (!p.id || !/^[a-z0-9-]+@ystack$/.test(p.id) || seen.has(p.id)) continue
    seen.add(p.id)
    const name = p.id.slice(0, -'@ystack'.length)
    const v = want.get(name)
    if (!v || v === p.version) continue
    const r = await claude(['plugin', 'update', p.id]).catch(() => undefined)
    if (r && r.exitCode === 0) updated.push(name)
    else failed.push(name)
  }
  return { updated, failed }
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** In-process guard: one pass at a time in this session (the manual command and a start can overlap). */
let running = false

/**
 * One auto-update pass. Returns the toast text, or undefined when there is nothing to tell.
 * `force` skips the cooldown (the manual command) and repeats warnings already given.
 */
export async function autoUpdate(io: Io, { force = false } = {}): Promise<string | undefined> {
  if (running) return force ? 'An update is already running in this session.' : undefined
  const now = await io.now()
  const last = Number(await io.get(LAST_RUN)) || 0
  if (!force && now - last < COOLDOWN_MS) return undefined
  running = true
  try {
    await io.set(LAST_RUN, now)
    return await pass(io, force)
  } finally {
    running = false
  }
}

async function pass(io: Io, force: boolean): Promise<string | undefined> {
  const said: string[] = []
  // A warning is said once per situation (its key), not at every start; news is always said.
  const before = ((await io.get(SAID)) ?? {}) as Record<string, string>
  const warnings: Record<string, string> = {}
  const warn = (topic: string, key: string, text: string) => {
    warnings[topic] = key
    if (force || before[topic] !== key) said.push(text)
  }

  const dir = await findCheckout(io)
  if (dir) {
    const p = await pull(io, dir)
    if (p.state === 'pulled') said.push(`ystack updated to ${short(p.head)} (${plural(p.commits ?? 0, 'new commit')}).`)
    if (p.state === 'dirty') warn('pull', `dirty:${p.head}`, `A newer ystack is out (${plural(p.commits, 'commit')}), but your checkout has local changes, so it wasn't pulled. Commit or stash them, then run /ystack-upgrade.`)
    if (p.state === 'diverged') warn('pull', `diverged:${p.head}`, `A newer ystack is out, but your checkout has commits that aren't on its remote, so it wasn't pulled. Run /ystack-upgrade.`)
    if (p.state === 'merge-failed') warn('pull', `merge:${p.head}`, `A newer ystack is out, but pulling it failed (${p.why}). Run /ystack-upgrade to see more.`)
    // Refresh the agents' copies whenever the checkout moved since the last good setup run (a pull, or
    // commits made here), and only when nothing stray would be copied out.
    if ((p.state === 'current' || p.state === 'pulled') && (await io.get(LAST_SETUP)) !== p.head) {
      if (!p.clean) {
        warn('setup', `stray:${p.head}`, `ystack didn't refresh the skills and guards: the checkout has uncommitted, untracked or ignored files under ${COPIED.join(', ')}, which setup would copy out. Commit or remove them, or run setup yourself.`)
      } else {
        const s = await runSetup(io, dir)
        if (s.ok) {
          await io.set(LAST_SETUP, p.head)
          if (p.state === 'current') said.push(`ystack skills and guards refreshed to ${short(p.head)}.`)
        } else if (!('busy' in s)) {
          // A checkout too old for --host installed is not retried until it moves.
          if (s.tooOld) await io.set(LAST_SETUP, p.head)
          warn('setup', `failed:${p.head}:${s.why}`, `ystack couldn't refresh the skills and guards: ${s.why}. It tries again next session; /ystack-upgrade shows more.`)
        }
      }
    }
  }
  const m = await updateMods(io)
  if ('updated' in m) {
    if (m.updated.length > 0) said.push(`${plural(m.updated.length, 'ystack mod')} updated (${m.updated.join(', ')}): restart Claude Code or run /reload-plugins to load them.`)
    if (m.failed.length > 0) warn('mods', `failed:${m.failed.join(',')}`, `Couldn't update ${m.failed.join(', ')}; run /ystack-upgrade.`)
  }
  await io.set(SAID, warnings)
  return said.length > 0 ? said.join(' ') : undefined
}
