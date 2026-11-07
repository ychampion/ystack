// `/vault` arguments. Pure.

import { NAME } from './placeholders.ts'

export type VaultCommand =
  | { kind: 'help' }
  | { kind: 'list' }
  | { kind: 'add'; name: string }
  | { kind: 'remove'; name: string }
  | { kind: 'bad'; why: string }

const ADD = new Set(['add', 'set', 'new'])
const REMOVE = new Set(['remove', 'rm', 'delete', 'del'])
const LIST = new Set(['list', 'ls'])

/**
 * True when a word that fits the name pattern is more likely a pasted key: a known key prefix, or a
 * long random-looking stretch (12+ characters between underscores, with a digit). Names like
 * OPENAI_KEY or STRIPE_KEY_2 pass; sk_live_51H..., ghp_..., AKIA... do not.
 */
export function looksLikeKey(word: string): boolean {
  if (/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|[sprk]k_(live|test)_|(AKIA|ASIA)[A-Z0-9]{16}$)/.test(word)) return true
  return word.split('_').some(part => part.length >= 12 && /\d/.test(part))
}

const isName = (word: string | undefined): word is string => word !== undefined && NAME.test(word) && !looksLikeKey(word)

/**
 * The arguments as they may be kept in the transcript: the subcommand and a valid name, nothing else.
 * Whatever else was typed (perhaps a pasted key) is dropped before the command's line is recorded.
 */
export function safeArgs(args: string): string {
  const [first = '', second] = args.trim().split(/\s+/)
  const sub = first.toLowerCase()
  if (ADD.has(sub) || REMOVE.has(sub)) return isName(second) ? `${sub} ${second}` : sub
  if (LIST.has(sub) || sub === 'help' || sub === '') return sub
  return ''
}

export function parseVault(args: string): VaultCommand {
  const [first = '', second] = args.trim().split(/\s+/)
  const sub = first.toLowerCase()
  if (sub === '' || sub === 'help') return { kind: 'help' }
  if (LIST.has(sub)) return { kind: 'list' }
  if (ADD.has(sub) || REMOVE.has(sub)) {
    if (second === undefined) return { kind: 'bad', why: `Give the key a name: /vault ${sub} NAME (for example OPENAI_KEY).` }
    if (looksLikeKey(second))
      return { kind: 'bad', why: 'That looks like a key, not a name. Type /vault add NAME (for example STRIPE_KEY), then paste the key into the box that opens.' }
    if (!NAME.test(second))
      return { kind: 'bad', why: 'A key name starts with a letter and uses only letters, digits and underscores (for example OPENAI_KEY).' }
    return ADD.has(sub) ? { kind: 'add', name: second } : { kind: 'remove', name: second }
  }
  return { kind: 'bad', why: 'Use /vault add NAME, /vault list or /vault remove NAME.' }
}
