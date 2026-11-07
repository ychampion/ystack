// Pure loop-detection logic for loop-breaker: no engine calls, so every rule is unit-testable.

/** Commands that check work: a pass after a fail of the same one is real progress. */
export const CHECK_CMD =
  /\b(test|tests|vitest|jest|pytest|tsc|typecheck|lint|clippy|build|cargo\s+(test|check|build)|go\s+(test|vet|build)|playwright|bun\s+(run|test)|bunx|make)\b/i

export type SignalKind = 'command' | 'error' | 'revert' | 'flap'
export type Signal = { kind: SignalKind; what: string; count: number }
export type Outcome = 'pass' | 'fail'
export type Failure = { cmd: string; error: string }

export type LoopState = {
  /** 0 = never triggered; 1 note given; 2 second opinion given; 3 stopped. */
  level: number
  cmdFails: Record<string, number>
  /** Per command, how its last failure looked (failureShape): a different failure is a fresh count. */
  cmdLast: Record<string, string>
  errSigs: Record<string, { count: number; cmds: string[] }>
  files: Record<string, string[]>
  tests: Record<string, { last: Outcome; flips: number }>
  failedChecks: Record<string, true>
  failures: Failure[]
  touched: string[]
  task: string
}

export const newLoop = (task = ''): LoopState => ({
  level: 0,
  cmdFails: {},
  cmdLast: {},
  errSigs: {},
  files: {},
  tests: {},
  failedChecks: {},
  failures: [],
  touched: [],
  task,
})

/** Counters back to zero (the task and files touched are kept for a later evidence pack). */
export const resetCounters = (s: LoopState): LoopState => ({ ...newLoop(s.task), touched: s.touched })

/** One spelling per command: whitespace collapsed, output plumbing (`2>&1`, `| tail -5`) dropped. */
export function normCommand(cmd: string): string {
  return cmd
    .replace(/\s+/g, ' ')
    .replace(/\s*\d?>&\d/g, '')
    .replace(/\s*\|\s*(tail|head|less|more|cat|Select-Object)\b[^|;&]*$/i, '')
    .replace(/["']/g, '"')
    .trim()
}

const ERROR_LINE = /\b(error|failed|failure|exception|traceback|cannot|can't|not found|no such|fatal|panic|denied|undefined|refused|timed? ?out)\b/i

/** The first error-looking line with paths, hex, numbers and quotes stripped, so the same error matches across commands. */
export function errorSignature(output: string): string {
  const line = output
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l.length > 0 && ERROR_LINE.test(l) && !/^exit code \d+$/i.test(l))
  if (!line) return ''
  return line
    .replace(/[A-Za-z]:[\\/][^\s:'"`)]*/g, '<path>')
    .replace(/(?:\.{0,2}\/)?(?:[\w.@-]+\/)+[\w.@-]+/g, '<path>')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/\b[0-9a-f]{7,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/["'`][^"'`]{0,80}["'`]/g, '<q>')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .slice(0, 160)
}

/** The error line a person or model would read, cut short (numbers and paths kept). */
export function errorLine(output: string): string {
  const line = output
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l.length > 0 && ERROR_LINE.test(l) && !/^exit code \d+$/i.test(l))
  return (line ?? output.trim().split(/\r?\n/)[0] ?? '').slice(0, 240)
}

const TEST_LINES: [RegExp, Outcome][] = [
  [/^\s*\(pass\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?$/, 'pass'],
  [/^\s*\(fail\)\s+(.+?)(?:\s+\[[\d.]+m?s\])?$/, 'fail'],
  [/^\s*[✓✔√]\s+(.+?)(?:\s+\(?[\d.]+\s?m?s\)?)?$/, 'pass'],
  [/^\s*[✗✘×]\s+(.+?)(?:\s+\(?[\d.]+\s?m?s\)?)?$/, 'fail'],
  [/^\s*PASSED\s+(\S+)/, 'pass'],
  [/^\s*FAILED\s+(\S+)/, 'fail'],
  [/^(\S+::\S+)\s+PASSED/, 'pass'],
  [/^(\S+::\S+)\s+FAILED/, 'fail'],
  [/^\s*--- PASS:\s+(\S+)/, 'pass'],
  [/^\s*--- FAIL:\s+(\S+)/, 'fail'],
  [/^\s*ok \d+ - (.+)$/, 'pass'],
  [/^\s*not ok \d+ - (.+)$/, 'fail'],
  [/^test (\S+) \.\.\. ok$/, 'pass'],
  [/^test (\S+) \.\.\. FAILED$/, 'fail'],
]

/** Per-test outcomes read from a test runner's output (bun, jest/vitest, pytest, go, TAP, cargo). */
export function testOutcomes(output: string): Map<string, Outcome> {
  const out = new Map<string, Outcome>()
  for (const raw of output.split(/\r?\n/)) {
    for (const [re, outcome] of TEST_LINES) {
      const m = re.exec(raw)
      if (m?.[1]) {
        out.set(m[1].trim(), outcome)
        break
      }
    }
  }
  return out
}

/** FNV-1a over the text plus its length: enough to tell file versions apart. */
export function hashText(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16)}:${text.length}`
}

const cap = <T>(xs: T[], n: number): T[] => (xs.length > n ? xs.slice(-n) : xs)

/** How a failure looks: its error signature and the tests that failed, numbers and paths aside. */
export function failureShape(output: string): string {
  const failing = [...testOutcomes(output)].filter(([, o]) => o === 'fail').map(([name]) => name).sort()
  return `${errorSignature(output)}|${failing.join('|')}`
}

export type CommandRun = { cmd: string; isOk: boolean; output: string }
export type Observed = { state: LoopState; signals: Signal[]; isProgress: boolean }

/** One Bash/PowerShell run: counts the same failing command, the same error across commands, and test flips. */
export function observeCommand(s0: LoopState, run: CommandRun, repeats: number): Observed {
  const cmd = normCommand(run.cmd)
  const isCheck = CHECK_CMD.test(cmd)
  let s: LoopState = { ...s0 }
  const signals: Signal[] = []

  if (run.isOk && isCheck && s.failedChecks[cmd]) {
    // Real progress: a check that failed now passes, so every counter starts again.
    s = resetCounters(s)
    return { state: s, signals, isProgress: true }
  }

  if (!run.isOk) {
    // The same command failing the same way is a loop; failing differently (another error, other tests
    // failing) is the normal fix-and-rerun cycle, so its count starts again.
    const shape = failureShape(run.output)
    const prevShape = s.cmdLast[cmd]
    const n = prevShape === undefined || prevShape === shape ? (s.cmdFails[cmd] ?? 0) + 1 : 1
    s.cmdFails = { ...s.cmdFails, [cmd]: n }
    s.cmdLast = { ...s.cmdLast, [cmd]: shape }
    if (isCheck) s.failedChecks = { ...s.failedChecks, [cmd]: true }
    s.failures = cap([...s.failures, { cmd: run.cmd.slice(0, 300), error: errorLine(run.output) }], 8)
    if (n >= repeats) signals.push({ kind: 'command', what: cmd.slice(0, 80), count: n })

    const sig = errorSignature(run.output)
    if (sig) {
      const prev = s.errSigs[sig] ?? { count: 0, cmds: [] }
      const entry = { count: prev.count + 1, cmds: prev.cmds.includes(cmd) ? prev.cmds : cap([...prev.cmds, cmd], 10) }
      s.errSigs = { ...s.errSigs, [sig]: entry }
      if (signals.length === 0 && entry.count >= repeats && entry.cmds.length >= 2)
        signals.push({ kind: 'error', what: errorLine(run.output).slice(0, 80), count: entry.count })
    }
  }

  if (isCheck) {
    const tests = { ...s.tests }
    for (const [name, outcome] of testOutcomes(run.output)) {
      const prev = tests[name]
      const flips = prev && prev.last !== outcome ? prev.flips + 1 : (prev?.flips ?? 0)
      tests[name] = { last: outcome, flips }
      if (prev && prev.last !== outcome && flips >= 3 && signals.length === 0)
        signals.push({ kind: 'flap', what: name.slice(0, 80), count: flips })
    }
    s.tests = tests
  }
  return { state: s, signals, isProgress: false }
}

/**
 * A file's content after a successful edit. `before` seeds the history with the version
 * the edit started from. A→B→A (the content returns to any version but the latest) is a signal.
 */
export function observeFile(s0: LoopState, path: string, after: string, before?: string): Observed {
  const hist = [...(s0.files[path] ?? [])]
  if (hist.length === 0 && before !== undefined) hist.push(before)
  const last = hist[hist.length - 1]
  const signals: Signal[] = []
  if (last !== undefined && last !== after && hist.slice(0, -1).includes(after)) {
    const count = hist.filter(h => h === after).length + 1
    signals.push({ kind: 'revert', what: path.replace(/^.*[\\/]/, ''), count })
  }
  if (last !== after) hist.push(after)
  const touched = s0.touched.includes(path) ? s0.touched : cap([...s0.touched, path], 20)
  return { state: { ...s0, files: { ...s0.files, [path]: cap(hist, 20) }, touched }, signals, isProgress: false }
}

export type Action = 'note' | 'second-opinion' | 'stop'

/**
 * The response ladder: first trigger a note, second a second opinion (only when it is on and
 * the loop's own model is known; otherwise straight to the stop), third and later a stop.
 */
export function escalate(s: LoopState, canSecondOpinion: boolean): { state: LoopState; action: Action } {
  if (s.level === 0) return { state: { ...s, level: 1 }, action: 'note' }
  if (s.level === 1 && canSecondOpinion) return { state: { ...s, level: 2 }, action: 'second-opinion' }
  return { state: { ...s, level: 3 }, action: 'stop' }
}

/** What repeated, in plain words. */
export function describe(sig: Signal): string {
  switch (sig.kind) {
    case 'command':
      return `the command "${sig.what}" has failed ${sig.count} times`
    case 'error':
      return `the same error came back ${sig.count} times across different commands: "${sig.what}"`
    case 'revert':
      return `${sig.what} went back to an earlier version (the same change is being undone and redone)`
    case 'flap':
      return `the test "${sig.what}" flipped between pass and fail ${sig.count} times`
  }
}

/** Short form for the band: "<who> retried <what> N times". */
export function bandWhat(sig: Signal): string {
  switch (sig.kind) {
    case 'command':
      return `"${sig.what.slice(0, 50)}"`
    case 'error':
      return 'the same error'
    case 'revert':
      return `an edit to ${sig.what}`
    case 'flap':
      return `the test ${sig.what.slice(0, 40)}`
  }
}

export const NOTE_TAIL = 'Stop retrying the same thing; write down what you now believe the cause is, then try something different.'

export function firstNote(sig: Signal): string {
  return `loop-breaker: ${describe(sig)}. ${NOTE_TAIL}`
}

/** The evidence pack for the second opinion: the task, the failing commands with their errors, files touched. No history. */
export function evidencePack(s: LoopState, sig: Signal): string {
  const parts = [
    'An AI coding agent is stuck in a loop. You are giving a fresh second opinion; you see none of its conversation.',
    `What repeated: ${describe(sig)}.`,
  ]
  if (s.task.trim()) parts.push(`The task it was given:\n${s.task.trim().slice(0, 1500)}`)
  if (s.failures.length > 0) parts.push(`Recent failing commands and their error lines:\n${s.failures.map(f => `- ${f.cmd}\n  error: ${f.error}`).join('\n')}`)
  if (s.touched.length > 0) parts.push(`Files it edited:\n${s.touched.map(f => `- ${f}`).join('\n')}`)
  parts.push(
    'In under 200 words: what is the most likely real cause, what is the agent probably assuming wrongly, and what single different thing should it try next? Be concrete.',
  )
  return parts.join('\n\n')
}
