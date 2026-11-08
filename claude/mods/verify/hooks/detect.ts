// Pure helpers: what counts as a check, a claim, a code file, and which related tests to run.

export const CHECK_CMD =
  /\b(test|tests|vitest|jest|pytest|tsc|typecheck|lint|clippy|build|cargo\s+(test|check|build)|go\s+(test|vet|build)|playwright|gh\s+(pr\s+checks|run\s+(watch|view))|curl|browse|bun\s+(run|-e|test)|bunx|node\s|python\s|Invoke-WebRequest|Measure-Command)\b/i

export const CLAIM =
  /\b(verified|tests?\s+(now\s+)?pass(es|ed|ing)?|all\s+(tests|checks)\s+(pass|are\s+green|green)|works\s+now|now\s+works|confirmed\s+(working|it\s+works)|fixed\s+and\s+working|everything\s+(passes|works)|build\s+(is\s+)?green)\b/i

/** Prose: editing it needs no build or test, so it neither counts as an edit nor resets the checks. */
export const DOC_FILE = /\.(md|mdx|txt|rst|adoc)$/i

export const CODE_FILE =/\.(c|m)?[jt]sx?$|\.(py|rs|go|vue|svelte)$/i

export const TEST_FILE = /(\.|_)(test|spec)\.(c|m)?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/i

export const norm = (p: string) => p.replace(/\\/g, '/')
export const dirOf = (p: string) => norm(p).replace(/\/[^/]*$/, '')
export const baseOf = (p: string) => norm(p).replace(/^.*\//, '')

/** Forward slashes, `.` and `..` collapsed, no trailing slash, lower case: comparable for a containment check. */
export function resolved(path: string): string {
  const out: string[] = []
  for (const part of norm(path).split('/')) {
    if (part === '..') {
      if (out.length > 1) out.pop()
    } else if (part !== '.' && !(part === '' && out.length > 0)) out.push(part)
  }
  return out.join('/').toLowerCase()
}

/** The name a related test file would carry: `auth.service.ts` -> `auth.service`, `test_auth.py` -> `auth`. */
export function stemOf(path: string): string {
  return baseOf(path)
    .replace(/\.(c|m)?[jt]sx?$|\.(py|rs|go|vue|svelte)$/i, '')
    .replace(/(\.|_)(test|spec)$/i, '')
    .replace(/^test_/i, '')
}

export type Manifest = 'package.json' | 'pyproject.toml' | 'pytest.ini' | 'setup.cfg' | 'Cargo.toml' | 'go.mod'
export const MANIFESTS: readonly Manifest[] = ['package.json', 'pyproject.toml', 'pytest.ini', 'setup.cfg', 'Cargo.toml', 'go.mod']

export type Plan = { argv: string[]; label: string } | undefined

/** Related test files among `tracked` (paths relative to root) for the edited files. */
export function relatedTests(edited: readonly string[], tracked: readonly string[], root: string): string[] {
  const rootN = norm(root).replace(/\/$/, '')
  const out = new Set<string>()
  for (const f of edited) {
    const rel = norm(f).startsWith(rootN + '/') ? norm(f).slice(rootN.length + 1) : norm(f)
    if (TEST_FILE.test(rel)) out.add(rel)
    const stem = stemOf(f).toLowerCase()
    if (stem.length < 3) continue
    for (const t of tracked) {
      if (!TEST_FILE.test(t)) continue
      if (stemOf(t).toLowerCase() === stem) out.add(t)
    }
  }
  return [...out].slice(0, 25)
}

/** Picks the cheapest command that runs only what the edits touch. */
export function planRun(args: {
  manifest: Manifest
  packageJson?: string
  edited: readonly string[]
  tracked: readonly string[]
  root: string
  /** The project's interpreter (its .venv python, or `uv run python`); bare `python` when unset. */
  python?: readonly string[]
}): Plan {
  const { manifest, edited, tracked, root } = args
  const rootN = norm(root).replace(/\/$/, '')
  const rel = (f: string) => (norm(f).startsWith(rootN + '/') ? norm(f).slice(rootN.length + 1) : norm(f))

  if (manifest === 'package.json') {
    const pkg = args.packageJson ?? ''
    const abs = edited.map(norm)
    if (/"vitest"\s*:/.test(pkg)) return { argv: ['bun', 'x', 'vitest', 'related', '--run', '--reporter=dot', ...abs], label: 'vitest related' }
    if (/"jest"\s*:/.test(pkg))
      return { argv: ['bun', 'x', 'jest', '--findRelatedTests', '--passWithNoTests', '--silent', ...abs], label: 'jest related' }
    const tests = relatedTests(edited, tracked, root)
    if (tests.length === 0) return undefined
    if (tests.some(t => /\.spec\.[jt]sx?$/.test(t)) && /"@playwright\/test"\s*:/.test(pkg)) return undefined // e2e: too heavy to auto-run
    return { argv: ['bun', 'test', ...tests.map(t => `./${t}`)], label: `bun test (${tests.length} file${tests.length > 1 ? 's' : ''})` }
  }
  if (manifest === 'pyproject.toml' || manifest === 'pytest.ini' || manifest === 'setup.cfg') {
    const tests = relatedTests(edited, tracked, root).filter(t => t.endsWith('.py'))
    if (tests.length === 0) return undefined
    return { argv: [...(args.python ?? ['python']), '-m', 'pytest', '-q', '-x', '--no-header', '-p', 'no:cacheprovider', ...tests], label: `pytest (${tests.length})` }
  }
  if (manifest === 'Cargo.toml') return { argv: ['cargo', 'check', '--quiet', '--message-format=short'], label: 'cargo check' }
  if (manifest === 'go.mod') {
    const dirs = [...new Set(edited.filter(f => f.endsWith('.go')).map(f => `./${dirOf(rel(f)) || '.'}`))].slice(0, 10)
    if (dirs.length === 0) return undefined
    return { argv: ['go', 'test', ...dirs], label: `go test (${dirs.length} pkg)` }
  }
  return undefined
}

/** The most useful lines of a failing run, at most `max`. */
export function failureLines(output: string, max = 15): string[] {
  const lines = output.split(/\r?\n/).map(l => l.trimEnd()).filter(l => l.trim().length > 0)
  const hits = lines.filter(l =>
    /(FAIL|✗|×|\bfailed\b|\bfailing\b|error(\[|:)|panicked|AssertionError|Expected|Received|assert |Traceback|\bE\s{2,})/i.test(l),
  )
  const pick = hits.length > 0 ? hits : lines.slice(-max)
  return pick.slice(0, max).map(l => (l.length > 220 ? l.slice(0, 217) + '...' : l))
}

/** The check the owner's project most likely uses, for the gate's hint. */
export function suggestCheck(manifest: Manifest | undefined, packageJson: string | undefined): string {
  if (manifest === 'package.json') {
    const scripts = packageJson?.match(/"scripts"\s*:\s*\{([^}]*)\}/)?.[1] ?? ''
    const has = (s: string) => new RegExp(`"${s}"\\s*:`).test(scripts)
    const parts = [has('typecheck') ? 'bun run typecheck' : '', has('test') ? 'bun run test' : 'bun test', has('build') ? 'bun run build' : '']
    return parts.filter(Boolean).join(' && ')
  }
  if (manifest === 'Cargo.toml') return 'cargo test'
  if (manifest === 'go.mod') return 'go test ./...'
  if (manifest !== undefined) return 'python -m pytest -q'
  return 'the project\'s build or test command, or a real run of what changed'
}
