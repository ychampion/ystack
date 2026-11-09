# Docs

Write-ups behind the mods. Each one is measured from real logs or tested, and says which.

| Page | What it answers |
| --- | --- |
| [long-sessions.md](long-sessions.md) | Where Claude Code usage really goes, handoff versus compaction, the one-hour cache cliff, and what the new rules would have saved over 14 days |
| [settings.md](settings.md) | The settings `/ystack-setup` offers (compaction windows, subagent tiers, effort, teams off) and why each is there |
| [building-with-agents.md](building-with-agents.md) | The spec → build → verify → review loop, briefs that work, and a real case where review caught three bugs that 12 passing tests missed |

Measure your own: `/ystack-stats` in a session (the `ystack-stats` mod), or `python claude/tools/usage-report.py --days 14`.
