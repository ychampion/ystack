// Picks the specialist reviewers for a set of changed files.

export function pickPanel(files: readonly string[]): string[] {
  const any = (re: RegExp) => files.some(f => re.test(f))
  const panel = ['pr-review-toolkit:code-reviewer', 'pr-review-toolkit:silent-failure-hunter']
  if (any(/(\.|_)(test|spec)\.|(^|\/)tests?\//i)) panel.push('pr-review-toolkit:pr-test-analyzer')
  if (any(/\.(c|m)?tsx?$/i)) panel.push('compound-engineering:review:kieran-typescript-reviewer')
  if (any(/\.(tsx|jsx)$/i) || any(/src-tauri\//i)) panel.push('compound-engineering:review:julik-frontend-races-reviewer')
  if (any(/\.py$/i)) panel.push('compound-engineering:review:kieran-python-reviewer')
  if (any(/auth|token|secret|crypt|permission|sandbox|session|oauth|password|payment|billing/i))
    panel.push('compound-engineering:review:security-sentinel')
  if (any(/migrat|schema|\.sql$|prisma|drizzle/i)) panel.push('compound-engineering:review:data-integrity-guardian')
  return panel
}

export function panelPrompt(scope: string, files: readonly string[], panel: readonly string[]): string {
  const shown = files.slice(0, 40).join(', ') + (files.length > 40 ? `, … (${files.length} files)` : '')
  return [
    `Run the review panel on ${scope}${files.length ? ` (${shown})` : ''}.`,
    `Dispatch these reviewers in parallel in ONE message, each with model "opus" and the diff scope named: ${panel.join(', ')}.`,
    'Each writes its full findings to a file and returns the path plus its top findings.',
    'Then verify every finding against the code yourself (drop false positives), and report the confirmed ones ranked by severity, with file:line and the fix. Do not edit code unless I ask.',
  ].join('\n')
}
