// Pure logic for lanes: file claims, expiry, git command classification, conflict prediction.

export const IDLE_MS = 30 * 60_000
export const RECONFIRM_MS = 5 * 60_000

export type FileClaim = { since: number; at: number }
/** One session's record for one repo, the JSON file other sessions read. */
export type SessionRecord = {
  sessionId: string
  label: string
  repoId: string
  worktree: string
  branch: string
  lastActive: number
  files: Record<string, FileClaim>
  isEnded?: boolean
}
export type Me = { sessionId: string; worktree: string }

/** One spelling per path: forward slashes, no trailing slash, a Windows drive path lower-cased. */
export function normPath(p: string): string {
  const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-z]:\//i.test(s) ? s.toLowerCase() : s
}

/** normPath with `.` and `..` segments resolved. */
export function resolvePath(p: string): string {
  const out: string[] = []
  for (const seg of normPath(p).split('/')) {
    if (seg === '.') continue
    if (seg === '..' && out.length > 1) out.pop()
    else if (seg !== '..') out.push(seg)
  }
  return out.join('/')
}

/** The file's path inside its worktree, or undefined when it lies outside. */
export function relPath(file: string, worktree: string): string | undefined {
  const f = normPath(file)
  const w = normPath(worktree)
  return f.startsWith(`${w}/`) ? f.slice(w.length + 1) : undefined
}

export const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '') || p
export const baseName = (p: string) => p.replace(/[\\/]+$/, '').replace(/^.*[\\/]/, '')

/** FNV-1a of the repo's shared git folder: one id for every worktree of a repo. */
export function repoHash(commonDir: string): string {
  const s = normPath(commonDir)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function sessionLabel(folder: string, firstPrompt?: string): string {
  const words = (firstPrompt ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 6).join(' ')
  return words ? `${folder}: ${words}${(firstPrompt ?? '').trim().split(/\s+/).length > 6 ? '...' : ''}` : folder
}

export const isLive = (r: SessionRecord, now: number) => !r.isEnded && now - r.lastActive < IDLE_MS

/** The files a record still claims: edited within the idle window, by a live session. */
export function liveClaims(r: SessionRecord, now: number): string[] {
  if (!isLive(r, now)) return []
  return Object.entries(r.files)
    .filter(([, c]) => now - c.at < IDLE_MS)
    .map(([f]) => f)
}

/** Adds or refreshes my claim on a file. */
export function claim(r: SessionRecord, rel: string, now: number): SessionRecord {
  const prev = r.files[rel]
  const since = prev && now - prev.at < IDLE_MS ? prev.since : now
  return { ...r, lastActive: now, files: { ...r.files, [rel]: { since, at: now } } }
}

/** Who else touches this file: a live claim in my own worktree, or edits in another worktree of the repo. */
export function whoHas(records: readonly SessionRecord[], me: Me, rel: string, now: number) {
  const others = records.filter(r => r.sessionId !== me.sessionId && isLive(r, now))
  const sameTree = others.find(r => normPath(r.worktree) === normPath(me.worktree) && liveClaims(r, now).includes(rel))
  const otherTrees = others.filter(r => normPath(r.worktree) !== normPath(me.worktree) && r.files[rel] !== undefined)
  return { sameTree, otherTrees }
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  return m === 0 ? 'just now' : m === 1 ? '1 minute ago' : `${m} minutes ago`
}

export function claimNote(owner: SessionRecord, rel: string, now: number): string {
  const since = owner.files[rel]?.since ?? owner.lastActive
  return `lanes: another Claude session ("${owner.label}") has been editing ${rel} since ${ago(now - since)}, in the same folder (${owner.worktree}, branch ${owner.branch}). You may be overwriting each other's changes: check with the owner, or work on a different file.`
}

export function conflictNote(other: SessionRecord, rel: string): string {
  return `lanes: heads-up, another Claude session ("${other.label}") is also changing ${rel}, on branch ${other.branch} in worktree ${other.worktree}. The two branches will likely conflict on this file when merged. Settle who owns it now, not at merge time.`
}

export type GitRisk =
  | { kind: 'stash' | 'reset-hard' | 'clean' | 'gc' | 'prune' }
  | { kind: 'checkout'; target: string }
  | { kind: 'worktree-remove'; target: string }

/** Splits a command line into words, keeping quoted text together. */
function words(segment: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}

/**
 * Splits a command into simple commands on separators outside quotes (; | & newlines and parentheses),
 * leaving out heredoc bodies, so text inside a commit message or a quoted string is never read as a command.
 */
export function segments(command: string): string[] {
  const out: string[] = []
  const heredocs: string[] = []
  let cur = ''
  let quote: '' | "'" | '"' = ''
  const n = command.length
  const flush = () => {
    if (cur.trim()) out.push(cur.trim())
    cur = ''
  }
  for (let i = 0; i < n; i++) {
    const c = command[i] as string
    if (quote) {
      if (quote === '"' && c === '\\' && i + 1 < n) {
        cur += c + command[++i]
        continue
      }
      if (c === quote) quote = ''
      cur += c
      continue
    }
    if (c === "'" || c === '"') {
      quote = c
      cur += c
      continue
    }
    if (c === '\\' && i + 1 < n) {
      cur += c + command[++i]
      continue
    }
    if (c === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      const m = /^<<-?\s*(['"]?)\\?([A-Za-z0-9_.-]+)\1/.exec(command.slice(i))
      if (m) {
        heredocs.push(m[2] as string)
        i += m[0].length - 1
        continue
      }
    }
    if (c === '\n') {
      flush()
      // Skip the bodies of heredocs opened on the line just ended.
      while (heredocs.length > 0) {
        const delim = heredocs.shift() as string
        while (i + 1 < n) {
          const eol = command.indexOf('\n', i + 1)
          const line = command.slice(i + 1, eol < 0 ? n : eol).replace(/\r$/, '').replace(/^\t+/, '')
          i = eol < 0 ? n : eol
          if (line.trim() === delim) break
        }
      }
      continue
    }
    if (c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '`') {
      flush()
      continue
    }
    cur += c
  }
  flush()
  return out
}

/** Words that run a command without being it: `sudo git ...`, `X=1 git ...`, `& git ...`, `then git ...`. */
const PREFIX_WORDS = new Set(['sudo', 'command', 'time', 'nohup', 'exec', 'env', '!', '{', 'then', 'do', 'else', 'if', 'while', 'until', '&'])

/** The git operations in a command that touch state shared across worktrees. */
export function classifyGit(command: string): GitRisk[] {
  const risks: GitRisk[] = []
  for (const segment of segments(command)) {
    const w = words(segment)
    let i = 0
    while (i < w.length && (PREFIX_WORDS.has(w[i] as string) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i] as string))) i++
    if (!(w[i] === 'git' || /^(git|git\.exe)$/i.test(w[i] ?? '') || /[\\/]git(\.exe)?$/i.test(w[i] ?? ''))) continue
    i++
    // global options before the subcommand
    while (i < w.length && w[i]?.startsWith('-')) i += w[i] === '-C' || w[i] === '-c' ? 2 : 1
    const sub = w[i]
    const args = w.slice(i + 1)
    const flags = args.filter(a => a.startsWith('-'))
    const plain = args.filter(a => !a.startsWith('-'))
    switch (sub) {
      case 'stash':
        if (!['list', 'show'].includes(plain[0] ?? '')) risks.push({ kind: 'stash' })
        break
      case 'checkout':
      case 'switch': {
        if (flags.some(f => ['-b', '-B', '-c', '-C', '--orphan', '--create', '--force-create', '--detach'].includes(f))) break
        if (args.includes('--')) break // restores files; the branch stays
        const target = plain[0]
        if (target && target !== '-' && !(sub === 'checkout' && plain.length > 1)) risks.push({ kind: 'checkout', target })
        break
      }
      case 'reset':
        if (flags.includes('--hard')) risks.push({ kind: 'reset-hard' })
        break
      case 'clean':
        if (flags.some(f => f === '--force' || /^-[a-zA-Z]*f/.test(f))) risks.push({ kind: 'clean' })
        break
      case 'gc':
        risks.push({ kind: 'gc' })
        break
      case 'prune':
        risks.push({ kind: 'prune' })
        break
      case 'worktree':
        if (plain[0] === 'prune') risks.push({ kind: 'prune' })
        if (plain[0] === 'remove' && plain[1]) risks.push({ kind: 'worktree-remove', target: plain[1] })
        break
    }
  }
  return risks
}

export type GitDecision = { deny?: string }

/**
 * What lanes does with a risky git command while other sessions are live in the repo.
 * The stash is always refused. The rest is refused once with a warning; the same command
 * again within five minutes goes ahead (`warned` holds when each command was last warned about).
 */
export function decideGit(
  command: string,
  risks: readonly GitRisk[],
  others: readonly SessionRecord[],
  cwd: string,
  warned: Map<string, number>,
  now: number,
): GitDecision {
  const live = others.filter(o => isLive(o, now))
  if (live.length === 0 || risks.length === 0) return {}
  const names = live.map(o => `"${o.label}"`).join(', ')
  if (risks.some(r => r.kind === 'stash'))
    return {
      deny: `lanes: refused. Another Claude session is working in this repo (${names}), and git keeps one stash for every worktree, so a stash here can pick up or throw away its work. Make a work-in-progress commit on your own branch instead (git add -A && git commit -m "WIP").`,
    }
  const why: string[] = []
  for (const r of risks) {
    if (r.kind === 'checkout') {
      const holder = live.find(o => o.branch === r.target)
      if (holder) why.push(`branch ${r.target} is checked out in another worktree (${holder.worktree}) by "${holder.label}"`)
    } else if (r.kind === 'worktree-remove') {
      const target = resolvePath(/^([a-z]:)?[\\/]/i.test(r.target) ? r.target : `${cwd}/${r.target}`)
      const holder = live.find(o => normPath(o.worktree) === target)
      if (holder) why.push(`the worktree ${r.target} is where "${holder.label}" is working`)
    } else {
      const what = ({ stash: 'the stash is shared', 'reset-hard': 'git reset --hard throws away uncommitted work', clean: 'git clean deletes untracked files', gc: 'git gc rewrites the shared object store', prune: 'pruning removes shared git data' } as const)[r.kind]
      why.push(`${what}, and other sessions share this repo (${names})`)
    }
  }
  if (why.length === 0) return {}
  const key = command.replace(/\s+/g, ' ').trim()
  const last = warned.get(key)
  if (last !== undefined && now - last < RECONFIRM_MS) {
    warned.delete(key)
    return {}
  }
  warned.set(key, now)
  return { deny: `lanes: held back once: ${why.join('; ')}. If you are sure this is safe for the other session, run the exact same command again within 5 minutes.` }
}

/** Live sessions in a repo, me included, for the band and the pane. */
export const liveSessions = (records: readonly SessionRecord[], now: number) => records.filter(r => isLive(r, now))
