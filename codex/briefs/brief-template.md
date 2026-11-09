# Codex brief template (`codex exec`, unattended)

Fill the slots, delete what does not apply, and keep the order. A stable opening means prompt-cache
hits across briefs, so put dates and other volatile facts low, never first. Rules that apply to every
run belong in your global `AGENTS.md`; add here only what is specific to this task.

Launch:
```
codex exec --skip-git-repo-check -C <dir> -o <last-message-file> "$(cat BRIEF.md)" </dev/null | tee codex.log
```
Add your sandbox and approval flags to taste. Pick the effort for the task, not out of caution: low for
non-coding chores (docs, renames, PR admin), medium for trivial code, high for small but important
changes, xhigh for normal implementation once the brief has done the thinking. Use the top tier only
with explicit permission for one task. If a tier under-delivers, go one tier up; never retry at the
same tier. The `codex-ladder` mod enforces this from Claude Code.

To steer a running campaign: stop the run, then `codex exec resume <session-id> "<what changed>"`.

---

Unattended run: nobody will answer questions. Never end a turn with a question. When something is
unclear, take the safest reversible assumption, log it under `## Assumptions` in REPORT.md, and continue.

Precedence: this brief outranks skills and the general rules in AGENTS.md wherever they conflict. If a
skill makes you pause, name the SKILL.md and quote the line in REPORT.md, then follow this brief.

## Objective
<what the user wants, in their words, and why>

## DONE means
<observable end state that anyone can check: files present, commands that pass, PRs opened and green.
Completion is this line, not "first draft works". Run it, inspect the result, fix what fails, and keep
going until DONE or a stop condition below.>

## Environment (checked <date>)
<toolchain versions, disk headroom, branches and PRs, what already exists and must be reused>
Your knowledge has a cutoff; trust this section over memory for anything newer.

## Verification
<the exact commands that prove DONE, and what passing looks like. Run them yourself before you stop.>

Test sizing: run the tests that cover the change and the required checks. Once they pass, broaden or
repeat testing only when new changes, failures or open concerns justify it. Do not write tests for
reversible, low-impact changes that only mirror the implementation. Run the full suite once before
pushing. Local test suites use disposable fixtures; run and re-run them without asking.

## Rules and stop conditions
- Iteration cap: stop after <N> fix cycles on any one failing problem, and report it.
- Time cap: stop after <H> hours, then write the final REPORT.md section.
- <repo rules: commit identity, attribution policy, never force-push the default branch, never merge red>
- Stop and report when <condition that means a human must decide>.

Security-sensitive slices (sandboxes, permission gates, input sanitisers): phrase them as defensive
verification, "prove the gate rejects X", naming the boundary, the evidence that it holds, and what
would show it does not. If you still decline one, log why in REPORT.md and continue with the rest.

## Output
REPORT.md is append-only. Every entry names a commit SHA, run id, or log excerpt. Update it at least
every 30 minutes, keep the `## Assumptions` section current, and write a final section when you stop:
what is DONE, what is not, and what a human needs to decide. Commit messages and PR bodies in plain prose.

## Slices (each one a green, reviewable change, in order)
1. <slice>
2. <slice>
