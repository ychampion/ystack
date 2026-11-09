// Splits a shell command line into the programs it runs, for bash and PowerShell.
// A guard against mistakes, not a sandbox: it reads what is written literally and does not expand
// variables, aliases, `eval` or scripts. A `$(...)` or backtick substitution stays part of its word,
// and the commands inside it are read too.

export type Shell = 'bash' | 'powershell'

export type Invocation = {
  /** The program's base name, lower case, without `.exe` / `.cmd` (`git`, `gh`, `curl`). */
  prog: string
  args: string[]
  /** The directory a preceding `cd` in the same command moved to, as written; `~` stands for home. */
  cwd?: string
  /** True when a preceding `cd` went somewhere the parser can't follow (`cd $X`, `cd -`, `cd ~user`). */
  cwdUnknown?: boolean
}

const OPERATORS_2 = ['&&', '||']

/** The index of the `)` closing the `(` at `open`, skipping quoted text; the end of `s` if none. */
function closeParen(s: string, open: number): number {
  let depth = 0
  for (let j = open; j < s.length; j++) {
    const ch = s[j]
    if (ch === "'") {
      const k = s.indexOf("'", j + 1)
      if (k < 0) return s.length
      j = k
    } else if (ch === '"') {
      j++
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1
    } else if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return j
    }
  }
  return s.length
}

/** Splits `command` into segments of words, at `&&`, `||`, `;`, `|`, `&`, newlines and parentheses. */
export function segments(command: string, shell: Shell): string[][] {
  const out: string[][] = []
  let seg: string[] = []
  let word = ''
  let inWord = false
  const endWord = () => {
    if (inWord) seg.push(word)
    word = ''
    inWord = false
  }
  const endSeg = () => {
    endWord()
    if (seg.length > 0) out.push(seg)
    seg = []
  }
  const esc = shell === 'powershell' ? '`' : '\\'
  /** A `$(...)` or bash backtick substitution at `i`: kept in the word, its own commands read first. */
  const substitution = (i: number): number | undefined => {
    let end: number
    let inner: string
    if (command[i] === '$' && command[i + 1] === '(') {
      end = closeParen(command, i + 1)
      inner = command.slice(i + 2, end)
    } else if (shell === 'bash' && command[i] === '`') {
      end = command.indexOf('`', i + 1)
      if (end < 0) end = command.length
      inner = command.slice(i + 1, end)
    } else return undefined
    inWord = true
    word += command.slice(i, end + 1)
    out.push(...segments(inner, shell))
    return end + 1
  }
  let i = 0
  while (i < command.length) {
    const c = command[i] as string
    const two = command.slice(i, i + 2)
    const sub = substitution(i)
    if (sub !== undefined) {
      i = sub
      continue
    }
    if (c === "'") {
      inWord = true
      i++
      while (i < command.length) {
        if (command[i] === "'") {
          if (shell === 'powershell' && command[i + 1] === "'") {
            word += "'"
            i += 2
            continue
          }
          break
        }
        word += command[i]
        i++
      }
      i++
      continue
    }
    if (c === '"') {
      inWord = true
      i++
      while (i < command.length && command[i] !== '"') {
        const inner = substitution(i)
        if (inner !== undefined) {
          i = inner
          continue
        }
        const d = command[i] as string
        if (d === esc && i + 1 < command.length) {
          const n = command[i + 1] as string
          if (shell === 'powershell' || '"\\$`\n'.includes(n)) {
            if (n !== '\n') word += n
            i += 2
            continue
          }
        }
        if (shell === 'powershell' && d === '"' && command[i + 1] === '"') {
          word += '"'
          i += 2
          continue
        }
        word += d
        i++
      }
      i++
      continue
    }
    if (c === esc && i + 1 < command.length) {
      const n = command[i + 1] as string
      if (n === '\n' || (n === '\r' && command[i + 2] === '\n')) {
        i += n === '\r' ? 3 : 2
        continue
      }
      inWord = true
      word += n
      i += 2
      continue
    }
    if (c === '#' && !inWord) {
      while (i < command.length && command[i] !== '\n') i++
      continue
    }
    if (OPERATORS_2.includes(two)) {
      endSeg()
      i += 2
      continue
    }
    if (c === '&') {
      // `2>&1`, `&>file` are redirections, not a separator.
      if (command[i - 1] === '>' || command[i + 1] === '>') {
        inWord = true
        word += c
        i++
        continue
      }
      endSeg()
      i++
      continue
    }
    if (c === ';' || c === '|' || c === '\n' || c === '(' || c === ')') {
      endSeg()
      i++
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
      i++
      continue
    }
    inWord = true
    word += c
    i++
  }
  endSeg()
  return out
}

/** Programs that run the rest of their words as a command, with the options of theirs that take a value. */
const WRAPPERS = new Map<string, string[]>([
  ['sudo', ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '-T', '-R', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type', '--other-user', '--close-from', '--command-timeout']],
  ['doas', ['-u', '-C']],
  ['nice', ['-n', '--adjustment']],
  ['timeout', ['-s', '--signal', '-k', '--kill-after']],
  ['env', ['-u', '--unset', '-C', '--chdir', '-S', '--split-string']],
  ['time', ['-f', '--format', '-o', '--output']],
  ['exec', ['-a']],
  ['command', []],
  ['builtin', []],
  ['nohup', []],
  ['stdbuf', []],
  ['then', []],
  ['do', []],
  ['else', []],
  ['elif', []],
  ['if', []],
  ['while', []],
  ['until', []],
  ['{', []],
  ['}', []],
  ['!', []],
  ['call', []],
  ['start-process', []],
])
const SHELLS_C = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'fish', 'git-bash'])
const SHELLS_PS = new Set(['pwsh', 'powershell'])
const CD = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location'])

/** `C:\Program Files\Git\cmd\git.exe` -> `git`. */
export function progName(word: string): string {
  const base = word.split(/[\\/]/).pop() ?? word
  return base.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')
}

/** The words of the command a segment runs, past env assignments and wrappers; empty for `command -v x`. */
function unwrap(words: string[]): string[] {
  let w = words
  for (let guard = 0; guard < 32 && w.length > 0; guard++) {
    const first = w[0] as string
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(first)) {
      w = w.slice(1)
      continue
    }
    const p = progName(first)
    const valued = WRAPPERS.get(p)
    if (valued === undefined) break
    w = w.slice(1)
    while (w.length > 0 && (w[0] as string).startsWith('-') && w[0] !== '-') {
      const o = w[0] as string
      if (o === '--') {
        w = w.slice(1)
        break
      }
      // `command -v git` only looks the program up.
      if (p === 'command' && /^-[a-zA-Z]*[vV]/.test(o)) return []
      w = w.slice(valued.includes(o) ? 2 : 1)
    }
    // timeout's duration comes before the command.
    if (p === 'timeout' && w.length > 0) w = w.slice(1)
  }
  return w
}

const isRedirect = (w: string) => /^\d*(>>?|<|&>|>&)/.test(w)

/** Absolute, or home-relative (`~`): not joined onto an earlier `cd`. */
export function isAbsolute(p: string): boolean {
  return p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p) || p.startsWith('~')
}

function joinPath(base: string | undefined, next: string): string {
  if (base === undefined || isAbsolute(next)) return next
  return `${base.replace(/[\\/]+$/, '')}/${next}`
}

/**
 * Where a `cd` goes: `~` for home (`$HOME`, `${HOME}`, `$env:USERPROFILE` too), the path as written,
 * '' for no change, or undefined when it can't be told (`-`, `~user`, any other variable or substitution).
 */
function cdTarget(target: string | undefined, shell: Shell): string | undefined {
  if (target === undefined) return shell === 'bash' ? '~' : ''
  const t = target.replace(/^(\$HOME|\$\{HOME\}|\$env:HOME|\$env:USERPROFILE)(?=$|[\\/])/i, '~')
  if (t === '-' || /[$`]/.test(t) || /^~[^\\/]/.test(t)) return undefined
  return t
}

/** Every program the command runs, in order, with the directory a preceding `cd` moved to. */
export function invocations(command: string, shell: Shell, depth = 0): Invocation[] {
  const out: Invocation[] = []
  let cwd: string | undefined
  let cwdUnknown = false
  for (const raw of segments(command, shell)) {
    // Leading env assignments and wrappers (`FOO=1 sudo -u x timeout 60 git push`).
    const words = unwrap(raw.filter((w, i) => !isRedirect(w) && !(i > 0 && isRedirect(raw[i - 1] as string) && /^\d*(>>?|<)$/.test(raw[i - 1] as string))))
    if (words.length === 0) continue
    const prog = progName(words[0] as string)
    const args = words.slice(1)
    if (CD.has(prog)) {
      const named = args.findIndex(a => /^-(path|literalpath)$/i.test(a))
      // `cd -` (the previous directory) is a target, not an option: skip only -L, -P, -e, -@ and PowerShell's named ones.
      const positional = args.find(a => a === '-' || !a.startsWith('-'))
      const target = cdTarget(named >= 0 ? args[named + 1] : positional, shell)
      if (target === undefined) cwdUnknown = true
      else if (target !== '') {
        // An absolute cd lands somewhere known again; a relative one after an unknown stays unknown.
        if (isAbsolute(target)) cwdUnknown = false
        cwd = joinPath(cwd, target)
      }
      continue
    }
    if (depth < 3 && SHELLS_C.has(prog)) {
      const ci = args.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a))
      const inner = ci >= 0 ? args[ci + 1] : undefined
      if (inner !== undefined) {
        out.push(...invocations(inner, 'bash', depth + 1).map(v => inherit(v, cwd, cwdUnknown)))
        continue
      }
    }
    if (depth < 3 && SHELLS_PS.has(prog)) {
      const ci = args.findIndex(a => /^-(c|command)$/i.test(a))
      if (ci >= 0 && args[ci + 1] !== undefined) {
        out.push(...invocations(args.slice(ci + 1).join(' '), 'powershell', depth + 1).map(v => inherit(v, cwd, cwdUnknown)))
        continue
      }
    }
    if (depth < 3 && prog === 'cmd') {
      const ci = args.findIndex(a => /^\/[ck]$/i.test(a))
      if (ci >= 0) {
        out.push(...invocations(args.slice(ci + 1).join(' '), 'bash', depth + 1).map(v => inherit(v, cwd, cwdUnknown)))
        continue
      }
    }
    out.push({ prog, args, ...(cwd !== undefined ? { cwd } : {}), ...(cwdUnknown ? { cwdUnknown } : {}) })
  }
  return out
}

function inherit(v: Invocation, cwd: string | undefined, unknown: boolean): Invocation {
  const joined = v.cwd !== undefined ? joinPath(cwd, v.cwd) : cwd
  const stillUnknown = v.cwdUnknown || (unknown && !(v.cwd !== undefined && isAbsolute(v.cwd)))
  const { cwdUnknown: _was, ...rest } = v
  return { ...rest, ...(joined !== undefined ? { cwd: joined } : {}), ...(stillUnknown ? { cwdUnknown: true } : {}) }
}

export type GitCall = {
  /** Global options to replay on our own git calls: `-C dir`, `--git-dir=..`, `--work-tree=..`. */
  replay: string[]
  sub: string
  rest: string[]
}

/** Separates git's global options from its subcommand. */
export function gitCall(args: string[]): GitCall | undefined {
  const replay: string[] = []
  let i = 0
  while (i < args.length) {
    const a = args[i] as string
    if (a === '-C' || a === '--git-dir' || a === '--work-tree') {
      if (args[i + 1] === undefined) return undefined
      replay.push(a, args[i + 1] as string)
      i += 2
      continue
    }
    if (a.startsWith('--git-dir=') || a.startsWith('--work-tree=')) {
      replay.push(a)
      i++
      continue
    }
    if (a === '-c' || a === '--namespace' || a === '--exec-path' || a === '--config-env' || a === '--super-prefix') {
      i += 2
      continue
    }
    if (a.startsWith('-')) {
      i++
      continue
    }
    return { replay, sub: a, rest: args.slice(i + 1) }
  }
  return undefined
}
