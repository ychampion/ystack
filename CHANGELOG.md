# Changelog

## Unreleased

- `image-theme` 0.1.2: pictures GDI+ can't open (WebP, and HEIC or AVIF with their Microsoft Store codecs) now work on Windows through Windows Imaging Component; when a picture really can't be read, the message says why in one line instead of a PowerShell error, and toasts no longer repeat the mod's name.
- `image-theme` 0.1.1: uses only local, absolute picture paths (never network or device paths, which could send Windows credentials to another machine), and on Linux tells ImageMagick which kind of picture to read from the extension.

## 0.1.1 (2026-11-16)

- New mod `image-theme`: `/image-theme` turns any picture you choose into your Claude theme. The picture becomes the desktop app background, softly veiled, with a frosted column behind the chat on Windows, and the theme colours come from it (surface tint, accent, light or dark). Works on Windows, macOS and Linux (ImageMagick); Claude can set it for you too. The `ystack` bundle (0.1.2) includes it.
- `living-themes` 0.1.3: new `first-snow` theme, the context fill on its own: falling snow and a snowbank that rises across the foot of the window as the context fills, burying a fence (a compaction clears it), with the context sign and cache candle. Snow, smoke and flames now animate with SMIL, so they move however the app draws the scene; reduced motion shows still snow.
- `living-themes` 0.1.2: `winter-cabin` gets a frosted glass column behind the chat (the scene's edges stay bright), fluffy snow clumps on the tree, glowing light halos, fairy lights and icicles on the cabin, a snowy pine forest and three depths of falling snow.
- `living-themes` 0.1.1: new `winter-cabin` scene that shows the session's own numbers: a sign with the context fill (snow piles up and buries the snowman as it grows; a compaction clears it) and a candle that burns down with the minutes left on the prompt cache (`cacheMinutes` setting, 60 by default).
- New mod `transcript-compress`: compresses Claude transcripts older than a week, losslessly, to free disk space (Windows and macOS file-system compression, so `/resume` still works; gzip with a restore command on Linux). Off by default: Claude suggests it at a break when 500 MB or more is waiting; `/compress-transcripts` runs it; an "Always on" setting runs it daily. The `ystack` bundle includes it.
- New mod `living-themes`: fourteen animated backdrops for the desktop app that react to what Claude is doing (thinking, tools, subagents, a failure, a merge) and follow your local time of day and season. `/live-theme` picks one; nothing changes until you do. The `ystack` bundle (0.1.1) includes it.
- 12 new skills of our own: `debug-loop`, `flaky-test`, `perf-loop`, `dep-upgrade`, `migration-plan`, `secure-diff`, `repo-map`, `release-notes`, `postmortem`, `grill`, `agent-writing`, `eval-judge`. Short, for agents to act on; `debug-loop` and `flaky-test` were tried on planted bugs by headless agents.
- 18 skills from other open collections, each with its licence and a NOTICE of changes: `diagnosing-bugs`, `tdd`, `prototype`, `grilling`, `to-spec`, `to-tickets`, `wayfinder`, `to-questionnaire`, `research`, `domain-modeling`, `codebase-design`, `improve-codebase-architecture`, `writing-for-agents`, `teach`, `retro`, `wizard`, `pr` and `migrate-to-rust` (whose report page now escapes the text it shows).
- New skill `idea-scout`: ideas for what to build (open-source tools, side projects, company-size) from live, dated, linked evidence of what people struggle with now, never from model memory alone. `dig <idea>` goes deep on one. Installed by `./setup` for Claude Code, Codex, OpenCode and Antigravity.
- Docs: [What changes when you install everything](claude/README.md#what-changes-when-you-install-everything) lists every mod that acts on its own after install (handoffs, nudges, guards, shortened output), what you'll notice, and the setting that turns each one off. The main README points to it from the install line.
- Installing everything no longer imposes one person's habits: `iron-rules` 0.2.1 has every house rule off until you turn it on (`useBun`, `noAttribution`, git identity), and `user-voice` 0.1.1 does nothing until you have a notes folder.
- `review-panel` 0.1.1: `/review-panel` answered "no command.run hook answered it" and queued nothing; it now queues the panel right after the command returns. `night-shift` 0.1.1: `/queue start` (with no time) silently never started; same fix.
- New mod `code-threads`: `/why <file:line>` traces code back to the Claude conversation that wrote it (what was asked, the reasoning, the session to reopen); Claude can call it as a tool too. Links are kept on your machine, never in git history.
- Headless support (`claude -p`, the Agent SDK, harnesses such as T3 Code): `context-meter` starts no turns or compactions of its own there, and `model-checkup` saves its one-time reminder for an interactive session. Checked with a real `claude -p` run.
- `./setup` installs the skills into Antigravity (Google's agent app and its `agy` CLI, on Gemini models): found automatically, or `--host antigravity` / `--host agy`. It also installs `ystack-guards`, an Antigravity plugin with `push-guard`, `package-bouncer` and `verify` as hooks; checked live in `agy`, where a key push and a made-up npm package were both refused.
- Long-sessions doc: how the one-hour cache cliff differs from compaction.
- `self-learning` plugin joins ystack: `/learn <topic>` turns a technology's docs into a reusable skill. Its agents now use your session's model, skills are saved only where updates can't overwrite them, and its command metadata parses again.
- Engineering workflow skills: `blast-radius`, `interrogate`, `arena`, `recall`.
- `ystack` bundle: `/plugin install ystack --marketplace ychampion/ystack` installs all 37 mods in one go.
- README: install everything first, then a grouped list of the mods to pick from, and how to update (auto-update or by hand).

## 0.1.0 (2026-11-14): first public release

An early version. Expect frequent updates: broader host support, more mods, and new skill packs.

- 33 Claude Code mods in one marketplace (`ychampion/ystack`), each installable on its own.
- New: `model-checkup` suggests `/doctor prompt-audit` the first time you use a model you haven't used before.
- `session-recovery`: resume commands now run in Windows PowerShell 5.1, and the "sessions from before the restart" band no longer lingers across sessions.
- 16 skills for Claude Code, Codex and OpenCode, installed by `./setup`.
- `opus-medium`, `opus-high` and `haiku-max` subagent types (`./setup --agents`).
- A brief template for unattended `codex exec` runs, and a weekly security sweep for Linux servers.
