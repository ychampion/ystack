# ystack

A working stack for coding agents: the rules, guards and helpers that make long agent runs more reliable and the human's job smaller.

It is general on purpose. Nothing in here is tied to one person's machine: anything personal (your git identity, thresholds, paths) is a setting you fill in at install.

| Folder | For | Status |
| --- | --- | --- |
| [`claude/`](claude/) | Claude Code | 26 mods |
| [`skills/`](skills/) | Claude Code, Codex, OpenCode and other agents that read skills | `taste` (design judgment), `make-media` (images and video when code isn't enough) |
| [`ops/`](ops/) | Any Linux server | `security-sweep`: a weekly scan of OS packages, repos and containers that installs only restart-free security patches and reports the rest |

## Install a Claude Code mod

At the prompt of a Claude Code terminal session:

```
/plugin install <mod> --marketplace ychampion/ystack
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). Mods with settings show a settings screen during install; change them later in `/config`.

From a shell: `claude plugin install <mod> --marketplace ychampion/ystack`.

In the Claude desktop app's Code tab, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `ychampion/ystack`, then Add plugin. A mod installed from a terminal at user scope also loads in the desktop app's local Code sessions. Mods run inside Claude Code only: not in claude.ai chat, and not in cloud sessions unless installed there.

The mods and what each does are listed in [`claude/README.md`](claude/README.md).

**Measured, not guessed:** [what long Claude Code sessions cost](claude/docs/long-sessions.md). Most usage came from a few sessions running for days near the compaction limit, and from their subagents. The page covers handoff versus compaction, and [`claude/tools/usage-report.py`](claude/tools/usage-report.py) gets the same numbers from your own logs.
