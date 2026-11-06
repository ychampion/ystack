import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { GateView, LiveView } from '../types'
import {
  CHECK_CMD,
  CLAIM,
  CODE_FILE,
  DOC_FILE,
  MANIFESTS,
  type Manifest,
  dirOf,
  failureLines,
  norm,
  planRun,
  suggestCheck,
} from './detect.ts'

const PANE = 'live-tests'
const DEBOUNCE_MS = 5000
const RUN_TIMEOUT_MS = 180_000

const live = atom({ plugin: 'verify', key: 'live' } as const, { status: 'idle', label: '', root: '', lines: [], at: 0 } as LiveView, {
  shape: 'live-1',
})
const gate = atom({ plugin: 'verify', key: 'gate' } as const, { edits: 0, checks: 0, files: [] } as GateView, { shape: 'gate-1' })
const isOff = atom({ plugin: 'verify', key: 'isOff' } as const, false)

// Per model loop ('main' or a subagent id): edits since the loop's task began, checks since its last edit.
type Loop = { files: Set<string>; checksSinceEdit: number; liveAfterEdit: 'none' | 'pass' | 'fail' }
const loops = new Map<string, Loop>()
const loopOf = (key: string): Loop => {
  let l = loops.get(key)
  if (!l) loops.set(key, (l = { files: new Set(), checksSinceEdit: 0, liveAfterEdit: 'none' }))
  return l
}

// Live runs, one per project root.
type Root = { timer?: Timer; isRunning: boolean; isPending: boolean; files: Set<string>; owners: Set<string>; lastSig: string; wasFailing: boolean }
const roots = new Map<string, Root>()
const notes = new Map<string, string[]>() // loop -> notes for its next tool result
const tracked = new Map<string, { at: number; files: string[] }>()

const say = (loop: string, text: string) => notes.set(loop, [...(notes.get(loop) ?? []), text])

async function findRoot($: EngineInterface, file: string): Promise<{ root: string; manifest: Manifest } | undefined> {
  let dir = dirOf(file)
  for (let i = 0; i < 12 && dir.length > 2; i++) {
    for (const m of MANIFESTS) if (await $.fs.exists(`${dir}/${m}`)) return { root: dir, manifest: m }
    const up = dirOf(dir)
    if (up === dir) break
    dir = up
  }
  return undefined
}

async function trackedFiles($: EngineInterface, root: string): Promise<string[]> {
  const now = await $.clock.now()
  const hit = tracked.get(root)
  if (hit && now - hit.at < 5 * 60_000) return hit.files
  const r = await $.process.run(['git', 'ls-files'], { cwd: root, timeoutMs: 20_000 }).catch(() => undefined)
  const files = r && r.exitCode === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : []
  tracked.set(root, { at: now, files })
  return files
}

async function runLive($: EngineInterface, root: string, manifest: Manifest) {
  const st = roots.get(root)
  if (!st) return
  if (st.isRunning) {
    st.isPending = true
    return
  }
  if (await read($, isOff)) return
  if (await $.fs.exists(`${root}/.claude/live-tests.off`)) return

  const edited = [...st.files]
  const owners = [...st.owners]
  st.files.clear()
  st.owners.clear()
  const packageJson = manifest === 'package.json' ? await $.fs.read(`${root}/package.json`).catch(() => undefined) : undefined
  const plan = planRun({
    manifest,
    packageJson: typeof packageJson === 'string' ? packageJson : undefined,
    edited,
    tracked: await trackedFiles($, root),
    root,
  })
  if (!plan) return

  st.isRunning = true
  await update($, live, (v): LiveView => ({ ...v, status: 'running', label: plan.label, root }))
  const started = await $.clock.now()
  const r = await $.process.run(plan.argv, { cwd: root, timeoutMs: RUN_TIMEOUT_MS }).catch((err: unknown) => ({
    exitCode: -1,
    stdout: '',
    stderr: String(err),
  }))
  st.isRunning = false
  const output = `${r.stdout}\n${r.stderr}`
  const isPass = r.exitCode === 0
  const lines = isPass ? [] : failureLines(output)
  const status = r.exitCode === -1 ? 'error' : isPass ? 'pass' : 'fail'
  await update($, live, () => ({ status, label: plan.label, root, lines, at: started }))

  for (const o of owners) loopOf(o).liveAfterEdit = isPass ? 'pass' : status === 'fail' ? 'fail' : loopOf(o).liveAfterEdit
  const sig = lines.join('\n')
  if (status === 'fail' && sig !== st.lastSig) {
    for (const o of owners) say(o, `live-tests: ${plan.label} FAILED after your edits:\n${lines.map(l => `  ${l}`).join('\n')}`)
  } else if (isPass) {
    if (st.wasFailing) for (const o of owners) say(o, `live-tests: ${plan.label} pass again.`)
  }
  st.lastSig = status === 'fail' ? sig : ''
  st.wasFailing = status === 'fail'

  if (st.isPending) {
    st.isPending = false
    void runLive($, root, manifest)
  }
}

async function onEdit($: EngineInterface, loop: string, file: string) {
  if (DOC_FILE.test(file)) return // a handoff or README written after the checks is not unverified code
  const l = loopOf(loop)
  l.files.add(norm(file))
  l.checksSinceEdit = 0
  l.liveAfterEdit = 'none'
  await update($, gate, g => ({ edits: g.edits + 1, checks: 0, files: [...new Set([...g.files, norm(file)])].slice(-50) }))
  if (!CODE_FILE.test(file)) return
  const found = await findRoot($, file)
  if (!found) return
  let st = roots.get(found.root)
  if (!st) roots.set(found.root, (st = { isRunning: false, isPending: false, files: new Set(), owners: new Set(), lastSig: '', wasFailing: false }))
  st.files.add(norm(file))
  st.owners.add(loop)
  st.timer?.cancel()
  st.timer = $.clock.after(DEBOUNCE_MS, () => void runLive($, found.root, found.manifest))
}

function gateReason(loop: string, lastText: string, hint: string): string | undefined {
  const l = loops.get(loop)
  if (!l || l.files.size === 0 || !CLAIM.test(lastText)) return undefined
  if (l.liveAfterEdit === 'fail')
    return 'verify: your reply claims success, but the related tests are failing after your edits (see the live-tests note). Fix them, or say plainly which failures are unrelated and why.'
  if (l.checksSinceEdit > 0 || l.liveAfterEdit === 'pass') return undefined
  const files = [...l.files].slice(0, 5).map(f => f.replace(/^.*\//, '')).join(', ')
  return `verify: you edited ${l.files.size} file(s) (${files}) and claim it works, but ran no check after the last edit. Run ${hint} (or a real run of what changed) and report what it showed, or say plainly that it is unverified.`
}

async function hintFor($: EngineInterface, loop: string): Promise<string> {
  const first = [...(loops.get(loop)?.files ?? [])][0]
  const found = first ? await findRoot($, first) : undefined
  const pkg = found?.manifest === 'package.json' ? await $.fs.read(`${found.root}/package.json`).catch(() => undefined) : undefined
  return `\`${suggestCheck(found?.manifest, typeof pkg === 'string' ? pkg : undefined)}\``
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'live-tests', description: 'Live related-test runner: open the pane, or `off` / `on`', argumentHint: '[on|off]' })
    return next(e)
  })

  on('command.run', { command: 'live-tests' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      await update($, isOff, () => arg === 'off')
      return { text: `live-tests ${arg} for this session (per project: create or delete .claude/live-tests.off).` }
    }
    await $.ui.open({ id: PANE, title: 'Live tests' })
    return { text: 'Live tests pane opened.' }
  })

  // A new task from the owner starts the main loop's ledger fresh.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') {
      loops.delete('main')
      await update($, gate, () => ({ edits: 0, checks: 0, files: [] }))
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const loop = e.agentId ?? 'main'
    const ran = await next(e)
    if (ran.deny !== undefined) return ran

    if (ran.isError !== true) {
      if (e.tool === 'Edit' || e.tool === 'Write') await onEdit($, loop, e.file_path)
      else if (e.tool === 'NotebookEdit') await onEdit($, loop, e.notebook_path)
      else if (e.tool === 'Monitor' || ((e.tool === 'Bash' || e.tool === 'PowerShell') && CHECK_CMD.test(e.command))) {
        loopOf(loop).checksSinceEdit += 1
        if (loop === 'main') await update($, gate, g => ({ ...g, checks: g.checks + 1 }))
      }
    } else if ((e.tool === 'Bash' || e.tool === 'PowerShell') && CHECK_CMD.test(e.command)) {
      loopOf(loop).checksSinceEdit += 1 // a failing check is still evidence the model saw
    }

    const pending = notes.get(loop)
    if (!pending || pending.length === 0) return ran
    notes.delete(loop)
    return { ...ran, context: [...(ran.context ?? []), ...pending] }
  })

  on('classic.Stop', async ($, e, next) => {
    if (e.stop_hook_active) return next(e)
    const reason = gateReason('main', e.last_assistant_message ?? '', await hintFor($, 'main'))
    return reason ? { block: reason } : next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SubagentStop', async ($, e, next) => {
    if (e.stop_hook_active) return next(e)
    const reason = gateReason(e.agent_id, e.last_assistant_message ?? '', await hintFor($, e.agent_id))
    loops.delete(e.agent_id)
    return reason ? { block: reason } : next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const g = await read($, gate)
    const v = await read($, live)
    const isFailing = v.status === 'fail'
    const isUnchecked = g.edits > 0 && g.checks === 0 && v.status !== 'pass'
    if (e.props.hasSurvey || (!isFailing && !isUnchecked && v.status !== 'running')) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        {isUnchecked && <Text dimColor>verify: {g.edits} edit{g.edits === 1 ? '' : 's'}, no check yet </Text>}
        {v.status === 'running' && <Text dimColor>· running {v.label} </Text>}
        {isFailing && <Text color="error">· ✗ {v.label}: {v.lines.length} failing line{v.lines.length === 1 ? '' : 's'} (/live-tests)</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, live)
    const off = await read($, isOff)
    return (
      <Box flexDirection="column">
        <Text bold>{off ? 'off for this session' : v.status === 'idle' ? 'waiting for a code edit' : `${v.status} · ${v.label}`}</Text>
        {v.root !== '' && <Text dimColor>{v.root}</Text>}
        {v.lines.map(l => (
          <Text>{l}</Text>
        ))}
      </Box>
    )
  })
}
