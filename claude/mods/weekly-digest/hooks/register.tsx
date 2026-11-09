import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Shown } from '../types'
import { DAY, digestMarkdown, emptyUsage, isoDay, parseDays, polishPrompt, scanUsage } from './core.ts'
import type { Branch, Commit, Decision, PullRequest, RepoReport, Usage, UsageScan } from './core.ts'

const PANE = 'weekly-digest'
const EMPTY: Shown = { path: '', markdown: '', polished: '', polishNote: '', sentTo: '' }
const shown = atom({ plugin: 'weekly-digest', key: 'shown' } as const, EMPTY, { shape: 'shown-2' })

let DIGEST_DIR = '~/.claude/digests'
let EXTRA_REPOS: string[] = []
let AUTHOR_EMAILS: string[] = []
let POLISH = false
const POLISH_MODEL = 'haiku'
const READ_WHOLE = 4_000_000 // $.fs.read takes files up to 4 MiB; bigger ones are streamed, filtered to reply rows

let home = ''
async function homeDir($: EngineInterface): Promise<string> {
  if (!home) home = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  return home
}
async function configDir($: EngineInterface): Promise<string> {
  const own = await $.env.get('CLAUDE_CONFIG_DIR')
  return own && own.trim() ? own.trim().replace(/\\/g, '/').replace(/\/+$/, '') : `${await homeDir($)}/.claude`
}
/** A drive path or a UNC share, either slash. */
const isWindowsPath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || /^(?:\\\\|\/\/)[^\\/]/.test(p)
/** ~ and relative paths start at the home folder; absolute ones (POSIX, drive or share) stay as they are. */
async function expand($: EngineInterface, p: string): Promise<string> {
  const t = p.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (t === '~' || t.startsWith('~/')) return `${await homeDir($)}${t.slice(1)}`
  if (t.startsWith('/') || isWindowsPath(t)) return t
  return `${await homeDir($)}/${t.replace(/^\.\//, '')}`
}
/** Folder names compare without case only where the file system ignores it. */
const keyOf = (p: string) => (isWindowsPath(p) ? p.toLowerCase() : p)

// Reply rows only: every row that carries usage also carries its working folder and time. No double quotes in the
// script: it travels as one argument on the Windows command line.
const PS_FILTER =
  "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8; " +
  "$f=[IO.File]::Open($env:WD_PATH,'Open','Read','ReadWrite, Delete'); $r=New-Object IO.StreamReader($f,[Text.Encoding]::UTF8); " +
  "$q=[char]34+'output_tokens'+[char]34; try { while ($null -ne ($l=$r.ReadLine())) { if ($l.Contains($q)) { [Console]::Out.WriteLine($l) } } } finally { $r.Close() }"

/** Streams a big transcript through a filter and folds its reply rows in. False when it could not be read. */
async function streamUsage($: EngineInterface, path: string, scan: UsageScan, since: number, until: number): Promise<boolean> {
  const argv = isWindowsPath(path) ? ['powershell', '-NoProfile', '-NonInteractive', '-Command', PS_FILTER] : ['grep', '-F', '"output_tokens"', '--', path]
  let carry = ''
  try {
    const s = $.process.spawn({ argv, env: { WD_PATH: path } })
    for await (const c of s) {
      if (c.stream !== 'stdout') continue
      const text = carry + c.text
      const cut = text.lastIndexOf('\n')
      if (cut < 0) {
        carry = text
        continue
      }
      scanUsage(scan, text.slice(0, cut), since, until)
      carry = text.slice(cut + 1)
    }
    scanUsage(scan, carry, since, until)
    const r = await s.result
    return r.code === 0 || r.code === 1 // grep answers 1 when no row matched
  } catch {
    return false
  }
}

type FileRef = { path: string; size: number; session: string; isMain: boolean }
/** Transcripts (and their subagents') written to inside the window; older files hold no reply inside it. */
async function transcripts($: EngineInterface, since: number): Promise<FileRef[]> {
  const base = `${await configDir($)}/projects`
  const out: FileRef[] = []
  for (const d of await $.fs.list(base).catch(() => [])) {
    if (d.kind !== 'dir') continue
    const dir = `${base}/${d.name}`
    const items = await $.fs.list(dir).catch(() => [])
    for (const f of items) {
      if (f.kind === 'file' && f.name.endsWith('.jsonl') && f.mtimeMs >= since) out.push({ path: `${dir}/${f.name}`, size: f.size, session: f.name.slice(0, -6), isMain: true })
    }
    for (const s of items) {
      if (s.kind !== 'dir') continue
      for (const f of await $.fs.list(`${dir}/${s.name}/subagents`).catch(() => [])) {
        if (f.kind === 'file' && f.name.endsWith('.jsonl') && f.mtimeMs >= since) out.push({ path: `${dir}/${s.name}/subagents/${f.name}`, size: f.size, session: s.name, isMain: false })
      }
    }
  }
  return out
}

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string | undefined> {
  const r = await $.process.run(['git', ...args], { cwd }).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout : undefined
}

const tops = new Map<string, string | undefined>()
/** The repo a folder belongs to (its top folder, forward slashes), or undefined outside any repo. */
async function repoOf($: EngineInterface, cwd: string): Promise<string | undefined> {
  if (tops.has(cwd)) return tops.get(cwd)
  const out = await git($, cwd, ['rev-parse', '--show-toplevel'])
  const top = out?.trim().replace(/\\/g, '/') || undefined
  tops.set(cwd, top)
  return top
}

const lines = (s: string | undefined) => (s ?? '').split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '')
const firstLine = (s: string, fallback: string) => lines(s)[0]?.slice(0, 120) ?? fallback

type Gh = { ok: boolean }
async function gh($: EngineInterface, cwd: string, args: string[]) {
  return $.process.run(['gh', ...args], { cwd }).catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: String(err) }))
}
async function ghList($: EngineInterface, cwd: string, repo: string, args: string[]): Promise<{ prs?: PullRequest[]; error?: string }> {
  const r = await gh($, cwd, ['pr', 'list', '-R', repo, ...args, ...(AUTHOR_EMAILS.length > 0 ? ['--author', '@me'] : [])])
  if (r.exitCode !== 0) return { error: firstLine(r.stderr, `gh exited ${r.exitCode}`) }
  try {
    const prs = JSON.parse(r.stdout) as PullRequest[]
    return { prs: Array.isArray(prs) ? prs : [] }
  } catch {
    return { error: 'gh gave an answer that is not JSON' }
  }
}

/** GitHub's search takes a time with an offset; the window starts at this UTC instant. */
const utcSearchTime = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}+00:00`

async function repoReport($: EngineInterface, path: string, since: number, ghState: Gh, notes: string[]): Promise<RepoReport> {
  const name = path.split('/').filter(Boolean).pop() ?? path
  // Only origin counts as the user's: in a fork, upstream and other remotes hold other people's work.
  const hasOrigin = lines(await git($, path, ['remote'])).includes('origin')
  // The user's own commits: the configured emails, else this repo's git user.email. Matched as written, not as a pattern.
  const emails = AUTHOR_EMAILS.length > 0 ? AUTHOR_EMAILS : lines(await git($, path, ['config', 'user.email'])).slice(0, 1)
  if (emails.length === 0) notes.push(`${name} has no git user.email and authorEmails is empty, so its commits by every author are listed.`)
  const authors = emails.length > 0 ? ['--fixed-strings', ...emails.map(e => `--author=${e}`)] : []
  const log = await git($, path, ['log', hasOrigin ? '--remotes=origin' : '--branches', '--no-merges', `--since=${new Date(since).toISOString()}`, '--format=%h%x1f%ae%x1f%s', ...authors])
  const commits: Commit[] = lines(log).map(l => {
    const [hash = '', email = '', subject = ''] = l.split('\x1f')
    return { hash, email, subject }
  })
  const branches: Branch[] = []
  if (hasOrigin) {
    for (const l of lines(await git($, path, ['for-each-ref', '--format=%(refname)%1f%(committerdate:unix)', 'refs/heads/']))) {
      const [ref = '', when = '0'] = l.split('\x1f')
      if (!ref.startsWith('refs/heads/') || Number(when) * 1000 < since) continue
      // A full ref after --end-of-options: a branch named like an option is still only a name.
      const ahead = Number((await git($, path, ['rev-list', '--count', '--not', '--remotes=origin', '--not', '--end-of-options', ref]))?.trim() ?? '0')
      if (ahead > 0) branches.push({ name: ref.slice('refs/heads/'.length), ahead })
    }
  }
  const uncommitted = lines(await git($, path, ['status', '--porcelain'])).length
  let merged: PullRequest[] = []
  let open: PullRequest[] = []
  let prNote = ''
  if (ghState.ok && hasOrigin) {
    const url = lines(await git($, path, ['remote', 'get-url', 'origin']))[0] ?? ''
    const view = url ? await gh($, path, ['repo', 'view', url, '--json', 'nameWithOwner']) : undefined
    let repo = ''
    try {
      repo = view && view.exitCode === 0 ? String((JSON.parse(view.stdout) as { nameWithOwner?: string }).nameWithOwner ?? '') : ''
    } catch {
      repo = ''
    }
    if (!repo) prNote = `GitHub PRs not listed here: origin is not a GitHub repo gh can see (${view ? firstLine(view.stderr, 'no answer') : 'no origin URL'})`
    else {
      const m = await ghList($, path, repo, ['--state', 'merged', '--search', `merged:>=${utcSearchTime(since)}`, '--json', 'number,title', '--limit', '100'])
      const o = await ghList($, path, repo, ['--state', 'open', '--json', 'number,title,isDraft', '--limit', '50'])
      merged = m.prs ?? []
      open = o.prs ?? []
      const err = m.error ?? o.error
      if (err) prNote = `GitHub PRs not listed here: ${err}`
    }
  }
  return { name, path, commits, hasRemote: hasOrigin, merged, open, branches, uncommitted, decisions: [], usage: { units: 0, slots: [] }, prNote }
}

async function openDecisions($: EngineInterface): Promise<Decision[]> {
  const dir = `${await homeDir($)}/.claude/decision-inbox` // where the decision-inbox mod keeps one file per decision
  const out: Decision[] = []
  for (const f of await $.fs.list(dir).catch(() => [])) {
    if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
    try {
      const d = JSON.parse(await $.fs.read(`${dir}/${f.name}`)) as Partial<Decision>
      if (d.status === 'open' && typeof d.id === 'string' && typeof d.question === 'string')
        out.push({ id: d.id, question: d.question, recommended: String(d.recommended ?? ''), sessionId: String(d.sessionId ?? ''), from: String(d.from ?? ''), status: 'open' })
    } catch {
      // a half-written or unreadable file: skip it
    }
  }
  return out
}

const addUsage = (into: Usage, u: Usage) => {
  into.units += u.units
  for (const s of u.slots) if (!into.slots.includes(s)) into.slots.push(s)
}
const plural = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`

/** digest-<date>.md, or digest-<date>-2.md and on when that day already has one: an earlier digest is never overwritten. */
async function freshPath($: EngineInterface, dir: string, day: string): Promise<string> {
  const taken = new Set((await $.fs.list(dir).catch(() => [])).map(f => f.name))
  let name = `digest-${day}.md`
  for (let k = 2; taken.has(name); k++) name = `digest-${day}-${k}.md`
  return `${dir}/${name}`
}

async function runDigest($: EngineInterface, days: number): Promise<string> {
  const now = await $.clock.now()
  const since = now - days * DAY
  const notes: string[] = []
  // Usage per working folder, from every transcript written in the period; rows outside it are skipped as they are read.
  const files = await transcripts($, since)
  const byCwd = new Map<string, Usage>()
  const sessionCwd = new Map<string, { cwd: string; units: number }>()
  let unread = 0
  for (const f of files) {
    const scan = emptyUsage()
    let ok = true
    if (f.size <= READ_WHOLE) {
      const text = await $.fs.read(f.path).catch(() => undefined)
      if (typeof text === 'string') scanUsage(scan, text, since, now)
      else ok = false
    } else ok = await streamUsage($, f.path, scan, since, now)
    if (!ok) unread++
    for (const [cwd, u] of Object.entries(scan.byCwd)) {
      addUsage(byCwd.get(cwd) ?? (byCwd.set(cwd, { units: 0, slots: [] }).get(cwd) as Usage), u)
      const best = sessionCwd.get(f.session)
      if (f.isMain && (!best || u.units > best.units)) sessionCwd.set(f.session, { cwd, units: u.units })
    }
  }
  if (unread > 0) notes.push(`${plural(unread, 'transcript')} could not be read; usage leaves them out.`)
  // Folders (only those with a reply inside the window) to repos.
  const repoUsage = new Map<string, Usage>()
  const paths = new Map<string, string>()
  const outside: Usage = { units: 0, slots: [] }
  for (const [cwd, u] of byCwd) {
    const top = await repoOf($, cwd)
    if (!top) {
      addUsage(outside, u)
      continue
    }
    const k = keyOf(top)
    paths.set(k, top)
    addUsage(repoUsage.get(k) ?? (repoUsage.set(k, { units: 0, slots: [] }).get(k) as Usage), u)
  }
  for (const extra of EXTRA_REPOS) {
    const dir = await expand($, extra)
    const top = await repoOf($, dir)
    if (top) paths.set(keyOf(top), top)
    else notes.push(`${dir} (in extraRepos) is not a git repo, so it was skipped.`)
  }
  // git and gh, per repo.
  const ghVersion = paths.size > 0 ? await $.process.run(['gh', '--version']).catch(() => undefined) : undefined
  const ghState = { ok: ghVersion !== undefined && ghVersion.exitCode === 0 }
  if (!ghState.ok && paths.size > 0) notes.push('The GitHub CLI (gh) was not found, so merged and open PRs are not listed. Commits still are.')
  const reports: RepoReport[] = []
  for (const [k, path] of paths) {
    const r = await repoReport($, path, since, ghState, notes)
    r.usage = repoUsage.get(k) ?? { units: 0, slots: [] }
    reports.push(r)
  }
  // Open decisions, matched to a repo by the session that asked, else by its folder's name.
  const other: Decision[] = []
  for (const d of await openDecisions($)) {
    const cwd = sessionCwd.get(d.sessionId)?.cwd
    const top = cwd ? await repoOf($, cwd) : undefined
    const folder = d.from.replace(/\s*\(main\)\s*$/, '').trim()
    const r = (top && reports.find(x => keyOf(x.path) === keyOf(top))) || reports.find(x => x.name === folder) || reports.find(x => x.name.toLowerCase() === folder.toLowerCase())
    if (r) r.decisions.push(d)
    else other.push(d)
  }
  const markdown = digestMarkdown({ since, now, days, repos: reports, outside, otherDecisions: other, notes })
  let polished = ''
  let polishNote = ''
  if (POLISH) {
    const r = await $.model.complete({ model: POLISH_MODEL, prompt: polishPrompt(markdown), maxTokens: 800 }).catch((err: unknown) => ({ isAnswered: false as const, reason: String(err) }))
    if (r.isAnswered) polished = r.text.trim()
    else polishNote = `The polished update could not be written (${r.reason}).`
  }
  const file = polished ? `${markdown}\n## Update draft\n\n_Written by a model from the digest above. Check it before you share it._\n\n${polished}\n` : markdown
  const path = await freshPath($, await expand($, DIGEST_DIR), isoDay(now))
  const saved = await $.fs.write(path, file).then(
    () => true,
    () => false,
  )
  await update($, shown, () => ({ path: saved ? path : '', markdown, polished, polishNote, sentTo: POLISH ? POLISH_MODEL : '' }))
  const merged = reports.reduce((s, r) => s + r.merged.length, 0)
  const commits = reports.reduce((s, r) => s + r.commits.length, 0)
  const summary = `${plural(reports.length, 'repo')}, ${plural(merged, 'merged PR')}, ${plural(commits, 'commit')}`
  return saved ? `Digest saved to ${path}: ${summary}.` : `Digest written (${summary}) but it could not be saved to ${path}.`
}

let building = false
/** The heavy part, after the command has answered: reading transcripts and running git and gh. */
async function build($: EngineInterface, days: number): Promise<void> {
  try {
    $.ui.toast(await runDigest($, days), { timeoutMs: 10_000 })
  } catch (err) {
    const why = `The digest could not be built: ${String(err).slice(0, 200)}`
    await update($, shown, () => ({ ...EMPTY, markdown: why }))
    $.ui.toast(why)
  } finally {
    building = false
  }
}

export const register: Register = (on, options) => {
  if (typeof options.digestDir === 'string' && options.digestDir.trim()) DIGEST_DIR = options.digestDir.trim()
  const list = (v: unknown) => (typeof v === 'string' ? v.split(/[,;\n]/).map(s => s.trim()).filter(Boolean) : [])
  EXTRA_REPOS = list(options.extraRepos)
  AUTHOR_EMAILS = list(options.authorEmails)
  POLISH = options.polish === true

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'digest', description: 'Plain-English digest of what shipped in the last N days (default 7), saved as markdown' })
    return next(e)
  })

  on('command.run', { command: 'digest' }, async ($, e) => {
    if (building) return { text: 'A digest is already being built; it will show in the pane.' }
    const days = parseDays(e.args ?? '')
    const text = `Building your digest for the last ${plural(days, 'day')}…`
    building = true
    await update($, shown, () => ({ ...EMPTY, markdown: text }))
    await $.ui.open({ id: PANE, title: 'Digest' })
    $.clock.after(0, () => void build($, days))
    return { text }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const s = await read($, shown)
    const sent = s.sentTo ? `Folder paths, commit and PR titles and open decisions went to ${s.sentTo} to write the summary.` : 'Nothing was sent anywhere.'
    return (
      <Box flexDirection="column">
        {s.path !== '' && (
          <Text dimColor>
            Saved to {s.path}. {sent}
          </Text>
        )}
        {s.markdown === '' ? <Text dimColor>Run /digest to write one.</Text> : <Markdown text={s.markdown} />}
        {s.polished !== '' && <Text bold>Update draft (written by a model; check it before you share it)</Text>}
        {s.polished !== '' && <Markdown key="polished" text={s.polished} />}
        {s.polishNote !== '' && <Text dimColor>{s.polishNote}</Text>}
      </Box>
    )
  })
}
