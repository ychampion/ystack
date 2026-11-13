import { expect, mock, test } from 'claude-code/testing'

import { buildNote, featureVerdict, findQuotes, isConcrete, resolveDir, sharpenerFires } from '../hooks/voice.ts'

const DOCS = [
  { path: 'notes/call-acme.md', text: 'Call with Acme.\n\nThey export every invoice to a spreadsheet by hand each Friday and hate it.\n\nPricing felt fine.' },
  { path: 'notes/call-bolt.md', text: 'Bolt wants to invite teammates without emailing us.\n\nThey would pay more for team seats.' },
  { path: 'notes/misc.txt', text: 'Random thoughts about the logo colour.' },
]

test('the keyword pre-filter', async () => {
  expect(featureVerdict('add an export to spreadsheet for invoices')).toBe('yes')
  expect(featureVerdict('fix the failing login test')).toBe('no')
  expect(featureVerdict('/review-panel')).toBe('no')
  expect(featureVerdict('the invoices thing customers keep mentioning, something around that')).toBe('maybe')
  expect(featureVerdict('ok')).toBe('no')
})

test('rough versus concrete', async () => {
  expect(isConcrete('add invoice export')).toBe(false)
  expect(isConcrete('add a CSV export button to `InvoiceTable.tsx`')).toBe(true)
})

test('quotes come from the matching notes, one per note, with paths', async () => {
  const q = findQuotes('let users export invoices to a spreadsheet', DOCS, 3)
  expect(q.length).toBe(1)
  expect(q[0]?.path).toBe('notes/call-acme.md')
  expect(q[0]?.text).toContain('spreadsheet')
  expect(findQuotes('invite teammates to a team', DOCS, 3)[0]?.path).toBe('notes/call-bolt.md')
  expect(findQuotes('dark mode for the editor', DOCS, 3)).toEqual([])
  expect(findQuotes('export invoices', DOCS, 0)).toEqual([])
})

test('the note: evidence, propose first, and one question round with spec-sharpener', async () => {
  const quotes = findQuotes('export invoices to a spreadsheet', DOCS, 3)
  const rough = buildNote({ quotes, proposeFirst: true, isConcrete: false, sharpenerFires: false, hasEvidenceDir: true })
  expect(rough).toContain('(notes/call-acme.md)')
  expect(rough).toContain('2-3 concrete options')
  expect(rough).toContain('ONE AskUserQuestion')
  const none = buildNote({ quotes: [], proposeFirst: true, isConcrete: true, sharpenerFires: false, hasEvidenceDir: true })
  expect(none).toContain('No user note mentions this yet')
  expect(none).not.toContain('2-3 concrete options')
  const both = buildNote({ quotes, proposeFirst: true, isConcrete: false, sharpenerFires: true, hasEvidenceDir: true })
  expect(both).toContain('SAME single AskUserQuestion round')
  expect(both).not.toContain('do not build its literal words')
  const off = buildNote({ quotes: [], proposeFirst: false, isConcrete: false, sharpenerFires: false, hasEvidenceDir: false })
  expect(off).not.toContain('No user note')
  expect(sharpenerFires('build a referral feature for the app')).toBe(true)
  expect(sharpenerFires('add invoice export')).toBe(false)
})

test('the notes folder resolves against the project or home', async () => {
  expect(resolveDir('feedback', 'C:\\work\\app', 'C:/Users/me')).toBe('C:/work/app/feedback')
  expect(resolveDir('~/notes/', '/p', '/home/me')).toBe('/home/me/notes')
  expect(resolveDir('D:/evidence', '/p', '/h')).toBe('D:/evidence')
})

test('"just do it" or "no questions" means no propose-first question round', async ($, on) => {
  mock.clock(on, { now: 5_000 })
  on('session.root', () => ({ value: '/proj' }))
  on('env.get', () => ({ value: undefined }) as never)
  on('fs.exists', () => ({ value: true })) // a notes folder with nothing in it: only the propose-first part is in play
  on('fs.list', () => ({ value: [] }) as never)
  let seen: readonly string[] = []
  on('prompt.submit', (_, e) => {
    seen = e.context ?? []
    return { text: e.text } as never
  })
  type Submit = Parameters<typeof $.prompt.submit>[0]
  await $.prompt.submit({ text: 'add invoice export to the dashboard', origin: { kind: 'composer' }, wait: false } as Submit)
  expect(seen.join('\n')).toContain('do not build its literal words')
  for (const text of ['add invoice export to the dashboard, just do it', 'add invoice export to the dashboard. No questions.', 'go ahead and add invoice export to the dashboard']) {
    seen = []
    await $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as Submit)
    expect(seen.join('\n')).not.toContain('do not build its literal words')
    expect(seen.join('\n')).not.toContain('AskUserQuestion')
  }
})

test('a feature prompt gets the evidence as context; a bug report gets nothing', { options: { evidenceDir: 'feedback' } }, async ($, on) => {
  mock.clock(on, { now: 5_000 })
  on('session.root', () => ({ value: '/proj' }))
  on('env.get', () => ({ value: undefined }) as never)
  const asked: string[] = []
  on('fs.exists', (_, e) => {
    asked.push(e.path)
    return { value: /proj[\\/]feedback$/.test(e.path) }
  })
  on('fs.list', () => ({ value: [{ name: 'acme.md', kind: 'file', size: 100, mtimeMs: 1, isLink: false }] }) as never)
  on('fs.read', () => ({ value: 'Acme exports every invoice to a spreadsheet by hand.' }) as never)
  let seen: readonly string[] = []
  on('prompt.submit', (_, e) => {
    seen = e.context ?? []
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: 'add an export of invoices to a spreadsheet', origin: { kind: 'composer' }, wait: false } as Parameters<typeof $.prompt.submit>[0])
  expect(asked.length).toBe(1)
  expect(seen.join('\n')).toContain('Acme exports every invoice')
  expect(seen.join('\n')).toContain('/proj/feedback/acme.md')

  seen = []
  await $.prompt.submit({ text: 'fix the crash on the login page', origin: { kind: 'composer' }, wait: false } as Parameters<typeof $.prompt.submit>[0])
  expect(seen).toEqual([])
})

test('no notes folder: user-voice adds nothing, not even the propose-first round', async ($, on) => {
  mock.clock(on, { now: 5_000 })
  on('session.root', () => ({ value: '/proj' }))
  on('env.get', () => ({ value: undefined }) as never)
  on('fs.exists', () => ({ value: false }))
  let seen: readonly string[] = []
  on('prompt.submit', (_, e) => {
    seen = e.context ?? []
    return { text: e.text } as never
  })
  type Submit = Parameters<typeof $.prompt.submit>[0]
  await $.prompt.submit({ text: 'add invoice export to the dashboard', origin: { kind: 'composer' }, wait: false } as Submit)
  expect(seen.join('\n')).not.toContain('user-voice')
})
