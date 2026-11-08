# Claude Code mods

Mods are Claude Code plugins built from function hooks: they sit on tool calls, prompts, subagent turns and the UI, so a rule is enforced, not just written in CLAUDE.md and hoped for. Each mod is independent; install only the ones you want.

```
/plugin install <mod> --marketplace ychampion/ystack
```

In the desktop app's Code tab: + next to the prompt box → Plugins → Add marketplace `ychampion/ystack` → Add plugin.

## Guards

| Mod | What it does | Settings |
| --- | --- | --- |
| `iron-rules` | Rewrites shell calls to house rules: `npm`/`npx` → `bun`/`bunx`, your commit identity on every commit, AI attribution stripped from commits and PRs, nested `cmd /c rmdir` blocked on Windows. | `gitName`, `gitEmail` (identity is added only when both are set), `useBun`, `noAttribution` |
| `verify` | A gate for the main loop and every subagent: no "done" without a real check. Optionally runs only the tests related to each edit in the background and reports failures as they happen; that runs the project's own test scripts without a prompt, so it is off until you turn it on, and only covers projects inside the session's folder. | `liveTests` (or `/live-tests on` per session) |
| `codex-ladder` | For people who drive the Codex CLI from Claude: keeps each run on an effort ladder (escalate a tier instead of retrying the same one, `max` only after `/codex-allow-max`), and checks briefs for DONE criteria, verification and a stop condition. | `defaultEffort`, `briefTemplate`, `blockFastTier` |
| `package-bouncer` | Checks every package install (npm, bun, pnpm, yarn, pip, uv, pipx, cargo, go, gem, composer) against the registry and OSV before it runs. Stops made-up names, known-vulnerable versions, releases younger than the minimum age, look-alikes of popular packages and names it can't read; warns on low downloads and npm install scripts. `/allow-package eco:NAME` (e.g. `npm:left-pad`, `pypi:my_pkg`) lets one through for the session; a bare `NAME` applies to the ecosystem where it was last stopped. | `minAgeDays` (14), `minWeeklyDownloads` (500), `failClosed` |
| `vault` | Lets Claude use API keys without seeing them. `/vault add NAME` saves a key to the OS keychain (Windows DPAPI, Linux secret-tool, else a 0600 file); Claude writes `{{vault:NAME}}`, the key reaches only that command through an environment variable, and it is hidden again in everything Claude reads and in the transcript. Writing a key into a file is refused. Refusing file tools on the store folder (checked on the resolved path, however it is spelled) is a second layer; hiding the keys in everything Claude reads is the main protection. | — |
| `slop-guard` | Checks design edits (CSS, TSX, HTML, Vue, Svelte, Astro, Tailwind classes) for the tells of AI-made design and reports them to Claude with line numbers; blocks only the unmistakable ones (gradient text, glows, banned fonts, fake content) until fixed or explained. Pairs with the `taste` skill. | per-rule overrides, extra banned fonts |

`codex-ladder` reads effort from the command line; an effort it cannot read counts as `max`. It is a guardrail against mistakes, not a security boundary: a Codex profile or `~/.codex/config.toml` can set effort without the command showing it. The same goes for `package-bouncer`: it catches honest mistakes, not deliberate evasion (`eval`, scripts).

## Delegation

| Mod | What it does | Works with |
| --- | --- | --- |
| `brief-linter` | Appends any missing standing requirements to every subagent brief: verify with a real check, long output to a file, an "Assumptions I made" section, a loop cap, and the decision inbox for owner calls. | `assumptions-ledger`, `decision-inbox` |
| `assumptions-ledger` | Reads each subagent's "Assumptions I made" and hands them to the main Claude to check. Technical ones it settles itself; only product or business calls go to you, through the decision inbox. `/assumptions` shows the log. | `brief-linter`, `decision-inbox` |
| `decision-inbox` | A non-blocking `ask` tool: an agent records a decision that is yours, takes its recommended default and keeps working. `/inbox` lists them with plain-language context, from every session; answer in any of them. Only the session that asked receives the answer: it collects it itself, so nothing is sent between sessions, a different permission mode doesn't hold it up, and a closed session gets it when resumed. | — |
| `spec-sharpener` | On a large, open-ended build request, has Claude ask 3-4 pointed questions before it starts. `/sharpen on\|off`. | — |
| `review-panel` | `/review-panel` picks specialist reviewers from the diff and runs them in parallel, then verifies their findings. | the `pr-review-toolkit` and `compound-engineering` plugins |

## Long sessions

| Mod | What it does | Settings |
| --- | --- | --- |
| `context-meter` | Speaks once when the context passes your handoff mark, when a usage limit nears 90%, and before the prompt cache lapses on a big idle context. `/ctx` shows size, limits and cost; `/handoff` writes a handoff doc from a cache-read fork, so the main context does not grow. | `handoffAt`, `compactAt`, `handoffDir` |
| `night-shift` | `/queue add <task>`, then `/queue start [HH:MM]`: runs queued tasks one at a time unattended, with soft budgets, a pause at rate limits, compaction between tasks and a morning report. | uses `decision-inbox` |
| `session-recovery` | After a restart or crash, offers to reopen every Claude session that was running, each resumed in its own Windows Terminal tab (tmux on Linux). `/recover`. | — |
| `loop-breaker` | Notices when the main session or a subagent goes in circles (the same failure repeating, an edit undone and redone, a flapping test). First a note, then a second opinion from the same model with no history, then it stops the agent and leaves you a decision in the inbox. | `repeats` (3), `secondOpinion` |
| `lanes` | Several sessions in one repo: warns when another session holds a file you edit, tells both sides early when two worktrees change the same file, and holds back git commands that hit shared state (stash, reset --hard, clean, gc, removing a worktree in use). `/lanes`. | `block` |
| `pin` | `/pin <rule>` keeps a rule word for word through every compaction (`--project` keeps it for this folder). Memory holds facts for all future sessions; pins are exact rules that must survive compaction. Suggests pins, never pins by itself. | — |
| `keep-going` | When Claude stops to offer in-scope, reversible work it could just do ("want me to continue?"), sends it back to work. Never for real decisions, risky or outward steps, or finished work. At most twice per request, with a toast each time. | `enabled`, `maxNudges` |

## Cost

| Mod | What it does | Settings |
| --- | --- | --- |
| `prompt-diet` | `/diet` shows what every turn sends, largest first, and which tools and skills you actually use. Load rarely used tools on demand, leave out noisy reminders, or shorten the skill listing; nothing becomes unreachable, decisions hold for the session so the prompt cache stays intact, and `/diet restore` undoes it. | `autoDefer`, `unusedSessions`, `compactSkills` (all off) |
| `output-diet` | Shortens long build, install, test and lint output before Claude reads it: strips progress bars, collapses repeats, keeps every error with context. Everything else (file reads, diffs, searches, queries, scripts) passes through whole, and the full output is always saved to a file Claude can read. `/output-diet`. | `enabled`, `maxLines` (150) |

## For the owner

| Mod | What it does | Settings |
| --- | --- | --- |
| `owner-view` | Plain-English captions under tool rows; `/brief-me` (done, left, risky, needs you) written cheaply from a cache-read fork and shown by itself after a break; a Plan › Build › Review › Test › Ship strip with what the change still needs before it ships, offered as the Tab suggestion. | `captions`, `awayMinutes` (45), `suggestions` |
| `user-voice` | On a feature request, adds matching quotes from your notes on what users said; on a rough one, Claude proposes 2-3 concrete versions and asks once before building. "Just do it" skips that. Works alongside `spec-sharpener`. `/user-voice`. | `evidenceDir`, `maxQuotes`, `proposeFirst` |
| `operator-context` | Gives Claude your own profile (who you are, what you own, what you authorize) as facts for its judgment that never override safety rules; lines that try to switch safety off are dropped and shown to you. `/operator`. | `profileFile`, `subagents` |
| `twins` | Tells you when one of two copies (a live copy and a shared one, code and docs) falls behind after an edit. Never edits and never prompts Claude by itself; only `/twins sync <name>` asks Claude to port the change. | `twinsFile` (+ `~/.claude/twins.json`) |

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
