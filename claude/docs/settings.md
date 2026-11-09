# The settings, and why each one is there

`/ystack-setup` (in the `ystack-setup` mod) shows each of these with its current state. You tick what you want and press Apply. It backs up every file first and can undo. This page explains them.

The figures come from one heavy user's own logs: 14 days of Claude Code on Opus, about 60,000 API calls. To get yours, run `/ystack-stats` or [`tools/usage-report.py`](../tools/usage-report.py).

## 1. Compact the main model at 400k, not at the window

```json
{ "modelSettings": { "<your Opus model id>": { "autoCompactWindow": 400000 } } }
```

With a 1M window, Claude Code otherwise lets a conversation grow toward the limit before compacting it. Every call re-reads the whole context, so the stretch near the limit is where a session spends the most per call. In the logs, compaction fired at a median of 365k, and the six sessions that made 91% of all usage sat there for days. 400k keeps the full window as headroom for a big file or log, without making a habit of it.

When a new model ships, add the same key under its id. The setting is per model.

## 2. Subagents that compact at 250k

Two agent files, `~/.claude/agents/opus-medium.md` and `opus-high.md`:

```yaml
---
name: opus-medium
description: Default builder. Features, refactors, tests, research, docs, fix rounds, bugs whose cause is known.
model: opus
effort: medium
autoCompactWindow: 250000
---
```

`opus-high` is the same with `effort: high`, for verification and review, security, bugs whose cause is unknown, concurrency, parsers and numeric code.

Subagents made **73%** of all usage in the logs. A long subagent run has nobody to type `/clear`, so compaction is its only reset. Replaying those runs with compaction at 250k instead of 400k:

- **cut their context re-reads by 26%** over one day;
- **cut subagent usage about 14%** over 14 days.

The main session stays at 400k, where you can hand off by hand (see [long-sessions.md](long-sessions.md)).

The window setting only ever lowers the point where compaction starts. It never raises the model's limit.

## 3. Effort comes from the agent file, not from hope

The Agent tool has no effort parameter. A subagent takes `effort:` from its agent file's frontmatter. If the file has none, it inherits the main session's level. That's why the two files above exist: dispatching `opus-medium` or `opus-high` is how you choose effort per task.

**Medium is the default** for building. In one day of logs, 40 of 52 subagents ran at high, mostly builds and fix rounds, and high made 59% of all usage. Moving those to medium is where effort saves. Keep high for the work where mistakes hide in edge cases: reviews, security, unknown bugs.

The [`model-router`](../mods/model-router) mod enforces this at dispatch.

## 4. The small model compacts at 100k

```json
{ "modelSettings": { "<your Haiku model id>": { "autoCompactWindow": 100000 } } }
```

Haiku is for pointer work: finding files, triaging logs, reshaping data. Its long prompts cost more per token past a size threshold. Compacting at 100k keeps it under that and keeps its cache reads cheap.

## 5. Agent teams off

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "0" } }
```

A background subagent sends one notification, when it finishes. A teammate wakes the lead every time its turn ends, and each wake re-reads the lead's whole context. In one 9-day session, **360 idle pings cost 32% of the session's usage, with no new work in them.** Subagents can still message each other by name when they need to coordinate. Turn teams on only when agents must argue with each other, such as in an adversarial review.

## 6. The companion mods

`context-meter` does the handoffs. `ystack-stats` shows what they and the settings saved. `/ystack-setup` lists their install commands and doesn't run them.
