// Turns the programs a command runs into the risky actions push-guard checks. Pure: no `$`.

import { gitCall, invocations, isAbsolute, progName, type Invocation, type Shell } from './parse.ts'

/**
 * Where our own git calls run: the segment's `cd` and the call's `-C` / `--git-dir` / `--work-tree`.
 * `cwdUnknown`: a `cd` or `-C` the parser can't follow, so the repo can't be told.
 */
export type Base = { cwd?: string; replay: string[]; cwdUnknown?: boolean }

/** A variable or substitution: its value can't be read from the command text. */
export const isDynamic = (s: string) => /[$`]/.test(s)
/** gh's `{owner}` / `{repo}` / `{branch}` placeholders, filled from the repo the command runs in. */
export const hasPlaceholder = (s: string) => /\{(owner|repo|branch)\}/i.test(s)
/** Shell brace or glob expansion (`{main,}`, `ma?n`, `[m]ain`): the word git gets can't be read from the text. */
export const isExpanded = (s: string) => /[{}?[\]]/.test(s)
/** A brace expansion proper (`{a,b}`, `{1..3}`), which can turn one word into several. */
const BRACE = /\{[^{}]*(,|\.\.)[^{}]*\}/

/** `all`: everything; a list: those paths only; `none`: nothing. */
export type Scope = 'all' | 'none' | string[]

export type CommitAction = {
  kind: 'commit'
  base: Base
  /** Tracked changes not yet staged that this command will commit (an earlier `git add`, `commit -a`, `commit <paths>`). */
  tracked: Scope
  /** Untracked files an earlier `git add` in the same command will stage. */
  untracked: Scope
}

/**
 * `current`: the checked-out branch (`HEAD`, `@`); `upstream` too when a bare push sends it to its upstream.
 * `unknown`: a target the command names through a variable or substitution.
 */
export type PushTarget = { branch: string } | { current: true; upstream?: true } | { all: true } | { unknown: string }

export type PushAction = {
  kind: 'push'
  base: Base
  remote: string
  /** Revisions whose new commits go out (`HEAD`, `main`, `--branches`, `--tags`). */
  /** Revisions named in the command whose new commits go out (`HEAD`, `main`); never starting with '-'. */
  revs: string[]
  /** Internal rev-list flags for what goes out (`--branches`, `--tags`, `--all`); never from the command's text. */
  revFlags: string[]
  /** Branches force-pushed. */
  forced: PushTarget[]
  /** Remote refs deleted, as allow keys (`origin/feature`, `origin:prune`). */
  deletes: string[]
}

/** `unreadable`: a repos/ PATCH whose body push-guard can't read (`--input`, `-d @file`, a variable). */
export type PublicAction = { kind: 'public'; base: Base; repo?: string; how: string; unreadable?: true }
export type DeleteRepoAction = { kind: 'delete-repo'; base: Base; repo?: string; how: string }
/** `target`: `owner/name/branch`; the owner and name may be gh placeholders. */
export type DeleteRefAction = { kind: 'delete-ref'; base: Base; target: string; how: string }

/** A git or gh call push-guard can't read: a variable subcommand, brace expansion, an inline alias, a launcher. */
export type UnknownAction = { kind: 'unknown'; base: Base; how: string }
/** A git or gh subcommand that isn't a builtin: maybe an alias from git or gh config, which register looks up. */
export type AliasAction = { kind: 'git-alias' | 'gh-alias'; base: Base; sub: string; rest: string[] }

export type Action = CommitAction | PushAction | PublicAction | DeleteRepoAction | DeleteRefAction | UnknownAction | AliasAction

const REPO_OPTS = new Set(['-C', '--git-dir', '--work-tree'])

/** True when the replayed options name the repo outright (an absolute `-C` or `--git-dir`). */
function namesRepo(replay: string[]): boolean {
  for (let i = 0; i < replay.length; i++) {
    const a = replay[i] as string
    if ((a === '-C' || a === '--git-dir') && isAbsolute(replay[i + 1] ?? '')) return true
    if (a.startsWith('--git-dir=') && isAbsolute(a.slice(10))) return true
  }
  return false
}

function baseOf(v: Invocation, replay: string[] = []): Base {
  const dynamicReplay = replay.some((a, i) => isDynamic(a) && (i === 0 || REPO_OPTS.has(replay[i - 1] as string) || a.startsWith('--')))
  const unknown = dynamicReplay || (v.cwdUnknown === true && !namesRepo(replay))
  return { ...(v.cwd !== undefined && !unknown ? { cwd: v.cwd } : {}), replay, ...(unknown ? { cwdUnknown: true } : {}) }
}

function mergeScope(a: Scope, b: Scope): Scope {
  if (a === 'all' || b === 'all') return 'all'
  if (a === 'none') return b
  if (b === 'none') return a
  return [...a, ...b]
}

const ADD_VALUE_OPTS = new Set(['--chmod', '--pathspec-from-file'])

/** The paths `git add` stages: `all` for `-A`, `.`, `-u`, or no paths. */
function addScope(rest: string[]): { tracked: Scope; untracked: Scope } {
  const paths: string[] = []
  let all = false
  let updateOnly = false
  let afterDashes = false
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string
    if (!afterDashes && a === '--') {
      afterDashes = true
      continue
    }
    if (!afterDashes && a.startsWith('-')) {
      if (a === '-A' || a === '--all' || a === '--no-ignore-removal') all = true
      else if (a === '-u' || a === '--update') updateOnly = true
      else if (a.startsWith('--pathspec-from-file')) all = true
      if (ADD_VALUE_OPTS.has(a)) i++
      continue
    }
    if (a === '.' || a === '*' || a === ':/' || a === './') all = true
    else paths.push(a)
  }
  if (all || paths.length === 0) return { tracked: 'all', untracked: updateOnly ? 'none' : 'all' }
  return { tracked: paths, untracked: updateOnly ? 'none' : paths }
}

const COMMIT_VALUE_SHORT = new Set(['-m', '-F', '-C', '-c', '-t'])
const COMMIT_VALUE_LONG = new Set([
  '--message',
  '--file',
  '--reuse-message',
  '--reedit-message',
  '--author',
  '--date',
  '--template',
  '--fixup',
  '--squash',
  '--cleanup',
  '--trailer',
  '--pathspec-from-file',
])

function commitScope(rest: string[]): Scope {
  const paths: string[] = []
  let all = false
  let afterDashes = false
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string
    if (!afterDashes && a === '--') {
      afterDashes = true
      continue
    }
    if (!afterDashes && a.startsWith('--')) {
      if (a === '--all') all = true
      if (a === '--include' || a === '--only') continue
      if (COMMIT_VALUE_LONG.has(a)) i++
      continue
    }
    if (!afterDashes && a.startsWith('-') && a.length > 1) {
      // Combined short flags: `-am "msg"`, `-a`, `-m"msg"`.
      for (let k = 1; k < a.length; k++) {
        const f = a[k] as string
        if (f === 'a') all = true
        if (COMMIT_VALUE_SHORT.has(`-${f}`)) {
          if (k === a.length - 1) i++
          break
        }
      }
      continue
    }
    paths.push(a)
  }
  if (all) return 'all'
  return paths.length > 0 ? paths : 'none'
}

const PUSH_VALUE = new Set(['-o', '--push-option', '--receive-pack', '--exec', '--repo'])

function stripHeads(ref: string): string {
  return ref.replace(/^refs\/heads\//, '')
}

/** Substitutions that only print the current branch name. */
const CURRENT_BRANCH = /^(?:\$\(|`)\s*git\s+(?:branch\s+--show-current|rev-parse\s+--abbrev-ref\s+HEAD|symbolic-ref\s+(?:-q\s+)?--short\s+(?:-q\s+)?HEAD)\s*(?:\)|`)$/

/** `@` and a current-branch substitution both mean `HEAD`. */
const normRef = (r: string) => (r === '@' || CURRENT_BRANCH.test(r) ? 'HEAD' : r)

function splitRefspec(s: string): [string, string | undefined] {
  // A substitution may hold a ':' of its own; split only outside it.
  if (s.startsWith('$(') || s.startsWith('`')) {
    const close = s.startsWith('$(') ? s.lastIndexOf(')') : s.lastIndexOf('`')
    const rest = s.slice(close + 1)
    return rest.startsWith(':') ? [s.slice(0, close + 1), rest.slice(1)] : [s, undefined]
  }
  const k = s.indexOf(':')
  return k < 0 ? [s, undefined] : [s.slice(0, k), s.slice(k + 1)]
}

function pushAction(v: Invocation, replay: string[], rest: string[]): PushAction {
  let force = false
  let del = false
  let prune = false
  let mirror = false
  let all = false
  let tags = false
  let repoOpt: string | undefined
  const pos: string[] = []
  let afterDashes = false
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string
    if (afterDashes || !a.startsWith('-') || a === '-') {
      pos.push(a)
      continue
    }
    if (a === '--') {
      afterDashes = true
      continue
    }
    if (a.startsWith('--')) {
      const name = a.split('=')[0] as string
      if (name === '--force' || name === '--force-with-lease') force = true
      else if (name === '--delete') del = true
      else if (name === '--prune') prune = true
      else if (name === '--mirror') mirror = true
      else if (name === '--all' || name === '--branches') all = true
      else if (name === '--tags') tags = true
      else if (name === '--repo') repoOpt = a.includes('=') ? a.slice(7) : rest[i + 1]
      if (PUSH_VALUE.has(a)) i++
      continue
    }
    for (let k = 1; k < a.length; k++) {
      const f = a[k] as string
      if (f === 'f') force = true
      if (f === 'd') del = true
      if (f === 'o') {
        if (k === a.length - 1) i++
        break
      }
    }
  }
  const remote = repoOpt ?? pos[0] ?? 'origin'
  const refspecs = pos.slice(1)
  const forced: PushTarget[] = []
  const deletes: string[] = []
  const revs: string[] = []
  const revFlags: string[] = []
  if (mirror) {
    forced.push({ all: true })
    deletes.push(`${remote}:mirror`)
    revFlags.push('--all')
  }
  if (prune) deletes.push(`${remote}:prune`)
  if (all) revFlags.push('--branches')
  if (tags) revFlags.push('--tags')
  for (const spec of refspecs) {
    const plus = spec.startsWith('+')
    const s = plus ? spec.slice(1) : spec
    if (del) {
      deletes.push(`${remote}/${stripHeads(s)}`)
      continue
    }
    if (s === ':') {
      if (force || plus) forced.push({ all: true })
      revFlags.push('--branches')
      continue
    }
    if (s.startsWith(':')) {
      deletes.push(`${remote}/${stripHeads(s.slice(1))}`)
      continue
    }
    const [rawSrc, rawDst] = splitRefspec(s)
    const src = normRef(rawSrc)
    const target = stripHeads(rawDst ? normRef(rawDst) : src)
    if (force || plus) {
      if (target === 'HEAD') forced.push({ current: true })
      else if (isDynamic(target) || isExpanded(target)) forced.push({ unknown: target })
      else if (target.includes('*')) forced.push({ all: true })
      else forced.push({ branch: target })
    }
    // A source starting with '-' would reach git as an option: never pass it on.
    // One that can't be read is scanned as every local branch.
    if (src && !src.startsWith('-')) {
      if (isDynamic(src) || isExpanded(src)) {
        if (!revFlags.includes('--branches')) revFlags.push('--branches')
      } else revs.push(src)
    }
  }
  if (refspecs.length === 0 && !mirror && !del) {
    if (all) {
      if (force) forced.push({ all: true })
    } else if (!tags) {
      if (force) forced.push({ current: true, upstream: true })
      revs.push('HEAD')
    }
  }
  return { kind: 'push', base: baseOf(v, replay), remote, revs, revFlags, forced, deletes }
}

/** `https://github.com/o/n.git`, `git@github.com:o/n`, `o/n` -> `o/n`. */
export function repoName(text: string): string | undefined {
  const t = text.trim().replace(/\.git$/, '').replace(/\/+$/, '')
  const url = /github\.com[:/]+([^/\s]+)\/([^/\s?#]+)$/i.exec(t)
  if (url) return `${url[1]}/${url[2]}`
  if (/^[\w.-]+\/[\w.-]+$/.test(t)) return t
  if (/^[\w.-]+$/.test(t)) return t
  return undefined
}

const PRIVATE_FALSE = /(^|[^\w])private["']?\s*[=:]\s*["']?\$?false\b/i
const VIS_PUBLIC = /(^|[^\w])visibility["']?\s*[=:]\s*["']?public\b/i
const makesPublic = (texts: string[]) => texts.some(t => PRIVATE_FALSE.test(t) || VIS_PUBLIC.test(t))

const GH_VALUE = new Set(['-R', '--repo', '-d', '--description', '-h', '--homepage', '-t', '--team', '-p', '--template', '-s', '--source', '-r', '--remote', '-c', '--clone', '-l', '--license', '-g', '--gitignore', '--add-topic', '--remove-topic', '--default-branch', '--visibility'])

function ghPositional(rest: string[]): string | undefined {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] as string
    if (a.startsWith('-')) {
      if (GH_VALUE.has(a)) i++
      continue
    }
    return a
  }
  return undefined
}

function ghRepoFlag(rest: string[]): string | undefined {
  const i = rest.findIndex(a => a === '-R' || a === '--repo')
  if (i >= 0) return rest[i + 1]
  const eq = rest.find(a => a.startsWith('--repo='))
  return eq?.slice(7)
}

function apiEndpoint(url: string): string {
  return url.replace(/^https?:\/\/api\.github\.com\//i, '').replace(/^\/+/, '').split('?')[0] as string
}

const BODY_METHODS = new Set(['PATCH', 'PUT', 'POST'])

/** `unreadable`: the request has a body push-guard can't read (a file, stdin, a variable). */
function apiActions(v: Invocation, endpoint: string, method: string, data: string[], how: string, unreadable = false): Action[] {
  const ep = apiEndpoint(endpoint)
  const repo = /^repos\/([^/]+)\/([^/]+)$/.exec(ep)
  if (repo) {
    const name = `${repo[1]}/${repo[2]}`
    if (method === 'DELETE') return [{ kind: 'delete-repo', base: baseOf(v), repo: name, how }]
    if (makesPublic(data)) return [{ kind: 'public', base: baseOf(v), repo: name, how }]
    if (unreadable && BODY_METHODS.has(method)) return [{ kind: 'public', base: baseOf(v), repo: name, how, unreadable: true }]
    return []
  }
  const ref = /^repos\/([^/]+)\/([^/]+)\/git\/refs\/(.+)$/.exec(ep)
  if (ref && method === 'DELETE') return [{ kind: 'delete-ref', base: baseOf(v), target: `${ref[1]}/${ref[2]}/${stripHeads(`refs/${ref[3]}`)}`, how }]
  const create = /^(user|orgs\/([^/]+))\/repos$/.exec(ep)
  if (create && (makesPublic(data) || (unreadable && method === 'POST'))) {
    const nameField = data.map(d => /^name=(.+)$/.exec(d)?.[1] ?? /"name"\s*:\s*"([^"]+)"/.exec(d)?.[1]).find(Boolean)
    const repoLabel = nameField ? (create[2] ? `${create[2]}/${nameField}` : nameField) : 'new'
    return [{ kind: 'public', base: baseOf(v), repo: repoLabel, how, ...(makesPublic(data) ? {} : { unreadable: true as const }) }]
  }
  return []
}

function ghActions(v: Invocation): Action[] {
  const [group, verb, ...rest] = v.args
  const how = `gh ${v.args.join(' ')}`.slice(0, 120)
  if (group === 'repo' && verb === 'edit') {
    const vis = rest.findIndex(a => a === '--visibility')
    const value = vis >= 0 ? rest[vis + 1] : rest.find(a => a.startsWith('--visibility='))?.slice(13)
    if (value?.toLowerCase() !== 'public') return []
    const repo = ghPositional(rest) ?? ghRepoFlag(rest)
    return [{ kind: 'public', base: baseOf(v), ...(repo ? { repo } : {}), how }]
  }
  if (group === 'repo' && verb === 'create') {
    if (!rest.includes('--public') && !rest.some(a => /^--visibility=public$/i.test(a))) return []
    const repo = ghPositional(rest)
    return [{ kind: 'public', base: baseOf(v), repo: repo ?? 'new', how }]
  }
  if (group === 'repo' && verb === 'delete') {
    const repo = ghPositional(rest) ?? ghRepoFlag(rest)
    return [{ kind: 'delete-repo', base: baseOf(v), ...(repo ? { repo } : {}), how }]
  }
  if (group === 'api') {
    const args = v.args.slice(1)
    let method = 'GET'
    let endpoint: string | undefined
    let unreadable = false
    const data: string[] = []
    for (let i = 0; i < args.length; i++) {
      const a = args[i] as string
      if (a === '-X' || a === '--method') {
        method = (args[++i] ?? '').toUpperCase()
        continue
      }
      if (a.startsWith('--method=')) {
        method = a.slice(9).toUpperCase()
        continue
      }
      if (/^-X[A-Z]+$/.test(a)) {
        method = a.slice(2)
        continue
      }
      if (a === '--input' || a.startsWith('--input=')) {
        // The body comes from a file or stdin: push-guard can't read it.
        if (a === '--input') i++
        unreadable = true
        if (method === 'GET') method = 'POST'
        continue
      }
      if (a === '-f' || a === '-F' || a === '--field' || a === '--raw-field' || a === '-H' || a === '--header' || a === '-q' || a === '--jq' || a === '-t' || a === '--template' || a === '--hostname' || a === '--cache') {
        const val = args[++i]
        if (val !== undefined && a !== '-H' && a !== '--header') {
          data.push(val)
          // `-F key=@file` reads the value from a file; a variable can't be read either.
          if ((a === '-F' || a === '--field' || a === '-f' || a === '--raw-field') && (/^[^=]*=@/.test(val) || isDynamic(val))) unreadable = true
        }
        if ((a === '-f' || a === '-F' || a === '--field' || a === '--raw-field') && method === 'GET') method = 'POST'
        continue
      }
      if (a.startsWith('-')) continue
      if (endpoint === undefined) endpoint = a
      else data.push(a)
    }
    if (endpoint === undefined) return []
    return apiActions(v, endpoint, method, data, how, unreadable)
  }
  return []
}

function curlActions(v: Invocation): Action[] {
  const url = v.args.find(a => /api\.github\.com\//i.test(a))
  if (!url) return []
  let method = 'GET'
  let unreadable = false
  const data: string[] = []
  for (let i = 0; i < v.args.length; i++) {
    const a = v.args[i] as string
    if (a === '-X' || a === '--request') method = (v.args[++i] ?? '').toUpperCase()
    else if (/^-X[A-Z]+$/.test(a)) method = a.slice(2)
    else if (/^(-d|--data|--data-raw|--data-binary|--data-urlencode|--json)$/.test(a)) {
      const val = v.args[++i]
      if (val !== undefined) data.push(val)
      // `-d @file` / `-d @-` read the body from a file or stdin (--data-raw takes '@' literally).
      if (val === undefined || (a !== '--data-raw' && /^@|^[^=]*=@/.test(val)) || isDynamic(val)) unreadable = true
      if (method === 'GET') method = 'POST'
    } else if (a === '-T' || a === '--upload-file') {
      i++
      unreadable = true
      if (method === 'GET') method = 'PUT'
    }
  }
  return apiActions(v, url, method, data, `curl ${url}`.slice(0, 120), unreadable)
}

function psRestActions(v: Invocation): Action[] {
  // Invoke-RestMethod / Invoke-WebRequest -Uri ... -Method Delete|Patch -Body '{...}'
  const url = v.args.find(a => /api\.github\.com\//i.test(a))
  if (!url) return []
  const mi = v.args.findIndex(a => /^-method$/i.test(a))
  const method = mi >= 0 ? (v.args[mi + 1] ?? 'GET').toUpperCase() : 'GET'
  const bi = v.args.findIndex(a => /^-body$/i.test(a))
  const body = bi >= 0 ? v.args[bi + 1] : undefined
  const data = body !== undefined && !body.startsWith('-') ? [body] : []
  // A body from a variable, a subexpression `(...)` (which ends the segment here) or -InFile can't be read.
  const unreadable = (bi >= 0 && (data.length === 0 || /^[$(]/.test(body as string))) || v.args.some(a => /^-infile$/i.test(a))
  return apiActions(v, url, method, data, `${v.prog} ${url}`.slice(0, 120), unreadable)
}

const GIT_RISKY = new Set(['push', 'commit'])

/**
 * git calls that run a command push-guard can't follow: `rebase -x/--exec`, `submodule foreach`, `bisect run`,
 * `for-each-repo`, `filter-branch` (its filters), `difftool -x/--extcmd`. Refused rather than parsed.
 */
function runsCommands(sub: string, rest: string[]): boolean {
  if (sub === 'for-each-repo' || sub === 'filter-branch') return true
  if (sub === 'rebase') return rest.some(a => a.startsWith('--exec') || /^-[A-Za-z]*x/.test(a))
  if (sub === 'submodule') return rest.includes('foreach')
  if (sub === 'bisect') return rest.includes('run')
  if (sub === 'difftool') return rest.some(a => a.startsWith('--extcmd') || /^-[A-Za-z]*x/.test(a))
  return false
}

/** `-c key=value` options before the subcommand whose value git runs as a command (editor, pager, ssh...). */
const RUN_KEYS = /^(alias\.|.*(editor|pager|sshcommand|helper|external|textconv|\.cmd|program|askpass|fsmonitor|hookspath)=)/i
function runsConfig(args: string[], subAt: number): boolean {
  for (let i = 0; i < subAt; i++) {
    const a = args[i] as string
    const kv = a === '-c' || a === '--config-env' ? (args[i + 1] ?? '') : /^-c./.test(a) ? a.slice(2) : a.startsWith('--config-env=') ? a.slice(13) : undefined
    if (kv !== undefined && RUN_KEYS.test(kv.includes('=') ? kv : `${kv}=`)) return true
  }
  return false
}

/** The risky actions in a command line, in order. */
export function actions(command: string, shell: Shell, depth = 0): Action[] {
  const out: Action[] = []
  // An alias is only looked up when the git or gh call is the whole command. Anything else in the line
  // (git config, an env change, a file write) could set the alias up before it runs, after the lookup.
  const alone = invocations(command, shell).length === 1 && !/^\s*([A-Za-z_][A-Za-z0-9_]*=|\$env:)/i.test(command)
  // Scope staged by earlier `git add`s in the same command, per repository location.
  let pendingTracked: Scope = 'none'
  let pendingUntracked: Scope = 'none'
  for (const v of invocations(command, shell)) {
    if (v.prog === 'git') {
      const g = gitCall(v.args)
      if (!g) continue
      // git on Windows may run `git PUSH` as git-push.exe: compare names lowercased.
      const sub = g.sub.toLowerCase()
      const subAt = v.args.length - g.rest.length - 1
      const base = baseOf(v, g.replay)
      if (isDynamic(sub) || isExpanded(sub) || v.args.slice(0, subAt).some(a => BRACE.test(a)) || (GIT_RISKY.has(sub) && g.rest.some(a => BRACE.test(a)))) {
        out.push({ kind: 'unknown', base, how: `\`git ${v.args.slice(0, subAt + 1).join(' ')}\` uses a variable or shell expansion where push-guard needs to read the words.` })
        continue
      }
      if (runsConfig(v.args, subAt)) {
        out.push({ kind: 'unknown', base, how: `\`git ${v.args.slice(0, subAt + 1).join(' ')}\` sets a git option that runs a command (an alias, editor, pager or similar).` })
        continue
      }
      if (!BUILTINS.has(sub)) {
        if (!alone) out.push({ kind: 'unknown', base, how: `\`git ${g.sub}\` isn't a git command, and other parts of this command could set it up as an alias.` })
        else out.push({ kind: 'git-alias', base, sub: g.sub, rest: g.rest })
        continue
      }
      if (runsCommands(sub, g.rest)) {
        out.push({ kind: 'unknown', base, how: `\`git ${g.sub}\` here runs another command for you.` })
        continue
      }
      if (sub === 'add' || sub === 'stage') {
        const s = addScope(g.rest)
        pendingTracked = mergeScope(pendingTracked, s.tracked)
        pendingUntracked = mergeScope(pendingUntracked, s.untracked)
      } else if (sub === 'commit') {
        out.push({ kind: 'commit', base, tracked: mergeScope(pendingTracked, commitScope(g.rest)), untracked: pendingUntracked })
      } else if (sub === 'push') {
        out.push(pushAction(v, g.replay, g.rest))
      }
    } else if (v.prog === 'gh') {
      const [group, verb] = v.args
      if (group === undefined || group.startsWith('-')) continue
      const base = baseOf(v)
      if (isDynamic(group) || isExpanded(group) || (group === 'repo' && verb !== undefined && (isDynamic(verb) || isExpanded(verb)))) {
        out.push({ kind: 'unknown', base, how: `\`gh ${v.args.slice(0, 2).join(' ')}\` uses a variable or shell expansion where push-guard needs to read the words.` })
      } else if (!GH_CORE.has(group)) {
        if (!alone) out.push({ kind: 'unknown', base, how: `\`gh ${group}\` isn't a gh command, and other parts of this command could set it up as an alias.` })
        else out.push({ kind: 'gh-alias', base, sub: group, rest: v.args.slice(1) })
      } else out.push(...ghActions(v))
    } else if (v.prog === 'curl') {
      out.push(...curlActions(v))
    } else if (v.prog === 'invoke-restmethod' || v.prog === 'invoke-webrequest' || v.prog === 'irm' || v.prog === 'iwr') {
      out.push(...psRestActions(v))
    } else if (!NO_EXEC.has(v.prog)) {
      // xargs, find -exec, watch, parallel and the like may add words push-guard can't see (stdin, file names):
      // what they run must be a literal git or gh command that can't push, commit or change a repo.
      const at = v.args.findIndex(a => { const p = progName(a); return p === 'git' || p === 'gh' })
      if (at >= 0 && !launchedIsSafe(progName(v.args[at] as string), v.args.slice(at + 1))) {
        out.push({ kind: 'unknown', base: baseOf(v), how: `\`${v.prog}\` runs \`${progName(v.args[at] as string)} ${v.args.slice(at + 1, at + 3).join(' ')}\` for you, so push-guard can't see the words it gets.` })
      }
    }
  }
  return out
}

function launchedIsSafe(tool: string, after: string[]): boolean {
  if (tool === 'git') {
    const g = gitCall(after)
    if (!g || g.inlineAlias || runsConfig(after, after.length - g.rest.length - 1)) return false
    const sub = g.sub.toLowerCase()
    return !isDynamic(sub) && !isExpanded(sub) && BUILTINS.has(sub) && !LAUNCHED_GIT_RISKY.has(sub)
  }
  const group = after[0]
  return group !== undefined && !isDynamic(group) && !isExpanded(group) && GH_CORE.has(group) && !LAUNCHED_GH_RISKY.has(group)
}

/** Programs that print or search their words rather than run them. */
const NO_EXEC = new Set(['echo', 'printf', 'write-host', 'write-output', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'man', 'which', 'where', 'whereis', 'type', 'get-command', 'gcm', 'tldr', 'git', 'gh'])
const LAUNCHED_GIT_RISKY = new Set(['push', 'commit', 'config', 'rebase', 'submodule', 'bisect', 'for-each-repo', 'filter-branch', 'difftool', 'mergetool'])
const LAUNCHED_GH_RISKY = new Set(['repo', 'api', 'alias', 'extension'])
/** gh's own top-level commands; any other name is an alias or an extension. */
export const GH_CORE = new Set(
  ('accessibility agent-task alias api attestation auth browse cache codespace completion config copilot cs extension gist gpg-key help ' +
    'issue label org pr preview project release repo ruleset run search secret ssh-key status variable version workflow').split(' '),
)

/**
 * git's builtin subcommands. git never lets an alias shadow one, so only other names need an alias lookup.
 * A name missing here costs one `git config` call, nothing more.
 */
const BUILTINS = new Set(
  ('add am annotate apply archive bisect blame branch bundle cat-file check-attr check-ignore check-mailmap check-ref-format checkout ' +
    'checkout-index cherry cherry-pick citool clean clone column commit commit-graph commit-tree config count-objects credential describe ' +
    'diagnose diff diff-files diff-index diff-tree difftool fast-export fast-import fetch fetch-pack filter-branch for-each-ref ' +
    'for-each-repo format-patch fsck gc get-tar-commit-id grep gui hash-object help hook index-pack init instaweb interpret-trailers ' +
    'log ls-files ls-remote ls-tree mailinfo mailsplit maintenance merge merge-base merge-file merge-index merge-tree mergetool mktag ' +
    'mktree multi-pack-index mv name-rev notes pack-objects pack-refs patch-id prune prune-packed pull push range-diff read-tree rebase ' +
    'reflog remote repack replace replay rerere reset restore rev-list rev-parse revert rm send-email send-pack shortlog show show-branch ' +
    'show-index show-ref sparse-checkout stage stash status stripspace submodule switch symbolic-ref tag unpack-file unpack-objects ' +
    'update-index update-ref update-server-info var verify-commit verify-pack verify-tag version whatchanged worktree write-tree lfs').split(' '),
)

/** A glob (`*`, `**`, `?`) as a regex; a pattern with no `/` matches the base name too. */
export function globMatch(pattern: string, path: string): boolean {
  const p = pattern.trim().replace(/\\/g, '/')
  if (!p) return false
  const f = path.replace(/\\/g, '/')
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i] as string
    if (c === '*') {
      if (p[i + 1] === '*') {
        re += '.*'
        i++
        if (p[i + 1] === '/') i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  const rx = new RegExp(`^${re}$`, 'i')
  if (rx.test(f)) return true
  if (!p.includes('/')) return rx.test(f.split('/').pop() ?? f)
  return false
}
