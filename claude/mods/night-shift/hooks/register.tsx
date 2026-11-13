import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { NightShift, NightTask } from '../types'
import { parseAt, parseStatus, wrap } from './queue.ts'

const PANE = 'night-shift'
const BUDGET_USD = 40
const BUDGET_HOURS = 3
const COMPACT_ABOVE = 300_000
const RATE_PAUSE = 95

const shift = atom({ plugin: 'night-shift', key: 'shift' } as const, { tasks: [], isActive: false } as NightShift, { shape: 'shift-1' })
let startTimer: Timer | undefined

async function persist($: EngineInterface) {
  await $.store.set('shift', await read($, shift))
}
async function set($: EngineInterface, fn: (s: NightShift) => NightShift) {
  await update($, shift, fn)
  await persist($)
}
const running = (s: NightShift) => s.tasks.find(t => t.status === 'running')

async function costNow($: EngineInterface): Promise<number> {
  return (await $.session.usage()).cost?.usd ?? 0
}

async function startNext($: EngineInterface) {
  const s = await read($, shift)
  if (!s.isActive || running(s)) return
  const usage = await $.session.usage()
  const hot = usage.rateLimits.find(r => r.percentUsed >= RATE_PAUSE)
  if (hot) {
    await set($, x => ({ ...x, isActive: false, note: `paused: ${hot.kind} at ${hot.percentUsed}%` }))
    void $.ui.notify(`Night shift paused: ${hot.kind} limit at ${hot.percentUsed}%.`, { title: 'night-shift' })
    return
  }
  const pending = s.tasks.filter(t => t.status === 'pending')
  const task = pending[0]
  if (!task) {
    await set($, x => ({ ...x, isActive: false, note: 'queue finished' }))
    const done = s.tasks.filter(t => t.status === 'done').length
    const other = s.tasks.filter(t => t.status === 'blocked' || t.status === 'failed' || t.status === 'unclear').length
    void $.ui.notify(`Night shift finished: ${done} done, ${other} need you. /queue report`, { title: 'night-shift' })
    return
  }
  if ((usage.context.tokens ?? 0) > COMPACT_ABOVE) {
    await $.session.compact({ instructions: 'Keep the night-shift queue, each finished task’s outcome, and every open decision.' }).catch(() => undefined)
  }
  const index = s.tasks.findIndex(t => t.id === task.id) + 1
  const now = await $.clock.now()
  const costStart = await costNow($)
  await set($, x => ({ ...x, tasks: x.tasks.map(t => (t.id === task.id ? { ...t, status: 'running', startedAt: now, costStart } : t)) }))
  await $.prompt.submit({ text: wrap(task, index, s.tasks.length, BUDGET_USD, BUDGET_HOURS) })
}

async function finish($: EngineInterface, status: NightTask['status'], summary: string) {
  const now = await $.clock.now()
  const cost = await costNow($)
  await set($, x => ({
    ...x,
    tasks: x.tasks.map(t => (t.status === 'running' ? { ...t, status, summary, endedAt: now, cost: cost - (t.costStart ?? cost) } : t)),
  }))
  $.clock.after(5000, () => void startNext($))
}

const fmt = (t: NightTask) => {
  const mins = t.startedAt ? Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 60000) : 0
  return `#${t.id} ${t.status}${t.startedAt ? ` · ${mins}m` : ''}${t.cost !== undefined ? ` · $${t.cost.toFixed(2)}` : ''}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'queue',
      description: 'Night shift: add <task> | list | start [HH:MM] | stop | skip | clear | report',
      argumentHint: 'add <task> | start [HH:MM] | stop | report',
    })
    const saved = await $.store.get('shift')
    if (saved && typeof saved === 'object') {
      // A restart mid-task: hand the running task back as pending, inactive until started again.
      const s = saved as NightShift
      await update($, shift, () => ({ ...s, isActive: false, tasks: s.tasks.map(t => (t.status === 'running' ? { ...t, status: 'pending' } : t)) }))
    }
    return next(e)
  })

  on('command.run', { command: 'queue' }, async ($, e) => {
    const [verb = 'list', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ').trim()
    const s = await read($, shift)
    switch (verb.toLowerCase()) {
      case 'add': {
        if (!arg) return { text: 'queue: /queue add <the task, as you would brief me>' }
        const id = Math.max(0, ...s.tasks.map(t => t.id)) + 1
        await set($, x => ({ ...x, tasks: [...x.tasks, { id, text: arg, status: 'pending' }] }))
        return { text: `queue: #${id} added (${s.tasks.filter(t => t.status === 'pending').length + 1} pending).` }
      }
      case 'start': {
        startTimer?.cancel()
        const at = arg ? parseAt(arg, new Date(await $.clock.now())) : undefined
        if (arg && at === undefined) return { text: 'queue: start time is HH:MM (24h).' }
        if (at !== undefined) {
          await set($, x => ({ ...x, startAt: at, note: `starts ${arg}` }))
          startTimer = $.clock.every(60_000, () => {
            void (async () => {
              if ((await $.clock.now()) < at) return
              startTimer?.cancel()
              await set($, x => ({ ...x, isActive: true, startAt: undefined, note: undefined }))
              await startNext($)
            })()
          })
          return { text: `queue: night shift starts at ${arg}. Keep this session open (an always-on machine is best).` }
        }
        await set($, x => ({ ...x, isActive: true, note: undefined }))
        $.clock.after(0, () => void startNext($)) // after the command returns: a submit from inside it is refused
        return { text: 'queue: night shift started.' }
      }
      case 'stop':
        startTimer?.cancel()
        await set($, x => ({ ...x, isActive: false, startAt: undefined, note: 'stopped after the current task' }))
        return { text: 'queue: stops after the current task.' }
      case 'skip':
        if (!running(s)) return { text: 'queue: nothing running.' }
        await finish($, 'skipped', 'skipped by the owner')
        return { text: 'queue: skipped the running task.' }
      case 'clear':
        await set($, x => ({ ...x, tasks: x.tasks.filter(t => t.status === 'running') }))
        return { text: 'queue: cleared (a running task stays).' }
      case 'report':
      case 'list':
        await $.ui.open({ id: PANE, title: 'Night shift' })
        return { text: s.tasks.length === 0 ? 'queue: empty.' : s.tasks.map(t => `${fmt(t)} — ${t.summary ?? t.text.slice(0, 80)}`).join('\n') }
      default:
        return { text: 'queue: add <task> | list | start [HH:MM] | stop | skip | clear | report' }
    }
  })

  on('classic.Stop', async ($, e, next) => {
    const s = await read($, shift)
    const task = running(s)
    if (!task) return next(e)
    const parsed = parseStatus(e.last_assistant_message ?? '')
    if (parsed) {
      await finish($, parsed.status, parsed.summary)
      return next(e)
    }
    if ((e.background_tasks?.length ?? 0) > 0) return next(e) // waiting on its agents: their notifications wake it
    if (e.stop_hook_active) {
      await finish($, 'unclear', 'ended without a NIGHT-SHIFT status line')
      return next(e)
    }
    return { block: 'night-shift: no background work is running and there is no status line. Continue the task, or end with `NIGHT-SHIFT: done|blocked|failed — <summary>`.' }
  }).catch(($, e, next) => next(e))

  // Soft budget: one wrap-up note, never a kill.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined) return done
    const task = running(await read($, shift))
    if (!task || task.wrapUpSent || task.startedAt === undefined) return done
    const spent = (await costNow($)) - (task.costStart ?? 0)
    const hours = ((await $.clock.now()) - task.startedAt) / 3_600_000
    if (spent < BUDGET_USD && hours < BUDGET_HOURS) return done
    await set($, x => ({ ...x, tasks: x.tasks.map(t => (t.id === task.id ? { ...t, wrapUpSent: true } : t)) }))
    void $.prompt.submit({
      text: `night-shift: task #${task.id} passed its soft budget ($${spent.toFixed(2)}, ${hours.toFixed(1)}h). Finish the slice you're in, leave the work in a safe state (committed on its branch, notes written), then end with the NIGHT-SHIFT line.`,
    })
    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s = await read($, shift)
    return (
      <Box flexDirection="column">
        <Text bold>{s.isActive ? 'running' : 'idle'}{s.note ? ` · ${s.note}` : ''}</Text>
        {s.tasks.length === 0 && <Text dimColor>/queue add &lt;task&gt; to queue work.</Text>}
        {s.tasks.map(t => (
          <Box flexDirection="column" key={`t-${t.id}`}>
            <Text color={t.status === 'done' ? 'success' : t.status === 'pending' || t.status === 'running' ? undefined : 'warning'}>{fmt(t)}</Text>
            <Text dimColor>{t.summary ?? t.text.slice(0, 160)}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
