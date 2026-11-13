import type { EngineInterface, Register } from 'claude-code'

import { type Thread, commitDir, keepPrompts, lastReasoning, parseTarget, shasIn, show } from './threads'

// One small file per commit, on this machine only: nothing is written to git history or pushed.
let dir = ''
let prompts: string[] = []
const MAX_COMMITS = 8

async function setup($: EngineInterface) {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  dir = home ? `${home}/.claude/code-threads` : ''
}

async function git($: EngineInterface, cwd: string, args: string[], timeoutMs = 15_000): Promise<string | undefined> {
  const r = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs }).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout : undefined
}

async function load($: EngineInterface, sha: string): Promise<Thread | undefined> {
  if (!dir) return undefined
  const text = await $.fs.read(`${dir}/${sha}.json`).catch(() => undefined)
  if (typeof text !== 'string') return undefined
  try {
    return JSON.parse(text) as Thread
  } catch {
    return undefined
  }
}

/** A commit command just ran: if it made a commit, keep who asked for it and why. */
async function record($: EngineInterface, cwd: string, agentId: string | undefined) {
  if (!dir) return
  const out = await git($, cwd, ['log', '-1', '--format=%H%x00%ct%x00%s'])
  const [sha, ct, subject] = (out ?? '').trim().split('\0')
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) return
  const at = Number(ct) * 1000
  // HEAD is this command's commit only if it is brand new (a failed commit leaves an older HEAD).
  if (!(Math.abs((await $.clock.now()) - at) < 120_000)) return
  const repo = ((await git($, cwd, ['rev-parse', '--show-toplevel'])) ?? cwd).trim()
  const files = ((await git($, cwd, ['show', '--name-only', '--format=', sha])) ?? '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 60)
  const messages = await $.session.messages().catch(() => [])
  const t: Thread = {
    sha,
    repo,
    subject: subject ?? '',
    at,
    sessionId: await $.session.id(),
    ...(agentId ? { agentId } : {}),
    cwd: await $.session.cwd(),
    prompts,
    reasoning: lastReasoning(messages),
    files,
  }
  await $.fs.write(`${dir}/${sha}.json`, JSON.stringify(t, null, 2))
}

/** The commits that shaped a line (or a file), newest first, each with its thread when there is one. */
async function why($: EngineInterface, target: { file: string; line?: number }): Promise<string> {
  const cwd = await $.session.cwd()
  const file = target.file.replace(/\\/g, '/')
  const absolute = /^([A-Za-z]:)?\//.test(file)
  const where = absolute ? file.replace(/\/[^/]*$/, '') || '/' : cwd
  const range = target.line ? ['log', `-L${target.line},${target.line}:${file}`, '--format=%H', '-s', `-n${MAX_COMMITS}`] : ['log', '--format=%H', `-n${MAX_COMMITS}`, '--', file]
  const log = await git($, where, range, 30_000)
  if (log === undefined) return `code-threads: git found no history for ${file}${target.line ? `:${target.line}` : ''} (not in a repo, not committed, or no such line).`
  const shas = shasIn(log)
  if (shas.length === 0) return `code-threads: ${file}${target.line ? `:${target.line}` : ''} has no committed history yet.`
  const parts: string[] = []
  let threads = 0
  for (const sha of shas) {
    const meta = ((await git($, where, ['show', '-s', '--format=%ct%x00%an%x00%s', sha])) ?? '').trim().split('\0')
    const t = await load($, sha)
    if (t) threads++
    parts.push(show({ sha, at: Number(meta[0]) * 1000, author: meta[1] ?? '', subject: meta[2] ?? '' }, t))
  }
  const what = `${file}${target.line ? `:${target.line}` : ''}`
  return `${what}: ${shas.length} commit${shas.length > 1 ? 's' : ''}, ${threads} with a Claude thread\n\n${parts.join('\n\n')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await setup($)
    await $.command.register({ name: 'why', description: 'Which conversation produced this code, and why: /why <file>[:line]', argumentHint: '<file>[:line]' })
    await $.tool.register({
      name: 'why',
      description:
        'Trace code back to the Claude conversation that wrote it. Given a file and line (or a whole file), returns the commits that shaped it, newest first, ' +
        'and for each commit made in a Claude session: what the person asked, the reasoning given just before the commit, and the session id to reopen. ' +
        'Use before changing code whose intent is unclear, when asked "why is this like this", or when a decision seems arbitrary.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Path to the file, relative to the working directory or absolute' },
          line: { type: 'number', description: 'Line number (1-based). Leave out for the whole file.' },
        },
        required: ['file'],
      },
      isDeferred: false,
    })
    return started
  })

  // Remember the last few things the person asked: the "why" of the next commit.
  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    if ((kind === 'composer' || kind === 'bridge' || kind === 'sdk') && !e.command) prompts = keepPrompts(prompts, e.text)
    return next(e)
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.isError === true || ran.deny !== undefined) return ran
    const at = commitDir(e.command ?? '', await $.session.cwd())
    if (at) await record($, at, e.agentId).catch(() => undefined) // never fail the command over a note
    return ran
  })

  on('tool.call', { tool: 'mcp__code-threads__why' }, async ($, e) => {
    const input = e as unknown as { file?: string; line?: number }
    const file = String(input.file ?? '').trim()
    if (!file) return { result: 'code-threads: give a file (and optionally a line).' }
    const line = typeof input.line === 'number' && input.line > 0 ? Math.floor(input.line) : undefined
    return { result: await why($, { file, ...(line ? { line } : {}) }) }
  })

  on('command.run', { command: 'why' }, async ($, e) => {
    const target = parseTarget(e.args)
    if (!target) return { text: 'Usage: /why <file>[:line]' }
    return { text: await why($, target) }
  })
}
