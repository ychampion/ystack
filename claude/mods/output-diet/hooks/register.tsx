import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Mode, Stats, Trim } from '../types'
import { estimateTokens, looksLikeData, note, safeName, shouldShorten, trimOutput, type Trimmed } from './trim.ts'

const PANE = 'output-diet'
const stats = atom({ plugin: 'output-diet', key: 'stats' } as const, { trims: 0, savedChars: 0, recent: [] } as Stats, { shape: 'stats-1' })
const mode = atom({ plugin: 'output-diet', key: 'mode' } as const, 'default' as Mode)

let isEnabled = true
let maxLines = 150

async function isActive($: EngineInterface): Promise<boolean> {
  const m = await read($, mode)
  return m === 'on' || (m === 'default' && isEnabled)
}

async function savedRoot($: EngineInterface): Promise<string> {
  const home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.').replace(/\\/g, '/')
  return `${home}/.claude/output-diet`
}

async function saveFull($: EngineInterface, command: string, body: string): Promise<string> {
  const dir = `${await savedRoot($)}/${safeName(await $.session.id())}`
  const path = `${dir}/${await $.clock.now()}.txt`
  await $.fs.write(path, `$ ${command}\n\n${body}`)
  return path
}

async function record($: EngineInterface, command: string, t: { fromLines: number; toLines: number; savedChars: number }, path: string) {
  const trim: Trim = { at: await $.clock.now(), command: command.replace(/\s+/g, ' ').slice(0, 80), ...t, path }
  await update($, stats, s => ({ trims: s.trims + 1, savedChars: s.savedChars + t.savedChars, recent: [trim, ...s.recent].slice(0, 10) }))
}

const KEEP_DAYS = 7
const MAX_DELETES = 200 // per session start; the rest go next time (keeps the path list well under Windows' variable limit)

/**
 * Deletes saved outputs older than 7 days: a session folder whose files are all old goes whole, otherwise its old
 * files go one by one. Runs once per session start, off the start's path; a failure leaves the files for next time.
 */
async function deleteOldOutputs($: EngineInterface) {
  const root = await savedRoot($)
  if (!/^([a-z]:)?\//i.test(root) || (await $.fs.exists(root)) !== true) return
  const cutoff = (await $.clock.now()) - KEEP_DAYS * 86_400_000
  const doomed: string[] = []
  for (const d of await $.fs.list(root)) {
    if (d.kind !== 'dir' || doomed.length >= MAX_DELETES) continue
    const dir = `${root}/${d.name}`
    const files = await $.fs.list(dir)
    const old = files.filter(f => f.kind === 'file' && f.mtimeMs > 0 && f.mtimeMs < cutoff)
    if (files.length > 0 && old.length === files.length) doomed.push(dir)
    else for (const f of old) doomed.push(`${dir}/${f.name}`)
  }
  if (doomed.length === 0) return
  const paths = doomed.slice(0, MAX_DELETES)
  // No shell parses the paths: on Windows they ride in an environment variable, elsewhere as rm's own arguments.
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const r = isWindows
    ? await $.process.run(
        [
          'powershell.exe',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '$env:OD_PATHS.Split([char]10) | Where-Object { $_ } | ForEach-Object { Remove-Item -LiteralPath $_ -Recurse -Force -ErrorAction SilentlyContinue }',
        ],
        { env: { OD_PATHS: paths.join('\n') }, timeoutMs: 60_000 },
      )
    : await $.process.run(['rm', '-rf', '--', ...paths], { timeoutMs: 60_000 })
  if (r.exitCode !== 0) $.ui.log(`output-diet: could not delete some saved outputs older than ${KEEP_DAYS} days: ${r.stderr.slice(0, 300)}`, { to: 'debug' })
}

type Shell = { tool: 'Bash' | 'PowerShell'; command: string; run_in_background?: boolean }

async function shorten($: EngineInterface, e: Shell, ran: ToolCallResult): Promise<ToolCallResult> {
  if (ran.deny !== undefined || e.run_in_background === true) return ran
  if (!shouldShorten(e.command) || !(await isActive($))) return ran

  // A failed command: its text is all the model reads. A hook cannot hand back an errored result of its own
  // (the engine checks it against the tool's success shape), but a deny keeps it an error with the text replaced.
  if (ran.isError === true) {
    const text = typeof ran.text === 'string' ? ran.text : typeof ran.result === 'string' ? ran.result : ''
    const t = trimOutput(text, maxLines)
    if (!t) return ran
    const path = await saveFull($, e.command, text)
    await record($, e.command, { fromLines: t.fromLines, toLines: t.toLines, savedChars: t.fromChars - t.toChars }, path)
    return { deny: `${t.text}\n${note(t.fromLines, path)}` }
  }

  const rec = ran.result as Record<string, unknown> | undefined
  if (!rec || typeof rec.stdout !== 'string') return ran
  if (rec.isImage === true || rec.persistedOutputPath !== undefined || rec.backgroundTaskId !== undefined) return ran
  const stdout = rec.stdout
  const stderr = typeof rec.stderr === 'string' ? rec.stderr : ''
  if (looksLikeData(stdout)) return ran
  const out: Trimmed | undefined = trimOutput(stdout, maxLines)
  const err: Trimmed | undefined = trimOutput(stderr, maxLines)
  if (!out && !err) return ran

  const fromLines = (out?.fromLines ?? stdout.split('\n').length) + (err?.fromLines ?? (stderr ? stderr.split('\n').length : 0))
  const path = await saveFull($, e.command, stderr ? `${stdout}\n\n--- stderr ---\n${stderr}` : stdout)
  const tail = note(fromLines, path)
  const newOut = out ? out.text : stdout
  const newErr = err ? err.text : stderr
  const saved = (out ? out.fromChars - out.toChars : 0) + (err ? err.fromChars - err.toChars : 0)
  const toLines = newOut.split('\n').length + (newErr ? newErr.split('\n').length : 0)
  await record($, e.command, { fromLines, toLines, savedChars: saved }, path)
  // A result without `ref` is mapped for the model afresh from this record, the tool's own fields kept.
  const result = out || !err ? { ...rec, stdout: `${newOut}\n${tail}`, stderr: newErr } : { ...rec, stdout: newOut, stderr: `${newErr}\n${tail}` }
  return ran.context ? { result, context: ran.context } : { result }
}

export const register: Register = (on, options) => {
  isEnabled = options.enabled !== false
  maxLines = typeof options.maxLines === 'number' && options.maxLines >= 80 ? Math.floor(options.maxLines) : 150

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'output-diet',
      description: 'Long command output shortener: open the pane, or turn it `off` / `on` for this session',
      argumentHint: '[on|off]',
    })
    // A timer, so the cleanup outlives the start's dispatch and never delays it.
    $.clock.after(0, () => {
      deleteOldOutputs($).catch(err => $.ui.log(`output-diet: old saved outputs were not cleaned up: ${String(err)}`, { to: 'debug' }))
    })
    return next(e)
  })

  on('command.run', { command: 'output-diet' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await update($, mode, () => arg)
      return {
        text:
          arg === 'off'
            ? 'Output shortening is off for this session. Long command output reaches Claude in full.'
            : 'Output shortening is on for this session.',
      }
    }
    await $.ui.open({ id: PANE, title: 'Output diet' })
    return { text: 'Output diet pane opened.' }
  })

  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const ran = await next(e)
    try {
      return await shorten($, e as Shell, ran)
    } catch {
      return ran // a failure here never costs the model its output
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, stats)
    const isOn = await isActive($)
    return (
      <Box flexDirection="column">
        <Text bold>{isOn ? `On: shortens build, install and test output over ${maxLines} lines` : 'Off for this session'}</Text>
        <Text>
          {s.trims} output{s.trims === 1 ? '' : 's'} shortened · about {estimateTokens(s.savedChars).toLocaleString('en-US')} tokens saved (estimate)
        </Text>
        <Text dimColor>File contents, diffs and searches always pass through untouched. Every full output is saved.</Text>
        {s.recent.length > 0 && <Text bold>Latest</Text>}
        {s.recent.map(t => (
          <Box flexDirection="column">
            <Text>
              {t.command} · {t.fromLines} → {t.toLines} lines
            </Text>
            <Text dimColor>  {t.path}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
