import { expect, test } from 'claude-code/testing'

import { isAudit, isNew, modelKey, remember } from '../hooks/checkup'

test('a context-size suffix is the same model', async () => {
  expect(modelKey('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
  expect(isNew('claude-opus-5-5[1m]', ['claude-opus-5-5'])).toBe(false)
})

test('a model never seen is new; an empty name never is', async () => {
  expect(isNew('claude-fable-5-2', ['claude-opus-5-5'])).toBe(true)
  expect(isNew('', [])).toBe(false)
})

test('remember adds once', async () => {
  expect(remember('claude-opus-5-5', ['claude-opus-5-5'])).toEqual(['claude-opus-5-5'])
  expect(remember('claude-haiku-5-5', [])).toEqual(['claude-haiku-5-5'])
})

test('the audit is recognised with or without a path', async () => {
  expect(isAudit('/doctor prompt-audit')).toBe(true)
  expect(isAudit('  /doctor prompt-audit ./repo')).toBe(true)
  expect(isAudit('/doctor')).toBe(false)
  expect(isAudit('please run /doctor prompt-audit')).toBe(false)
})
