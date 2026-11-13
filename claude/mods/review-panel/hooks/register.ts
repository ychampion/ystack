import type { Register } from 'claude-code'

import { panelPrompt, pickPanel } from './panel.ts'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'review-panel',
      description: 'Dispatch the specialist review panel (picked from the diff) on uncommitted changes, a ref range, or a PR',
      argumentHint: '[HEAD~3 | main...HEAD | #123]',
    })
    return next(e)
  })

  on('command.run', { command: 'review-panel' }, async ($, e) => {
    const arg = e.args.trim()
    const pr = arg.match(/^#?(\d+)$/)?.[1]
    let files: string[] = []
    let scope: string

    if (pr) {
      scope = `PR #${pr}`
      const r = await $.process.run(['gh', 'pr', 'diff', pr, '--name-only'], { timeoutMs: 30_000 }).catch(() => undefined)
      files = r?.exitCode === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : []
    } else {
      const range = arg || 'HEAD'
      // A ref or range only: an argument like --output=<file> would make git write files.
      if (!/^[\w./~^@{}-]+(\.{2,3}[\w./~^@{}-]+)?$/.test(range) || range.startsWith('-'))
        return { text: `review-panel: "${range}" is not a ref or range (e.g. HEAD~3, main...HEAD, #123).` }
      scope = arg ? `the diff ${arg}` : 'the uncommitted changes (staged, unstaged and untracked)'
      const diff = await $.process.run(['git', 'diff', '--name-only', '--end-of-options', range], { timeoutMs: 30_000 }).catch(() => undefined)
      if (!diff || diff.exitCode !== 0) return { text: `review-panel: git diff ${range} failed here: ${diff?.stderr.trim() ?? 'not a git repository'}` }
      files = diff.stdout.split(/\r?\n/).filter(Boolean)
      if (!arg) {
        const untracked = await $.process.run(['git', 'ls-files', '--others', '--exclude-standard'], { timeoutMs: 30_000 }).catch(() => undefined)
        files.push(...(untracked?.stdout.split(/\r?\n/).filter(Boolean) ?? []))
      }
    }

    if (files.length === 0) return { text: `review-panel: nothing to review in ${scope}.` }
    const panel = pickPanel(files)
    // Not from inside the command: the engine refuses a submit that would wait under the turn this hook holds.
    const text = panelPrompt(scope, files, panel)
    $.clock.after(0, () => void $.prompt.submit({ text }).catch(() => undefined))
    return { text: `review-panel: ${panel.length} reviewers queued for ${scope} (${files.length} files).` }
  })
}
