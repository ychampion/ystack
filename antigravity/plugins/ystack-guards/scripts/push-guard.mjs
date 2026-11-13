#!/usr/bin/env node
// push-guard for Antigravity (PreToolUse on run_command). Port of ystack's Claude Code push-guard rules:
//   - a `git push` whose outgoing commits (those no remote has yet) add something that looks like a key;
//   - making a GitHub repo public (`gh repo edit --visibility public`, `gh repo create --public`, and
//     `gh api` / curl / Invoke-RestMethod calls that set private=false or visibility=public);
//   - a force-push onto main or master.
// Everything else is allowed. A stop names the file, line and kind of key, never the value.
// Any internal error or overrun lets the command through and logs to stderr: a guard must never wedge the agent.

import { spawnSync } from 'node:child_process'

import { ALLOW, argsOf, commandCwd, commandsIn, isDynamic, isMain, log, runHook } from './lib.mjs'

const GUARD = 'push-guard'
export const PROTECTED_BRANCHES = ['main', 'master']

// ---- key patterns (same as the Claude Code push-guard) ----

const PATTERNS = [
  { kind: 'private key block', re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED |SSH2 )?PRIVATE KEY(?: BLOCK)?-----/ },
  { kind: 'AWS access key ID', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/ },
  { kind: 'AWS secret access key', re: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}\b/i },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { kind: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { kind: 'Anthropic API key', re: /\bsk-ant-(?:api|admin|oat)\d{2}-[A-Za-z0-9_-]{20,}/ },
  // Bounded quantifiers only: each start costs at most a few hundred steps, so a long line scans in linear time.
  { kind: 'OpenAI API key', re: /\bsk-(?!ant-)[A-Za-z0-9_-]{20,200}T3BlbkFJ[A-Za-z0-9_-]{20}|\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40}|\bsk-[A-Za-z0-9]{48}(?![A-Za-z0-9])/ },
  { kind: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { kind: 'Slack webhook URL', re: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9]{16,}/ },
  { kind: 'Stripe secret key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'Google OAuth client secret', re: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/ },
]

const WINDOW = 4096
const OVERLAP = 512

/** The kinds of key on one line of text (never the values). */
export function kindsIn(text) {
  const found = new Set()
  for (let start = 0; ; start += WINDOW - OVERLAP) {
    const piece = text.length <= WINDOW ? text : text.slice(start, start + WINDOW)
    for (const p of PATTERNS) if (!found.has(p.kind) && p.re.test(piece)) found.add(p.kind)
    if (start + WINDOW >= text.length) break
  }
  return PATTERNS.filter(p => found.has(p.kind)).map(p => p.kind)
}

/** `.env`, `.env.local`, `prod.env`; not example, sample, template, test or development files. */
export function isEnvFile(file) {
  const base = (file.replace(/\\/g, '/').split('/').pop() ?? file).toLowerCase()
  if (/\.(example|sample|template|dist|defaults?|test|testing|development|dev)$/.test(base) || /\.(example|sample|template)\./.test(base)) return false
  return base === '.env' || base.startsWith('.env.') || base.endsWith('.env')
}

function unquote(p) {
  const s = p.trim()
  return s.startsWith('"') && s.endsWith('"') && s.length > 1 ? s.slice(1, -1).replace(/\\(.)/g, '$1') : s
}

function headerPaths(rest) {
  let a
  let b
  if (rest.startsWith('"')) {
    const m = /^("(?:[^"\\]|\\.)*") (.+)$/.exec(rest)
    if (!m) return undefined
    a = unquote(m[1])
    b = unquote(m[2])
  } else if (rest.endsWith('"')) {
    const k = rest.lastIndexOf(' "')
    if (k < 0) return undefined
    a = rest.slice(0, k)
    b = unquote(rest.slice(k + 1))
  } else {
    const mid = (rest.length - 1) / 2
    if (Number.isInteger(mid) && rest[mid] === ' ') {
      a = rest.slice(0, mid)
      b = rest.slice(mid + 1)
    } else {
      const k = rest.lastIndexOf(' ')
      if (k < 0) return undefined
      a = rest.slice(0, k)
      b = rest.slice(k + 1)
    }
  }
  const pa = /^[a-z]\//.exec(a)?.[0]
  const pb = /^[a-z]\//.exec(b)?.[0]
  if (pa && pb) return { file: b.slice(2), prefix: pb }
  return { file: b, prefix: '' }
}

export const COMMIT_MARK = '\u0001pg-commit '

/** Scans `git log -p` text: only added lines, and any added or changed `.env` file. */
export function scanDiff(diff) {
  const found = []
  let file
  let line = 0
  let commit
  let envFlagged = false
  let deleted = false
  let prefix = ''
  let oldLeft = 0
  let newLeft = 0
  const flagEnv = () => {
    if (file && !deleted && !envFlagged && isEnvFile(file)) {
      envFlagged = true
      found.push({ file, kind: '.env file', ...(commit ? { commit } : {}) })
    }
  }
  for (const raw of diff.split('\n')) {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (oldLeft > 0 || newLeft > 0) {
      if (l.startsWith('+') && newLeft > 0) {
        newLeft--
        if (file !== undefined) {
          flagEnv()
          for (const kind of kindsIn(l.slice(1))) found.push({ file, line, kind, ...(commit ? { commit } : {}) })
        }
        line++
        continue
      }
      if (l.startsWith('-') && oldLeft > 0) {
        oldLeft--
        continue
      }
      if (l.startsWith(' ')) {
        oldLeft--
        newLeft--
        line++
        continue
      }
      if (l.startsWith('\\')) continue
      oldLeft = 0
      newLeft = 0
    }
    if (l.startsWith(COMMIT_MARK)) {
      commit = l.slice(COMMIT_MARK.length).trim()
      file = undefined
      continue
    }
    if (l.startsWith('diff --git ')) {
      const h = headerPaths(l.slice(11))
      file = h?.file
      prefix = h?.prefix ?? ''
      envFlagged = false
      deleted = false
      continue
    }
    if (l.startsWith('deleted file mode')) {
      deleted = true
      continue
    }
    if (l.startsWith('new file mode')) {
      flagEnv()
      continue
    }
    if (l.startsWith('+++ ')) {
      const p = l.slice(4)
      if (p === '/dev/null') deleted = true
      else {
        const u = unquote(p)
        file = prefix && u.startsWith(prefix) ? u.slice(prefix.length) : u
      }
      continue
    }
    if (l.startsWith('--- ')) continue
    const hunk = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l)
    if (hunk) {
      oldLeft = hunk[1] === undefined ? 1 : Number(hunk[1])
      line = Number(hunk[2])
      newLeft = hunk[3] === undefined ? 1 : Number(hunk[3])
    }
  }
  return found
}

export function describe(findings, max = 10) {
  const seen = new Set()
  const lines = []
  for (const f of findings) {
    const where = `${f.file}${f.line ? ` line ${f.line}` : ''}${f.commit ? ` (commit ${f.commit})` : ''}`
    const key = `${where}|${f.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(`- ${where}: ${f.kind}`)
  }
  const more = lines.length > max ? `\n- ...and ${lines.length - max} more` : ''
  return lines.slice(0, max).join('\n') + more
}

// ---- git ----

const SAFE = ['-c', 'core.fsmonitor=', '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '-c', 'log.showSignature=false', '-c', 'diff.external=', '-c', 'core.pager=cat', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.noprefix=false', '-c', 'core.quotePath=true']
const MAX_OUT = 4 * 1024 * 1024

/** Runs git with hooks, fsmonitor, external diff and pager off. `cut`: the output hit the 4 MB cap. */
export function git(cwd, args) {
  const r = spawnSync('git', [...SAFE, ...args], { cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: MAX_OUT, windowsHide: true })
  const cut = r.error?.code === 'ENOBUFS'
  return { ok: (r.status === 0 && !r.error) || cut, out: r.stdout ?? '', err: String(r.stderr || r.error?.message || '').trim().slice(0, 200), cut }
}

// ---- parsing ----

const PUSH_LONG = ['all', 'branches', 'mirror', 'delete', 'tags', 'dry-run', 'porcelain', 'force', 'force-with-lease', 'no-force-with-lease',
  'force-if-includes', 'no-force-if-includes', 'recurse-submodules', 'no-recurse-submodules', 'atomic', 'no-atomic', 'push-option',
  'receive-pack', 'exec', 'repo', 'set-upstream', 'thin', 'no-thin', 'quiet', 'verbose', 'progress', 'no-progress', 'verify', 'no-verify',
  'follow-tags', 'no-follow-tags', 'signed', 'no-signed', 'ipv4', 'ipv6', 'prune', 'no-prune']
/** git accepts any unambiguous prefix of a long option; every option the prefix could mean counts. */
const longNames = name => {
  const n = name.replace(/^--/, '')
  return PUSH_LONG.includes(n) ? [n] : PUSH_LONG.filter(o => o.startsWith(n))
}
const stripHeads = r => r.replace(/^refs\/heads\//, '')
const normRef = r => (r === '@' ? 'HEAD' : r)

/**
 * `git push` arguments -> what goes out and what is force-pushed. `forced` holds
 * `{branch}`, `{current, upstream?}`, `{all}` or `{unknown}` targets.
 */
export function parsePush(rest) {
  let force = false
  let del = false
  let mirror = false
  let all = false
  let tags = false
  const pos = []
  let afterDashes = false
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (afterDashes || !a.startsWith('-') || a === '-') {
      pos.push(a)
      continue
    }
    if (a === '--') {
      afterDashes = true
      continue
    }
    if (a.startsWith('--')) {
      const names = longNames(a.split('=')[0])
      const means = o => names.includes(o)
      if (means('force') || means('force-with-lease')) force = true
      if (means('delete')) del = true
      if (means('mirror')) mirror = true
      if (means('all') || means('branches')) all = true
      if (means('tags')) tags = true
      if (names.length === 1 && ['push-option', 'receive-pack', 'exec', 'repo'].includes(names[0]) && !a.includes('=')) i++
      continue
    }
    for (let k = 1; k < a.length; k++) {
      const f = a[k]
      if (f === 'f') force = true
      if (f === 'd') del = true
      if (f === 'o') {
        if (k === a.length - 1) i++
        break
      }
    }
  }
  const refspecs = pos.slice(1)
  const forced = []
  const revs = []
  const revFlags = []
  if (mirror) {
    forced.push({ all: true })
    revFlags.push('--all')
  }
  if (all) revFlags.push('--branches')
  if (tags) revFlags.push('--tags')
  for (const spec of refspecs) {
    if (del) continue
    const plus = spec.startsWith('+')
    const s = plus ? spec.slice(1) : spec
    if (s === ':') {
      if (force || plus) forced.push({ all: true })
      revFlags.push('--branches')
      continue
    }
    if (s.startsWith(':')) continue // deleting a remote branch
    const k = s.indexOf(':')
    const src = normRef(k < 0 ? s : s.slice(0, k))
    const target = stripHeads(k < 0 ? src : normRef(s.slice(k + 1)))
    if (force || plus) {
      if (target === 'HEAD') forced.push({ current: true })
      else if (isDynamic(target) && !target.includes('*')) forced.push({ unknown: target })
      else if (target.includes('*')) forced.push({ all: true })
      else forced.push({ branch: target })
    }
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
  return { remote: pos[0] ?? 'origin', revs, revFlags, forced }
}

const GIT_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix', '--config-env'])

/** `git [globals] <sub> args`: the subcommand, its args, and the globals that pick the repo (-C, --git-dir, --work-tree). */
export function gitCall(words) {
  const replay = []
  let i = 1
  for (; i < words.length; i++) {
    const a = words[i]
    if (!a.startsWith('-')) break
    if (GIT_VALUE.has(a)) {
      if (a === '-C' || a === '--git-dir' || a === '--work-tree') replay.push(a, words[i + 1] ?? '')
      i++
      continue
    }
    if (/^--(git-dir|work-tree)=/.test(a)) replay.push(a)
  }
  return { sub: words[i], rest: words.slice(i + 1), replay }
}

const PRIVATE_FALSE = /(^|[^\w])private["']?\s*[=:]\s*["']?\$?false\b/i
const VIS_PUBLIC = /(^|[^\w])visibility["']?\s*[=:]\s*["']?public\b/i
export const makesPublic = texts => texts.some(t => PRIVATE_FALSE.test(t) || VIS_PUBLIC.test(t))

/** A `gh ...` call that makes a repo public: a short description of it, else undefined. */
export function ghPublic(words) {
  let i = 1
  while (i < words.length && words[i].startsWith('-')) i += words[i] === '-R' || words[i] === '--repo' ? 2 : 1
  const [group, verb] = [words[i], words[i + 1]]
  const rest = words.slice(i + 2)
  if (group === 'repo' && verb === 'edit') {
    const k = rest.indexOf('--visibility')
    const value = k >= 0 ? rest[k + 1] : rest.find(a => a.startsWith('--visibility='))?.slice(13)
    if (value?.toLowerCase() === 'public') return describeRepo('edit', rest)
  }
  if (group === 'repo' && verb === 'create') {
    if (rest.includes('--public') || rest.some(a => /^--visibility=public$/i.test(a))) return describeRepo('create', rest)
  }
  if (group === 'api') {
    const endpoint = rest.length ? words.slice(i + 1).find(a => !a.startsWith('-') && /repos/.test(a)) : undefined
    const args = words.slice(i + 1)
    if ((endpoint || args.some(a => /repos/.test(a))) && makesPublic(args)) return `a GitHub API call (${(endpoint ?? 'repos').slice(0, 80)})`
  }
  return undefined
}

function describeRepo(how, rest) {
  const VALUE = new Set(['-R', '--repo', '-d', '--description', '-h', '--homepage', '-t', '--team', '-p', '--template', '-s', '--source', '-r', '--remote', '-c', '--clone', '-l', '--license', '-g', '--gitignore', '--add-topic', '--remove-topic', '--default-branch', '--visibility'])
  let name
  for (let k = 0; k < rest.length; k++) {
    const a = rest[k]
    if (VALUE.has(a)) {
      if ((a === '-R' || a === '--repo') && !name) name = rest[k + 1]
      k++
      continue
    }
    if (!a.startsWith('-') && !name) name = a
  }
  if (how === 'create') return name ? `a new public repository (${name})` : 'a new public repository'
  return name ? `the repository ${name}` : 'this repository'
}

/** curl / Invoke-RestMethod / Invoke-WebRequest to a GitHub repos endpoint with a body making it public. */
export function httpPublic(words) {
  const text = words.join(' ')
  if (!/api\.github\.com\/(repos|user\/repos|orgs\/[^/\s]+\/repos)/i.test(text)) return undefined
  return makesPublic(words) || makesPublic([text]) ? 'a GitHub API request' : undefined
}

// ---- the check ----

const SECRET_HELP =
  'Take the key out of the file (read it from an environment variable or a secret store instead) and commit the fix. ' +
  'If it is already in a commit, amend or rebase that commit to remove it before pushing (removing it in a new commit still pushes it), and tell the user so they can rotate the key. ' +
  'If this is a false alarm (a test fixture, a documented fake), tell the user; they can push it themselves.'

const HTTP = new Set(['curl', 'invoke-restmethod', 'invoke-webrequest', 'irm', 'iwr'])

/** The reasons to stop this command line (empty: let it run). `notes` collects what couldn't be checked. */
export function check(command, cwd, notes = []) {
  const why = []
  for (const c of commandsIn(command, cwd)) {
    if (c.prog === 'gh') {
      const what = ghPublic(c.words)
      if (what) {
        why.push(
          `This would make ${what} public: anyone could read its code and history. Do not try another way. ` +
            'Ask the user; if they want it, they change the visibility themselves, outside the agent.',
        )
      }
      continue
    }
    if (HTTP.has(c.prog)) {
      const what = httpPublic(c.words)
      if (what) why.push(`This sends ${what} that would make a repository public. Ask the user; if they want it, they do it themselves, outside the agent.`)
      continue
    }
    if (c.prog !== 'git') continue
    const g = gitCall(c.words)
    if (g.sub !== 'push') continue
    if (c.cwdUnknown) {
      notes.push("couldn't tell which folder this push runs in, so it was not checked")
      continue
    }
    const p = parsePush(g.rest)
    const run = args => git(c.cwd, [...g.replay, ...args])
    const isProtected = b => PROTECTED_BRANCHES.includes(b)
    const hits = []
    const add = h => hits.includes(h) || hits.push(h)
    for (const t of p.forced) {
      if (t.all) add(`every branch (including ${PROTECTED_BRANCHES.join(', ')})`)
      else if (t.branch !== undefined) {
        if (isProtected(t.branch)) add(t.branch)
      } else if (t.unknown !== undefined) add(`${t.unknown} (couldn't tell which branch that is, so it counts as protected)`)
      else {
        const r = run(['rev-parse', '--abbrev-ref', 'HEAD'])
        const b = r.out.trim()
        if (!r.ok || !b || b === 'HEAD') add("the current branch (couldn't tell which branch that is)")
        else if (isProtected(b)) add(b)
        if (t.upstream) {
          const u = run(['rev-parse', '--symbolic-full-name', '@{u}'])
          const up = u.out.trim().replace(/^refs\/remotes\/[^/]+\//, '').replace(/^refs\/heads\//, '')
          if (u.ok && up && isProtected(up)) add(up)
        }
      }
    }
    if (hits.length > 0) {
      why.push(
        `This force-pushes to a protected branch: ${hits.join(', ')}. That rewrites history other people and machines rely on. ` +
          `Push your work to a new branch instead (\`git push -u ${p.remote} HEAD:<new-branch>\`) and open a pull request. If the user really wants to rewrite it, they run the command themselves.`,
      )
      continue
    }
    if (p.revs.length === 0 && p.revFlags.length === 0) continue
    // `--not --remotes --not`: skip what any remote already has, then make the named revisions positive again.
    const log = run(['log', '-p', '--no-color', '--no-ext-diff', '--no-textconv', '-U0', `--format=%x01${COMMIT_MARK.slice(1)}%h`, '--max-count=1000', ...p.revFlags, '--not', '--remotes', '--not', '--end-of-options', ...p.revs])
    if (!log.ok) {
      notes.push(`couldn't read the commits being pushed (${log.err || 'git failed'})`)
      continue
    }
    if (log.cut) notes.push('checked only the first 4 MB of the commits being pushed')
    const found = scanDiff(log.out)
    if (found.length > 0) why.push(`The commits being pushed contain what looks like a secret (values not shown):\n${describe(found)}\n${SECRET_HELP}`)
  }
  return [...new Set(why)]
}

/** The hook: PreToolUse input -> decision. */
export function decide(input) {
  const tc = input?.toolCall
  if (!tc || tc.name !== 'run_command') return ALLOW
  const args = argsOf(tc)
  const command = typeof args.CommandLine === 'string' ? args.CommandLine : ''
  if (!/\b(git|gh|curl|invoke-restmethod|invoke-webrequest|irm|iwr)\b/i.test(command)) return ALLOW
  const notes = []
  const why = check(command, commandCwd(input, args), notes)
  for (const n of notes) log(GUARD, n)
  if (why.length > 0) return { decision: 'deny', reason: `push-guard stopped this command.\n\n${why.join('\n\n')}` }
  return ALLOW
}

if (isMain(import.meta.url)) await runHook(GUARD, decide, { pass: ALLOW })
