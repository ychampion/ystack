import { expect, test } from 'claude-code/testing'

import { DEFAULT_KEYWORDS, classify, decide, type Config } from '../hooks/route.ts'

const CFG: Config = {
  strongModel: 'opus',
  fastModel: 'haiku',
  highEffort: 'high',
  mediumEffort: 'medium',
  keywords: DEFAULT_KEYWORDS,
  unmatched: 'medium',
  bannedModels: [],
  fallbackModels: ['opus', 'sonnet', 'haiku'],
  genericTypes: ['general-purpose'],
  enforce: false,
  classifier: 'off',
}
const tier = (description: string, prompt = '', type?: string, kw = DEFAULT_KEYWORDS) => classify(description, prompt, type, kw).tier

test('typical descriptions land in the right tier', async () => {
  expect(tier('Review the auth diff')).toBe('high')
  expect(tier('Security audit of upload handler')).toBe('high')
  expect(tier('Debug flaky checkout test, cause unknown')).toBe('high')
  expect(tier('Verify the migration on a copy')).toBe('high')
  expect(tier('Write a parser for CSV dialects')).toBe('high')
  expect(tier('Concurrency bug in the job queue')).toBe('high')
  expect(tier('Implement the settings page')).toBe('medium')
  expect(tier('Refactor billing module')).toBe('medium')
  expect(tier('Research vector databases')).toBe('medium')
  expect(tier('Add tests for the cart')).toBe('medium')
  expect(tier('Fix round from review findings')).toBe('medium')
  expect(tier('Locate where tokens are refreshed')).toBe('fast')
  expect(tier('Triage the CI log')).toBe('fast')
  expect(tier('Poll deploy status')).toBe('fast')
  expect(tier('Reshape JSON to CSV')).toBe('fast')
  expect(tier('Summarize the meeting')).toBeUndefined()
})

test('keywords match at word starts only, and only the start of the prompt counts', async () => {
  // "report" and "support" don't contain the word "port"; "prefix" is not "fix".
  expect(tier('Report on support prefixes')).toBeUndefined()
  const boiler = `${'Background. '.repeat(60)}Verify with a real check. Security matters.`
  expect(tier('Implement the export', boiler)).toBe('medium')
  expect(tier('Do the thing', 'Please review the auth module for injection.')).toBe('high')
  expect(tier('Do the thing', '', 'pr-review-toolkit:code-reviewer')).toBe('high')
})

test('extra keywords from settings join the built-in rules', async () => {
  const kw = { ...DEFAULT_KEYWORDS, fast: [...DEFAULT_KEYWORDS.fast, 'inventory'] }
  expect(tier('Inventory the plugins folder', '', undefined, kw)).toBe('fast')
  expect(tier('Inventory the plugins folder')).toBeUndefined()
})

test('decisions: the table, a banned model, explicit choices, enforce, named agent types, forks', async () => {
  const req = (over: object = {}) => ({ description: 'Review the diff', prompt: '', ...over })
  expect(decide(req(), classify('Review the diff', '', undefined, DEFAULT_KEYWORDS), CFG)).toMatchObject({ model: 'opus', effort: 'high', tier: 'high' })
  expect(decide(req({ description: 'Locate config' }), classify('Locate config', '', undefined, DEFAULT_KEYWORDS), CFG)).toMatchObject({ model: 'haiku', tier: 'fast' })
  expect(decide(req({ description: 'Locate config' }), { tier: 'fast', why: '' }, CFG).effort).toBeUndefined()

  const banned = decide(req({ model: 'sonnet' }), { tier: 'fast', why: '' }, { ...CFG, bannedModels: ['sonnet'] })
  expect(banned.model).toBe('opus')
  expect(banned.note).toContain('sonnet is banned')
  // A banned id part matches a full id.
  expect(decide(req({ model: 'claude-sonnet-9-9' }), { tier: 'high', why: '' }, { ...CFG, bannedModels: ['sonnet'] }).model).toBe('opus')

  const explicit = decide(req({ model: 'haiku', effort: 'low' }), { tier: 'high', why: 'x' }, CFG)
  expect(explicit.model).toBeUndefined()
  expect(explicit.effort).toBeUndefined()
  expect(explicit.why).toContain("kept the caller's model and effort")

  expect(decide(req({ model: 'haiku', effort: 'low' }), { tier: 'high', why: 'x' }, { ...CFG, enforce: true })).toMatchObject({ model: 'opus', effort: 'high' })

  const named = decide(req({ subagentType: 'my-reviewer' }), { tier: 'fast', why: '' }, CFG)
  expect(named.model).toBeUndefined()
  expect(named.effort).toBeUndefined()
  expect(decide(req({ subagentType: 'my-reviewer' }), { tier: 'fast', why: '' }, { ...CFG, enforce: true }).model).toBe('haiku')
  expect(decide(req({ subagentType: 'my-reviewer', model: 'sonnet' }), { tier: 'fast', why: '' }, { ...CFG, bannedModels: ['sonnet'] }).model).toBe('opus')

  expect(decide(req({ fork: true, model: 'sonnet' }), { tier: 'high', why: '' }, { ...CFG, bannedModels: ['sonnet'] })).toEqual({ why: 'a fork always runs on its parent model' })
  expect(decide(req(), { why: 'no rule matched' }, { ...CFG, unmatched: 'leave' })).toEqual({ why: 'no rule matched; left as asked' })
  expect(decide(req(), { why: 'no rule matched' }, CFG)).toMatchObject({ model: 'opus', effort: 'medium' })
  // A banned fast model falls back to the strong one.
  expect(decide(req(), { tier: 'fast', why: '' }, { ...CFG, bannedModels: ['haiku'] }).model).toBe('opus')
})

// Review repros (fix round): whole-word matching, negation, security terms, strict tier priority.
test('review: "unknown cause" is not a fix round, and one high word beats build words', async () => {
  expect(tier('Debug the crash, unknown cause', 'The service crashes at random; cause unknown.')).toBe('high')
  expect(tier('Investigate the outage', 'The root cause is still unknown; an unknown cause keeps paging us.')).toBe('high')
  expect(tier('Look into the import job', 'Not sure why it stops halfway.')).toBe('high')
  expect(tier('Look into the import job', 'The failure is intermittent.')).toBe('high')
  expect(tier('Verify the build and test fix', 'Check that the fix works.')).toBe('high')
  expect(tier('Verify the migration fix', 'Run it against a copy.')).toBe('high')
  expect(tier('Fix the bug, known cause', 'The null check is missing in save().')).toBe('medium')
  // A findings list lowers to medium only when nothing security-related is present.
  expect(tier('Security review of the auth patch', 'Here is the findings list from the last round; confirm each one is really fixed.')).toBe('high')
  expect(tier('Fix round from review findings', 'Apply each item on the findings list.')).toBe('medium')
  // Whole words: "fixture" is not "fix", "tested" is not "test", "authors" is not "auth".
  expect(tier('Tidy the fixtures')).toBeUndefined()
  expect(tier('Thank the authors')).toBeUndefined()
})

test('review: security terms, crashes, races and flaky tests always mean high, even in a lookup', async () => {
  for (const [d, p] of [
    ['Search for hardcoded secrets', 'Scan the repo for credentials and tokens.'],
    ['Find where SQL injection is possible', 'Trace user input to queries.'],
    ['Grep for XSS sinks', 'innerHTML, dangerouslySetInnerHTML.'],
    ['Triage the production crash', 'Users report data loss after the deploy.'],
    ['Fix the race condition in the test harness', 'It deadlocks sometimes.'],
    ['Fix the flaky test', 'Fails 1 in 10 runs.'],
    ['Classify these vulnerabilities by severity', 'CVE list attached.'],
    ['Locate the auth middleware', ''],
    ['List files that check permissions', ''],
  ]) expect([d, tier(d as string, p as string)]).toEqual([d, 'high'])
  expect(tier('Locate where tokens are refreshed')).toBe('fast')
})

test('review: a banned strongModel falls back to the first allowed model, and the note names it', async () => {
  const cfg = { ...CFG, bannedModels: ['opus'], fallbackModels: ['opus', 'sonnet', 'haiku'] }
  const d = decide({ description: 'Implement X', prompt: '', model: 'opus' }, { tier: 'medium', why: 'x' }, cfg)
  expect(d.model).toBe('sonnet')
  expect(d.note).toContain('runs on sonnet instead')
  expect(decide({ description: 'Review X', prompt: '' }, { tier: 'high', why: 'x' }, cfg)).toMatchObject({ model: 'sonnet', effort: 'high' })
})

test('review: with no strongModel set, the model is left to the session and only effort is set', async () => {
  const cfg = { ...CFG, strongModel: '' }
  const high = decide({ description: 'Review X', prompt: '' }, { tier: 'high', why: 'x' }, cfg)
  expect(high.model).toBeUndefined()
  expect(high.effort).toBe('high')
  expect(decide({ description: 'Locate X', prompt: '' }, { tier: 'fast', why: 'x' }, cfg).model).toBe('haiku')
  const banned = decide({ description: 'Review X', prompt: '', model: 'sonnet' }, { tier: 'high', why: 'x' }, { ...cfg, bannedModels: ['sonnet'], fallbackModels: ['sonnet', 'opus'] })
  expect(banned.model).toBe('opus')
  expect(banned.note).toContain('runs on opus instead')
})
