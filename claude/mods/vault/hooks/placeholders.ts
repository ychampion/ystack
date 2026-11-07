// `{{vault:NAME}}` in a shell command becomes a reference to an environment variable the mod sets for
// that one call, so the key's value is never written into any command text. Pure: tests drive it directly.

export type Shell = 'bash' | 'powershell'

/** A key's name: a letter, then letters, digits or underscores; 64 at most. */
export const NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const PLACEHOLDER = /\{\{vault:([A-Za-z][A-Za-z0-9_]{0,63})\}\}/y
const ANY_PLACEHOLDER = /\{\{vault:([A-Za-z][A-Za-z0-9_]{0,63})\}\}/g

export const placeholder = (name: string) => `{{vault:${name}}}`

/** The names a text refers to, each once, in order. */
export function placeholderNames(text: string): string[] {
  return [...new Set([...text.matchAll(ANY_PLACEHOLDER)].map(m => m[1] as string))]
}

export type Rewrite = { command: string } | { error: string }

/** Escapes text for the inside of a PowerShell double-quoted string. */
const psDq = (s: string) => s.replace(/[`$"]/g, c => '`' + c)
/** Escapes text for the inside of a PowerShell double-quoted here-string. */
const psHereDq = (s: string) => s.replace(/[`$]/g, c => '`' + c)

/**
 * Rewrites every `{{vault:NAME}}` to a reference to `envFor(NAME)`, quoted so the shell expands it
 * wherever the placeholder stood: unquoted, in double quotes, in single quotes, in a heredoc.
 * Where no expansion can happen (a quoted heredoc), answers an error instead.
 */
export function rewriteCommand(command: string, shell: Shell, envFor: (name: string) => string): Rewrite {
  return shell === 'powershell' ? rewritePowerShell(command, envFor) : rewriteBash(command, envFor)
}

function matchAt(text: string, i: number): { name: string; length: number } | undefined {
  if (text[i] !== '{' || text[i + 1] !== '{') return undefined
  PLACEHOLDER.lastIndex = i
  const m = PLACEHOLDER.exec(text)
  return m ? { name: m[1] as string, length: m[0].length } : undefined
}

type BashMode = 'top' | 'dq' | 'sq' | 'ansi' | 'bt'

function rewriteBash(cmd: string, envFor: (name: string) => string): Rewrite {
  let out = ''
  const stack: BashMode[] = ['top']
  // Inside $( ... ) the quoting starts afresh: remember the paren depth each one opened at.
  const parenDepth: number[] = [0]
  const heredocs: { delim: string; expands: boolean; strip: boolean }[] = []
  const n = cmd.length
  let i = 0
  const mode = () => stack[stack.length - 1] as BashMode
  while (i < n) {
    const m = mode()
    const ph = matchAt(cmd, i)
    if (ph) {
      const v = envFor(ph.name)
      if (m === 'top' || m === 'bt') out += `"\${${v}}"`
      else if (m === 'dq') out += `\${${v}}`
      else if (m === 'sq') out += `'"\${${v}}"'`
      else out += `'"\${${v}}"$'` // ansi: $'...'
      i += ph.length
      continue
    }
    const c = cmd[i] as string
    if (m === 'sq') {
      out += c
      if (c === "'") stack.pop()
      i++
      continue
    }
    if (m === 'ansi') {
      if (c === '\\' && i + 1 < n) {
        out += c + cmd[i + 1]
        i += 2
        continue
      }
      out += c
      if (c === "'") stack.pop()
      i++
      continue
    }
    if (m === 'dq') {
      if (c === '\\' && i + 1 < n) {
        out += c + cmd[i + 1]
        i += 2
        continue
      }
      if (c === '"') {
        stack.pop()
        out += c
        i++
        continue
      }
      if (c === '$' && cmd[i + 1] === '(') {
        stack.push('top')
        parenDepth.push(0)
        out += '$('
        i += 2
        continue
      }
      if (c === '`') {
        stack.push('bt')
        out += c
        i++
        continue
      }
      out += c
      i++
      continue
    }
    // top or bt (a backtick substitution reads like top)
    if (c === '\\' && i + 1 < n) {
      out += c + cmd[i + 1]
      i += 2
      continue
    }
    if (c === "'") {
      stack.push('sq')
      out += c
      i++
      continue
    }
    if (c === '$' && cmd[i + 1] === "'") {
      stack.push('ansi')
      out += "$'"
      i += 2
      continue
    }
    if (c === '"') {
      stack.push('dq')
      out += c
      i++
      continue
    }
    if (c === '`') {
      if (m === 'bt') stack.pop()
      else stack.push('bt')
      out += c
      i++
      continue
    }
    if (c === '$' && cmd[i + 1] === '(') {
      stack.push('top')
      parenDepth.push(0)
      out += '$('
      i += 2
      continue
    }
    if (c === '(') {
      parenDepth[parenDepth.length - 1] = (parenDepth[parenDepth.length - 1] ?? 0) + 1
      out += c
      i++
      continue
    }
    if (c === ')') {
      const depth = parenDepth[parenDepth.length - 1] ?? 0
      if (depth > 0) parenDepth[parenDepth.length - 1] = depth - 1
      else if (stack.length > 1) {
        stack.pop()
        parenDepth.pop()
      }
      out += c
      i++
      continue
    }
    if (c === '<' && cmd[i + 1] === '<' && cmd[i + 2] === '<') {
      out += '<<<' // a here-string: the word after it is an ordinary word
      i += 3
      continue
    }
    if (c === '<' && cmd[i + 1] === '<') {
      let j = i + 2
      const strip = cmd[j] === '-'
      if (strip) j++
      while (cmd[j] === ' ' || cmd[j] === '\t') j++
      const hm = /^(['"]?)([^\s'";&|<>()]+)\1/.exec(cmd.slice(j))
      if (hm) {
        heredocs.push({ delim: hm[2] as string, expands: hm[1] === '', strip })
        out += cmd.slice(i, j + hm[0].length)
        i = j + hm[0].length
        continue
      }
    }
    if (c === '\n' && heredocs.length > 0) {
      out += c
      i++
      while (heredocs.length > 0) {
        const h = heredocs.shift() as { delim: string; expands: boolean; strip: boolean }
        while (i < n) {
          const eol = cmd.indexOf('\n', i)
          const end = eol < 0 ? n : eol
          const line = cmd.slice(i, end)
          const bare = line.replace(/\r$/, '')
          if ((h.strip ? bare.replace(/^\t+/, '') : bare) === h.delim) {
            out += line + (eol < 0 ? '' : '\n')
            i = eol < 0 ? n : eol + 1
            break
          }
          if (!h.expands && /\{\{vault:/.test(line)) {
            return {
              error:
                `A key can't be used inside a quoted heredoc (<<'${h.delim}'): the shell does not expand anything there. ` +
                `Use an unquoted heredoc (<<${h.delim}) or put {{vault:NAME}} on the command line.`,
            }
          }
          out += h.expands ? line.replace(ANY_PLACEHOLDER, (_m, name: string) => `\${${envFor(name)}}`) : line
          out += eol < 0 ? '' : '\n'
          i = eol < 0 ? n : eol + 1
        }
      }
      continue
    }
    out += c
    i++
  }
  return { command: out }
}

function rewritePowerShell(cmd: string, envFor: (name: string) => string): Rewrite {
  const ref = (name: string) => `\${env:${envFor(name)}}`
  let out = ''
  const n = cmd.length
  let i = 0
  let inDq = false
  while (i < n) {
    const ph = matchAt(cmd, i)
    if (ph) {
      out += ref(ph.name)
      i += ph.length
      continue
    }
    const c = cmd[i] as string
    if (c === '`' && i + 1 < n) {
      out += c + cmd[i + 1]
      i += 2
      continue
    }
    if (inDq) {
      if (c === '"' && cmd[i + 1] === '"') {
        out += '""'
        i += 2
        continue
      }
      if (c === '"') inDq = false
      out += c
      i++
      continue
    }
    // Here-strings: @' ... '@ (literal) and @" ... "@ (expanding), the closer at a line's start.
    if (c === '@' && (cmd[i + 1] === "'" || cmd[i + 1] === '"') && /^\r?\n/.test(cmd.slice(i + 2))) {
      const q = cmd[i + 1] as string
      const close = cmd.indexOf(`\n${q}@`, i + 2)
      const bodyEnd = close < 0 ? n : close + 1
      const body = cmd.slice(i + 2, bodyEnd)
      const tail = close < 0 ? '' : `${q}@`
      if (q === '"') {
        out += '@"' + body.replace(ANY_PLACEHOLDER, (_m, name: string) => ref(name)) + tail
      } else if (placeholderNames(body).length > 0) {
        // A literal here-string never expands: make it an expanding one, everything else escaped.
        out += '@"' + replaceOutside(body, psHereDq, ref) + (close < 0 ? '' : '"@')
      } else {
        out += "@'" + body + tail
      }
      i = close < 0 ? n : close + 3
      continue
    }
    if (c === "'") {
      // Find the closing quote ('' is an escaped quote).
      let j = i + 1
      let text = ''
      for (;;) {
        const k = cmd.indexOf("'", j)
        if (k < 0) {
          text += cmd.slice(j)
          j = n
          break
        }
        text += cmd.slice(j, k)
        if (cmd[k + 1] === "'") {
          text += "'"
          j = k + 2
          continue
        }
        j = k + 1
        break
      }
      if (placeholderNames(text).length > 0) {
        // A single-quoted string never expands: rewrite it as the double-quoted string with the same text.
        out += '"' + replaceOutside(text, psDq, ref) + '"'
      } else {
        out += cmd.slice(i, j)
      }
      i = j
      continue
    }
    if (c === '"') inDq = true
    out += c
    i++
  }
  return { command: out }
}

/** Escapes the text around each placeholder and replaces the placeholders with references. */
function replaceOutside(text: string, escape: (s: string) => string, ref: (name: string) => string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(ANY_PLACEHOLDER)) {
    out += escape(text.slice(last, m.index)) + ref(m[1] as string)
    last = (m.index as number) + m[0].length
  }
  return out + escape(text.slice(last))
}
