# Claude Code mods

Mods are Claude Code plugins built from function hooks: they sit on tool calls, prompts, subagent turns and the UI, so a rule is enforced, not just written in CLAUDE.md and hoped for. Each mod is independent; install only the ones you want.

```
/plugin install <mod> --marketplace ychampion/ystack
```

## Guards

| Mod | What it does | Settings |
| --- | --- | --- |
| `iron-rules` | Rewrites shell calls to house rules: `npm`/`npx` → `bun`/`bunx`, your commit identity on every commit, AI attribution stripped from commits and PRs, nested `cmd /c rmdir` blocked on Windows. | `gitName`, `gitEmail` (identity is added only when both are set), `useBun`, `noAttribution` |
| `verify` | A gate for the main loop and every subagent: no "done" without a real check. Runs only the tests related to each edit in the background and reports failures as they happen. | — |
| `codex-ladder` | For people who drive the Codex CLI from Claude: keeps each run on an effort ladder (escalate a tier instead of retrying the same one, `max` only after `/codex-allow-max`), and checks briefs for DONE criteria, verification and a stop condition. | `defaultEffort`, `briefTemplate`, `blockFastTier` |

## Delegation

| Mod | What it does | Works with |
| --- | --- | --- |
| `brief-linter` | Appends any missing standing requirements to every subagent brief: verify with a real check, long output to a file, an "Assumptions I made" section, a loop cap, and the decision inbox for owner calls. | `assumptions-ledger`, `decision-inbox` |
| `assumptions-ledger` | Reads each subagent's "Assumptions I made" and hands them to the main Claude to check. Technical ones it settles itself; only product or business calls go to you, through the decision inbox. `/assumptions` shows the log. | `brief-linter`, `decision-inbox` |
| `decision-inbox` | A non-blocking `ask` tool: an agent records a decision that is yours, takes its recommended default and keeps working. `/inbox` lists them with plain-language context; your answer is sent back to whoever asked. | — |
| `spec-sharpener` | On a large, open-ended build request, has Claude ask 3-4 pointed questions before it starts. `/sharpen on\|off`. | — |
| `review-panel` | `/review-panel` picks specialist reviewers from the diff and runs them in parallel, then verifies their findings. | the `pr-review-toolkit` and `compound-engineering` plugins |

## Long sessions

| Mod | What it does | Settings |
| --- | --- | --- |
| `context-meter` | Speaks once when the context passes your handoff mark, when a usage limit nears 90%, and before the prompt cache lapses on a big idle context. `/ctx` shows size, limits and cost; `/handoff` writes a handoff doc from a cache-read fork, so the main context does not grow. | `handoffAt`, `compactAt`, `handoffDir` |
| `night-shift` | `/queue add <task>`, then `/queue start [HH:MM]`: runs queued tasks one at a time unattended, with soft budgets, a pause at rate limits, compaction between tasks and a morning report. | uses `decision-inbox` |
| `session-recovery` | After a restart or crash, offers to reopen every Claude session that was running, each resumed in its own Windows Terminal tab (tmux on Linux). `/recover`. | — |

## Learning

| Mod | What it does | Works with |
| --- | --- | --- |
| `memory-recall` | When a tool call fails, matches the error against your memory notes and skills and points Claude at the one that fits. | Claude Code auto-memory, `~/.claude/skills` |
| `auto-claudeception` | After a long debugging turn or a "turns out" discovery, suggests `/claudeception` to save what was learned as a skill. Never runs it by itself. | a `/claudeception` skill |

## Developing

Each mod is a folder: `.claude-plugin/plugin.json`, `hooks/hooks.json`, a hooks module, and tests.

```
claude --plugin-dir claude/mods/<mod>     # load one mod from this checkout
claude plugin validate claude/mods/<mod>
claude plugin test claude/mods/<mod>
```

Claude Code writes the mod's type definitions to `.claude-plugin/types/` when it loads the mod (ignored by git); after that, `bunx tsc -p claude/mods/<mod> --noEmit --allowImportingTsExtensions` type-checks it.
