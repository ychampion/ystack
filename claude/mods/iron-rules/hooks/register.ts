import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import {
  addGitIdentity,
  isNestedCmdDelete,
  messageFiles,
  rewriteNpm,
  stripAttribution,
  stripInlineAttribution,
} from './rules.ts'

type Shell = 'Bash' | 'PowerShell'
type Rules = { useBun: boolean; noAttribution: boolean; gitName: string; gitEmail: string }

function rulesFrom(options: PluginOptions): Rules {
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return {
    useBun: options.useBun !== false,
    noAttribution: options.noAttribution !== false,
    gitName: text(options.gitName),
    gitEmail: text(options.gitEmail),
  }
}

async function cleanMessageFiles($: EngineInterface, command: string): Promise<string[]> {
  const cleaned: string[] = []
  for (const path of messageFiles(command)) {
    const text = await $.fs.read(path).catch(() => undefined)
    if (typeof text !== 'string') continue
    const next = stripAttribution(text)
    if (next !== text) {
      await $.fs.write(path, next)
      cleaned.push(path)
    }
  }
  return cleaned
}

function rewrite(command: string, rules: Rules): { command: string; notes: string[] } {
  const notes: string[] = []
  let out = command

  if (rules.useBun) {
    const npm = rewriteNpm(out)
    if (npm !== out) notes.push('npm/npx -> bun/bunx')
    out = npm
  }

  if (rules.gitName && rules.gitEmail) {
    const ident = addGitIdentity(out, rules.gitName, rules.gitEmail)
    if (ident !== out) notes.push(`added the commit identity ${rules.gitName} <${rules.gitEmail}>`)
    out = ident
  }

  if (rules.noAttribution && /\bgit\b[^\n]*\bcommit\b|\bgh\s+(pr|issue)\s+(create|edit|comment)\b/.test(out)) {
    const stripped = stripInlineAttribution(out)
    if (stripped !== out) notes.push('removed AI attribution')
    out = stripped
  }
  return { command: out, notes }
}

export const register: Register = (on, options) => {
  const rules = rulesFrom(options)
  on('tool.call', { tool: ['Bash', 'PowerShell'] }, async ($, e, next) => {
    const tool: Shell = e.tool
    if (isNestedCmdDelete(e.command)) {
      return {
        deny:
          'iron-rules: nested `cmd /c rmdir|del` is blocked (the quoting breaks). ' +
          "Use PowerShell `Remove-Item -LiteralPath '<path>' -Recurse -Force` with a single-quoted path.",
      }
    }

    const { command, notes } = rewrite(e.command, rules)
    if (rules.noAttribution) {
      const cleaned = await cleanMessageFiles($, command)
      if (cleaned.length > 0) notes.push(`removed AI attribution from ${cleaned.join(', ')}`)
    }

    const ran = await next(command === e.command ? e : { ...e, command })
    if (ran.deny !== undefined) return ran

    const context = [...(ran.context ?? [])]
    if (notes.length > 0) context.push(`iron-rules: ${notes.join('; ')}.`)
    if (tool === 'PowerShell' && ran.isError === true && /\\"/.test(e.command)) {
      context.push(
        'iron-rules: PowerShell does not escape quotes with a backslash (`\\"`). Use single quotes, a backtick (`"), or a here-string.',
      )
    }
    return context.length > (ran.context?.length ?? 0) ? { ...ran, context } : ran
  }).catch(($, e, next) => next(e)) // fail open: a broken rule never blocks real work
}
