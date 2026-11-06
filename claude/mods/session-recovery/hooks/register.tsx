import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RecoverRow } from '../types'
import { BEAT_MS, KEEP_MS, type Rec, ago, candidates, projectOf, resumeLine, wtArgv } from './recover.ts'

const PANE = 'session-recovery'
const rows = atom({ plugin: 'session-recovery', key: 'rows' } as const, [] as RecoverRow[], { shape: 'rows-1' })

let dir = ''
let isWindows = false
let title = ''
let startedAt = 0
let isInteractive = true

async function setup($: EngineInterface) {
  const win = await $.env.get('USERPROFILE')
  isWindows = win !== undefined
  const home = (win ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
  dir = `${home}/.claude/session-recovery`
}

// One file per session: several Claude processes never write the same file.
const fileOf = (id: string) => `${dir}/${id}.json`

async function readAll($: EngineInterface): Promise<Rec[]> {
  const entries = await $.fs.list(dir).catch(() => [])
  const out: Rec[] = []
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    const text = await $.fs.read(`${dir}/${f.name}`).catch(() => undefined)
    if (typeof text !== 'string') continue
    try {
      out.push(JSON.parse(text) as Rec)
    } catch {
      // a half-written file from the crash itself: skip it
    }
  }
  return out
}

async function remove($: EngineInterface, id: string) {
  const path = fileOf(id)
  const argv = isWindows ? ['powershell', '-NoProfile', '-Command', `Remove-Item -LiteralPath '${path.replace(/'/g, "''")}' -Force -ErrorAction SilentlyContinue`] : ['rm', '-f', path]
  await $.process.run(argv, { timeoutMs: 15_000 }).catch(() => undefined)
}

async function beat($: EngineInterface, ended = false) {
  const id = await $.session.id()
  const now = await $.clock.now()
  const rec: Rec = { id, cwd: await $.session.cwd(), title, startedAt: startedAt || now, lastBeat: now, ended, isInteractive }
  await $.fs.write(fileOf(id), JSON.stringify(rec))
}

async function bootTime($: EngineInterface): Promise<number | undefined> {
  if (!isWindows) {
    const stat = await $.fs.read('/proc/stat').catch(() => undefined)
    const btime = typeof stat === 'string' ? stat.match(/^btime\s+(\d+)/m)?.[1] : undefined
    return btime ? Number(btime) * 1000 : undefined
  }
  const r = await $.process
    .run(['powershell', '-NoProfile', '-Command', "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')"], { timeoutMs: 20_000 })
    .catch(() => undefined)
  const t = r?.exitCode === 0 ? Date.parse(r.stdout.trim()) : NaN
  return Number.isFinite(t) ? t : undefined
}

async function refresh($: EngineInterface): Promise<RecoverRow[]> {
  const now = await $.clock.now()
  const all = await readAll($)
  for (const r of all) if (now - r.lastBeat > KEEP_MS || (r.ended && now - r.lastBeat > 60 * 60_000)) void remove($, r.id)
  const list = candidates(all, now, await bootTime($), await $.session.id()).map(c => ({
    id: c.id,
    cwd: c.cwd,
    title: c.title,
    lastBeat: c.lastBeat,
    isFromBeforeBoot: c.isFromBeforeBoot,
  }))
  await update($, rows, () => list)
  return list
}

async function reopen($: EngineInterface, list: readonly RecoverRow[]): Promise<string> {
  if (list.length === 0) return 'Nothing to reopen.'
  const recs = list.map(r => ({ ...r, startedAt: 0, ended: false, isInteractive: true }))
  if (isWindows) {
    const r = await $.process.run(wtArgv(recs), { timeoutMs: 30_000 }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))
    if (r.exitCode !== 0) {
      await $.prompt.fill({ text: recs.map(resumeLine).join('\n'), mode: 'replace' })
      return `Windows Terminal did not start (${r.stderr.trim().slice(0, 120)}). The resume commands are in your prompt box.`
    }
  } else if (await $.env.get('TMUX')) {
    for (const r of recs) await $.process.run(['tmux', 'new-window', '-c', r.cwd, '-n', projectOf(r.cwd), `claude --resume ${r.id}`], { timeoutMs: 15_000 }).catch(() => undefined)
  } else {
    await $.prompt.fill({ text: recs.map(resumeLine).join('\n'), mode: 'replace' })
    return 'No Windows Terminal or tmux here: the resume commands are in your prompt box.'
  }
  for (const r of list) await remove($, r.id) // each resumed session records itself again
  await update($, rows, l => l.filter(x => !list.some(y => y.id === x.id)))
  return `Reopened ${list.length} session${list.length > 1 ? 's' : ''}.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await setup($)
    isInteractive = e.isInteractive
    startedAt = await $.clock.now()
    if (!e.isInteractive) return started
    await $.command.register({ name: 'recover', description: 'Reopen sessions that were open before a restart or crash', argumentHint: '[all | auto on|off]' })
    await beat($)
    $.clock.every(BEAT_MS, () => void beat($))

    void (async () => {
      const list = await refresh($)
      const killed = list.filter(r => r.isFromBeforeBoot)
      if (killed.length === 0) return
      // Only one session after a boot acts on it.
      const boot = Math.min(...killed.map(r => r.lastBeat))
      if ((await $.store.get('handledBoot')) === boot) return
      await $.store.set('handledBoot', boot)
      if ((await $.store.get('auto')) === true) {
        $.ui.toast(await reopen($, killed), { timeoutMs: 8000 })
        return
      }
      $.ui.toast(`${killed.length} session${killed.length > 1 ? 's were' : ' was'} open before the restart. /recover`, { timeoutMs: 10000 })
      void $.prompt.suggest({ text: '/recover' })
      void $.ui.open({ id: PANE, title: 'Recover sessions' })
    })()
    return started
  })

  // The first thing the person asks names the session in the list.
  on('prompt.submit', async ($, e, next) => {
    if (!title && (e.origin.kind === 'composer' || e.origin.kind === 'bridge') && !e.command) title = e.text.slice(0, 60)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // A clean exit or /clear: not a session to recover. (A restart never gets here.)
    const id = e.sessionId
    const now = await $.clock.now()
    if (dir) await $.fs.write(fileOf(id), JSON.stringify({ id, cwd: '', title, startedAt, lastBeat: now, ended: true, isInteractive } satisfies Rec)).catch(() => undefined)
    if (e.reason === 'clear') title = ''
    return next(e)
  })

  on('command.run', { command: 'recover' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg.startsWith('auto')) {
      const isOn = arg.endsWith('on')
      await $.store.set('auto', isOn)
      return { text: `session-recovery: after a restart, the first session ${isOn ? 'reopens everything by itself' : 'asks first'}.` }
    }
    const list = await refresh($)
    if (arg === 'all') return { text: await reopen($, list) }
    await $.ui.open({ id: PANE, title: 'Recover sessions' })
    return { text: list.length === 0 ? 'No sessions to recover.' : `${list.length} session${list.length > 1 ? 's' : ''} to recover (pane open).` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const n = (await read($, rows)).filter(r => r.isFromBeforeBoot).length
    if (e.props.hasSurvey || n === 0) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text color="warning">recover: {n} session{n > 1 ? 's' : ''} from before the restart (/recover)</Text>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, rows)
    const now = Date.now()
    const dismiss = async (ids: string[]) => {
      for (const id of ids) await remove($, id)
      await update($, rows, l => l.filter(x => !ids.includes(x.id)))
    }
    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>Nothing to recover.</Text>}
        {list.length > 0 && (
          <Box>
            <Button key="all" label={`Reopen all (${list.length})`} variant="primary" onPress={async () => $.ui.toast(await reopen($, list))} />
            <Button key="none" label="Dismiss all" onPress={() => dismiss(list.map(r => r.id))} />
          </Box>
        )}
        {list.map(r => (
          <Box flexDirection="column" key={`r-${r.id}`}>
            <Text bold>
              {r.isFromBeforeBoot ? '⟲ ' : ''}
              {projectOf(r.cwd)} · {ago(now - r.lastBeat)}
            </Text>
            <Text dimColor>{r.title || r.id}</Text>
            <Box>
              <Button key={`o-${r.id}`} label="Reopen" onPress={async () => $.ui.toast(await reopen($, [r]))} />
              <Button key={`d-${r.id}`} label="Dismiss" onPress={() => dismiss([r.id])} />
            </Box>
          </Box>
        ))}
      </Box>
    )
  })
}
