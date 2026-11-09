import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Shell } from './parse.ts'
import { actions, globMatch, hasPlaceholder, isDynamic, isExpanded, repoName, type Action, type Base, type CommitAction, type PushAction, type Scope } from './rules.ts'
import { COMMIT_MARK, describe, scanDiff, scanFile, type Finding } from './secrets.ts'

type Config = { allowPaths: string[]; protectedRepos: string[]; protectedBranches: string[] }

function list(v: unknown, d: string): string[] {
  const raw = Array.isArray(v) ? v.join(',') : typeof v === 'string' ? v : d
  return raw
    .split(/[,\n]/)
    .map(s => s.trim())
    .filter(Boolean)
}

function configFrom(o: PluginOptions): Config {
  return {
    allowPaths: list(o.allowPaths, ''),
    protectedRepos: list(o.protectedRepos, ''),
    protectedBranches: list(o.protectedBranches, 'main, master'),
  }
}

const MAX_COMMITS = 1000
const MAX_UNTRACKED = 200
const MAX_FILE_CHARS = 1_000_000
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
const ALLOW_VERBS = new Set(['public', 'delete', 'api'])

// This session's allows: `public:<owner/name>`, `delete:<target>`, `api:<owner/name>`, lower case. Reset at session start.
let allows = new Set<string>()

/** Where the command runs: the session's directory, the user's home, and whether paths are Windows ones. */
type Where = { cwd: string; home?: string; windows: boolean }

const slashes = (p: string) => p.replace(/\\/g, '/')
const isAbs = (p: string) => p.startsWith('/') || /^[A-Za-z]:/.test(p)

/** `~/x`, Git Bash `/c/x` and relative paths as absolute ones git can be started in; undefined if it can't be told. */
function resolveDir(p: string, w: Where): string | undefined {
  let s = slashes(p)
  if (s === '~' || s.startsWith('~/')) {
    if (!w.home) return undefined
    s = slashes(w.home).replace(/\/+$/, '') + s.slice(1)
  }
  if (w.windows) {
    const m = /^\/(?:cygdrive\/|mnt\/)?([a-zA-Z])(?:\/(.*))?$/.exec(s)
    if (m) s = `${(m[1] as string).toUpperCase()}:/${m[2] ?? ''}`
  }
  if (!isAbs(s)) s = `${slashes(w.cwd).replace(/\/+$/, '')}/${s}`
  return s
}

/** The base with its directory and `-C` / `--git-dir` / `--work-tree` paths made absolute, or marked unknown. */
function locate(base: Base, w: Where): Base {
  if (base.cwdUnknown) return base
  const unknown: Base = { replay: base.replay, cwdUnknown: true }
  const cwd = base.cwd !== undefined ? resolveDir(base.cwd, w) : undefined
  if (base.cwd !== undefined && cwd === undefined) return unknown
  const replay: string[] = []
  for (let i = 0; i < base.replay.length; i++) {
    const a = base.replay[i] as string
    const eq = /^(--git-dir|--work-tree)=(.*)$/.exec(a)
    const value = eq ? (eq[2] as string) : i > 0 && ['-C', '--git-dir', '--work-tree'].includes(base.replay[i - 1] as string) ? a : undefined
    // Relative paths stay relative: git reads them against the directory it runs in.
    const fix = value !== undefined && (value.startsWith('~') || /^\/[a-zA-Z](\/|$)/.test(value)) ? resolveDir(value, w) : value
    if (value !== undefined && fix === undefined) return unknown
    replay.push(eq ? `${eq[1]}=${fix}` : value !== undefined ? (fix as string) : a)
  }
  return { ...(cwd !== undefined ? { cwd } : {}), replay }
}

type Git = { ok: boolean; out: string; err: string; cut: boolean }

/** Config for every git call: no fsmonitor or hooks, no signature checks, external diff or pager, plain a/ b/ prefixes. */
function safeConfig(w: Where): string[] {
  const none = w.windows ? 'NUL' : '/dev/null'
  return ['-c', 'core.fsmonitor=', '-c', `core.hooksPath=${none}`, '-c', 'log.showSignature=false', '-c', 'diff.external=', '-c', 'core.pager=cat', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.noprefix=false']
}

async function run($: EngineInterface, argv: string[], cwd: string | undefined): Promise<Git> {
  try {
    const r = await $.process.run(argv, { ...(cwd !== undefined ? { cwd } : {}), timeoutMs: 20_000 })
    return { ok: r.exitCode === 0, out: r.stdout, err: r.stderr.trim().slice(0, 200), cut: r.isStdoutTruncated }
  } catch (err) {
    return { ok: false, out: '', err: String(err).slice(0, 200), cut: false }
  }
}

function git($: EngineInterface, w: Where, base: Base, args: string[]): Promise<Git> {
  return run($, ['git', ...safeConfig(w), ...base.replay, ...args], base.cwd)
}

function joinPath(base: string | undefined, next: string): string {
  if (base === undefined || /^([\\/]|[A-Za-z]:|~)/.test(next)) return next
  return `${base.replace(/[\\/]+$/, '')}/${next}`
}

const pathArgs = (s: Scope) => (Array.isArray(s) ? ['--', ...s] : [])
const DIFF = ['--no-color', '--no-ext-diff', '--no-textconv', '-U0']
const names = (files: string[]) => (files.length > 10 ? `${files.slice(0, 10).join(', ')} and ${files.length - 10} more` : files.join(', '))

/** Keys in what this commit will record. `notes` say what couldn't be scanned. */
async function scanCommit($: EngineInterface, w: Where, a: CommitAction, cfg: Config, notes: string[]): Promise<Finding[]> {
  const found: Finding[] = []
  const staged = await git($, w, a.base, ['diff', '--cached', ...DIFF])
  if (!staged.ok) {
    notes.push(`push-guard couldn't read the staged changes to check them for keys (${staged.err || 'git failed'}).`)
    return found
  }
  if (staged.cut) notes.push('push-guard checked only the first 4 MB of the staged changes for keys.')
  found.push(...scanDiff(staged.out, cfg.allowPaths))
  if (a.tracked !== 'none') {
    const hasHead = (await git($, w, a.base, ['rev-parse', '--verify', '-q', 'HEAD'])).ok
    const more = await git($, w, a.base, hasHead ? ['diff', 'HEAD', ...DIFF, ...pathArgs(a.tracked)] : ['diff', ...DIFF, ...pathArgs(a.tracked)])
    if (more.ok) found.push(...scanDiff(more.out, cfg.allowPaths))
    else notes.push(`push-guard couldn't read the changes this command stages to check them for keys (${more.err || 'git failed'}).`)
    if (more.cut) notes.push('push-guard checked only the first 4 MB of the changes this command stages for keys.')
  }
  if (a.untracked !== 'none') {
    const ls = await git($, w, a.base, ['ls-files', '--others', '--exclude-standard', '-z', ...pathArgs(a.untracked)])
    if (!ls.ok) notes.push(`push-guard couldn't list the new files this command stages (${ls.err || 'git failed'}).`)
    else {
      const files = ls.out.split('\0').filter(Boolean)
      if (files.length > MAX_UNTRACKED) notes.push(`push-guard checked only the first ${MAX_UNTRACKED} of ${files.length} new files for keys; not checked: ${names(files.slice(MAX_UNTRACKED))}.`)
      const ci = a.base.replay.indexOf('-C')
      const dir = joinPath(a.base.cwd, ci >= 0 ? (a.base.replay[ci + 1] as string) : '.')
      const skipped: string[] = []
      const cut: string[] = []
      for (const f of files.slice(0, MAX_UNTRACKED)) {
        const text = await $.fs.read(joinPath(dir, f)).catch(() => undefined)
        if (typeof text !== 'string') {
          skipped.push(f)
          continue
        }
        if (text.length > MAX_FILE_CHARS) cut.push(f)
        found.push(...scanFile(f, text.slice(0, MAX_FILE_CHARS), cfg.allowPaths))
      }
      if (skipped.length > 0) notes.push(`push-guard couldn't read these new files to check them for keys (over 4 MiB, binary or unreadable): ${names(skipped)}.`)
      if (cut.length > 0) notes.push(`push-guard checked only the first ${MAX_FILE_CHARS.toLocaleString('en-US')} characters of these new files for keys: ${names(cut)}.`)
    }
  }
  return found
}

/** Keys in the commits this push sends that no remote has yet. Commits a remote already has are skipped by design. */
async function scanPush($: EngineInterface, w: Where, a: PushAction, cfg: Config, notes: string[]): Promise<Finding[]> {
  if (a.revs.length === 0 && a.revFlags.length === 0) return []
  // The format line starts with \x01 so scanDiff can tell commit headers from diff text (COMMIT_MARK).
  // Revisions from the command go last, after --end-of-options, so none can be read as an option.
  // `--not --remotes --not` excludes what a remote has and turns the following revisions positive again.
  const log = await git($, w, a.base, [
    'log',
    '-p',
    ...DIFF,
    `--format=%x01${COMMIT_MARK.slice(1)}%h`,
    `--max-count=${MAX_COMMITS}`,
    ...a.revFlags,
    '--not',
    '--remotes',
    '--not',
    '--end-of-options',
    ...a.revs.filter(r => !r.startsWith('-')),
  ])
  if (!log.ok) {
    notes.push(`push-guard couldn't read the commits being pushed to check them for keys (${log.err || 'git failed'}).`)
    return []
  }
  if (log.cut) notes.push('push-guard checked only the first 4 MB of the commits being pushed for keys.')
  return scanDiff(log.out, cfg.allowPaths)
}

async function currentBranch($: EngineInterface, w: Where, base: Base): Promise<string | undefined> {
  const r = await git($, w, base, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const b = r.out.trim()
  return r.ok && b && b !== 'HEAD' ? b : undefined
}

/** The branch the current one tracks on its remote (`main` for `refs/remotes/origin/main`). */
async function upstreamBranch($: EngineInterface, w: Where, base: Base): Promise<string | undefined> {
  const r = await git($, w, base, ['rev-parse', '--symbolic-full-name', '@{u}'])
  const ref = r.out.trim()
  if (!r.ok || !ref) return undefined
  return ref.replace(/^refs\/remotes\/[^/]+\//, '').replace(/^refs\/heads\//, '')
}

/** The repo the command runs in, as gh sees it, then from the origin remote. */
async function repoHere($: EngineInterface, w: Where, base: Base): Promise<string | undefined> {
  if (base.cwdUnknown) return undefined
  const gh = await run($, ['gh', 'repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], base.cwd)
  const viaGh = gh.ok ? repoName(gh.out) : undefined
  if (viaGh?.includes('/')) return viaGh
  const r = await git($, w, base, ['remote', 'get-url', 'origin'])
  return r.ok ? repoName(r.out) : undefined
}

/**
 * The repo an action names: literal names as written; gh's `{owner}` / `{repo}` filled from the repo the
 * command runs in; a variable or substitution never resolves (undefined).
 */
async function resolveRepo($: EngineInterface, w: Where, base: Base, given: string | undefined): Promise<string | undefined> {
  if (given && isDynamic(given)) return undefined
  if (given && !hasPlaceholder(given)) return repoName(given) ?? given
  const here = await repoHere($, w, base)
  if (!given || here === undefined) return here
  const [owner, name] = here.split('/') as [string, string]
  const filled = given.replace(/\{owner\}/gi, owner).replace(/\{repo\}/gi, name)
  return hasPlaceholder(filled) ? undefined : filled
}

function isProtectedRepo(repo: string | undefined, cfg: Config): boolean {
  if (cfg.protectedRepos.length === 0) return false
  if (cfg.protectedRepos.includes('*')) return true
  if (repo === undefined) return true
  const r = repo.toLowerCase()
  return cfg.protectedRepos.some(p => {
    const q = p.toLowerCase()
    if (q === r) return true
    // `gh repo create name` names no owner: compare the name part.
    return !r.includes('/') && q.split('/').pop() === r
  })
}

const SECRET_HELP =
  'Take the key out of the file (read it from an environment variable or a secret store instead) and stage the fix. ' +
  "If it is only in the staged copy, `git restore --staged <file>` unstages it. If it is in a commit already, amend or rebase that commit to remove it before pushing, and tell the user so they can rotate the key. " +
  'If this is a false alarm (a test fixture, a documented fake), tell the user; they can add the path to the push-guard `allowPaths` setting.'

const UNKNOWN_REPO = "push-guard couldn't tell which repo this runs in; run it from that folder or with git -C <path>."

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

async function check($: EngineInterface, w: Where, a: Action, cfg: Config, notes: string[], depth = 0): Promise<string[]> {
  const why: string[] = []
  switch (a.kind) {
    case 'unknown':
      why.push(`${a.how} Run git or gh directly, with the words written out, so push-guard can check it.`)
      break
    case 'git-alias': {
      if (a.base.cwdUnknown) {
        why.push(`\`git ${a.sub}\` may be an alias, and ${UNKNOWN_REPO}`)
        break
      }
      const r = await git($, w, a.base, ['config', '--get', `alias.${a.sub}`])
      // Exit 1 with no output: no such alias, so git runs an external `git-<sub>` or fails.
      if (!r.ok && r.out.trim() === '' && r.err === '') break
      if (!r.ok) {
        why.push(`push-guard couldn't look up whether \`git ${a.sub}\` is an alias (${r.err || 'git config failed'}). Run the command it stands for directly.`)
        break
      }
      const expansion = r.out.trim()
      if (expansion.startsWith('!') || depth >= 3) {
        why.push(`\`git ${a.sub}\` is a git alias for \`${expansion.slice(0, 80)}\`. Run the command it stands for directly, so push-guard can check it.`)
        break
      }
      for (const inner of actions(`git ${expansion} ${a.rest.map(quote).join(' ')}`, 'bash')) {
        why.push(...(await check($, w, { ...inner, base: a.base } as Action, cfg, notes, depth + 1)))
      }
      break
    }
    case 'commit': {
      if (a.base.cwdUnknown) {
        why.push(UNKNOWN_REPO)
        break
      }
      const found = await scanCommit($, w, a, cfg, notes)
      if (found.length > 0) why.push(`This commit would record what looks like a secret (values not shown):\n${describe(found)}\n${SECRET_HELP}`)
      break
    }
    case 'push': {
      if (a.base.cwdUnknown) {
        why.push(UNKNOWN_REPO)
        break
      }
      const hits: string[] = []
      const protectedName = (b: string) => cfg.protectedBranches.some(g => globMatch(g, b))
      const add = (h: string) => {
        if (!hits.includes(h)) hits.push(h)
      }
      for (const t of a.forced) {
        if (cfg.protectedBranches.length === 0) break
        if ('all' in t) add(`every branch (including ${cfg.protectedBranches.join(', ')})`)
        else if ('branch' in t) {
          if (protectedName(t.branch)) add(t.branch)
        } else if ('unknown' in t) add(`${t.unknown} (push-guard couldn't tell which branch that is, so it counts as protected)`)
        else {
          const b = await currentBranch($, w, a.base)
          if (b === undefined) add("the current branch (push-guard couldn't tell which branch that is)")
          else if (protectedName(b)) add(b)
          // A bare push goes to the branch's upstream, which may have another name.
          if (t.upstream) {
            const up = await upstreamBranch($, w, a.base)
            if (up !== undefined && protectedName(up)) add(up)
          }
        }
      }
      if (hits.length > 0) {
        why.push(
          `This force-pushes to a protected branch: ${hits.join(', ')}. That rewrites history other people and machines rely on. ` +
            `Push your work to a new branch instead (\`git push -u ${a.remote} HEAD:<new-branch>\`) and open a pull request. If the user really wants to rewrite ${hits.length === 1 ? 'that branch' : 'those branches'}, they run the command themselves.`,
        )
      }
      for (const d of a.deletes) {
        if (isDynamic(d) || isExpanded(d.replace(/:(prune|mirror)$/, ""))) {
          why.push(`This deletes a remote branch push-guard can't read (${d}). Name the branch literally so the user can decide.`)
          continue
        }
        if (allows.has(`delete:${d.toLowerCase()}`)) continue
        const what = d.endsWith(':prune') ? `remote branches on ${d.slice(0, -6)} that no longer exist here (--prune)` : d.endsWith(':mirror') ? `anything on ${d.slice(0, -7)} that isn't here (--mirror)` : `the remote branch ${d}`
        why.push(`This deletes ${what}, which is hard to undo. Ask the user first. If they agree, they type \`/push-guard allow delete ${d}\` and you run the same command again.`)
      }
      if (why.length === 0) {
        const found = await scanPush($, w, a, cfg, notes)
        if (found.length > 0) why.push(`The commits being pushed contain what looks like a secret (values not shown):\n${describe(found)}\n${SECRET_HELP}`)
      }
      break
    }
    case 'public': {
      const repo = a.repo === 'new' ? 'new' : await resolveRepo($, w, a.base, a.repo)
      if (a.unreadable) {
        if (repo === undefined) why.push("push-guard couldn't read the request body, nor tell which repository it changes. Name the repository literally (`owner/name`) so the user can decide.")
        else if (!allows.has(`api:${repo.toLowerCase()}`)) {
          why.push(`push-guard couldn't read the request body; if it doesn't make the repo public, /push-guard allow api ${repo} (the user types it), then run the same command again. Or pass the fields inline (\`-f key=value\`) so push-guard can read them.`)
        }
        break
      }
      const isProtected = repo === 'new' ? cfg.protectedRepos.includes('*') : isProtectedRepo(repo, cfg)
      if (isProtected) {
        why.push(
          `This would make ${repo ? `the repository ${repo}` : "a repository (push-guard couldn't tell which, so it counts as protected)"} public, and it is on push-guard's protected list. ` +
            'Do not try another way. Only the user can change its visibility, by hand, outside Claude.',
        )
      } else if (repo === undefined) {
        why.push("This would make a repository public, and push-guard couldn't tell which one. Name it literally (`owner/name`) so the user can decide.")
      } else if (!allows.has(`public:${repo.toLowerCase()}`)) {
        why.push(
          `This would make ${repo === 'new' ? 'a new repository' : `the repository ${repo}`} public: anyone could read its code and history. Ask the user first. ` +
            `If they agree, they type \`/push-guard allow public ${repo}\` and you run the same command again.`,
        )
      }
      break
    }
    case 'delete-repo': {
      const repo = await resolveRepo($, w, a.base, a.repo)
      if (repo === undefined) why.push("This deletes a repository, and push-guard couldn't tell which one. Name it literally (`owner/name`) so the user can decide.")
      else if (!allows.has(`delete:${repo.toLowerCase()}`)) {
        why.push(`This deletes the repository ${repo}, with its issues, pull requests and history. Ask the user first. If they agree, they type \`/push-guard allow delete ${repo}\` and you run the same command again.`)
      }
      break
    }
    case 'delete-ref': {
      const [owner, name, ...ref] = a.target.split('/')
      const repo = await resolveRepo($, w, a.base, `${owner}/${name}`)
      const target = repo !== undefined && !isDynamic(ref.join('/')) ? `${repo}/${ref.join('/')}` : undefined
      if (target === undefined) why.push(`This deletes a remote ref push-guard can't read (${a.target}). Name the repository and branch literally so the user can decide.`)
      else if (!allows.has(`delete:${target.toLowerCase()}`)) {
        why.push(`This deletes the remote ref ${target}, which is hard to undo. Ask the user first. If they agree, they type \`/push-guard allow delete ${target}\` and you run the same command again.`)
      }
      break
    }
  }
  return why
}

function statusText(cfg: Config): string {
  const lines = [
    'push-guard settings:',
    `- Protected branches (no force-push): ${cfg.protectedBranches.join(', ') || 'none'}`,
    `- Protected repos (never made public by Claude): ${cfg.protectedRepos.join(', ') || 'none'}`,
    `- Paths skipped by the key scan: ${cfg.allowPaths.join(', ') || 'none'}`,
    allows.size > 0 ? `Allowed this session: ${[...allows].map(a => a.replace(':', ' ')).join(', ')}` : 'Nothing allowed this session.',
    'To let one through: /push-guard allow public <owner/name>, /push-guard allow delete <target>, or /push-guard allow api <owner/name> (the target the stop message named).',
  ]
  return lines.join('\n')
}

/** Commands push-guard has anything to check in; an internal error on any other lets it run. */
const RELEVANT = /\b(git|gh|curl|invoke-restmethod|invoke-webrequest|irm|iwr)\b/i

async function whereOf($: EngineInterface): Promise<Where> {
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || undefined
  return { cwd, ...(home ? { home } : {}), windows: /^[A-Za-z]:/.test(cwd) }
}

export const register: Register = (on, options) => {
  const cfg = configFrom(options)

  on('session.start', async ($, e, next) => {
    allows = new Set()
    await $.command.register({
      name: 'push-guard',
      description: 'Show push-guard settings, or allow one stopped public/delete/api action for this session',
      argumentHint: '[allow public <owner/name> | allow delete <target> | allow api <owner/name>]',
    })
    return next(e)
  })

  on('command.run', { command: 'push-guard' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return { text: statusText(cfg) }
    const [verb, what, target] = words
    if (verb !== 'allow' || what === undefined || !ALLOW_VERBS.has(what) || !target) {
      return { text: 'Usage: /push-guard, /push-guard allow public <owner/name>, /push-guard allow delete <target>, or /push-guard allow api <owner/name>.' }
    }
    if (!USER_ORIGINS.has(e.origin?.kind)) return { text: 'Only the user can allow this, by typing the command.' }
    if (/[{}$`]/.test(target)) {
      return { text: `${target} can't be allowed: it is a placeholder or a variable, not a name. Use the literal name push-guard's stop message gave (owner/name).` }
    }
    if (what === 'public' && isProtectedRepo(target, cfg)) {
      return { text: `${target} is on the protected repos list, so push-guard won't let Claude make it public. Change its visibility yourself, or edit the protectedRepos setting.` }
    }
    allows.add(`${what}:${target.toLowerCase()}`)
    const verbText = what === 'public' ? `make ${target} public` : what === 'api' ? `send ${target} an API request whose body push-guard can't read` : `delete ${target}`
    return {
      text: `Allowed for this session: Claude may ${verbText}.`,
      context: [`The user allowed push-guard to let this through for the session: ${verbText}. Run the command again.`],
    }
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const shell: Shell = e.tool === 'PowerShell' ? 'powershell' : 'bash'
    const acts = actions(e.command, shell)
    if (acts.length === 0) return next(e)
    const w = await whereOf($)
    const notes: string[] = []
    const why: string[] = []
    for (const a of acts) {
      const placed = { ...a, base: locate(a.base, w) } as Action
      why.push(...(await check($, w, placed, cfg, notes)))
    }
    if (why.length > 0) return { deny: `push-guard stopped this command.\n\n${[...new Set(why)].join('\n\n')}` }
    const ran = await next(e)
    if (notes.length === 0 || ran.deny !== undefined) return ran
    return { ...ran, context: [...(ran.context ?? []), ...notes] }
  }).catch(async ($, e, next) => {
    if (next.called) return next(e)
    const command = e.command
    if (!RELEVANT.test(command)) return next(e)
    // Fail closed: a command push-guard could not check does not run.
    return { deny: `push-guard hit an internal error and couldn't check this command, so it stopped it (${(next.error.message ?? next.error.kind).slice(0, 160)}). Tell the user; they can run it themselves, or turn push-guard off for it.` }
  })
}
