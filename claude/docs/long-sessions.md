# What long Claude Code sessions cost, measured

This page is measured, not guessed. The numbers come from one heavy user's own logs: 14 days of Claude Code on Opus, 1.9 billion input-token equivalents, about 60,000 API calls. Run [`tools/usage-report.py`](../tools/usage-report.py) to get the same figures from your own logs. It only reads `~/.claude/projects` on your machine.

## The one rule behind all of it

**Every API call re-reads the whole conversation.** A turn that edits five files is five or more calls, and each one sends everything said so far. The prompt cache makes those re-reads cheaper, but you still pay for them on every call:

| What happens to a token | Price, relative to a normal input token |
| --- | --- |
| Read again from the cache | 0.1× |
| Written to the 1-hour cache (what Claude Code uses) | 2× |
| Written to the 5-minute cache | 1.25× |
| Output (Opus) | 5× |

So a session's cost per call grows with its context. One call at 300k re-reads about 30k worth of input. At 60k it's 6k. Same work, five times the price.

## What the logs showed

| Measured | Result |
| --- | --- |
| Who made the calls | Subagents made **73%** of all usage; main sessions made 27% |
| Where the usage sat | **Six sessions** that ran 31 to 219 hours each made **91%** of it; five of them sat at about 367k context, the edge of compaction |
| A fresh session's first call | **28k** median (most between 10k and 72k) |
| When auto-compaction fired (400k window) | **365k** median: sessions spend their most expensive calls just before it |
| Right after a compaction | **101k** median (96–106k): the summary plus the last messages, kept word for word |
| Long subagents replayed with compaction at 250k instead of 400k | **26% fewer** context re-reads |
| Agent teams: each teammate's "I'm idle" ping re-reads the lead's whole context | 360 pings cost **32%** of one 9-day session, with no new work in them |
| Text the installed mods (two dozen) add to prompts | **0.3%** of context tokens: the mods were not the cost |

What actually drove the cost was long sessions running near the compaction limit for days, and subagents doing the same. How often anyone typed made little difference.

## What the new rules would have saved

The same 14 days replayed call by call, with the real growth of each call kept and only the reset rules changed:

| | As logged | With ystack's rules | Less |
| --- | --- | --- | --- |
| Main sessions: hand off at 252k (to ~35k, counting the checkpoint turn) instead of compacting near 365k | 504M | 405M | **20%** |
| Subagents: compact at 250k (to ~85k) instead of 400k | 1,398M | 1,207M | **14%** |
| **Total** | **1,902M** | **1,611M** | **15%** |

The figures are input-token equivalents, priced as in the table above.

Read it as a rough estimate:

- The main-session figure assumes a handoff at every crossing of 252k, so it's the optimistic end.
- The subagent figure is solid, because compaction there is automatic.
- It leaves out two changes made earlier that a replay can't model: building at medium effort instead of high, and turning agent teams off. Each was large on its own: high-effort subagents made 59% of one day's usage, and teammates' idle pings made 32% of one 9-day session.

`/ystack-stats` runs this same replay on your own logs.

## Before and after, on real usage

The replay changes one thing and holds the rest still. This section is the opposite: what usage actually did, as logged, while the rules went in over two months. About 248,000 API calls (main sessions and subagents, de-duplicated), priced as above. An active hour is a clock hour with at least one call.

| Period | Active hours | Per active hour | Median hour | Per API call | Median context per call |
| --- | --- | --- | --- | --- | --- |
| Before the rules (to Sep 23) | 37 | 38.4M | 27.7M | 51.8k | 375k |
| Rules written in CLAUDE.md only (Sep 24 to Nov 6) | 510 | 13.9M | 9.0M | 34.8k | 209k |
| Rules enforced by the mods (Nov 7 on) | 63 | 8.3M | 6.8M | 31.4k | 189k |
| **Change, first to last** | | **−78%** | **−75%** | **−39%** | **−50%** |

How far to trust it:

- **Per call (−39%) is the firm number.** It tracks context size, which is what the reset rules change, and it moves little with how much work runs at once.
- **Per hour (−78%) is the upper end.** September was mostly large parallel swarms (95% of calls from subagents, against 78% now), so part of the drop is running fewer agents at once, a habit the rules encourage but don't force.
- **The earliest period is thin.** Only 37 active hours of September logs survive, below the 50 hours `/ystack-stats` asks for on each side of a split.
- **Writing the rules down did most of it; the mods added the rest.** From the middle period to the last, per hour fell another 40% and per call another 10%, over only 63 hours so far.

`/ystack-stats` shows the same before-and-after on your own logs once you have used ystack for a few days.

## Handoff or compaction?

Both shrink a big context. They differ in what triggers them and what they keep.

| | Compaction (auto, or `/compact`) | Handoff (`/handoff` from `context-meter`) |
| --- | --- | --- |
| When | When the context nears the limit, even in the middle of a task | At a natural boundary: a phase ends, you step away, agents are running on their own |
| What it keeps | A summary plus the last messages word for word (~100k) | A handoff document (goal, state, what's running, what's waiting on you, decisions, next steps, key files) plus the last reply. About 30–40k |
| Lost | Whatever the summary skips; you don't choose | Whatever the handoff doesn't say; it's saved as a file you can read and edit |
| Survives a crash | No | Yes, it's a file |

Use them like this:

- **Under ~150k:** do nothing. A reset saves little, and catching up costs more.
- **A phase is done and the context is over ~250k:** hand off.
- **In the middle of a task:** let compaction handle it. Keeping the last messages word for word matters while work is half done. You can steer it with `/compact keep the failing test names`.
- **Stepping away for more than an hour:** hand off before you go. See the next section.
- **A new, unrelated task:** `/clear`. Nothing needs to carry over.
- **Subagents:** compaction only. Lowering their window (for example `autoCompactWindow: 250000` in an agent's file) is the lever that measured −26%.

## The one-hour cliff

The cache keeps your context for an hour. Come back after that, and the first call writes the whole context back at 2×. At 300k that's about 600k input-equivalents in a single call, before any work happens. Writing a handoff while the cache is still warm costs one cached read (about 30k worth) plus the document. The fresh conversation then starts small.

A handoff written *after* the hour pays that same 600k rewrite once, because writing it means reading the conversation. It still pays off if real work follows, since every later call is small. But the cheap moment is before the cache lapses.

## What `context-meter` does about it

- **`/handoff`.** One turn writes the handoff and saves it to `<handoffDir>/<project>-handoff.md`. The mod then replaces the conversation in place with that document and your last reply. You don't need `/clear`, it's the same session, and background agents still report back to it.
- **Automatic handoffs** (setting `autoHandoff`, on by default). Each one runs only between turns, never inside one:
  - a turn that ran `git push` or `gh pr merge/create` ends with the context past your handoff mark;
  - the session has sat idle 50 minutes on 200k+, before the cache lapses;
  - the session is running on its own: a turn started by an agent's report, another session or a schedule ends past the mark, and you haven't typed for 15 minutes. A turn you started never triggers it.
- **Its own warnings.** It speaks once at the handoff mark and once when a usage limit nears 90%, and `/ctx` shows the context size, limits and cost.

Limits: replacing the conversation needs an interactive session, because headless `claude -p` runs refuse it. There the mod still writes the file and tells you to `/clear` and continue from it. Compactions that someone else starts (auto, your `/compact`, a subagent's) run as usual.

## Measure your own

```
python claude/tools/usage-report.py            # last 24 hours
python claude/tools/usage-report.py --days 14
```

It prints usage by main session and by subagent type, your top sessions with how long they ran and their peak context, and the three context sizes above: fresh, before compaction, after.
