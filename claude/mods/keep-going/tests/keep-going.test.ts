import { expect, mock, test, type Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { buildClassifierInput, finalParagraph, looksLikeOffer, parseVerdict } from '../hooks/nudge.ts'

const OFFERS = [
  'Done with the parser.\n\nWant me to continue with the CLI wiring?',
  'The API layer is in place. Should I go ahead and add the tests?',
  'Shall I update the remaining three call sites?',
  'Would you like me to apply the same fix to the other handlers?',
  'Let me know if you want me to finish the migration for the other tables.',
  "I can also add the missing error handling in auth.ts if you'd like.",
  'Next, I\'ll wire the settings page to the new store.',
  "I'll now move on to the billing module.",
  'The next step is to update the importer to the new schema.',
  "I'll start on the docs unless you'd prefer I stop here.",
  'Do you want me to run the full test suite?',
]

const NOT_OFFERS = [
  'All 42 tests pass. The parser now handles nested quotes; see src/parse.ts.',
  'Fixed. `bun test` shows 12 passing, 0 failing.',
  'Should I use Postgres or SQLite? It changes the schema.\n\nI have built everything that does not depend on this.',
  'I ran the build and it failed on a missing env var: STRIPE_KEY. I need that key to go on.',
  'Let me know if anything is unclear.\n\nThe report is in docs/report.md and the numbers are final.',
  '',
]

test('the pre-filter fires on offers and untaken next steps', async () => {
  for (const m of OFFERS) expect([m, looksLikeOffer(m)]).toEqual([m, true])
})

test('the pre-filter stays quiet on reports, real questions and blockers', async () => {
  for (const m of NOT_OFFERS) expect([m, looksLikeOffer(m)]).toEqual([m, false])
})

test('only the final paragraph counts', async () => {
  expect(finalParagraph('a\n\nb\n\n  \n\nc  ')).toBe('c')
  expect(looksLikeOffer('Want me to do X? I did it anyway.\n\nAll done: tests pass.')).toBe(false)
})

test('the classifier input tags both texts as data and clips them', async () => {
  const input = buildClassifierInput('Build the export feature', 'Want me to add CSV too?')
  expect(input).toContain('<request>\nBuild the export feature\n</request>')
  expect(input).toContain('<final_message>\nWant me to add CSV too?\n</final_message>')
  expect(buildClassifierInput('', 'x')).toContain('(not available)')
  const long = buildClassifierInput('a'.repeat(5000), 'z'.repeat(5000) + 'END')
  expect(long.length).toBeLessThan(6000)
  expect(long).toContain('END') // the end of the final message is what matters
})

test('only a clear CONTINUE continues', async () => {
  expect(parseVerdict('CONTINUE')).toBe('CONTINUE')
  expect(parseVerdict(' continue.')).toBe('CONTINUE')
  expect(parseVerdict('OK')).toBe('OK')
  expect(parseVerdict('')).toBe('OK')
  expect(parseVerdict('I would say continue')).toBe('OK')
})

type Seen = { asked: string[]; toasts: string[] }

function engine(on: On, verdict = 'CONTINUE'): Seen {
  const seen: Seen = { asked: [], toasts: [] }
  mock.clock(on, { now: Date.parse('2026-11-07T12:00:00Z') })
  on('model.complete', (_, e) => {
    seen.asked.push(String((e as unknown as { prompt: string }).prompt))
    return { value: { isAnswered: true, text: verdict, usage: { input_tokens: 1, output_tokens: 1 } } as never }
  })
  on('ui.toast', (_, e) => {
    seen.toasts.push((e as unknown as { text: string }).text)
    return { value: undefined }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('classic.Stop', () => ({}))
  on('classic.SubagentStop', () => ({}))
  return seen
}

const ask = ($: Engine, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as Parameters<typeof $.prompt.submit>[0])
const cmd = ($: Engine, args: string) => $.command.run({ command: 'keep-going', args } as Parameters<typeof $.command.run>[0])
const stop = ($: Engine, message: string, active = false) =>
  $.classic.Stop({ stop_hook_active: active, last_assistant_message: message } as Parameters<typeof $.classic.Stop>[0])

test('an in-scope offer is blocked with the nudge, once per stop chain', async ($, on) => {
  const seen = engine(on)
  await cmd($, 'on')
  await ask($, 'Build the CSV export for invoices')
  const r = await stop($, 'The exporter is done.\n\nWant me to wire it to the button too?')
  expect(r.block).toContain('keep-going: you offered to continue')
  expect(seen.asked[0]).toContain('Build the CSV export for invoices')
  expect(seen.toasts).toContain('keep-going: sent Claude back to work')
  // stop_hook_active: never block again in the same chain
  expect((await stop($, 'Want me to wire it to the button too?', true)).block).toBeUndefined()
})

test('a finished report never reaches the classifier', async ($, on) => {
  const seen = engine(on)
  await cmd($, 'on')
  await ask($, 'Fix the login bug')
  expect((await stop($, 'Fixed; bun test shows 12 passing.')).block).toBeUndefined()
  expect(seen.asked.length).toBe(0)
})

test('an OK verdict allows the stop', async ($, on) => {
  engine(on, 'OK')
  await cmd($, 'on')
  await ask($, 'Ship it')
  expect((await stop($, 'Ready. Should I push to main and deploy?')).block).toBeUndefined()
})

test('at most maxNudges per request, reset by the next request', async ($, on) => {
  engine(on)
  await cmd($, 'on')
  await ask($, 'Refactor the store')
  const offer = 'Store split done.\n\nShall I move the selectors too?'
  expect((await stop($, offer)).block).toBeDefined()
  expect((await stop($, offer)).block).toBeDefined()
  expect((await stop($, offer)).block).toBeUndefined() // default maxNudges is 2
  await ask($, 'Now the reducers')
  expect((await stop($, offer)).block).toBeDefined()
})

test('a maxNudges of 1 is honoured', { options: { maxNudges: 1 } }, async ($, on) => {
  engine(on)
  await cmd($, 'on')
  await ask($, 'Refactor the store')
  const offer = 'Shall I move the selectors too?'
  expect((await stop($, offer)).block).toBeDefined()
  expect((await stop($, offer)).block).toBeUndefined()
})

test('waiting on background work is a fine stop', async ($, on) => {
  const seen = engine(on)
  await cmd($, 'on')
  await ask($, 'Run the migration')
  const r = await $.classic.Stop({
    stop_hook_active: false,
    last_assistant_message: 'Next, I\'ll check the results when the agent reports back.',
    background_tasks: [{ id: 'a1' }],
  } as unknown as Parameters<typeof $.classic.Stop>[0])
  expect(r.block).toBeUndefined()
  expect(seen.asked.length).toBe(0)
})

test('/keep-going off stops it; the list shows nudges', async ($, on) => {
  engine(on)
  await cmd($, 'on')
  await ask($, 'Write the tests')
  await stop($, 'Want me to add the edge cases as well?')
  expect((await cmd($, '')).text).toContain('Want me to add the edge cases as well?')
  expect((await cmd($, 'off')).text).toBe('keep-going off for this session.')
  await ask($, 'Write more tests')
  expect((await stop($, 'Want me to add the edge cases as well?')).block).toBeUndefined()
  await cmd($, 'on')
})

test('the enabled setting turns it off', { options: { enabled: false } }, async ($, on) => {
  const seen = engine(on)
  await ask($, 'Write the tests')
  expect((await stop($, 'Want me to add the edge cases as well?')).block).toBeUndefined()
  expect(seen.asked.length).toBe(0)
})

test('subagents are judged against their own task', async ($, on) => {
  const seen = engine(on)
  await cmd($, 'on')
  const r = await $.classic.SubagentStop({
    stop_hook_active: false,
    agent_id: 'sub1',
    agent_type: 'general-purpose',
    agent_transcript_path: '',
    last_assistant_message: 'Half the files are converted. Should I convert the rest?',
  } as Parameters<typeof $.classic.SubagentStop>[0])
  expect(r.block).toContain('keep-going')
  expect(seen.asked[0]).toContain('(not available)')
})
