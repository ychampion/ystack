// Pure logic for output-diet: which command outputs to shorten, and how. No engine calls here.

/** Output past either limit is a candidate for shortening. */
export const MAX_CHARS = 12_000
export const HEAD = 20
export const TAIL = 40
export const CONTEXT = 3
/** Shortening that saves less than this share of the text is not worth a note: the output passes untouched. */
export const MIN_SAVING = 0.25

/**
 * Commands whose output Claude asked for as content (a file, a diff, a search, a listing, data).
 * Any one of them anywhere in a pipeline or chain passes the whole output through untouched.
 */
const CONTENT_FIRST_WORD = new Set([
  'cat', 'type', 'get-content', 'gc', 'head', 'tail', 'less', 'more', 'bat', 'nl', 'tac',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'select-string', 'sls', 'findstr',
  'jq', 'yq', 'awk', 'cut', 'sort', 'uniq', 'column', 'diff', 'cmp', 'comm', 'xxd', 'od', 'hexdump', 'format-hex', 'strings',
  'ls', 'dir', 'get-childitem', 'gci', 'tree', 'find', 'fd', 'stat', 'wc', 'file',
  'curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm',
  'select-object', 'format-list', 'format-table', 'convertto-json', 'convertfrom-json',
])
const CONTENT_GIT = new Set(['diff', 'show', 'log', 'blame', 'grep', 'cat-file', 'ls-files', 'ls-tree', 'shortlog', 'reflog', 'format-patch', 'range-diff'])
const CONTENT_GH = new Set(['api', 'pr', 'issue', 'run', 'release', 'repo', 'gist', 'search'])

/** Splits a command line into its simple commands (pipes, `&&`, `||`, `;`, newlines), quotes respected loosely. */
export function segments(command: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote = ''
  for (let i = 0; i < command.length; i++) {
    const c = command[i]
    if (quote) {
      if (c === quote) quote = ''
      cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      cur += c
      continue
    }
    if (c === '|' || c === ';' || c === '&' || c === '\n') {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function words(segment: string): string[] {
  const ws = segment.replace(/^[({\s]+/, '').split(/\s+/).filter(Boolean)
  // Skip leading env assignments and wrappers that run another command.
  while (ws.length > 0 && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(ws[0] ?? '') || ['sudo', 'env', 'time', 'nice', 'command', 'exec', '&', '.'].includes(ws[0] ?? ''))) ws.shift()
  return ws.map(w => w.replace(/^["']|["']$/g, ''))
}

/** True when the output is content Claude asked for, so it must reach the model untouched. */
export function isContentCommand(command: string): boolean {
  for (const seg of segments(command)) {
    const ws = words(seg)
    if (ws.length === 0) continue
    const first = ((ws[0] ?? '').split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.exe$/, '')
    if (CONTENT_FIRST_WORD.has(first)) return true
    if (first === 'sed' && ws.includes('-n')) return true
    if (first === 'git') {
      // `git -C dir diff`, `git -c k=v log`: skip global options and their arguments.
      const rest = ws.slice(1)
      let i = 0
      while (i < rest.length && (rest[i] ?? '').startsWith('-')) i += rest[i] === '-C' || rest[i] === '-c' ? 2 : 1
      if (CONTENT_GIT.has(rest[i] ?? '')) return true
    }
    if (first === 'gh' && CONTENT_GH.has(ws[1] ?? '')) return true
  }
  return false
}

/** Build, install, test and lint tools: their long output is noise around a few lines that matter. Any argument. */
const NOISY_ANY = new Set([
  'npx', 'bunx', 'pnpx', 'tsc', 'vite', 'webpack', 'rollup', 'esbuild', 'turbo', 'nx', 'lerna',
  'jest', 'vitest', 'mocha', 'ava', 'pytest', 'tox', 'nox', 'playwright', 'cypress',
  'eslint', 'biome', 'prettier', 'ruff', 'mypy', 'pyright', 'black', 'flake8', 'pylint', 'rubocop',
  'make', 'cmake', 'ninja', 'meson', 'msbuild', 'xcodebuild', 'mvn', 'mvnw', 'gradle', 'gradlew', 'sbt', 'ant',
])
/** Tools whose long output is noise only for some subcommands (`npm ls` and `pip list` are content). */
const NOISY_SUB: Record<string, ReadonlySet<string>> = (() => {
  const js = new Set(['install', 'i', 'ci', 'add', 'update', 'upgrade', 'up', 'remove', 'rm', 'uninstall', 'build', 'test', 't', 'run', 'exec', 'x', 'dlx', 'rebuild', 'lint', 'check', 'typecheck'])
  const py = new Set(['install', 'sync', 'add', 'update', 'upgrade', 'lock', 'build', 'run', 'uninstall', 'remove'])
  return {
    npm: js, pnpm: js, yarn: js, bun: js, deno: new Set(['install', 'test', 'task', 'lint', 'check', 'compile']),
    pip: py, pip3: py, uv: py, poetry: py, pipenv: py, conda: py, mamba: py,
    cargo: new Set(['build', 'b', 'test', 't', 'check', 'c', 'clippy', 'run', 'r', 'install', 'update', 'fetch', 'bench', 'doc']),
    go: new Set(['build', 'test', 'vet', 'get', 'install', 'mod', 'generate', 'run']),
    dotnet: new Set(['build', 'test', 'restore', 'publish', 'run', 'pack']),
    swift: new Set(['build', 'test']), flutter: new Set(['build', 'test', 'pub']), dart: new Set(['test', 'pub', 'compile']),
    gem: new Set(['install', 'update']), bundle: new Set(['install', 'update', 'exec']), composer: new Set(['install', 'update', 'require']),
    mix: new Set(['compile', 'test', 'deps.get']),
    docker: new Set(['build', 'pull', 'push', 'buildx']), podman: new Set(['build', 'pull', 'push']),
    apt: new Set(['install', 'upgrade', 'update']), 'apt-get': new Set(['install', 'upgrade', 'update']),
    brew: new Set(['install', 'upgrade', 'update']), choco: new Set(['install', 'upgrade']), winget: new Set(['install', 'upgrade']), scoop: new Set(['install', 'update']),
  }
})()
const PY_MODULES = new Set(['pytest', 'pip', 'unittest', 'build', 'mypy', 'ruff', 'tox', 'black', 'pylint', 'flake8'])

/** True when the command runs a build, install, test or lint tool (anywhere in a chain): the only output shortened. */
export function isNoisyCommand(command: string): boolean {
  for (const seg of segments(command)) {
    const ws = words(seg)
    const first = ((ws[0] ?? '').split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')
    if (NOISY_ANY.has(first)) return true
    // The first word after the tool's own options: `npm --prefix app install` -> install; `yarn` alone installs.
    const sub = (ws.slice(1).find(w => !w.startsWith('-')) ?? '').toLowerCase()
    if (first === 'yarn' && sub === '') return true
    if (NOISY_SUB[first]?.has(sub)) return true
    if (first === 'uv' && sub === 'pip' && /\binstall\b/.test(seg)) return true
    if (first === 'docker' && sub === 'compose' && /\s(build|pull)\b/.test(seg)) return true
    if (/^(python3?|py)$/.test(first)) {
      const m = ws.indexOf('-m')
      if (m >= 0 && PY_MODULES.has((ws[m + 1] ?? '').toLowerCase())) return true
      if (/\bsetup\.py\b/.test(seg)) return true
    }
    if (first === 'node' && ws.includes('--test')) return true
    if (first === 'claude' && ws[1] === 'plugin' && (ws[2] === 'test' || ws[2] === 'validate')) return true
  }
  return false
}

/**
 * Whether a command's long output may be shortened: a build, install, test or lint run, and nothing in it that
 * prints content Claude asked for. Everything else (scripts, queries, listings, logs) reaches Claude whole.
 */
export const shouldShorten = (command: string): boolean => isNoisyCommand(command) && !isContentCommand(command)

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>78]/g

/** Strips ANSI codes and keeps only what a carriage-return redraw left visible on each line. */
export function clean(text: string): string[] {
  return text
    .replace(ANSI, '')
    .split('\n')
    .map(line => {
      const l = line.endsWith('\r') ? line.slice(0, -1) : line
      if (!l.includes('\r')) return l
      const parts = l.split('\r').filter(p => p.trim() !== '')
      return parts[parts.length - 1] ?? ''
    })
}

/**
 * Lines that are kept whatever else goes: errors, warnings and failures in the usual tools' spellings
 * (npm's `ERR!`, jest's ✕, vitest's ×, pytest's `E   ` detail lines, linkers, git, the shell, the kernel).
 */
export const IMPORTANT =
  /error|\berr!|warn|fail|exception|panic|traceback|denied|not found|no such file|exit (code|status)|fatal|abort|segfault|segmentation fault|core dumped|\bkilled\b|out of memory|cannot|can't|unable to|conflict|\[rejected\]|timed out|undefined reference|unresolved|assert|critical|[✕✗✘×]|^E\s{2,}/i
const PASS_MARK = /^\s*(?:✓|✔|√|\(pass\)|PASS\b|ok\s+\d+\b|ok\s+-|\[\s*OK\s*\])/
const PASS_WORD = /\s(?:PASSED|passed)\s*(?:\[|\(|$)|^test .* \.\.\. ok\s*$/
const FAIL_SUMMARY = /(?:^|\s)[1-9]\d*\s+(?:[Ff]ail|[Ff]ailed|[Ff]ailing|[Ff]ailures?|[Ee]rrors?)\b|(?:^|\s)FAIL(?:ED)?\b|\(fail\)|✗|✘|^\s*FAILURES?\b/m

/** Whether a test run reported failures, so its passing lines can go. */
export const hasFailureSummary = (lines: readonly string[]) => lines.some(l => FAIL_SUMMARY.test(l))
export const isPassLine = (line: string) => PASS_MARK.test(line) || (PASS_WORD.test(line) && !/fail/i.test(line))

/** Two lines that differ only in numbers, hashes, sizes, percentages or timings count as near-identical. */
export const shapeOf = (line: string) =>
  line
    .trim()
    .toLowerCase()
    .replace(/\b[0-9a-f]{7,}\b/g, 'H')
    .replace(/\d+(?:[.,:]\d+)*/g, '0')
    .replace(/\s+/g, ' ')

type Item = { text: string; similar: number; isImportant: boolean }

export type Trimmed = {
  text: string
  fromLines: number
  toLines: number
  fromChars: number
  toChars: number
}

/**
 * Shortens one output: strips ANSI and redraws, drops passing-test lines when a failure summary exists,
 * collapses runs of near-identical lines, keeps the first 20 and last 40 lines and every important line
 * with 3 lines of context. Returns undefined when nothing worth saving would go.
 */
export function trimOutput(raw: string, maxLines: number): Trimmed | undefined {
  const fromLines = raw.split('\n').length
  if (fromLines <= maxLines && raw.length <= MAX_CHARS) return undefined
  let lines = clean(raw)
  if (hasFailureSummary(lines)) lines = lines.filter(l => !isPassLine(l))

  // Collapse runs of near-identical lines: the first stays, a count says how many followed.
  // Important lines are never merged, so every error keeps its own line numbers and names.
  const items: Item[] = []
  for (const l of lines) {
    const last = items[items.length - 1]
    const isImportant = IMPORTANT.test(l)
    if (last && !isImportant && !last.isImportant && l.trim() !== '' && shapeOf(l) === shapeOf(last.text)) {
      last.similar += 1
      continue
    }
    items.push({ text: l, similar: 0, isImportant })
  }

  const keep = new Array<boolean>(items.length).fill(false)
  for (let i = 0; i < Math.min(HEAD, items.length); i++) keep[i] = true
  for (let i = Math.max(0, items.length - TAIL); i < items.length; i++) keep[i] = true
  items.forEach((it, i) => {
    if (!it.isImportant) return
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(items.length - 1, i + CONTEXT); j++) keep[j] = true
  })

  const out: string[] = []
  let gap = 0
  items.forEach((it, i) => {
    if (!keep[i]) {
      gap += 1 + it.similar
      return
    }
    if (gap > 0) out.push(`[... ${gap} line${gap === 1 ? '' : 's'} omitted]`)
    gap = 0
    out.push(it.text)
    if (it.similar === 1) out.push(it.text)
    else if (it.similar > 1) out.push(`[... ${it.similar} similar lines]`)
  })
  if (gap > 0) out.push(`[... ${gap} line${gap === 1 ? '' : 's'} omitted]`)

  const text = out.join('\n')
  if (text.length > raw.length * (1 - MIN_SAVING)) return undefined
  return { text, fromLines, toLines: out.length, fromChars: raw.length, toChars: text.length }
}

/** Output that is data (JSON) or a whole document is content, whatever printed it. */
export const looksLikeData = (text: string) => /^\s*[[{]/.test(text) && /[\]}]\s*$/.test(text)

export const note = (fromLines: number, path: string) =>
  `[output-diet: shortened from ${fromLines} lines; full output saved to ${path}. Read it if you need more]`

/** A file-name-safe session folder name. */
export const safeName = (s: string) => s.replace(/[^\w.-]/g, '-').slice(0, 80) || 'session'

export const estimateTokens = (chars: number) => Math.round(chars / 4)
