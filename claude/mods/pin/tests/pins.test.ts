import { expect, test } from 'claude-code/testing'

import { BLOCK_HEAD, compactInstructions, detectRules, missingPins, parsePinArgs, projectKey } from '../hooks/pins.ts'

test('hard rules are detected, questions and plain asks are not', async () => {
  expect(detectRules('Fix the login bug. Never make this repo public. Thanks')).toEqual(['Never make this repo public.'])
  expect(detectRules('You must not push to main\nalso tidy the README')).toEqual(['You must not push to main'])
  expect(detectRules("- Don't ever send email to customers yourself")).toEqual(["Don't ever send email to customers yourself"])
  expect(detectRules('Do not touch billing code, ever.')).toEqual(['Do not touch billing code, ever.'])
  expect(detectRules('Is it always this slow?')).toEqual([])
  expect(detectRules('Please add a dark mode toggle.')).toEqual([])
})

test('the verbatim check tolerates rewrapping, not rewording', async () => {
  const pins = ['Never make this repo public.', 'Always use bun, not npm.']
  expect(missingPins(pins, ['Summary...\nNever make this\nrepo public.\nAlways use bun,  not npm.'])).toEqual([])
  expect(missingPins(pins, ['The repo must stay private. Always use bun, not npm.'])).toEqual(['Never make this repo public.'])
})

test('instructions, args and project keys', async () => {
  const i = compactInstructions('Keep the API notes.', ['Never deploy on Fridays.'])
  expect(i.startsWith('Keep the API notes.')).toBe(true)
  expect(i).toContain('- Never deploy on Fridays.')
  expect(i).toContain(BLOCK_HEAD)
  expect(parsePinArgs('')).toEqual({ kind: 'list' })
  expect(parsePinArgs('--project Never X')).toEqual({ kind: 'add', text: 'Never X', isProject: true })
  expect(parsePinArgs('Never X')).toEqual({ kind: 'add', text: 'Never X', isProject: false })
  expect(projectKey('C:' + String.fromCharCode(92) + 'Work' + String.fromCharCode(92) + 'App' + String.fromCharCode(92))).toBe(projectKey('c:/work/app'))
})
