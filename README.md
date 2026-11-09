# ystack

ystack is a collection of mods, skills, and setup tools for Claude Code, Codex, and OpenCode. It is for developers who run coding agents for long sessions and want checks on their work and usage.

On one heavy user's logs, it cut usage about 78% per hour of work and 39% per API call. [How that was measured](#what-the-logs-show).

## Install

```bash
git clone https://github.com/ychampion/ystack.git ~/ystack && ~/ystack/setup
```

Setup installs every skill in `skills/` for each agent you have (Claude Code, Codex, OpenCode). Run it again to update them. Machine-specific values, including your git identity, thresholds, and paths, are settings you fill in at install.

On macOS and Linux, skills are symlinks into the checkout, so `git pull` updates them. On Windows (Git Bash), they are copies: re-run `./setup` after each pull, or use `/ystack-upgrade`.

| Flag | Does |
| --- | --- |
| `--host claude,codex,opencode` | Pick hosts (default: every host whose home folder exists; `all` for all three) |
| `--agents` | Also install the `opus-medium`, `opus-high`, and `haiku-max` subagent types into `~/.claude/agents` |
| `--mods` | Print the commands that add the marketplace and a starter set of mods; add `--yes` to run them |
| `--dry-run` | Show what would change without changing anything |
| `--uninstall` | Remove only what ystack installed |

Setup skips any skill or agent file that is yours, including a ystack skill you have edited, and tells you it skipped it. Use `--force` to replace it after moving your version to `~/.ystack-backup/`. If any step fails, setup names it and exits 1.

The starter mods are `ystack-stats`, `ystack-setup`, `context-meter`, `verify`, `push-guard`, and `model-router`.

After setup:

- Run `/ystack-stats` to replay your last two weeks of logs under ystack's rules and see the potential savings on day one, before changing your settings.
- Run `/ystack-setup` to walk through the recommended Claude Code settings. Nothing changes until you Apply.
- Copy or merge [`claude/CLAUDE.starter.md`](claude/CLAUDE.starter.md) into `~/.claude/CLAUDE.md`. It holds the working rules and names the mod that enforces each one. Setup doesn't install it.
- Start each `codex exec` brief from [`codex/briefs/brief-template.md`](codex/briefs/brief-template.md).

Later, `/ystack-upgrade` pulls, re-runs setup for the same hosts, and updates installed mods.

## Install one Claude Code mod

At the prompt of a Claude Code terminal session:

```text
/plugin install <mod> --marketplace ychampion/ystack
```

Answer `y` to add the marketplace, then pick a scope. User scope loads the mod in every session. Mods with settings show a settings screen during install; change them later in `/config`.

From a shell:

```bash
claude plugin install <mod> --marketplace ychampion/ystack
```

In the Claude desktop app's Code tab, `/plugin` does not run. Click + next to the prompt box, then Plugins, Add marketplace with `ychampion/ystack`, then Add plugin. A mod installed from a terminal at user scope also loads in the desktop app's local Code sessions.

Mods run inside Claude Code. They don't run in claude.ai chat, and cloud sessions need their own installation. See [`claude/README.md`](claude/README.md) for the mods and what each does.

## What's included

| Folder | For | Status |
| --- | --- | --- |
| [`claude/`](claude/) | Claude Code | 32 mods, three subagent types, a starter `CLAUDE.md`, and measured write-ups in [`claude/docs/`](claude/docs/) |
| [`skills/`](skills/) | Claude Code, Codex, OpenCode, and other agents that read skills | 16 skills: design (`taste`), screenshots, film and sound, agent-ops fixes, founder work (discovery, sales, weekly review, YC) |
| [`codex/`](codex/) | Codex CLI | A brief template for unattended `codex exec` runs; pairs with the `codex-ladder` mod |
| [`ops/`](ops/) | Any Linux server | `security-sweep`: a weekly scan of OS packages, repos, and containers that installs only restart-free security patches and reports the rest |

Most agent stacks provide skills: written advice the model may or may not follow. ystack also has mods, which use hooks on tool calls, prompts, and subagent turns. Rules such as requiring a real check before reporting work done and checking for keys in pushed commits run as code every time, whether the model remembers them or not.

Guards cover keys pushed to a remote, private repos made public, force-pushes over `main`, and hallucinated packages installed. Decisions that need your input go to an inbox while the agent continues with its recommended default. The same skills work across Claude Code, Codex, and OpenCode; Codex also gets a brief template and an effort ladder.

## What the logs show

These figures come from one heavy user's logs. The [long-session write-up](claude/docs/long-sessions.md) distinguishes measurements from replays and covers handoff versus compaction.

Across about 248,000 real API calls from September to November, usage per active hour fell from 38.4M to 8.3M input-token equivalents as the rules and mods went in, and median context per call halved from 375k to 189k. That is about 78% less per active hour and about 39% less per API call. The hourly figure also reflects fewer agents running at once, and only 37 hours of the earliest logs survive. Treat 78% as the upper end and 39% per call as the firm floor. See the [full table](claude/docs/long-sessions.md#before-and-after-on-real-usage).

Subagents accounted for 73% of usage, and six sessions running for days near the compaction limit accounted for 91%. The mods' own prompt text was 0.3%.

Replaying those 14 days with handoffs at 252k and subagents compacting at 250k reduced usage from 1.90B to 1.61B input-token equivalents, a saving of about 15%. `context-meter` does this by itself between turns, without `/clear`: it hands off at the end of a phase, and when you step away it compacts if work is half done or hands off if it isn't.

Agent-team idle pings accounted for 32% of one 9-day session. High-effort subagents accounted for 59% of one day, mostly on work medium effort handles. `/ystack-setup` offers fixes for both settings; `model-router` enforces them per task.

On one mod, an independent review found three bugs that 12 passing tests missed. Any of the three could lose a conversation. The review loop is documented, and the mods enforce parts of it.

You can also use [`claude/tools/usage-report.py`](claude/tools/usage-report.py) to get the same usage numbers from your own logs:

```bash
python claude/tools/usage-report.py --days 14
```
