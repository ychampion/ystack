import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LaneRow, LanesView } from '../types'
import {
  type SessionRecord,
  baseName,
  claim,
  claimNote,
  classifyGit,
  conflictNote,
  decideGit,
  dirOf,
  isLive,
  liveClaims,
  normPath,
  relPath,
  repoHash,
  sessionLabel,
  whoHas,
} from './lanes.ts'

const PANE = 'lanes'
const view = atom({ plugin: 'lanes', key: 'view' } as const, { repo: '', sessions: [] } as LanesView, { shape: 'view-1' })

type RepoInfo = { repoId: string; worktree: string; branch: string }
const repos = new Map<string, { info?: RepoInfo; at: number }>() // folder -> repo, cached
const mine = new Map<string, SessionRecord>() // repoId -> this session's record
const peers = new Map<string, { at: number; records: SessionRecord[] }>() // repoId -> every record, cached
const warnedGit = new Map<string, number>()
const warnedConflict = new Set<string>()
let base = ''
let sessionId = ''
let label = ''
let rootRepo: RepoInfo | undefined
let lastBeat = 0
let lastNoticeCheck = 0
let seenNoticeAt = 0

async function lanesDir($: EngineInterface): Promise<string> {
  if (!base) base = `${((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')}/.claude/lanes`
  return base
}
async function myId($: EngineInterface): Promise<string> {
  if (!sessionId) sessionId = await $.session.id()
  return sessionId
}

async function repoOf($: EngineInterface, dir: string): Promise<RepoInfo | undefined> {
  const key = normPath(dir)
  const now = await $.clock.now()
  const hit = repos.get(key)
  if (hit && now - hit.at < 5 * 60_000) return hit.info
  const r = await $.process
    .run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel', '--abbrev-ref', 'HEAD'], { cwd: dir, timeoutMs: 5000 })
    .catch(() => undefined)
  const [common, top, branch] = r && r.exitCode === 0 ? r.stdout.trim().split(/\r?\n/) : []
  const info = common && top ? { repoId: repoHash(common), worktree: normPath(top), branch: branch ?? '' } : undefined
  repos.set(key, { info, at: now })
  return info
}

async function records($: EngineInterface, repoId: string, isFresh = false): Promise<SessionRecord[]> {
  const now = await $.clock.now()
  const hit = peers.get(repoId)
  if (!isFresh && hit && now - hit.at < 15_000) return hit.records
  const dir = `${await lanesDir($)}/${repoId}`
  const out: SessionRecord[] = []
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (f.kind !== 'file' || !f.name.endsWith('.json') || f.name.startsWith('notice-')) continue
    const text = await $.fs.read(`${dir}/${f.name}`).catch(() => undefined)
    try {
      if (typeof text === 'string') out.push(JSON.parse(text) as SessionRecord)
    } catch {
      // a half-written file: skip it this time
    }
  }
  peers.set(repoId, { at: now, records: out })
  return out
}

async function myRecord($: EngineInterface, info: RepoInfo): Promise<SessionRecord> {
  const now = await $.clock.now()
  const have = mine.get(info.repoId)
  const rec: SessionRecord = have
    ? { ...have, label, worktree: info.worktree, branch: info.branch }
    : { sessionId: await myId($), label, repoId: info.repoId, worktree: info.worktree, branch: info.branch, lastActive: now, files: {} }
  return rec
}
async function save($: EngineInterface, rec: SessionRecord) {
  mine.set(rec.repoId, rec)
  await $.fs.write(`${await lanesDir($)}/${rec.repoId}/${rec.sessionId}.json`, JSON.stringify(rec)).catch(() => undefined)
}

async function heartbeat($: EngineInterface) {
  const now = await $.clock.now()
  if (now - lastBeat < 60_000) return
  lastBeat = now
  for (const rec of mine.values()) await save($, { ...rec, label, lastActive: now })
}

// Notices: one file per (to, from) pair, written only by the sender, so no two sessions write one file.
async function sendNotice($: EngineInterface, repoId: string, to: string, text: string) {
  const from = await myId($)
  const path = `${await lanesDir($)}/${repoId}/notice-${to}-${from}.json`
  const prev = await $.fs.read(path).catch(() => undefined)
  let list: { at: number; text: string }[] = []
  try {
    if (typeof prev === 'string') list = JSON.parse(prev) as typeof list
  } catch {
    list = []
  }
  await $.fs.write(path, JSON.stringify([...list.slice(-19), { at: await $.clock.now(), text }])).catch(() => undefined)
}
async function takeNotices($: EngineInterface): Promise<string[]> {
  const now = await $.clock.now()
  if (now - lastNoticeCheck < 20_000 || mine.size === 0) return []
  lastNoticeCheck = now
  const me = await myId($)
  const out: string[] = []
  let newest = seenNoticeAt
  for (const repoId of mine.keys()) {
    const dir = `${await lanesDir($)}/${repoId}`
    for (const f of await $.fs.list(dir).catch(() => [])) {
      if (!f.name.startsWith(`notice-${me}-`)) continue
      const text = await $.fs.read(`${dir}/${f.name}`).catch(() => undefined)
      try {
        for (const n of typeof text === 'string' ? (JSON.parse(text) as { at: number; text: string }[]) : [])
          if (n.at > seenNoticeAt) {
            out.push(n.text)
            newest = Math.max(newest, n.at)
          }
      } catch {
        // skip
      }
    }
  }
  seenNoticeAt = newest
  return out
}

async function refreshView($: EngineInterface) {
  if (!rootRepo) return
  const now = await $.clock.now()
  const me = await myId($)
  const rows: LaneRow[] = (await records($, rootRepo.repoId, true))
    .filter(r => isLive(r, now))
    .map(r => ({ label: r.label, branch: r.branch, worktree: r.worktree, files: liveClaims(r, now), isMe: r.sessionId === me }))
  await update($, view, () => ({ repo: rootRepo ? baseName(rootRepo.worktree) : '', sessions: rows }))
}

export const register: Register = (on, options) => {
  const isBlocking = options.block === true

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lanes', description: 'Show the Claude sessions working in this repo, their branches and the files they hold' })
    const root = await $.session.root()
    label = sessionLabel(baseName(root))
    seenNoticeAt = await $.clock.now()
    rootRepo = await repoOf($, root)
    if (rootRepo) await save($, await myRecord($, rootRepo))
    await refreshView($)
    $.clock.every(30_000, () => void refreshView($).catch(() => undefined))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.command && (e.origin.kind === 'composer' || e.origin.kind === 'bridge') && !label.includes(':')) {
      label = sessionLabel(baseName(await $.session.root()), e.text)
      lastBeat = 0
    }
    await heartbeat($).catch(() => undefined)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    const now = await $.clock.now()
    for (const rec of mine.values()) await save($, { ...rec, files: {}, isEnded: true, lastActive: now })
    mine.clear()
    sessionId = '' // a /clear goes on under a new id
    label = label.replace(/:.*$/, '')
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'lanes' }, async $ => {
    await refreshView($)
    await $.ui.open({ id: PANE, title: 'Lanes' })
    const n = (await read($, view)).sessions.length
    return { text: rootRepo ? `${n} session${n === 1 ? '' : 's'} in this repo; the pane lists them.` : 'This folder is not a git repo, so there are no lanes to show.' }
  })

  on('tool.call', async ($, e, next) => {
    const now = await $.clock.now()
    const notes: string[] = []
    // A long autonomous turn sends no prompts: its tool calls are what keep it counted as live.
    await heartbeat($).catch(() => undefined)

    if (e.tool === 'Edit' || e.tool === 'Write') {
      const info = await repoOf($, dirOf(e.file_path))
      const rel = info ? relPath(e.file_path, info.worktree) : undefined
      if (!info || !rel) return withNotices($, await next(e), notes)
      const me = await myId($)
      const hit = whoHas(await records($, info.repoId), { sessionId: me, worktree: info.worktree }, rel, now)
      if (hit.sameTree && isBlocking) return { deny: `${claimNote(hit.sameTree, rel, now)} (Edits to it are blocked while the other session holds it.)` }
      const ran = await next(e)
      if (ran.deny !== undefined || ran.isError === true) return ran
      await save($, claim(await myRecord($, info), rel, now))
      if (hit.sameTree) notes.push(claimNote(hit.sameTree, rel, now))
      for (const o of hit.otherTrees) {
        const key = `${o.sessionId}|${rel}`
        if (warnedConflict.has(key)) continue
        warnedConflict.add(key)
        notes.push(conflictNote(o, rel))
        const myRec = mine.get(info.repoId)
        if (myRec) await sendNotice($, info.repoId, o.sessionId, conflictNote(myRec, rel))
      }
      return withNotices($, ran, notes)
    }

    if ((e.tool === 'Bash' || e.tool === 'PowerShell') && /\bgit\b/.test(e.command)) {
      const risks = classifyGit(e.command)
      if (risks.length > 0) {
        const root = await $.session.root()
        const info = await repoOf($, root)
        if (info) {
          const me = await myId($)
          const others = (await records($, info.repoId, true)).filter(r => r.sessionId !== me)
          const d = decideGit(e.command, risks, others, normPath(root), warnedGit, now)
          if (d.deny) return { deny: d.deny }
        }
      }
      const ran = await next(e)
      if (/\b(checkout|switch)\b/.test(e.command)) repos.clear() // the branch may have moved
      return withNotices($, ran, notes)
    }

    return withNotices($, await next(e), notes)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    if (e.props.hasSurvey || v.sessions.length < 2) return next(e)
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>lanes: {v.sessions.length} sessions in this repo (/lanes)</Text>
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, view)
    return (
      <Box flexDirection="column">
        {v.sessions.length === 0 && <Text dimColor>No active Claude sessions in this repo.</Text>}
        {v.sessions.map((s, i) => (
          <Box flexDirection="column" key={`s-${i}`}>
            <Text bold>
              {s.isMe ? '(this session) ' : ''}
              {s.label}
            </Text>
            <Text dimColor>
              branch {s.branch || '?'} · {s.worktree}
            </Text>
            {s.files.length === 0 ? <Text dimColor>no files held</Text> : s.files.slice(0, 15).map(f => <Text>  {f}</Text>)}
            {s.files.length > 15 && <Text dimColor>  and {s.files.length - 15} more</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}

async function withNotices<T extends { deny?: unknown; context?: readonly string[] }>($: EngineInterface, ran: T, notes: string[]): Promise<T> {
  if (ran.deny !== undefined) return ran
  const all = [...notes, ...(await takeNotices($).catch(() => []))]
  return all.length === 0 ? ran : { ...ran, context: [...(ran.context ?? []), ...all] }
}
