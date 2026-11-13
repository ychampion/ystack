// Pure logic: which model counts as new, and when the person has already run the audit.

export const AUDIT = '/doctor prompt-audit'

/** One name per model: `claude-opus-5-5[1m]` and `claude-opus-5-5` are the same model for the audit. */
export const modelKey = (model: string): string => model.trim().toLowerCase().replace(/\[[^\]]*\]$/, '')

/** The audit, typed by the person (with or without a path after it). */
export const isAudit = (text: string): boolean => /^\/doctor\s+prompt-audit\b/.test(text.trim())

/** Models to remind about: the current one, unless it was seen before. */
export const isNew = (model: string, seen: readonly string[]): boolean => model !== '' && !seen.includes(modelKey(model))

export const remember = (model: string, seen: readonly string[]): string[] =>
  seen.includes(modelKey(model)) ? [...seen] : [...seen, modelKey(model)].slice(-50)
