// Shared plumbing for the ystack guards: read the hook's JSON from stdin, answer on stdout, never wedge
// the agent (any crash or overrun answers "allow" / lets the agent stop, and logs to stderr), and a
// small shell splitter good enough to find the programs a command line runs.
//
// Antigravity treats a PreToolUse answer with no decision as a deny, so every path writes a decision.
// "allow" is "no objection": it does not override the user's own permission settings.
//
// The same scripts serve Devin (the Devin CLI and Devin Desktop), whose hooks.json starts them with
// `--host devin`. Devin sends Claude-style input (`tool_name`, `tool_input`) and reads Claude-style answers;
// the guards keep deciding in Antigravity's terms and `toDevin` translates the answer.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The host that started this script: `devin` when run with `--host devin`, else `antigravity`. */
export const HOST = process.argv.includes('--host') && process.argv[process.argv.indexOf('--host') + 1] === 'devin' ? 'devin' : 'antigravity'

/**
 * An Antigravity-style answer in Devin's terms. "allow" and "let it stop" are an empty answer (no
 * objection; Devin's own permission settings still apply). A deny, or a Stop hook sending the agent back,
 * is `decision: "block"` with the reason shown to the agent. "ask" is Claude's `permissionDecision: "ask"`.
 */
export function toDevin(ans, event) {
  if (!ans || typeof ans !== 'object') return {}
  if (ans.decision === 'deny' || ans.decision === 'continue') return { decision: 'block', reason: ans.reason ?? '' }
  if (ans.decision === 'ask') {
    return { hookSpecificOutput: { hookEventName: event || 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: ans.reason ?? '' } }
  }
  return {}
}

/**
 * True when this module is the script node was started with (not imported by a test). Compares real paths:
 * when the plugin folder is reached through a symlink (Devin's plugin cache links to it; setup links it on
 * macOS and Linux), argv[1] keeps the link's path while import.meta.url is the resolved one.
 */
export function isMain(metaUrl) {
  if (process.argv[1] === undefined) return false
  const started = path.resolve(process.argv[1])
  let main
  try {
    main = fs.realpathSync(started) === fs.realpathSync(fileURLToPath(metaUrl))
  } catch {
    main = metaUrl === pathToFileURL(started).href
  }
  // A hook host always passes `--host`; if a guard it started still thinks it was imported, it would answer
  // nothing (which hosts read as "allow"), so say so where the host's log can show it.
  if (!main && process.argv.includes('--host') && path.basename(started) === path.basename(fileURLToPath(metaUrl))) {
    log(path.basename(started), `started as ${started} but did not recognise itself as the main script; it will not answer`)
  }
  return main
}

export function log(guard, msg) {
  try {
    process.stderr.write(`[ystack-guards ${guard}] ${msg}\n`)
  } catch {}
}

function readStdin(ms) {
  return new Promise(resolve => {
    let s = ''
    const t = setTimeout(() => resolve(s), ms)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', d => (s += d))
    process.stdin.on('end', () => {
      clearTimeout(t)
      resolve(s)
    })
    process.stdin.on('error', () => {
      clearTimeout(t)
      resolve(s)
    })
  })
}

/**
 * Runs a hook: `handler(input)` returns the answer object. `pass` is the answer when anything goes wrong
 * or `budgetMs` runs out (Antigravity's own timeout is 30 s by default; we answer well before it).
 */
export async function runHook(guard, handler, { pass, budgetMs = 20_000, host = HOST } = {}) {
  let done = false
  let event
  const answer = obj => {
    if (done) return
    done = true
    try {
      process.stdout.write(JSON.stringify(host === 'devin' ? toDevin(obj, event) : obj))
    } catch {}
    // Pending sockets or child processes must not keep the hook alive past its answer.
    setTimeout(() => process.exit(0), 50).unref?.()
  }
  const timer = setTimeout(() => {
    log(guard, `no answer within ${budgetMs} ms; letting it through`)
    answer(pass)
  }, budgetMs)
  try {
    const raw = await readStdin(5_000)
    const input = raw.trim() ? JSON.parse(raw) : {}
    event = input?.hook_event_name
    const out = await handler(input)
    answer(out ?? pass)
  } catch (err) {
    log(guard, `internal error, letting it through: ${err && err.stack ? err.stack : String(err)}`)
    answer(pass)
  } finally {
    clearTimeout(timer)
  }
}

export const ALLOW = Object.freeze({ decision: 'allow' })

/** Tool-call args, tolerant of the older transcript form where every value is itself JSON text. */
export function argsOf(toolCall) {
  const a = toolCall && typeof toolCall.args === 'object' && toolCall.args !== null ? toolCall.args : {}
  const out = {}
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === 'string' && /^["[{]/.test(v)) {
      try {
        out[k] = JSON.parse(v)
        continue
      } catch {}
    }
    out[k] = v
  }
  return out
}

/** The folder a run_command runs in: its Cwd argument, else the session's cwd, else the first workspace. */
export function commandCwd(input, args) {
  const c = (typeof args.Cwd === 'string' && args.Cwd) || input.cwd || (Array.isArray(input.workspacePaths) && input.workspacePaths[0]) || process.cwd()
  return path.resolve(c)
}

// Devin's shell tool is `exec`; `shell_command` is the name hooks imported from Windsurf use.
const DEVIN_SHELL_TOOLS = new Set(['exec', 'shell_command'])

/**
 * The shell command a PreToolUse call is about to run, and the folder it runs in, from either host's
 * input; undefined when the call is not a shell command. Devin: `tool_input.command`, run in its `cwd`
 * (else the session's cwd, else the project folder Devin names in DEVIN_PROJECT_DIR).
 */
export function shellCall(input) {
  const tc = input?.toolCall
  if (tc) {
    if (tc.name !== 'run_command') return undefined
    const args = argsOf(tc)
    return { command: typeof args.CommandLine === 'string' ? args.CommandLine : '', cwd: commandCwd(input, args) }
  }
  if (typeof input?.tool_name !== 'string' || !DEVIN_SHELL_TOOLS.has(input.tool_name)) return undefined
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {}
  const c = (typeof ti.cwd === 'string' && ti.cwd) || (typeof input.cwd === 'string' && input.cwd) || process.env.DEVIN_PROJECT_DIR || process.cwd()
  // A command sent as an argv array is joined so it is still checked, not waved through as empty.
  let command = ti.command
  if (Array.isArray(command)) command = command.map(String).join(' ')
  if (typeof command !== 'string') {
    log('shell', `${input.tool_name} call has no command string (tool_input keys: ${Object.keys(ti).join(', ') || 'none'}); nothing to check`)
    command = ''
  }
  return { command, cwd: path.resolve(c) }
}

// ---- shell splitting ----

/** A word the shell would expand: a variable, a substitution, a glob or brace expansion. */
export const isDynamic = w => /[$`*?{}]/.test(w)

const SEPARATORS = new Set([';', '&&', '||', '|', '&', '\n'])

/**
 * Splits a command line into simple commands, each a list of words with quotes removed. Handles bash and
 * PowerShell well enough to find program names and their arguments: single and double quotes, `;`, `&&`,
 * `||`, `|`, newlines, redirections, a leading PowerShell `&` call operator and `( { ` grouping.
 * Backslashes are kept as they are (they are path separators on Windows).
 */
export function splitCommands(command) {
  const segments = []
  let words = []
  let cur = ''
  let has = false
  const endWord = () => {
    if (has) words.push(cur)
    cur = ''
    has = false
  }
  const endSegment = () => {
    endWord()
    if (words.length > 0) segments.push(words)
    words = []
  }
  const s = String(command ?? '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "'") {
      const j = s.indexOf("'", i + 1)
      cur += j < 0 ? s.slice(i + 1) : s.slice(i + 1, j)
      has = true
      i = j < 0 ? s.length : j
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < s.length && s[j] !== '"') {
        if ((s[j] === '`' || s[j] === '\\') && s[j + 1] === '"') {
          cur += '"'
          j += 2
          continue
        }
        cur += s[j]
        j++
      }
      has = true
      i = j
      continue
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
      continue
    }
    if (c === '\n' || c === ';') {
      endSegment()
      continue
    }
    if (c === '&' || c === '|') {
      if (s[i + 1] === c) i++
      // `2>&1`, `>&2`: part of a redirection, not a separator.
      if (c === '&' && /[0-9]?>$/.test(cur)) {
        cur += '&'
        continue
      }
      endSegment()
      continue
    }
    if ((c === '(' || c === ')' || c === '{' || c === '}') && !has) {
      // Grouping at a word start: `(cd x && git push)`, `if ($?) { git push }`.
      if (c === ')' || c === '}') endSegment()
      continue
    }
    cur += c
    has = true
  }
  endSegment()
  // Drop redirections (`>out`, `2>&1`, `> file`).
  return segments
    .map(ws => {
      const out = []
      for (let k = 0; k < ws.length; k++) {
        const w = ws[k]
        if (/^[0-9]?>>?$|^<$/.test(w)) {
          k++
          continue
        }
        if (/^[0-9]?>>?.|^<./.test(w) || /^[0-9]?>&[0-9]$/.test(w)) continue
        out.push(w)
      }
      return out
    })
    .filter(ws => ws.length > 0)
}

/** `C:\x\git.exe` -> `git`; `pip3.12` stays as it is. */
export function progName(word) {
  const base = String(word).replace(/\\/g, '/').split('/').pop() ?? ''
  return base.replace(/\.(exe|cmd|bat|ps1)$/i, '').toLowerCase()
}

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/
const WRAPPERS = new Set(['sudo', 'env', 'command', 'time', 'nohup', 'exec', 'builtin'])
const CD = new Set(['cd', 'chdir', 'pushd', 'set-location', 'sl', 'push-location'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'cmd', 'powershell', 'pwsh'])

/**
 * The simple commands a line runs, each with the folder it runs in: `cd` / `Set-Location` earlier in the
 * line moves later commands (`cwdUnknown` when the target can't be read). `bash -c '...'`, `cmd /c ...`
 * and `powershell -Command ...` are opened up, two levels deep.
 */
export function commandsIn(command, cwd, depth = 0) {
  const out = []
  let here = cwd
  let unknown = false
  for (let words of splitCommands(command)) {
    while (words.length > 0 && (words[0] === '&' || words[0] === '.' || ASSIGN.test(words[0]) || WRAPPERS.has(progName(words[0])))) words = words.slice(1)
    if (words.length === 0) continue
    const prog = progName(words[0])
    if (CD.has(prog)) {
      const target = words.slice(1).filter(w => !/^-(path|literalpath)$/i.test(w))[0]
      if (target === undefined || target === '~') continue
      if (isDynamic(target) || target === '-') unknown = true
      else here = path.resolve(here, target.replace(/^~(?=[\\/])/, process.env.HOME || process.env.USERPROFILE || '~'))
      continue
    }
    if (SHELLS.has(prog) && depth < 2) {
      const k = words.findIndex((w, i) => i > 0 && /^(-c|\/c|\/k|-command|-c(o(m(m(a(n(d)?)?)?)?)?)?)$/i.test(w))
      if (k > 0 && words[k + 1] !== undefined) {
        for (const inner of commandsIn(words.slice(k + 1).join(' '), here, depth + 1)) out.push(unknown ? { ...inner, cwdUnknown: true } : inner)
        continue
      }
    }
    out.push({ words, prog, cwd: here, ...(unknown ? { cwdUnknown: true } : {}) })
  }
  return out
}
