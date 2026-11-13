# Changelog

## Unreleased

- `self-learning` plugin joins ystack: `/learn <topic>` turns a technology's docs into a reusable skill. Its agents now use your session's model, skills are saved only where updates can't overwrite them, and its command metadata parses again.
- Engineering workflow skills: `blast-radius`, `interrogate`, `arena`, `recall`.
- `ystack` bundle: `/plugin install ystack --marketplace ychampion/ystack` installs all 33 mods in one go.
- README: install everything first, then a grouped list of the mods to pick from, and how to update (auto-update or by hand).

## 0.1.0 (2026-11-14): first public release

An early version. Expect frequent updates: broader host support, more mods, and new skill packs.

- 33 Claude Code mods in one marketplace (`ychampion/ystack`), each installable on its own.
- New: `model-checkup` suggests `/doctor prompt-audit` the first time you use a model you haven't used before.
- `session-recovery`: resume commands now run in Windows PowerShell 5.1, and the "sessions from before the restart" band no longer lingers across sessions.
- 16 skills for Claude Code, Codex and OpenCode, installed by `./setup`.
- `opus-medium`, `opus-high` and `haiku-max` subagent types (`./setup --agents`).
- A brief template for unattended `codex exec` runs, and a weekly security sweep for Linux servers.
