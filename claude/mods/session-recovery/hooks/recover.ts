// Pure logic: which recorded sessions died with the machine, and the commands that reopen them.

export type Rec = {
  id: string
  cwd: string
  title: string
  startedAt: number
  lastBeat: number
  ended: boolean
  isInteractive: boolean
}

export const BEAT_MS = 2 * 60_000
export const ALIVE_MS = 5 * 60_000 // a beat this recent means the session is still running somewhere
export const KEEP_MS = 7 * 24 * 60 * 60_000

export type Candidate = Rec & { isFromBeforeBoot: boolean }

/** Sessions that never ended cleanly and are not beating now, newest first; those killed by the last boot first. */
export function candidates(recs: readonly Rec[], now: number, bootAt: number | undefined, selfId: string): Candidate[] {
  return recs
    .filter(r => r.id !== selfId && !r.ended && r.isInteractive && now - r.lastBeat > ALIVE_MS && now - r.lastBeat < KEEP_MS)
    .map(r => ({ ...r, isFromBeforeBoot: bootAt !== undefined && r.lastBeat < bootAt }))
    .sort((a, b) => Number(b.isFromBeforeBoot) - Number(a.isFromBeforeBoot) || b.lastBeat - a.lastBeat)
}

const clean = (s: string) => s.replace(/[;"\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'claude'

/** One Windows Terminal call that opens a tab per session, each `claude --resume <id>` in its folder. */
export function wtArgv(recs: readonly Rec[]): string[] {
  const argv = ['wt', '-w', '0']
  recs.forEach((r, i) => {
    if (i > 0) argv.push(';')
    argv.push('new-tab', '-d', r.cwd, '--title', clean(r.title), 'claude', '--resume', r.id)
  })
  return argv
}

export function resumeLine(r: Rec): string {
  return `cd "${r.cwd}" && claude --resume ${r.id}`
}

export function ago(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

export function projectOf(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/$/, '').split('/').pop() || cwd
}
