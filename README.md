# ystack

A working stack for coding agents: the rules, guards and helpers that make long agent runs more reliable and the human's job smaller.

It is general on purpose. Nothing in here is tied to one person's machine: anything personal (your git identity, thresholds, paths) is a setting you fill in at install.

## Why use it

The numbers below come from one heavy user's own logs: 14 days of Claude Code on Opus, about 60,000 API calls. Each one is measured or replayed, and the write-ups say which.

- **Most usage isn't where you'd think.** Subagents made 73% of it. Six sessions running for days near the compaction limit made 91%. The mods' own prompt text was 0.3%.
- **Resetting context at the right moment saves ~15%.** Replaying those 14 days with handoffs at 252k and subagents compacting at 250k cut usage from 1.90B to 1.61B input-token equivalents. `context-meter` does the handoffs by itself, between turns, without `/clear`.
- **Two settings were costly and easy to fix.** Agent-team idle pings made 32% of one 9-day session. High-effort subagents made 59% of one day, mostly on work medium effort handles. `/ystack-setup` offers the fixes; `model-router` enforces them per task.
- **Review catches what tests don't.** On one mod here, an independent review found three bugs that 12 passing tests had missed, any of which could lose a conversation. That loop is written up, and the mods enforce parts of it.
- **Guards for the mistakes you can't undo:** keys pushed to a remote, a private repo made public, a force-push over `main`, a hallucinated package installed.

**See it on your own logs:** install `ystack-stats` and run `/ystack-stats`. It replays your last two weeks under these rules, on day one. Or run `python claude/tools/usage-report.py --days 14`.

| Folder | For | Status |
| --- | --- | --- |
| [`claude/`](claude/) | Claude Code | 32 mods, three subagent types, a starter `CLAUDE.md`, and measured write-ups in [`claude/docs/`](claude/docs/) |
| [`skills/`](skills/) | Claude Code, Codex, OpenCode and other agents that read skills | 16 skills: design (`taste`), screenshots, film and sound, agent-ops fixes, founder work (discovery, sales, weekly review, YC) |
| [`codex/`](codex/) | Codex CLI | A brief template for unattended `codex exec` runs; pairs with the `codex-ladder` mod |
| [`ops/`](ops/) | Any Linux server | `security-sweep`: a weekly scan of OS packages, repos and containers that installs only restart-free security patches and reports the rest |

## How ystack differs

Most agent stacks are skills: written advice the model reads and may or may not follow. ystack has skills too, but the core is different:

- **Enforced, not requested.** The mods are hooks on tool calls, prompts and subagent turns. A rule like "no done without a real check" or "no key in a pushed commit" runs as code every time, whether or not the model remembered it.
- **Measured, not guessed.** Every number on this page comes from real logs, and `/ystack-stats` replays your own last two weeks under ystack's rules before you change anything.
- **One stack for several agents.** The same skills install for Claude Code, Codex and OpenCode; Codex runs get a brief template and an effort ladder.
- **The human stays in charge, not in the way.** Decisions that are yours go to an inbox while the agent carries on with its recommended default; guards stop the irreversible mistakes; setup never overwrites anything of yours.

## Install

Clone it once and run setup. It installs every skill in `skills/` for each agent you have (Claude Code, Codex, OpenCode), and re-running it updates them.

```bash
git clone https://github.com/ychampion/ystack.git ~/ystack && ~/ystack/setup
```

On macOS and Linux the skills are symlinks into the checkout, so `git pull` updates them. On Windows (Git Bash) they are copies: re-run `./setup` after each pull, or use `/ystack-upgrade`.

| Flag | Does |
| --- | --- |
| `--host claude,codex,opencode` | Pick hosts (default: every host whose home folder exists; `all` for all three) |
| `--agents` | Also install the `opus-medium`, `opus-high` and `haiku-max` subagent types into `~/.claude/agents` |
| `--mods` | Print the commands that add the marketplace and a starter set of mods; add `--yes` to run them |
| `--dry-run` | Show what would change, change nothing |
| `--uninstall` | Remove only what ystack installed |

Setup never overwrites a skill or agent file that is yours, including a ystack skill you have edited: it skips it and says so, and `--force` replaces it after moving yours to `~/.ystack-backup/`. If any step fails, setup names it and exits 1.

The starter mods are `ystack-stats`, `ystack-setup`, `context-meter`, `verify`, `push-guard` and `model-router`. Then:

- `/ystack-stats` replays your last two weeks under ystack's rules, so you see the savings on your own logs.
- `/ystack-setup` walks through the recommended Claude Code settings; nothing changes until you Apply.
- Copy or merge [`claude/CLAUDE.starter.md`](claude/CLAUDE.starter.md) into `~/.claude/CLAUDE.md`. It holds the working rules and names the mod that enforces each one. Setup doesn't install it.
- Codex users: start each `codex exec` brief from [`codex/briefs/brief-template.md`](codex/briefs/brief-template.md).

Later, `/ystack-upgrade` pulls, re-runs setup for the same hosts and updates installed mods.

## Install one Claude Code mod

At the prompt of a Claude Code terminal session:

```
/plugin install <mod> --marketplace ychampion/ystack
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). Mods with settings show a settings screen during install; change them later in `/config`.

From a shell: `claude plugin install <mod> --marketplace ychampion/ystack`.

In the Claude desktop app's Code tab, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `ychampion/ystack`, then Add plugin. A mod installed from a terminal at user scope also loads in the desktop app's local Code sessions. Mods run inside Claude Code only: not in claude.ai chat, and not in cloud sessions unless installed there.

The mods and what each does are listed in [`claude/README.md`](claude/README.md).

**Measured, not guessed:** [what long Claude Code sessions cost](claude/docs/long-sessions.md). Most usage came from a few sessions running for days near the compaction limit, and from their subagents. The page covers handoff versus compaction, and [`claude/tools/usage-report.py`](claude/tools/usage-report.py) gets the same numbers from your own logs.
