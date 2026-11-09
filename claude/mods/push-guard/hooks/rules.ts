// Turns the programs a command runs into the risky actions push-guard checks. Pure: no `$`.

import { gitCall, invocations, isAbsolute, type Invocation, type Shell } from './parse.ts'

/**
 * Where our own git calls run: the segment's `cd` and the call's `-C` / `--git-dir` / `--work-tree`.
 * `cwdUnknown`: a `cd` or `-C` the parser can't follow, so the repo can't be told.
 */
export type Base = { cwd?: string; replay: string[]; cwdUnknown?: boolean }

/** A variable or substitution: its value can't be read from the command text. */
export const isDynamic = (s: string) => /[$`]/.test(s)
/** gh's `{owner}` / `{repo}` / `{branch}` placeholders, filled from the repo the command runs in. */
export const hasPlaceholder = (s: string) => /\{(owner|repo|branch)\}/i.test(s)

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

export type Action = CommitAction | PushAction | PublicAction | DeleteRepoAction | DeleteRefAction

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
      else if (isDynamic(target)) forced.push({ unknown: target })
      else if (target.includes('*')) forced.push({ all: true })
      else forced.push({ branch: target })
    }
    // A source starting with '-' would reach git as an option: never pass it on.
    // One that can't be read is scanned as every local branch.
    if (src && !src.startsWith('-')) {
      if (isDynamic(src)) {
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

/** The risky actions in a command line, in order. */
export function actions(command: string, shell: Shell): Action[] {
  const out: Action[] = []
  // Scope staged by earlier `git add`s in the same command, per repository location.
  let pendingTracked: Scope = 'none'
  let pendingUntracked: Scope = 'none'
  for (const v of invocations(command, shell)) {
    if (v.prog === 'git') {
      const g = gitCall(v.args)
      if (!g) continue
      if (g.sub === 'add' || g.sub === 'stage') {
        const s = addScope(g.rest)
        pendingTracked = mergeScope(pendingTracked, s.tracked)
        pendingUntracked = mergeScope(pendingUntracked, s.untracked)
      } else if (g.sub === 'commit') {
        out.push({ kind: 'commit', base: baseOf(v, g.replay), tracked: mergeScope(pendingTracked, commitScope(g.rest)), untracked: pendingUntracked })
      } else if (g.sub === 'push') {
        out.push(pushAction(v, g.replay, g.rest))
      }
    } else if (v.prog === 'gh') {
      out.push(...ghActions(v))
    } else if (v.prog === 'curl') {
      out.push(...curlActions(v))
    } else if (v.prog === 'invoke-restmethod' || v.prog === 'invoke-webrequest' || v.prog === 'irm' || v.prog === 'iwr') {
      out.push(...psRestActions(v))
    }
  }
  return out
}

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
