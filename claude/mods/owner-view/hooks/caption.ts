// Pure logic for owner-view: plain captions for tool rows, the stage a task is in, and what it still needs.

export type Input = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const base = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? p
const clip = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const quote = (s: string): string => `"${clip(s.trim(), 40)}"`

/** The topic of a test file: tests/payment.test.ts -> payment, test_billing.py -> billing. */
function testTopic(arg: string): string {
  const b = base(arg)
    .replace(/\.(test|spec)\.[^.]+$/i, '')
    .replace(/^test_/i, '')
    .replace(/_test\.[^.]+$/i, '')
    .replace(/\.[^.]+$/, '')
  return b.replace(/[-_.]+/g, ' ').trim()
}

/** The first real command of a shell line, with leading `cd x &&` and env assignments dropped. */
export function firstCommand(command: string): string {
  const parts = command.split(/\s*(?:&&|\|\||;|\n)\s*/).map(p => p.trim()).filter(Boolean)
  const real = parts.map(p => p.replace(/^(\w+=\S*\s+)+/, '')).find(p => !/^(cd|set-location|pushd|export|set)\b/i.test(p)) ?? parts[0] ?? ''
  return real.replace(/^(\w+=\S*\s+)+/, '').trim()
}

type Rule = [RegExp, string | ((m: RegExpMatchArray, cmd: string) => string)]

const SHELL_RULES: Rule[] = [
  [/^(bun|npm|pnpm|yarn)\s+(run\s+)?test\b\s*(\S+)?/i, m => (m[3] && !m[3].startsWith('-') ? `running the ${testTopic(m[3])} tests` : 'running the tests')],
  [/^(bunx\s+|npx\s+)?(vitest|jest|pytest|mocha)\b\s*(\S+)?/i, m => (m[3] && !m[3].startsWith('-') ? `running the ${testTopic(m[3])} tests` : 'running the tests')],
  [/^(go|cargo)\s+test\b/i, 'running the tests'],
  [/^(bunx\s+|npx\s+)?playwright\s+test\b/i, 'running the browser tests'],
  [/^claude\s+plugin\s+test\b/i, 'running the plugin tests'],
  [/^claude\s+plugin\s+validate\b/i, 'checking the plugin is set up right'],
  [/^(bunx\s+|npx\s+)?tsc\b|^(bun|npm|pnpm|yarn)\s+run\s+(typecheck|check-types|types)\b/i, 'checking the code for type errors'],
  [/^(bunx\s+|npx\s+)?(eslint|biome|prettier|ruff)\b|^(bun|npm|pnpm|yarn)\s+run\s+(lint|format)\b|^cargo\s+clippy\b/i, 'checking code style'],
  [/^(bun|npm|pnpm|yarn)\s+run\s+build\b|^(cargo|go)\s+build\b|^(bunx\s+|npx\s+)?(vite|next)\s+build\b/i, 'building the app'],
  [/^(bun|npm|pnpm|yarn)\s+(run\s+)?(dev|start|serve|preview)\b|^(bunx\s+|npx\s+)?vite\b(?!\s+build)/i, 'starting the app on this computer'],
  [/^(bun|npm|pnpm|yarn)\s+(add|install|i)\s+(?!-)(\S+)/i, m => `adding the ${clip(m[3] ?? '', 30)} package`],
  [/^(bun|npm|pnpm|yarn|pip|uv)\s+(install|i|sync)\b/i, 'installing the packages the project needs'],
  [/^(bun|npm|pnpm|yarn)\s+(remove|uninstall|rm)\s+(\S+)/i, m => `removing the ${clip(m[3] ?? '', 30)} package`],
  [/^git\s+push\b/i, 'sending the changes to the shared copy on GitHub'],
  [/^git\s+(pull|fetch)\b/i, 'getting the latest changes from the shared copy'],
  [/^git\s+commit\b/i, 'saving a checkpoint of the changes'],
  [/^git\s+add\b/i, 'picking the changes to save'],
  [/^git\s+(status|diff|log|show)\b/i, 'looking at what changed'],
  [/^git\s+(checkout|switch)\s+(-b|-c)\s+(\S+)/i, m => `starting a new branch, ${clip(m[3] ?? '', 30)}`],
  [/^git\s+(checkout|switch)\s+(\S+)/i, m => `switching to the ${clip(m[2] ?? '', 30)} branch`],
  [/^git\s+(merge|rebase)\b/i, 'combining two lines of work'],
  [/^git\s+(reset\s+--hard|clean\b)/i, 'throwing away uncommitted changes'],
  [/^git\s+stash\b/i, 'putting changes aside for later'],
  [/^git\s+clone\b/i, 'downloading a copy of a project'],
  [/^gh\s+pr\s+create\b/i, 'opening a pull request for review'],
  [/^gh\s+pr\s+merge\b/i, 'merging the pull request'],
  [/^gh\s+(pr\s+checks|run\s+(watch|view|list))\b/i, 'checking the automated checks on GitHub'],
  [/^gh\s+pr\s+(view|diff|list)\b/i, 'looking at a pull request'],
  [/^gh\s+issue\b/i, 'looking at GitHub issues'],
  [/^(rm|rmdir|del|remove-item)\b.*?([\w.-]*(dist|build|out|\.next|target|node_modules|cache)[\w.-]*)\/?\s*$/i, m => `deleting the ${clip(m[2] ?? '', 30)} folder`],
  [/^(rm|rmdir|del|remove-item)\b\s+(-\S+\s+)*['"]?([^\s'"]+)/i, m => `deleting ${clip(base(m[3] ?? ''), 40)}`],
  [/^(mkdir|new-item\s+-itemtype\s+directory)\b/i, 'making a new folder'],
  [/^(cp|copy|copy-item|robocopy|xcopy)\b/i, 'copying files'],
  [/^(mv|move|move-item|rename-item|ren)\b/i, 'moving or renaming files'],
  [/^(ls|dir|get-childitem|gci|tree|find)\b/i, 'looking at the files in a folder'],
  [/^(cat|head|tail|less|type|get-content|gc|sed\s+-n)\b/i, 'reading a file'],
  [/^(grep|rg|select-string|findstr)\b/i, 'searching the code'],
  [/^(curl|wget|invoke-webrequest|iwr|invoke-restmethod)\b.*?https?:\/\/([^/\s'"]+)/i, m => `checking the web address ${clip(m[2] ?? '', 40)}`],
  [/^(curl|wget|invoke-webrequest|iwr|invoke-restmethod)\b/i, 'calling a web address'],
  [/^codex\s+exec\b/i, 'handing a task to Codex'],
  [/^docker\b/i, 'working with containers'],
  [/^ssh\b/i, 'running a command on a server'],
  [/^(scp|rsync)\b/i, 'copying files to or from a server'],
  [/^(vercel|wrangler|netlify|fly|railway)\b.*\b(deploy|publish)\b|^(vercel)\b\s*(--prod)?\s*$/i, 'putting the site live'],
  [/^(bun|node|deno|python3?|py)\s+(?!-)(\S+\.(m?[jt]s|py))\b/i, m => `running the script ${clip(base(m[2] ?? ''), 40)}`],
  [/^(echo|write-output|write-host|printf)\b/i, 'printing a message'],
  [/^(kill|taskkill|stop-process)\b/i, 'stopping a running program'],
  [/^(ps|tasklist|get-process)\b/i, 'checking what programs are running'],
  [/^(which|where|get-command)\b/i, 'checking a program is installed'],
  [/^(sleep|start-sleep)\b/i, 'waiting'],
]

/** A cheap plain-English caption for a tool row, or undefined when no rule knows it. */
export function ruleCaption(tool: string, input: Input): string | undefined {
  switch (tool) {
    case 'Bash':
    case 'PowerShell': {
      const desc = str(input.description).trim()
      const cmd = firstCommand(str(input.command))
      for (const [re, out] of SHELL_RULES) {
        const m = cmd.match(re)
        if (m) return typeof out === 'string' ? out : out(m, cmd)
      }
      // The model's own description is usually plain enough; lowercase its first letter.
      if (desc && desc.length <= 70) return desc.charAt(0).toLowerCase() + desc.slice(1).replace(/\.$/, '')
      return undefined
    }
    case 'Read':
      return `reading ${base(str(input.file_path))}`
    case 'Edit':
    case 'MultiEdit':
      return `changing ${base(str(input.file_path))}`
    case 'Write':
      return `writing ${base(str(input.file_path))}`
    case 'NotebookEdit':
      return `changing the notebook ${base(str(input.notebook_path))}`
    case 'Glob':
      return 'finding files by name'
    case 'Grep':
      return str(input.pattern) ? `searching the code for ${quote(str(input.pattern))}` : 'searching the code'
    case 'WebFetch': {
      const host = str(input.url).match(/^https?:\/\/([^/]+)/i)?.[1]
      return host ? `reading a web page on ${host}` : 'reading a web page'
    }
    case 'WebSearch':
      return `searching the web for ${quote(str(input.query))}`
    case 'Agent':
    case 'Task':
      return str(input.description) ? `handing off to a helper: ${clip(str(input.description), 50)}` : 'handing off to a helper'
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'updating the to-do list'
    case 'Skill':
      return str(input.skill) ? `using the ${clip(str(input.skill), 30)} skill` : 'using a skill'
    case 'AskUserQuestion':
      return 'asking you a question'
    case 'EnterPlanMode':
      return 'switching to planning'
    case 'ExitPlanMode':
      return 'showing you the plan'
    case 'Monitor':
    case 'BashOutput':
      return 'checking on a background job'
    case 'KillShell':
    case 'TaskStop':
      return 'stopping a background job'
    case 'ToolSearch':
      return 'loading a tool it needs'
    case 'SendMessage':
      return 'messaging a helper'
    case 'LSP':
      return 'looking up code definitions'
    default:
      return undefined
  }
}

/** The tiny prompt for a caption no rule knows. */
export function captionPrompt(tool: string, input: Input): string {
  let shown = ''
  try {
    shown = JSON.stringify(input).slice(0, 400)
  } catch {
    shown = String(input).slice(0, 400)
  }
  return (
    'Say what this step of a coding agent does, for a business owner who does not read code. ' +
    'Answer with 3 to 8 plain words, lowercase, starting with a verb ending in -ing, no period, no file paths, no jargon.\n' +
    `Tool: ${tool}\nInput: ${shown}`
  )
}

/** Tidies a model's caption: one short line, no quotes or trailing period. */
export function cleanCaption(text: string): string | undefined {
  const line = text.split('\n').map(l => l.trim()).find(Boolean)
  if (!line) return undefined
  const t = line.replace(/^["'`]+|["'`.]+$/g, '').trim()
  return t ? clip(t.charAt(0).toLowerCase() + t.slice(1), 80) : undefined
}

// ---------- stages and what a change still needs ----------

export type Stage = 'Plan' | 'Build' | 'Review' | 'Test' | 'Ship'
export const STAGES: readonly Stage[] = ['Plan', 'Build', 'Review', 'Test', 'Ship']

export type Signal =
  | { kind: 'read' }
  | { kind: 'edit'; file: string; isUi: boolean; isSensitive: boolean; isCode: boolean }
  | { kind: 'review'; isSecurity: boolean }
  | { kind: 'test' }
  | { kind: 'browser' }
  | { kind: 'ship' }
  | { kind: 'other' }

export const UI_FILE = /\.(tsx|jsx|vue|svelte|astro|html?|css|scss|sass|less)$/i
export const CODE_FILE = /\.(c|m)?[jt]sx?$|\.(py|rs|go|vue|svelte|astro|rb|java|kt|swift|cs|php|sql)$/i
export const DOC_FILE = /\.(md|mdx|txt|rst|adoc)$/i
export const SENSITIVE_PATH = /(auth|login|signin|signup|session|password|passwd|payment|billing|checkout|stripe|razorpay|paypal|invoice|subscription|secret|credential|token|oauth|jwt|permission|rbac|acl|role|crypto|security|middleware)/i
const SENSITIVE_TEXT = /\b(password|api[_-]?key|secret|stripe|razorpay|checkout|charge|refund|permission|authori[sz]e|jwt|bearer|csrf|oauth|bcrypt|encrypt|decrypt)\b/i

export const TEST_CMD =
  /\b(test|tests|vitest|jest|pytest|mocha|playwright|tsc|typecheck|cargo\s+(test|check|build)|go\s+(test|vet|build)|run\s+build|vite\s+build|next\s+build|plugin\s+(test|validate))\b/i
export const SHIP_CMD = /\bgit\s+push\b|\bgh\s+pr\s+(create|merge)\b|\b(vercel|wrangler|netlify|fly)\b.*\b(deploy|publish|--prod)\b/i
const BROWSER_CMD = /\b(browse|playwright|screenshot|puppeteer|chrome-devtools|agent-browser)\b/i
const BROWSER_TOOL = /browse|playwright|chrome|screenshot|webview|navigate|puppeteer|computer/i
const BROWSER_SKILL = /^(browse|qa|qa-only|design-review|webapp-testing|test-browser|dev-browser|run)$/i
const REVIEW_NAME = /review|reviewer|critic|sentinel|hunter|oracle|guardian|auditor|analyzer/i
const SECURITY_NAME = /security|sentinel|cso|secure|threat|audit/i
export const REVIEW_COMMAND = /^(review|review-panel|code-review|review-pr|security-review|cso|simplify|diff-review)$/i
export const BROWSER_COMMAND = /^(browse|qa|qa-only|design-review|run)$/i

/** What one finished tool call says about the task. */
export function signalOf(tool: string, input: Input): Signal {
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const file = str(input.file_path) || str(input.notebook_path)
    const text = `${str(input.new_string)}\n${str(input.content)}`.slice(0, 20_000)
    const isDoc = DOC_FILE.test(file)
    return {
      kind: 'edit',
      file,
      isUi: !isDoc && UI_FILE.test(file),
      isCode: !isDoc && CODE_FILE.test(file),
      isSensitive: !isDoc && (SENSITIVE_PATH.test(base(file)) || SENSITIVE_PATH.test(file.replace(/\\/g, '/').split('/').slice(-3, -1).join('/')) || (CODE_FILE.test(file) && SENSITIVE_TEXT.test(text))),
    }
  }
  if (tool === 'Read' || tool === 'Grep' || tool === 'Glob' || tool === 'LSP' || tool === 'WebFetch' || tool === 'WebSearch') return { kind: 'read' }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = str(input.command)
    if (SHIP_CMD.test(cmd)) return { kind: 'ship' }
    if (BROWSER_CMD.test(cmd)) return { kind: 'browser' }
    if (TEST_CMD.test(cmd)) return { kind: 'test' }
    if (/^\s*(cat|head|tail|ls|dir|grep|rg|find|git\s+(status|diff|log|show)|get-content|get-childitem|select-string)\b/i.test(firstCommand(cmd))) return { kind: 'read' }
    return { kind: 'other' }
  }
  if (tool === 'Agent' || tool === 'Task') {
    const who = `${str(input.subagent_type)} ${str(input.description)}`
    if (REVIEW_NAME.test(who) || /\b(review|verify|verification|audit)\b/i.test(who)) return { kind: 'review', isSecurity: SECURITY_NAME.test(who) }
    if (BROWSER_TOOL.test(str(input.subagent_type))) return { kind: 'browser' }
    return { kind: 'other' }
  }
  if (tool === 'Skill') {
    const skill = str(input.skill).replace(/^.*:/, '')
    if (BROWSER_SKILL.test(skill)) return { kind: 'browser' }
    if (REVIEW_COMMAND.test(skill) || /review/i.test(skill)) return { kind: 'review', isSecurity: SECURITY_NAME.test(skill) }
    if (/^(ship|land-and-deploy)$/i.test(skill)) return { kind: 'ship' }
    return { kind: 'other' }
  }
  if (tool.startsWith('mcp__') && BROWSER_TOOL.test(tool)) return { kind: 'browser' }
  return { kind: 'other' }
}

/** What a slash command the owner ran says about the task. */
export function signalOfCommand(name: string): Signal | undefined {
  if (REVIEW_COMMAND.test(name)) return { kind: 'review', isSecurity: SECURITY_NAME.test(name) }
  if (BROWSER_COMMAND.test(name)) return { kind: 'browser' }
  if (/^(ship|land-and-deploy)$/i.test(name)) return { kind: 'ship' }
  return undefined
}

export type Needs = { tests: boolean; browser: boolean; security: boolean }
export type Track = { recent: Signal['kind'][]; isPlanMode: boolean; needs: Needs; edits: number }

export const emptyTrack = (): Track => ({ recent: [], isPlanMode: false, needs: { tests: false, browser: false, security: false }, edits: 0 })

/** Folds one signal into the tracker. */
export function fold(t: Track, s: Signal): Track {
  const recent = [...t.recent, s.kind].slice(-12)
  const needs = { ...t.needs }
  let edits = t.edits
  switch (s.kind) {
    case 'edit':
      edits += 1
      if (s.isCode) needs.tests = true
      if (s.isUi) needs.browser = true
      if (s.isSensitive) needs.security = true
      break
    case 'test':
      needs.tests = false
      break
    case 'browser':
      needs.browser = false
      break
    case 'review':
      if (s.isSecurity) needs.security = false
      break
    case 'ship':
      return { recent, isPlanMode: false, needs: { tests: false, browser: false, security: false }, edits: 0 }
  }
  return { ...t, recent, needs, edits }
}

/** The stage the task is in, from recent activity. */
export function stageOf(t: Track): Stage | undefined {
  if (t.isPlanMode) return 'Plan'
  const strong = [...t.recent].reverse().find(k => k !== 'read' && k !== 'other')
  const reads = t.recent.slice(-6)
  if (reads.length >= 4 && reads.every(k => k === 'read' || k === 'other') && reads.some(k => k === 'read')) return 'Plan'
  switch (strong) {
    case 'edit':
      return 'Build'
    case 'review':
      return 'Review'
    case 'test':
    case 'browser':
      return 'Test'
    case 'ship':
      return 'Ship'
    default:
      return t.recent.includes('read') ? 'Plan' : undefined
  }
}

/** Plain lines for what the change still needs before it ships, most important first. */
export function missing(n: Needs): string[] {
  const out: string[] = []
  if (n.security) out.push('a security review (login, payment or secret code changed)')
  if (n.tests) out.push('the tests run since the last change')
  if (n.browser) out.push('a look at the page in a browser')
  return out
}

/** The next step to offer in the prompt box, or undefined when nothing is missing. */
export function suggestionFor(n: Needs, hasReviewPanel: boolean): string | undefined {
  if (n.security) return hasReviewPanel ? '/review-panel' : 'run a security review of the login, payment and secret code you changed'
  if (n.tests) return 'run the tests for what you just changed and tell me what they showed'
  if (n.browser) return 'check the page in a browser and take a screenshot'
  return undefined
}

// ---------- the brief ----------

export const BRIEF_PROMPT = `Write a short status brief of this session for the owner: a business-focused person who runs the project and does not read code.
You have no tools: answer straight away, without thinking it over at length. Plain English, short lines, no file paths, no code, no jargon; say what things mean for users and the business.
Use exactly these four headings, each followed by 1 to 4 lines starting with "- " (write "- nothing" if empty):
Done
Left
Risky
Needs you
Under "Needs you" list only decisions or actions only the owner can take. Output only the brief.`

/** Whether the owner is coming back after a break. */
export function isAway(lastActiveAt: number, now: number, awayMinutes: number): boolean {
  return lastActiveAt > 0 && now - lastActiveAt > awayMinutes * 60_000
}
