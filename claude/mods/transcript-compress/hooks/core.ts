// Pure logic for transcript-compress: which transcripts to squeeze, how to batch them, how to read what the
// platform tools printed, and the words shown to the person and to Claude. No engine calls here, so it is all
// testable on its own.

export type Platform = 'windows' | 'mac' | 'linux'

/** One transcript file as the walk found it. */
export type Transcript = { path: string; size: number; mtimeMs: number }

/** What the mod keeps across sessions (in $.store, key 'state'). */
export type Saved = {
  /** Every transcript last modified before this time was already handled by a run. */
  watermarkMs: number
  /** When the last run finished (0 = never). */
  lastRunAt: number
  /** When Claude was last asked to suggest a run (0 = never). */
  lastSuggestedAt: number
  /** Totals over all runs. */
  files: number
  savedBytes: number
  /** Another session's run holds the job until this time. */
  lockUntil: number
}

export const EMPTY: Saved = { watermarkMs: 0, lastRunAt: 0, lastSuggestedAt: 0, files: 0, savedBytes: 0, lockUntil: 0 }

export const DAY = 86_400_000
/** Ask Claude to suggest at most this often. */
export const SUGGEST_EVERY = 7 * DAY
/** "Always on" runs at most this often. */
export const AUTO_EVERY = 20 * 3_600_000
/** A run's lock lapses after this, so a crashed session never blocks the job for good. */
export const LOCK_FOR = 30 * 60_000
/** Room for one command line: Windows allows 32,767 characters; stay well under. */
export const ARGV_CHARS = 24_000
/** Rough share of a transcript the file-system compressors free (measured 1.3-1.5x on real transcripts). */
export const EST_SHARE = 0.3

export function readSaved(raw: unknown): Saved {
  if (!raw || typeof raw !== 'object') return { ...EMPTY }
  const r = raw as Record<string, unknown>
  const n = (k: keyof Saved) => (typeof r[k] === 'number' && Number.isFinite(r[k]) ? (r[k] as number) : 0)
  return { watermarkMs: n('watermarkMs'), lastRunAt: n('lastRunAt'), lastSuggestedAt: n('lastSuggestedAt'), files: n('files'), savedBytes: n('savedBytes'), lockUntil: n('lockUntil') }
}

/** The transcripts a run would take: old enough, not handled before, not this session's own. */
export function eligible(all: readonly Transcript[], o: { now: number; minAgeDays: number; watermarkMs: number; sessionId: string }): Transcript[] {
  const cutoff = cutoffOf(o.now, o.minAgeDays)
  return all.filter(t => t.mtimeMs < cutoff && t.mtimeMs >= o.watermarkMs && !isSessionFile(t.path, o.sessionId))
}

export function cutoffOf(now: number, minAgeDays: number): number {
  return now - Math.max(1, minAgeDays) * DAY
}

/** True for this session's transcript or anything in its own folder (its subagents). */
export function isSessionFile(path: string, sessionId: string): boolean {
  if (!sessionId) return false
  const p = path.replace(/\\/g, '/')
  return p.endsWith(`/${sessionId}.jsonl`) || p.includes(`/${sessionId}/`)
}

/** Splits paths into groups whose joined length fits one command line. */
export function batches(paths: readonly string[], maxChars = ARGV_CHARS): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  let len = 0
  for (const p of paths) {
    const add = p.length + 3
    if (cur.length > 0 && len + add > maxChars) {
      out.push(cur)
      cur = []
      len = 0
    }
    cur.push(p)
    len += add
  }
  if (cur.length > 0) out.push(cur)
  return out
}

const digits = (s: string) => Number(s.replace(/[^\d]/g, '')) || 0

/**
 * Reads compact.exe's summary ("K files within D directories were compressed." / "N total bytes of data are stored in
 * M bytes."). Files compact.exe finds already compressed are not counted in either line. Undefined when the summary
 * is missing (a localised Windows, or compact.exe failed).
 */
export function parseCompact(stdout: string): { files: number; before: number; after: number } | undefined {
  const m = /(\d[\d,.\s ]*)\s+total bytes of data are stored in\s+(\d[\d,.\s ]*)\s+bytes/i.exec(stdout)
  if (!m) return undefined
  const f = /(\d[\d,. ]*)\s+files? within/i.exec(stdout)
  return { files: f ? digits(f[1]!) : 0, before: digits(m[1]!), after: digits(m[2]!) }
}

/** Sums the first column of `du -k` output, in bytes. */
export function sumDuBytes(stdout: string): number {
  let kb = 0
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s/.exec(line)
    if (m) kb += Number(m[1])
  }
  return kb * 1024
}

/** The sh loop that recompresses each argument in place with macOS's own file-system compression. */
export const MAC_SCRIPT = 'for f do t="$f.tc-tmp"; if ditto --hfsCompression "$f" "$t" && mv -f "$t" "$f"; then :; else rm -f "$t"; echo "failed: $f" >&2; fi; done'

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export function sumSize(ts: readonly Transcript[]): number {
  return ts.reduce((a, t) => a + t.size, 0)
}

export function shouldSuggest(o: { auto: boolean; suggestAtMB: number; waitingBytes: number; now: number; lastSuggestedAt: number }): boolean {
  if (o.auto || o.suggestAtMB <= 0) return false
  if (o.waitingBytes < o.suggestAtMB * 1024 ** 2) return false
  return o.now - o.lastSuggestedAt >= SUGGEST_EVERY
}

export function shouldAutoRun(o: { auto: boolean; waitingCount: number; now: number; lastRunAt: number; lockUntil: number }): boolean {
  return o.auto && o.waitingCount > 0 && o.now - o.lastRunAt >= AUTO_EVERY && o.now >= o.lockUntil
}

export function methodLine(p: Platform): string {
  if (p === 'windows') return "Windows' built-in file compression (the files stay readable and /resume still works)"
  if (p === 'mac') return "macOS's built-in file compression (the files stay readable and /resume still works)"
  return 'gzip (Linux has no built-in file compression for these, so compressed sessions leave /resume until you run /compress-transcripts restore <session-id>)'
}

/** The note added to the person's next prompt so Claude can bring the run up at a good moment. */
export function suggestionNote(o: { count: number; bytes: number; platform: Platform; minAgeDays: number }): string {
  return [
    `transcript-compress: ${o.count} Claude transcripts older than ${o.minAgeDays} days take ${formatBytes(o.bytes)} and could be compressed with ${methodLine(o.platform)}, freeing roughly ${formatBytes(o.bytes * EST_SHARE)}.`,
    'Do not interrupt the task for this. Only when the current task is finished or the person is between tasks, mention it once, in one line, at the end of a reply: that /compress-transcripts does it (lossless, a minute or two), and that "Always on" in /plugin configure transcript-compress@<marketplace> makes it automatic.',
    'If they say yes, call the compress tool of transcript-compress (mcp__transcript-compress__compress). Never run it without their yes, and do not bring it up again this session if they decline or ignore it.',
  ].join(' ')
}

/** checked: transcripts the run went through; files: of those, newly compressed (one compressed earlier by other means counts as checked only). */
export type RunResult = { checked: number; files: number; failed: number; savedBytes: number | undefined; scannedBytes: number; platform: Platform }

export function resultLine(r: RunResult): string {
  if (r.checked === 0) return 'transcript-compress: nothing to compress right now.'
  if (r.files === 0 && r.failed === 0) return `transcript-compress: checked ${r.checked} transcripts; all were already compressed.`
  const saved = r.savedBytes === undefined ? 'space freed not reported' : `freed ${formatBytes(r.savedBytes)} of ${formatBytes(r.scannedBytes)}`
  const fails = r.failed > 0 ? `; ${r.failed} could not be compressed (in use or on a drive without compression)` : ''
  return `transcript-compress: compressed ${r.files} of ${r.checked} transcripts, ${saved}${fails}.`
}

export function statusText(o: { saved: Saved; waitingCount: number; waitingBytes: number; platform: Platform; auto: boolean; minAgeDays: number; now: number; running: boolean }): string {
  const s = o.saved
  const lines = [
    `transcript-compress (${o.auto ? 'Always on' : 'on request'}, transcripts older than ${o.minAgeDays} days)`,
    `  method: ${methodLine(o.platform)}`,
    `  waiting: ${o.waitingCount} transcripts, ${formatBytes(o.waitingBytes)} (roughly ${formatBytes(o.waitingBytes * EST_SHARE)} to free)`,
    `  so far: ${s.files} compressed, ${formatBytes(s.savedBytes)} freed${s.lastRunAt ? `, last run ${Math.max(0, Math.round((o.now - s.lastRunAt) / DAY))} days ago` : ', never run'}`,
  ]
  if (o.running) lines.push('  a run is going now.')
  lines.push('  /compress-transcripts runs it now' + (o.platform === 'linux' ? '; /compress-transcripts restore <session-id> brings one back' : '') + '.')
  return lines.join('\n')
}

export function parseArgs(args: string): { kind: 'run' } | { kind: 'status' } | { kind: 'restore'; id: string } | { kind: 'help' } {
  const [verb = '', id = ''] = args.trim().split(/\s+/)
  if (verb === '' || verb === 'run' || verb === 'now') return { kind: 'run' }
  if (verb === 'status') return { kind: 'status' }
  if (verb === 'restore' && /^[A-Za-z0-9-]+$/.test(id)) return { kind: 'restore', id }
  return { kind: 'help' }
}
