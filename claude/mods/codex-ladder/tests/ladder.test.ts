import { expect, test } from 'claude-code/testing'

import { effectiveEffort, isCodexExec, missingBriefParts, nextUp, parseCodex } from '../hooks/ladder.ts'

test('parses effort, profile and brief file', async () => {
  const c = parseCodex('codex exec -c model_reasoning_effort="high" --profile docs - < briefs/slice.md')
  expect(c.effort).toBe('high')
  expect(c.profile).toBe('docs')
  expect(c.briefFile).toBe('briefs/slice.md')
  expect(effectiveEffort(parseCodex('codex exec "do x"'))).toBe('xhigh')
  expect(effectiveEffort(parseCodex('codex exec "do x"'), 'high')).toBe('high')
  expect(parseCodex("codex exec -c model_reasoning_effort='ultra' x").effort).toBe('ultra')
  expect(parseCodex('codex exec -c model_reasoning_effort=medium -c model_reasoning_effort=max x').effort).toBe('max')
  expect(parseCodex('codex exec -c model_reasoning_effort=max -c model_reasoning_effort=medium x').effort).toBe('max')
  expect(parseCodex('codex exec -c service_tier=priority x').hasServiceTier).toBe(true)
  expect(parseCodex('Get-Content -Raw C:/b/brief.md | codex exec -').briefFile).toBe('C:/b/brief.md')
})

test('recognises codex exec, not other codex words', async () => {
  expect(isCodexExec('cd repo && codex exec - < b.md')).toBe(true)
  expect(isCodexExec('codex features list')).toBe(false)
  expect(isCodexExec('echo codex exec is great')).toBe(true) // conservative: only adds notes or applies the hard bans
})

test('brief gaps and the ladder', async () => {
  expect(missingBriefParts('## Objective and DONE\nDONE means tests pass. Verify with bun test. Stop after 2 fix cycles.')).toEqual([])
  expect(missingBriefParts('Make it faster.')).toEqual(['DONE criteria', 'verification steps', 'an iteration cap / stop condition'])
  expect(nextUp('medium')).toBe('high')
  expect(nextUp('xhigh')).toBe('xhigh')
})
