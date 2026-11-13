# Changelog

## Unreleased

- `review-panel` 0.1.1: `/review-panel` answered "no command.run hook answered it" and queued nothing; it now queues the panel right after the command returns. `night-shift` 0.1.1: `/queue start` (with no time) silently never started; same fix.
- New mod `code-threads`: `/why <file:line>` traces code back to the Claude conversation that wrote it (what was asked, the reasoning, the session to reopen); Claude can call it as a tool too. Links are kept on your machine, never in git history.
- Headless support (`claude -p`, the Agent SDK, harnesses such as T3 Code): `context-meter` starts no turns or compactions of its own there, and `model-checkup` saves its one-time reminder for an interactive session. Checked with a real `claude -p` run.
- `./setup` installs the skills into Antigravity (Google's agent app and its `agy` CLI, on Gemini models): found automatically, or `--host antigravity` / `--host agy`.
- Long-sessions doc: how the one-hour cache cliff differs from compaction.
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
