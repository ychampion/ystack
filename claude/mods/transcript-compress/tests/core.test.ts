import { expect, test } from 'claude-code/testing'

import {
  AUTO_EVERY,
  DAY,
  SUGGEST_EVERY,
  batches,
  eligible,
  isSessionFile,
  parseArgs,
  parseCompact,
  readSaved,
  resultLine,
  shouldAutoRun,
  shouldSuggest,
  suggestionNote,
  sumDuBytes,
} from '../hooks/core'

const NOW = 1_800_000_000_000
const t = (path: string, ageDays: number, size = 1000) => ({ path, size, mtimeMs: NOW - ageDays * DAY })

test('eligible: old enough, newer than the watermark, never this session', async () => {
  const all = [
    t('/p/a/old.jsonl', 30),
    t('/p/a/fresh.jsonl', 2),
    t('/p/a/me.jsonl', 30),
    t('/p/a/me/subagents/agent-1.jsonl', 30),
    t('/p/a/done.jsonl', 60),
  ]
  const got = eligible(all, { now: NOW, minAgeDays: 7, watermarkMs: NOW - 45 * DAY, sessionId: 'me' })
  expect(got.map(x => x.path)).toEqual(['/p/a/old.jsonl'])
})

test('a session id matches its own file and folder, on either slash', async () => {
  expect(isSessionFile('C:\\u\\.claude\\projects\\x\\abc.jsonl', 'abc')).toBe(true)
  expect(isSessionFile('/h/.claude/projects/x/abc/subagents/a.jsonl', 'abc')).toBe(true)
  expect(isSessionFile('/h/.claude/projects/x/abcd.jsonl', 'abc')).toBe(false)
  expect(isSessionFile('/h/x/abc.jsonl', '')).toBe(false)
})

test('batches keep every path, in order, each batch within the limit', async () => {
  const paths = Array.from({ length: 50 }, (_, i) => `/p/${'x'.repeat(90)}/${i}.jsonl`)
  const got = batches(paths, 1000)
  expect(got.flat()).toEqual(paths)
  for (const b of got) expect(b.join(' ').length + b.length * 2 <= 1000).toBe(true)
  expect(batches(['/one-very-long-path'], 5)).toEqual([['/one-very-long-path']])
  expect(batches([])).toEqual([])
})

test("compact.exe's summary is read, with thousands separators", async () => {
  const out = '\n Compressing files in C:\\x\\\n\n2 files within 2 directories were compressed.\n1,600,004 total bytes of data are stored in 8,192 bytes.\nThe compression ratio is 195.3 to 1.\n'
  expect(parseCompact(out)).toEqual({ files: 2, before: 1_600_004, after: 8_192 })
  expect(parseCompact('0 files within 1 directories were compressed.\n0 total bytes of data are stored in 0 bytes.')).toEqual({ files: 0, before: 0, after: 0 })
  expect(parseCompact('Accès refusé.')).toBeUndefined()
})

test('du -k output sums to bytes, ignoring error lines', async () => {
  expect(sumDuBytes('12\t/a.jsonl\n8\t/b.jsonl\ndu: /c: No such file\n')).toBe(20 * 1024)
})

test('suggest only when off, over the threshold, and not in the last week', async () => {
  const base = { auto: false, suggestAtMB: 500, waitingBytes: 600 * 1024 ** 2, now: NOW, lastSuggestedAt: 0 }
  expect(shouldSuggest(base)).toBe(true)
  expect(shouldSuggest({ ...base, auto: true })).toBe(false)
  expect(shouldSuggest({ ...base, suggestAtMB: 0 })).toBe(false)
  expect(shouldSuggest({ ...base, waitingBytes: 100 })).toBe(false)
  expect(shouldSuggest({ ...base, lastSuggestedAt: NOW - SUGGEST_EVERY + 1 })).toBe(false)
})

test('Always on runs at most once a day, never through another session lock', async () => {
  const base = { auto: true, waitingCount: 3, now: NOW, lastRunAt: 0, lockUntil: 0 }
  expect(shouldAutoRun(base)).toBe(true)
  expect(shouldAutoRun({ ...base, auto: false })).toBe(false)
  expect(shouldAutoRun({ ...base, waitingCount: 0 })).toBe(false)
  expect(shouldAutoRun({ ...base, lastRunAt: NOW - AUTO_EVERY + 1 })).toBe(false)
  expect(shouldAutoRun({ ...base, lockUntil: NOW + 1 })).toBe(false)
})

test('the note tells Claude to wait for a break and ask first', async () => {
  const note = suggestionNote({ count: 12, bytes: 2 * 1024 ** 3, platform: 'windows', minAgeDays: 7 })
  expect(note.includes('2.0 GB')).toBe(true)
  expect(note.includes('Never run it without their yes')).toBe(true)
  expect(note.includes('/resume still works')).toBe(true)
  expect(suggestionNote({ count: 1, bytes: 1, platform: 'linux', minAgeDays: 7 }).includes('restore')).toBe(true)
})

test('result lines and arguments', async () => {
  expect(resultLine({ checked: 0, files: 0, failed: 0, savedBytes: 0, scannedBytes: 0, platform: 'mac' })).toBe('transcript-compress: nothing to compress right now.')
  expect(resultLine({ checked: 4, files: 0, failed: 0, savedBytes: 0, scannedBytes: 9, platform: 'windows' }).includes('already compressed')).toBe(true)
  expect(resultLine({ checked: 4, files: 3, failed: 1, savedBytes: 3 * 1024 ** 2, scannedBytes: 10 * 1024 ** 2, platform: 'windows' })).toBe(
    'transcript-compress: compressed 3 of 4 transcripts, freed 3 MB of 10 MB; 1 could not be compressed (in use or on a drive without compression).',
  )
  expect(parseArgs('')).toEqual({ kind: 'run' })
  expect(parseArgs(' status ')).toEqual({ kind: 'status' })
  expect(parseArgs('restore 1b2c-3d')).toEqual({ kind: 'restore', id: '1b2c-3d' })
  expect(parseArgs('restore ../x')).toEqual({ kind: 'help' })
  expect(readSaved({ watermarkMs: 5, files: 'x' })).toEqual({ watermarkMs: 5, lastRunAt: 0, lastSuggestedAt: 0, files: 0, savedBytes: 0, lockUntil: 0 })
})
