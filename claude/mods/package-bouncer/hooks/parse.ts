// Finds package installs in a shell command. Pure: no engine calls, so tests drive it directly.

export type Ecosystem = 'npm' | 'pypi' | 'crates' | 'go' | 'rubygems' | 'packagist'
export type Shell = 'bash' | 'powershell'

/**
 * Where the package would come from. Only `registry` is looked up; `unparsed` (a word the shell would
 * expand, so the name is unknown until it runs) is refused; the rest are reported as not checked.
 */
export type SourceKind = 'registry' | 'url' | 'git' | 'path' | 'other-registry' | 'unparsed'

export type Spec = {
  ecosystem: Ecosystem
  /** The registry name (npm `@scope/name`, Go module path), as typed. */
  name: string
  /** The requested version or range, as typed; absent means "latest". */
  version?: string
  /** The argument as it appeared in the command. */
  raw: string
  source: SourceKind
}

export type ParseResult = {
  specs: Spec[]
  /** `pip install -r <file>` files, to be read and checked by the caller. */
  requirementFiles: string[]
}

const REDIRECT = '\u0000redirect'
/** Stands in for a command substitution (`$(...)` or backticks) inside a command's arguments. */
export const SUBST = '$(...)'

/** A word the shell would expand (variables, substitutions, globs, $'...' escapes): its real text is unknown here. */
export function isDynamic(word: string): boolean {
  return /[$`*?[\]{}\\]/.test(word)
}

function unparsed(ecosystem: Ecosystem, raw: string): Spec {
  return { ecosystem, name: raw, raw, source: 'unparsed' }
}

/** Splits a command into simple commands (on && || ; | & newlines, subshells and substitutions), each a list of words. */
export function splitCommands(command: string, shell: Shell): string[][] {
  const segs: string[][] = []
  let cur: string[] = []
  let word = ''
  let inWord = false
  const pendingHeredocs: { delim: string; strip: boolean }[] = []

  const flushWord = () => {
    if (inWord) cur.push(word)
    word = ''
    inWord = false
  }
  const flushSeg = () => {
    flushWord()
    if (cur.length > 0) segs.push(cur)
    cur = []
  }
  // A substitution (`$(...)`, backticks) is one word of the command around it, marked SUBST so an install
  // whose package comes from it is caught; the commands inside it are split as segments of their own.
  const substitution = (inner: string) => {
    segs.push(...splitCommands(inner, shell))
    word += SUBST
    inWord = true
  }
  /** The index of the `)` closing a `$(` whose body starts at `from`, quotes and nesting respected. */
  const closeParen = (from: number): number => {
    let depth = 1
    let q = ''
    for (let j = from; j < command.length; j++) {
      const d = command[j] as string
      if (q) {
        if (d === q) q = ''
        else if (d === '\\' && q === '"' && shell === 'bash') j++
        continue
      }
      if (d === "'" || d === '"') q = d
      else if (d === '\\' && shell === 'bash') j++
      else if (d === '(') depth++
      else if (d === ')' && --depth === 0) return j
    }
    return command.length
  }
  const n = command.length
  let i = 0
  while (i < n) {
    const c = command[i] as string

    // PowerShell here-strings: @' ... '@ and @" ... "@ at the start of a word.
    if (shell === 'powershell' && c === '@' && !inWord && (command[i + 1] === "'" || command[i + 1] === '"')) {
      const q = command[i + 1] as string
      const close = command.indexOf('\n' + q + '@', i + 2)
      const end = close < 0 ? n : close
      word += command.slice(i + 2, end).replace(/^\r?\n/, '')
      inWord = true
      i = close < 0 ? n : close + 3
      continue
    }
    if (shell === 'bash' && c === '$' && command[i + 1] === "'") {
      i++ // ANSI-C quoting $'...': read as a plain single-quoted word
      continue
    }
    if (c === "'") {
      let j = i + 1
      let text = ''
      for (;;) {
        const k = command.indexOf("'", j)
        if (k < 0) {
          text += command.slice(j)
          j = n
          break
        }
        text += command.slice(j, k)
        // PowerShell doubles a quote inside single quotes.
        if (shell === 'powershell' && command[k + 1] === "'") {
          text += "'"
          j = k + 2
          continue
        }
        j = k + 1
        break
      }
      word += text
      inWord = true
      i = j
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < n && command[j] !== '"') {
        const d = command[j] as string
        if (shell === 'bash' && d === '\\' && j + 1 < n && '"\\$`\n'.includes(command[j + 1] as string)) {
          if (command[j + 1] !== '\n') word += command[j + 1]
          j += 2
          continue
        }
        if (shell === 'powershell' && d === '`' && j + 1 < n) {
          word += command[j + 1]
          j += 2
          continue
        }
        word += d
        j++
      }
      inWord = true
      i = j + 1
      continue
    }
    if (shell === 'bash' && c === '\\' && i + 1 < n) {
      if (command[i + 1] !== '\n') {
        word += command[i + 1]
        inWord = true
      }
      i += 2
      continue
    }
    if (shell === 'powershell' && c === '`' && i + 1 < n) {
      const d = command[i + 1] as string
      if (d === '\n' || d === '\r') {
        i += d === '\r' && command[i + 2] === '\n' ? 3 : 2
        continue
      }
      word += d
      inWord = true
      i += 2
      continue
    }
    if (c === '#' && !inWord) {
      while (i < n && command[i] !== '\n') i++
      continue
    }
    if (c === '\n') {
      flushSeg()
      i++
      // Skip the bodies of heredocs opened on the line just ended.
      while (pendingHeredocs.length > 0) {
        const h = pendingHeredocs.shift() as { delim: string; strip: boolean }
        for (;;) {
          if (i >= n) break
          const eol = command.indexOf('\n', i)
          const line = command.slice(i, eol < 0 ? n : eol).replace(/\r$/, '')
          i = eol < 0 ? n : eol + 1
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break
        }
      }
      continue
    }
    if (c === '\r') {
      i++
      continue
    }
    if (shell === 'bash' && c === '`') {
      let k = i + 1
      while (k < n && command[k] !== '`') k += command[k] === '\\' ? 2 : 1
      substitution(command.slice(i + 1, Math.min(k, n)))
      i = k + 1
      continue
    }
    if (c === ';' || c === '|' || c === '(' || c === ')') {
      flushSeg()
      i++
      continue
    }
    if (c === '&') {
      if (command[i + 1] === '&') {
        flushSeg()
        i += 2
        continue
      }
      if (shell === 'bash') {
        if (command[i + 1] === '>') {
          // &> file
          flushWord()
          cur.push(REDIRECT)
          i += command[i + 2] === '>' ? 3 : 2
          continue
        }
        flushSeg()
        i++
        continue
      }
      // PowerShell: & is the call operator (or a trailing background job).
      flushWord()
      i++
      continue
    }
    if (c === '>' || c === '<') {
      // A redirection: drop a bare fd number before it and the target after it.
      if (inWord && /^\d+$/.test(word)) {
        word = ''
        inWord = false
      } else if (inWord && shell === 'powershell' && word === '*') {
        word = ''
        inWord = false
      }
      flushWord()
      if (shell === 'bash' && c === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
        // Heredoc: <<WORD, <<-WORD, <<'WORD', <<"WORD".
        let j = i + 2
        const strip = command[j] === '-'
        if (strip) j++
        while (command[j] === ' ' || command[j] === '\t') j++
        const m = /^(['"]?)([^\s'";&|<>()]+)\1/.exec(command.slice(j))
        if (m) {
          pendingHeredocs.push({ delim: m[2] as string, strip })
          i = j + m[0].length
          continue
        }
      }
      let j = i + 1
      while (j < n && (command[j] === '>' || command[j] === '<' || command[j] === '&')) j++
      // `2>&1`: the target is the fd right after.
      if (command[j - 1] === '&' && /\d/.test(command[j] ?? '')) {
        while (j < n && /\d/.test(command[j] as string)) j++
        i = j
        continue
      }
      cur.push(REDIRECT)
      i = j
      continue
    }
    if (c === '$' && command[i + 1] === '(') {
      const close = closeParen(i + 2)
      substitution(command.slice(i + 2, close))
      i = close + 1
      continue
    }
    if (c === ' ' || c === '\t') {
      flushWord()
      i++
      continue
    }
    word += c
    inWord = true
    i++
  }
  flushSeg()
  // Drop each redirection marker with its target word.
  return segs
    .map(seg => {
      const out: string[] = []
      for (let k = 0; k < seg.length; k++) {
        if (seg[k] === REDIRECT) {
          k++
          continue
        }
        out.push(seg[k] as string)
      }
      return out
    })
    .filter(seg => seg.length > 0)
}

/** `C:\x\npm.cmd` -> `npm`; `/usr/bin/pip3` -> `pip3`. */
export function exeName(word: string): string {
  const base = word.split(/[\\/]/).pop() ?? word
  return base.toLowerCase().replace(/\.(exe|cmd|bat|ps1|com)$/, '')
}

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Drops what runs a command without being it: env assignments, sudo, env, time, nohup and the like. */
function stripWrappers(words: string[], shell: Shell): string[] {
  const w = words.slice()
  for (;;) {
    const first = w[0]
    if (first === undefined) return w
    if (['{', '}', '!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until'].includes(first)) {
      w.shift()
      continue
    }
    if (shell === 'bash' && ASSIGN.test(first)) {
      w.shift()
      continue
    }
    const base = exeName(first)
    if (base === 'sudo' || base === 'doas') {
      w.shift()
      while (w[0]?.startsWith('-')) {
        const f = w.shift() as string
        if (['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T'].includes(f)) w.shift()
      }
      continue
    }
    if (base === 'env') {
      w.shift()
      while (w[0] !== undefined && (w[0].startsWith('-') || ASSIGN.test(w[0]))) {
        const f = w.shift() as string
        if (f === '-u' || f === '-C' || f === '-S') w.shift()
      }
      continue
    }
    if (['time', 'nohup', 'exec', 'command', 'builtin', 'nice', 'stdbuf', 'caffeinate'].includes(base)) {
      w.shift()
      while (w[0]?.startsWith('-')) {
        const f = w.shift() as string
        if (f === '-n') w.shift()
      }
      continue
    }
    if (base === 'timeout') {
      w.shift()
      while (w[0]?.startsWith('-')) {
        const f = w.shift() as string
        if (f === '-s' || f === '-k' || f === '--signal' || f === '--kill-after') w.shift()
      }
      w.shift() // the duration
      continue
    }
    return w
  }
}

const isPathLike = (a: string) =>
  a === '.' ||
  a === '..' ||
  /^(\.{1,2}[\\/]|[\\/]|~|[A-Za-z]:[\\/])/.test(a)

/** Walks flags and positionals: `valueFlags` take the next word unless written `--flag=value`. */
function walk(
  args: string[],
  valueFlags: readonly string[],
  onFlag?: (flag: string, value: string | undefined) => void,
): string[] {
  const positionals: string[] = []
  let afterDashDash = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (afterDashDash) {
      positionals.push(a)
      continue
    }
    if (a === '--') {
      afterDashDash = true
      continue
    }
    if (a.startsWith('-') && a.length > 1) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        onFlag?.(a.slice(0, eq), a.slice(eq + 1))
        continue
      }
      if (valueFlags.includes(a)) {
        onFlag?.(a, args[i + 1])
        i++
        continue
      }
      onFlag?.(a, undefined)
      continue
    }
    positionals.push(a)
  }
  return positionals
}

// ---- npm-style specs (npm, npx, bun, bunx, pnpm, yarn) ----

const NPM_NAME = /^(@[A-Za-z0-9~][A-Za-z0-9._~-]*\/)?[A-Za-z0-9~][A-Za-z0-9._~-]*$/

export function npmSpec(raw: string, arg = raw): Spec | undefined {
  const mk = (source: SourceKind, name = arg, version?: string): Spec => ({
    ecosystem: 'npm',
    name,
    ...(version !== undefined && version !== '' ? { version } : {}),
    raw,
    source,
  })
  if (/^https?:\/\//i.test(arg)) return mk('url')
  if (/^(git\+|git:|git@|github:|gitlab:|bitbucket:|gist:)/i.test(arg)) return mk('git')
  if (/^(file:|link:|workspace:|portal:|patch:)/i.test(arg)) return mk('path')
  if (/^jsr:/i.test(arg)) return mk('other-registry')
  if (isPathLike(arg) || /\.(tgz|tar\.gz|tar)$/i.test(arg)) return mk('path')

  // alias@npm:real@version
  const alias = /^((?:@[^/@\s]+\/)?[^/@\s]+)@npm:(.+)$/.exec(arg)
  if (alias) return npmSpec(raw, alias[2] as string)

  let name: string
  let version: string | undefined
  if (arg.startsWith('@')) {
    const m = /^(@[^/@\s]+\/[^/@\s]+)(?:@(.*))?$/.exec(arg)
    if (!m) return undefined
    name = m[1] as string
    version = m[2]
  } else {
    const m = /^([^@/\s]+)(?:@(.*))?$/.exec(arg)
    if (!m) return arg.includes('/') && !isDynamic(arg) ? mk('git') : undefined // GitHub shorthand: user/repo
    name = m[1] as string
    version = m[2]
  }
  if (!NPM_NAME.test(name) || name.length > 214) return undefined
  if (version !== undefined) {
    if (/^https?:\/\//i.test(version)) return mk('url', name)
    if (/^(file:|link:|workspace:|portal:)/i.test(version) || isPathLike(version)) return mk('path', name)
    if (/^(git\+|git:|git@|github:|gitlab:|bitbucket:|gist:)/i.test(version) || /^[^@\s]+\/[^@\s]+(#.*)?$/.test(version))
      return mk('git', name)
  }
  return mk('registry', name, version)
}

/** `npm create vite` / `npm init vite` -> create-vite; `@scope` -> @scope/create; `@scope/x` -> @scope/create-x. */
export function createPackage(arg: string): string {
  const at = arg.lastIndexOf('@')
  const [base, ver] = at > 0 ? [arg.slice(0, at), arg.slice(at)] : [arg, '']
  if (base.startsWith('@')) {
    const slash = base.indexOf('/')
    if (slash < 0) return `${base}/create${ver}`
    return `${base.slice(0, slash)}/create-${base.slice(slash + 1)}${ver}`
  }
  return `create-${base}${ver}`
}

const NPM_VALUE_FLAGS = [
  '--registry', '--tag', '--prefix', '-w', '--workspace', '--omit', '--include', '--install-strategy', '--cache',
  '--userconfig', '--save-prefix', '--before', '--loglevel', '--otp', '--scope', '-C', '--dir', '--cwd',
  '--filter', '-F', '--backend', '--cache-dir', '--concurrent-scripts', '--network-concurrency', '-c', '--config',
  '--modules-folder', '--network-timeout', '--mutex', '--linker', '--minimum-release-age',
]

function npmInstall(args: string[], flagsWithValues = NPM_VALUE_FLAGS): { specs: Spec[]; otherRegistry: boolean } {
  let otherRegistry = false
  const positionals = walk(args, flagsWithValues, f => {
    if (f === '--registry') otherRegistry = true
  })
  const specs = positionals.flatMap(p => {
    const s = npmSpec(p)
    if (!s) return isDynamic(p) ? [unparsed('npm', p)] : []
    return [otherRegistry && s.source === 'registry' ? { ...s, source: 'other-registry' as const } : s]
  })
  return { specs, otherRegistry }
}

/** npx / bunx / pnpm dlx / yarn dlx / npm exec: `-p pkg` names packages, else the first positional is one. */
function npxLike(args: string[]): Spec[] {
  const pkgs: string[] = []
  let otherRegistry = false
  const positionals: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === '--') {
      positionals.push(...args.slice(i + 1))
      break
    }
    if (a === '-p' || a === '--package') {
      if (args[i + 1] !== undefined) pkgs.push(args[i + 1] as string)
      i++
      continue
    }
    if (a.startsWith('--package=')) {
      pkgs.push(a.slice('--package='.length))
      continue
    }
    if (a === '-c' || a === '--call' || a === '--cache' || a === '--userconfig') {
      i++
      continue
    }
    if (a === '--registry') {
      otherRegistry = true
      i++
      continue
    }
    if (a.startsWith('--registry=')) {
      otherRegistry = true
      continue
    }
    if (a.startsWith('-')) continue
    positionals.push(a)
    break // everything after the command is its own arguments
  }
  const names = pkgs.length > 0 ? pkgs : positionals.slice(0, 1)
  return names.flatMap(p => {
    const s = npmSpec(p)
    if (!s) return isDynamic(p) ? [unparsed('npm', p)] : []
    return [otherRegistry && s.source === 'registry' ? { ...s, source: 'other-registry' as const } : s]
  })
}

function npmCreate(args: string[]): Spec[] {
  const positionals = walk(args, NPM_VALUE_FLAGS)
  const first = positionals[0]
  if (first === undefined) return []
  if (isDynamic(first) && !isPathLike(first)) return [unparsed('npm', first)]
  if (/[\\/]/.test(first) && !first.startsWith('@')) return [] // a template path or repo
  const s = npmSpec(first, createPackage(first))
  return s ? [{ ...s, raw: first }] : []
}

const NPM_INSTALL_SUBS = new Set([
  'install', 'i', 'add', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall',
])

function parseNpm(args: string[]): Spec[] {
  const sub = walk(args, NPM_VALUE_FLAGS)[0]
  if (sub === undefined) return []
  const rest = args.slice(args.indexOf(sub) + 1)
  if (NPM_INSTALL_SUBS.has(sub)) return npmInstall(rest).specs
  if (sub === 'exec' || sub === 'x') return npxLike(rest)
  if (sub === 'create' || sub === 'init' || sub === 'innit') return npmCreate(rest)
  return []
}

function parseBun(args: string[]): Spec[] {
  const sub = walk(args, NPM_VALUE_FLAGS)[0]
  if (sub === undefined) return []
  const rest = args.slice(args.indexOf(sub) + 1)
  if (sub === 'add' || sub === 'a' || sub === 'install' || sub === 'i') return npmInstall(rest).specs
  if (sub === 'x') return npxLike(rest)
  if (sub === 'create' || sub === 'c' || sub === 'init') return sub === 'init' ? [] : npmCreate(rest)
  return []
}

function parsePnpm(args: string[]): Spec[] {
  const sub = walk(args, NPM_VALUE_FLAGS)[0]
  if (sub === undefined) return []
  const rest = args.slice(args.indexOf(sub) + 1)
  if (sub === 'add' || sub === 'install' || sub === 'i') return npmInstall(rest).specs
  if (sub === 'dlx') return npxLike(rest)
  if (sub === 'create') return npmCreate(rest)
  return []
}

function parseYarn(args: string[]): Spec[] {
  let positionals = walk(args, NPM_VALUE_FLAGS)
  let rest = args
  if (positionals[0] === 'global') {
    rest = args.slice(args.indexOf('global') + 1)
    positionals = walk(rest, NPM_VALUE_FLAGS)
  }
  const sub = positionals[0]
  if (sub === undefined) return []
  const after = rest.slice(rest.indexOf(sub) + 1)
  if (sub === 'add') return npmInstall(after).specs
  if (sub === 'dlx') return npxLike(after)
  if (sub === 'create') return npmCreate(after)
  return []
}

// ---- Python (pip, python -m pip, uv, uvx, pipx) ----

export function normalizePypi(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-')
}

export function pypiSpec(raw: string, otherRegistry = false): Spec | undefined {
  const mk = (source: SourceKind, name = raw, version?: string): Spec => ({
    ecosystem: 'pypi',
    name,
    ...(version ? { version } : {}),
    raw,
    source,
  })
  if (/^(git\+|hg\+|svn\+|bzr\+)/i.test(raw)) return mk('git')
  if (/^(https?|file):\/\//i.test(raw)) return mk('url')
  if (isPathLike(raw) || /\.(whl|tar\.gz|zip|tar\.bz2|tgz)$/i.test(raw)) return mk('path')
  const at = /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*@\s*(\S+)/.exec(raw)
  if (at) return mk(/^git\+/i.test(at[3] as string) ? 'git' : 'url', at[1] as string)
  const m = /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)\s*(\[[^\]]*\])?\s*([^;]*)/.exec(raw)
  if (!m) return undefined
  const name = m[1] as string
  const spec = (m[3] ?? '').trim()
  if (spec !== '' && !/^[<>=!~]/.test(spec)) return undefined // not a requirement
  const exact = /^===?\s*([^,\s*]+)$/.exec(spec)
  const version = exact ? (exact[1] as string) : spec || undefined
  return mk(otherRegistry ? 'other-registry' : 'registry', name, version)
}

const PIP_VALUE_FLAGS = [
  '-c', '--constraint', '-t', '--target', '--prefix', '--root', '--platform', '--python-version', '--implementation',
  '--abi', '--no-binary', '--only-binary', '--progress-bar', '--src', '--upgrade-strategy', '-f', '--find-links',
  '--trusted-host', '--report', '--config-settings', '-C', '--global-option', '--build-option', '--python', '--log',
  '--cache-dir', '--timeout', '--retries', '--proxy', '--cert', '--client-cert', '--exists-action',
  '--keyring-provider', '--root-user-action', '--group', '--python-platform', '--resolution', '--prerelease',
  '--exclude-newer', '--link-mode', '-p', '--optional', '--package', '--script', '--rev', '--tag', '--branch',
  '--extra', '--with-requirements', '--with-editable', '--directory', '--project', '--index-strategy', '--suffix',
  '--pip-args', '--color', '--config-file', '--marker', '--bounds', '--requirements',
]
const PIP_INDEX_FLAGS = ['-i', '--index-url', '--extra-index-url', '--index', '--default-index', '--extra-index']

function pipInstall(args: string[], acc: ParseResult, fromFlags: readonly string[] = []): void {
  let otherRegistry = false
  for (const a of args) {
    if (PIP_INDEX_FLAGS.includes(a) || PIP_INDEX_FLAGS.some(f => a.startsWith(f + '='))) otherRegistry = true
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === '--') continue
    if (a.startsWith('-') && a.length > 1) {
      const [flag, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined]
      const value = inline ?? args[i + 1]
      const consumed = inline === undefined
      if (flag === '-r' || flag === '--requirement' || flag === '--requirements' || flag === '--with-requirements') {
        if (value !== undefined) acc.requirementFiles.push(value)
        if (consumed) i++
        continue
      }
      if (flag === '-e' || flag === '--editable' || flag === '--with-editable') {
        if (value !== undefined) {
          const s = pypiSpec(value)
          acc.specs.push(s && s.source !== 'registry' ? s : { ecosystem: 'pypi', name: value, raw: value, source: 'path' })
        }
        if (consumed) i++
        continue
      }
      if (fromFlags.includes(flag)) {
        if (value !== undefined) {
          const s = pypiSpec(value, otherRegistry)
          if (s) acc.specs.push(s)
          else if (isDynamic(value)) acc.specs.push(unparsed('pypi', value))
        }
        if (consumed) i++
        continue
      }
      if (PIP_INDEX_FLAGS.includes(flag) || PIP_VALUE_FLAGS.includes(flag)) {
        if (consumed) i++
        continue
      }
      // `-rfile` (short flag glued to its value)
      if (/^-r./.test(a) && !a.startsWith('--')) acc.requirementFiles.push(a.slice(2))
      continue
    }
    // PEP 508 direct reference split over words: `name @ https://...`
    if (args[i + 1] === '@' && args[i + 2] !== undefined) {
      const url = args[i + 2] as string
      acc.specs.push({ ecosystem: 'pypi', name: a, raw: `${a} @ ${url}`, source: /^git\+/i.test(url) ? 'git' : 'url' })
      i += 2
      continue
    }
    const s = pypiSpec(a, otherRegistry)
    if (s) acc.specs.push(s)
    else if (isDynamic(a)) acc.specs.push(unparsed('pypi', a))
  }
}

const PIP_GLOBAL_VALUE_FLAGS = [
  '--python', '--log', '--proxy', '--cert', '--client-cert', '--cache-dir', '--timeout', '--retries', '--exists-action',
  '--trusted-host', '--use-feature', '--use-deprecated', '--root-user-action', '--keyring-provider', '--log-file',
]

function parsePip(args: string[], acc: ParseResult): void {
  const sub = walk(args, PIP_GLOBAL_VALUE_FLAGS)[0]
  if (sub !== 'install') return
  pipInstall(args.slice(args.indexOf(sub) + 1), acc)
}

const UV_GLOBAL_VALUE_FLAGS = ['--directory', '--project', '--cache-dir', '--color', '--config-file', '--python', '-p']

function parseUv(args: string[], acc: ParseResult): void {
  const pos = walk(args, UV_GLOBAL_VALUE_FLAGS)
  const sub = pos[0]
  if (sub === undefined) return
  const rest = args.slice(args.indexOf(sub) + 1)
  if (sub === 'pip') {
    const sub2 = walk(rest, UV_GLOBAL_VALUE_FLAGS)[0]
    if (sub2 === 'install') pipInstall(rest.slice(rest.indexOf(sub2) + 1), acc)
    return
  }
  if (sub === 'add') return pipInstall(rest, acc)
  if (sub === 'run') return parseUvRun(rest, acc)
  if (sub === 'tool') {
    const sub2 = walk(rest, UV_GLOBAL_VALUE_FLAGS)[0]
    if (sub2 === 'install') pipInstall(rest.slice(rest.indexOf(sub2) + 1), acc, ['--with', '-w'])
    if (sub2 === 'run') parseUvx(rest.slice(rest.indexOf(sub2) + 1), acc)
    return
  }
}

/** uvx / uv tool run / pipx run: `--from pkg` or the first positional, plus each `--with pkg`. */
function parseUvx(args: string[], acc: ParseResult): void {
  let from: string | undefined
  const withs: string[] = []
  let otherRegistry = false
  let first: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    const [flag, inline] = a.includes('=') && a.startsWith('-') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined]
    const value = inline ?? args[i + 1]
    if (flag === '--from' || flag === '--spec') {
      from = value
      if (inline === undefined) i++
      continue
    }
    if (flag === '--with' || flag === '-w') {
      if (value !== undefined) withs.push(value)
      if (inline === undefined) i++
      continue
    }
    if (PIP_INDEX_FLAGS.includes(flag)) {
      otherRegistry = true
      if (inline === undefined) i++
      continue
    }
    if (a.startsWith('-')) {
      if (PIP_VALUE_FLAGS.includes(flag) && inline === undefined) i++
      continue
    }
    first = a
    break
  }
  for (const p of [from ?? first, ...withs]) {
    if (p === undefined) continue
    const s = pypiSpec(p, otherRegistry)
    if (s) acc.specs.push(s)
    else if (isDynamic(p)) acc.specs.push(unparsed('pypi', p))
  }
}

/** `uv run --with pkg ... cmd`: each `--with` installs a package; what follows the command is its own. */
function parseUvRun(args: string[], acc: ParseResult): void {
  const opts: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === '--') break
    if (!a.startsWith('-')) break // the command uv runs
    const flag = a.includes('=') ? a.slice(0, a.indexOf('=')) : a
    if (flag === '--with' || flag === '--with-requirements' || flag === '--with-editable') {
      opts.push(a)
      if (!a.includes('=') && args[i + 1] !== undefined) opts.push(args[++i] as string)
      continue
    }
    if (PIP_INDEX_FLAGS.includes(flag)) {
      opts.push(a)
      if (!a.includes('=') && args[i + 1] !== undefined) opts.push(args[++i] as string)
      continue
    }
    if ((PIP_VALUE_FLAGS.includes(flag) || UV_GLOBAL_VALUE_FLAGS.includes(flag)) && !a.includes('=')) i++
  }
  pipInstall(opts, acc, ['--with'])
}

function parsePipx(args: string[], acc: ParseResult): void {
  const sub = walk(args, [])[0]
  if (sub === undefined) return
  const rest = args.slice(args.indexOf(sub) + 1)
  if (sub === 'install') pipInstall(rest, acc)
  if (sub === 'run') parseUvx(rest, acc)
}

/** python -m pip ... / py -3 -m pip ... */
function parsePython(args: string[], acc: ParseResult): void {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (a === '-m') {
      const mod = args[i + 1]
      const rest = args.slice(i + 2)
      if (mod === 'pip' || mod === 'pip3') parsePip(rest, acc)
      if (mod === 'uv') parseUv(rest, acc)
      if (mod === 'pipx') parsePipx(rest, acc)
      return
    }
    if (a === '-c') return
    if (a === '-X' || a === '-W') {
      i++
      continue
    }
    if (!a.startsWith('-')) return // a script: not pip
  }
}

/** Reads a requirements file's text into specs (comments, options, URLs and paths handled). */
export function parseRequirements(text: string): { specs: Spec[]; nested: string[] } {
  const specs: Spec[] = []
  const nested: string[] = []
  const joined = text.replace(/\\\r?\n/g, ' ')
  for (const rawLine of joined.split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim()
    if (line === '') continue
    if (line.startsWith('-')) {
      const m = /^(-r|--requirement|-c|--constraint)\s*=?\s*(\S+)/.exec(line)
      if (m && (m[1] === '-r' || m[1] === '--requirement')) nested.push(m[2] as string)
      const e = /^(-e|--editable)\s*=?\s*(\S+)/.exec(line)
      if (e) {
        const s = pypiSpec(e[2] as string)
        specs.push(s && s.source !== 'registry' ? s : { ecosystem: 'pypi', name: e[2] as string, raw: e[2] as string, source: 'path' })
      }
      continue
    }
    const s = pypiSpec(line.replace(/\s+--hash=\S+/g, ''))
    if (s) specs.push(s)
  }
  return { specs, nested }
}

// ---- cargo ----

const CARGO_VALUE_FLAGS = [
  '--features', '-F', '--rename', '--registry', '--package', '-p', '--manifest-path', '--path', '--git', '--branch',
  '--tag', '--rev', '--target', '--lockfile-path', '--config', '-Z', '--color', '--version', '--vers', '--root',
  '--index', '--target-dir', '--profile', '--bin', '--example', '-j', '--jobs',
]

function parseCargo(args: string[]): Spec[] {
  const a0 = args.filter(a => !a.startsWith('+')) // toolchain: cargo +nightly ...
  const sub = walk(a0, CARGO_VALUE_FLAGS)[0]
  if (sub !== 'add' && sub !== 'install') return []
  const rest = a0.slice(a0.indexOf(sub) + 1)
  let source: SourceKind = 'registry'
  let version: string | undefined
  const positionals = walk(rest, CARGO_VALUE_FLAGS, (f, v) => {
    if (f === '--git') source = 'git'
    else if (f === '--path') source = 'path'
    else if ((f === '--registry' || f === '--index') && source === 'registry') source = 'other-registry'
    else if (f === '--version' || f === '--vers') version = v
  })
  return positionals.flatMap((p): Spec[] => {
    const m = /^([A-Za-z0-9_-]+)(?:@(.+))?$/.exec(p)
    if (!m) return isPathLike(p) ? [{ ecosystem: 'crates' as const, name: p, raw: p, source: 'path' as const }] : isDynamic(p) ? [unparsed('crates', p)] : []
    const v = m[2] ?? version
    return [{ ecosystem: 'crates' as const, name: m[1] as string, ...(v ? { version: v } : {}), raw: p, source }]
  })
}

// ---- go ----

const GO_VALUE_FLAGS = [
  '-tags', '-ldflags', '-gcflags', '-asmflags', '-o', '-modfile', '-mod', '-C', '-p', '-pkgdir', '-toolexec', '-overlay',
  '-pgo', '-buildmode', '-compiler', '-installsuffix', '-exec', '-gccgoflags', '-coverpkg', '-covermode',
  '--tags', '--ldflags', '--gcflags', '--modfile', '--mod',
]

function parseGo(args: string[]): Spec[] {
  const sub = walk(args, GO_VALUE_FLAGS)[0]
  if (sub !== 'get' && sub !== 'install') return []
  const rest = args.slice(args.indexOf(sub) + 1)
  return walk(rest, GO_VALUE_FLAGS).flatMap((p): Spec[] => {
    const at = p.indexOf('@')
    const path = at >= 0 ? p.slice(0, at) : p
    const version = at >= 0 ? p.slice(at + 1) : undefined
    if (version === 'none') return [] // a removal
    if (isDynamic(path) && !path.includes('...')) return [unparsed('go', p)]
    if (isPathLike(path) || path.includes('...')) return [{ ecosystem: 'go' as const, name: path, raw: p, source: 'path' as const }]
    const first = path.split('/')[0] ?? ''
    if (!first.includes('.')) return [] // std, cmd, all, or a module-local name
    return [{ ecosystem: 'go' as const, name: path, ...(version ? { version } : {}), raw: p, source: 'registry' as const }]
  })
}

// ---- gem ----

const GEM_VALUE_FLAGS = ['-v', '--version', '-i', '--install-dir', '-n', '--bindir', '-P', '--trust-policy', '--platform', '--document', '--build-root', '-s', '--source', '-g', '--file', '--clear-sources']

function parseGem(args: string[]): Spec[] {
  const sub = walk(args, GEM_VALUE_FLAGS)[0]
  if (sub !== 'install' && sub !== 'i') return []
  const rest = args.slice(args.indexOf(sub) + 1)
  let version: string | undefined
  let source: SourceKind = 'registry'
  const positionals = walk(rest, GEM_VALUE_FLAGS, (f, v) => {
    if (f === '-v' || f === '--version') version = v
    if (f === '-s' || f === '--source') source = 'other-registry'
  })
  return positionals.flatMap((p): Spec[] => {
    if (isPathLike(p) || /\.gem$/i.test(p)) return [{ ecosystem: 'rubygems' as const, name: p, raw: p, source: 'path' as const }]
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?::(.+))?$/.exec(p)
    if (!m) return isDynamic(p) ? [unparsed('rubygems', p)] : []
    const v = m[2] ?? version
    return [{ ecosystem: 'rubygems' as const, name: m[1] as string, ...(v ? { version: v } : {}), raw: p, source }]
  })
}

// ---- composer ----

function parseComposer(args: string[]): Spec[] {
  const values = ['-d', '--working-dir', '--update-with-dependencies']
  let pos = walk(args, values)
  let rest = args
  if (pos[0] === 'global') {
    rest = args.slice(args.indexOf('global') + 1)
    pos = walk(rest, values)
  }
  if (pos[0] !== 'require' && pos[0] !== 'req') return []
  const positionals = walk(rest.slice(rest.indexOf(pos[0]) + 1), values)
  const specs: Spec[] = []
  for (const p of positionals) {
    const m = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:[:= ]\s*(.+))?$/.exec(p)
    if (m) {
      specs.push({ ecosystem: 'packagist', name: (m[1] as string).toLowerCase(), ...(m[2] ? { version: m[2] } : {}), raw: p, source: 'registry' })
      continue
    }
    // `vendor/pkg 1.2.*`: a bare constraint belongs to the package before it.
    const prev = specs[specs.length - 1]
    if (prev && prev.version === undefined && /^[\d^~<>=*v|@ .,-]|^dev-/.test(p) && !p.includes('/')) {
      prev.version = p
      prev.raw = `${prev.raw} ${p}`
    } else if (isDynamic(p)) specs.push(unparsed('packagist', p))
    // platform packages (php, ext-*) have no slash: nothing to check
  }
  return specs
}

// ---- dispatch ----

function parseSegment(words: string[], shell: Shell, acc: ParseResult, depth: number): void {
  const w = stripWrappers(words, shell)
  const first = w[0]
  if (first === undefined) return
  const base = exeName(first)
  const args = w.slice(1)

  // Nested shells: bash -c "...", powershell -Command "...", cmd /c ...
  if (depth < 3) {
    if (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(base)) {
      const i = args.findIndex(a => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a))
      const script = i >= 0 ? args[i + 1] : undefined
      if (script !== undefined) collect(script, 'bash', acc, depth + 1)
      return
    }
    if (base === 'powershell' || base === 'pwsh') {
      const i = args.findIndex(a => /^-(c|co|com|comm|comma|comman|command)$/i.test(a))
      if (i >= 0) collect(args.slice(i + 1).join(' '), 'powershell', acc, depth + 1)
      return
    }
    if (base === 'cmd') {
      const i = args.findIndex(a => /^\/[ck]$/i.test(a))
      if (i >= 0) collect(args.slice(i + 1).join(' '), 'powershell', acc, depth + 1)
      return
    }
  }

  if (base === 'npm') acc.specs.push(...parseNpm(args))
  else if (base === 'npx') acc.specs.push(...npxLike(args))
  else if (base === 'bun') acc.specs.push(...parseBun(args))
  else if (base === 'bunx') acc.specs.push(...npxLike(args))
  else if (base === 'pnpm') acc.specs.push(...parsePnpm(args))
  else if (base === 'pnpx') acc.specs.push(...npxLike(args))
  else if (base === 'yarn') acc.specs.push(...parseYarn(args))
  else if (/^pip(\d+(\.\d+)?)?$/.test(base)) parsePip(args, acc)
  else if (/^python(\d+(\.\d+)?)?$/.test(base) || base === 'py') parsePython(args, acc)
  else if (base === 'uv') parseUv(args, acc)
  else if (base === 'uvx') parseUvx(args, acc)
  else if (base === 'pipx') parsePipx(args, acc)
  else if (base === 'cargo') acc.specs.push(...parseCargo(args))
  else if (base === 'go') acc.specs.push(...parseGo(args))
  else if (base === 'gem') acc.specs.push(...parseGem(args))
  else if (base === 'composer') acc.specs.push(...parseComposer(args))
}

function collect(command: string, shell: Shell, acc: ParseResult, depth: number): void {
  for (const seg of splitCommands(command, shell)) parseSegment(seg, shell, acc, depth)
}

/** Every package install the command would run, with duplicates folded. */
export function parseInstalls(command: string, shell: Shell): ParseResult {
  const acc: ParseResult = { specs: [], requirementFiles: [] }
  collect(command, shell, acc, 0)
  const seen = new Set<string>()
  acc.specs = acc.specs.filter(s => {
    const k = `${s.ecosystem}|${s.source}|${s.name}|${s.version ?? ''}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  return acc
}

function globElement(glob: string): RegExp {
  const body = glob
    .split('')
    .map(ch => (ch === '*' ? '[^/]*' : ch === '?' ? '[^/]' : /[\w-]/.test(ch) ? ch : `\\${ch}`))
    .join('')
  return new RegExp(`^${body}$`, 'i')
}

/** Whether a Go module path matches GOPRIVATE / GONOPROXY patterns (comma-separated globs over leading path elements). */
export function isGoPrivate(path: string, patterns: string): boolean {
  const elems = path.split('/')
  return patterns
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .some(p => {
      const pe = p.split('/')
      if (pe.length > elems.length) return false
      return pe.every((g, i) => globElement(g).test(elems[i] as string))
    })
}
