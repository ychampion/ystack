# ystack

A working stack for coding agents: the rules, guards and helpers that make long agent runs more reliable and the human's job smaller.

It is general on purpose. Nothing in here is tied to one person's machine: anything personal (your git identity, thresholds, paths) is a setting you fill in at install.

| Folder | For | Status |
| --- | --- | --- |
| [`claude/`](claude/) | Claude Code | 13 mods |
| `skills/` | Claude Code, Codex, OpenCode and other agents that read skills | planned |

## Install a Claude Code mod

At the prompt of a Claude Code terminal session:

```
/plugin install <mod> --marketplace ychampion/ystack
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session). Mods with settings show a settings screen during install; change them later in `/config`.

From a shell: `claude plugin install <mod> --marketplace ychampion/ystack`.

The mods and what each does are listed in [`claude/README.md`](claude/README.md).
