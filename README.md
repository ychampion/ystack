# ystack

ystack is a collection of mods, skills, and setup tools for Claude Code, Codex, OpenCode and Antigravity. It is for developers who run coding agents for long sessions and want checks on their work and usage.

On one heavy user's logs, it cut usage about 78% per hour of work and 39% per API call. [How that was measured](#what-the-logs-show).

> **Early version (0.1).** It works and is used daily, but expect frequent changes: broader host support, more mods and new skill packs are on the way. Issues and requests are welcome. [Changelog](CHANGELOG.md).

## Install for Claude Code: everything, one line

At the prompt of a Claude Code terminal session:

```text
/plugin install ystack --marketplace ychampion/ystack
```

Or from a shell:

```bash
claude plugin install ystack --marketplace ychampion/ystack
```

This adds the `ystack` marketplace and installs all 34 mods plus the `self-learning` plugin. Restart Claude Code (or run `/reload-plugins`) to load them. Don't want one of them? `claude plugin uninstall <mod>` removes just that one. Mods with settings show a settings screen during install; change them later in `/config`.

Some mods act on their own from the start. For example, `context-meter` swaps a very long conversation for a short handoff note, `keep-going` sends Claude back to work when it offers to continue, and `push-guard` refuses risky pushes. Before installing everything, read [what changes when you install everything](claude/README.md#what-changes-when-you-install-everything), which also says how to turn each one off.

Then run `/ystack-stats` to see what ystack would have saved on your last two weeks of logs, and `/ystack-setup` to walk through the recommended settings. Nothing changes until you Apply.

In the Claude desktop app's Code tab, `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `ychampion/ystack`, then Add plugin. A mod installed from a terminal at user scope also loads in the desktop app's local Code sessions. Mods run inside Claude Code; they don't run in claude.ai chat, and cloud sessions need their own installation.

## Or pick the mods you want

```text
/plugin install <mod> --marketplace ychampion/ystack
```

| Group | Mods |
| --- | --- |
| Start here | `ystack-stats` (your savings, from your own logs) · `ystack-setup` (recommended settings, one click each) · `model-checkup` (suggests `/doctor prompt-audit` on a model you haven't used before) |
| Guards | `push-guard` (keys in pushes, repos made public, force-pushes) · `verify` (no "done" without a real check) · `package-bouncer` (hallucinated or brand-new packages) · `vault` (API keys Claude uses but never sees) · `iron-rules` (your house rules on shell calls; off until you turn them on) · `slop-guard` (AI-made design tells) · `codex-ladder` (Codex effort ladder) |
| Delegation | `model-router` (right model and effort per subagent) · `decision-inbox` (agents keep going while your decisions wait) · `brief-linter` (complete subagent briefs) · `assumptions-ledger` (checks what subagents assumed) · `spec-sharpener` (pointed questions before big builds) · `review-panel` (parallel specialist review) |
| Long sessions | `context-meter` (handoffs and compaction at the right time) · `session-board` (every session on one board) · `session-recovery` (reopen sessions after a crash or restart) · `night-shift` (unattended task queue) · `loop-breaker` (stops going in circles) · `lanes` (several sessions, one repo) · `pin` (rules that survive compaction) · `keep-going` (no needless "want me to continue?") |
| Cost | `prompt-diet` (what every turn sends) · `output-diet` (shorter build and test output) |
| For the owner | `owner-view` (plain-English captions, `/brief-me`) · `user-voice` (what users said, on feature requests) · `operator-context` (your profile as facts) · `twins` (copies that fall behind) · `weekly-digest` (your week per repo) |
| Learning | `code-threads` (`/why <file:line>`: the Claude conversation that wrote that code, what was asked and why) · `self-learning` (`/learn <topic>`: researches a technology's docs and writes a reusable skill) · `memory-recall` (past fixes on a failing tool call) · `auto-claudeception` (saves what a debugging session learned) |

Each mod is independent. What each one does, with its settings: [`claude/README.md`](claude/README.md).

## Update

Turn on auto-update once: `/plugin`, then Marketplaces, `ystack`, Enable auto-update. Claude Code then keeps the marketplace and every installed mod current.

Or update by hand:

```bash
claude plugin marketplace update ystack
claude plugin update <mod>@ystack
```

To update every installed ystack mod at once (bash):

```bash
claude plugin marketplace update ystack && for m in $(claude plugin list | grep -o '[a-z0-9-]*@ystack'); do claude plugin update "$m"; done
```

Restart Claude Code after an update to load the new versions.

## Headless: `claude -p` and harnesses

ystack works when Claude Code runs headless: `claude -p`, the Agent SDK, and apps built on them such as T3 Code. Install it the same way; the harness runs the same Claude Code, so it loads the same mods and skills.

Headless, the guards and rewrites work as usual (`push-guard`, `verify`, `package-bouncer`, `iron-rules`, `model-router` and the rest). What needs a person is skipped: panes and the prompt box don't exist, toasts and status lines arrive as `ui_toast` and `ui_status` events the harness can show or ignore, and no mod starts a turn of its own. `context-meter` doesn't hand off or compact by itself there, since an unasked turn would show up in the harness's chat; Claude Code's own auto-compaction still runs. Commands you type, such as `/review-panel` or `/queue`, work as they do in a terminal.

## Skills for Claude Code, Codex, OpenCode and Antigravity

```bash
git clone https://github.com/ychampion/ystack.git ~/ystack && ~/ystack/setup
```

Setup installs every skill in `skills/` for each agent you have (Claude Code, Codex, OpenCode, Antigravity). For Antigravity it also installs the `ystack-guards` plugin into `~/.gemini/config/plugins`; quit the Antigravity app before updating or removing it, because the app keeps the folder open. Run it again to update them. Machine-specific values, including your git identity, thresholds, and paths, are settings you fill in at install.

On macOS and Linux, skills are symlinks into the checkout, so `git pull` updates them. On Windows (Git Bash), they are copies: re-run `./setup` after each pull, or use `/ystack-upgrade`.

| Flag | Does |
| --- | --- |
| `--host claude,codex,opencode,antigravity` | Pick hosts (default: every host found on this machine; `all` for all four; `agy` is short for `antigravity`) |
| `--agents` | Also install the `opus-medium`, `opus-high`, and `haiku-max` subagent types into `~/.claude/agents` |
| `--mods` | Print the commands that add the marketplace and a starter set of mods; add `--yes` to run them |
| `--dry-run` | Show what would change without changing anything |
| `--uninstall` | Remove only what ystack installed |

Setup skips any skill or agent file that is yours, including a ystack skill you have edited, and tells you it skipped it. Use `--force` to replace it after moving your version to `~/.ystack-backup/`. If any step fails, setup names it and exits 1.

The starter mods are `ystack-stats`, `ystack-setup`, `context-meter`, `verify`, `push-guard`, and `model-router`.

After setup:

- Copy or merge [`claude/CLAUDE.starter.md`](claude/CLAUDE.starter.md) into `~/.claude/CLAUDE.md`. It holds the working rules and names the mod that enforces each one. Setup doesn't install it.
- Start each `codex exec` brief from [`codex/briefs/brief-template.md`](codex/briefs/brief-template.md).

Later, `/ystack-upgrade` pulls, re-runs setup for the same hosts, and updates installed mods.

## What's included

| Folder | For | Status |
| --- | --- | --- |
| [`claude/`](claude/) | Claude Code | 34 mods, three subagent types, a starter `CLAUDE.md`, and measured write-ups in [`claude/docs/`](claude/docs/) |
| [`skills/`](skills/) | Claude Code, Codex, OpenCode, Antigravity (Gemini models, in the app and the `agy` CLI), and other agents that read skills | 20 skills: engineering workflow (`blast-radius`, `interrogate`, `arena`, `recall`), design (`taste`), screenshots, film and sound, agent-ops fixes, founder work (discovery, sales, weekly review, YC) |
| [`antigravity/`](antigravity/plugins/ystack-guards/) | Antigravity (the app and the `agy` CLI) | `ystack-guards`, a plugin with three guards as Antigravity hooks: `push-guard` (no keys in a push, no repo made public, no force-push to `main`), `package-bouncer` (no made-up or brand-new packages) and `verify` (no "done" without a check). `./setup` installs it with the skills |
| [`codex/`](codex/) | Codex CLI | A brief template for unattended `codex exec` runs; pairs with the `codex-ladder` mod |
| [`ops/`](ops/) | Any Linux server | `security-sweep`: a weekly scan of OS packages, repos, and containers that installs only restart-free security patches and reports the rest |

Most agent stacks provide skills: written advice the model may or may not follow. ystack also has mods, which use hooks on tool calls, prompts, and subagent turns. Rules such as requiring a real check before reporting work done and checking for keys in pushed commits run as code every time, whether the model remembers them or not.

Guards cover keys pushed to a remote, private repos made public, force-pushes over `main`, and hallucinated packages installed. Decisions that need your input go to an inbox while the agent continues with its recommended default. The same skills work across Claude Code, Codex, OpenCode and Antigravity; Codex also gets a brief template and an effort ladder.

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

## License

MIT. See [LICENSE](LICENSE). Skills adapted from other authors (`cinematic-shot`, `clean-ui-shot`, `earshot`, `real-sound`, `taste-skill`) keep their own MIT licence and credits in their folders.
