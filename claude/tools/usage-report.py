#!/usr/bin/env python3
"""Where your Claude Code tokens go, read from your own session logs (~/.claude/projects). Prints totals only.

    python usage-report.py            # last 24 hours
    python usage-report.py --days 14

Weights are in "input-token equivalents", relative to one fresh input token: cache read 0.1, cache write 1.25
(5-minute cache) or 2 (1-hour cache), output 5 (Opus). Nothing leaves your machine.
"""
import argparse
import collections
import glob
import json
import os
import statistics
import time

ap = argparse.ArgumentParser()
ap.add_argument('--days', type=float, default=1)
args = ap.parse_args()
cut = time.time() - args.days * 86400
root = os.path.expanduser('~/.claude/projects')


def weight(u):
    cc = u.get('cache_creation') or {}
    w1h = cc.get('ephemeral_1h_input_tokens', 0)
    w5m = u.get('cache_creation_input_tokens', 0) - w1h
    return (u.get('input_tokens', 0) + 1.25 * w5m + 2 * w1h
            + 0.1 * u.get('cache_read_input_tokens', 0) + 5 * u.get('output_tokens', 0))


def calls(path, main=True):
    """One row per API call (a call is logged once per content block): (time, context size, weight)."""
    if os.path.getmtime(path) < cut:
        return
    seen = set()
    for line in open(path, encoding='utf-8', errors='ignore'):
        if '"usage"' not in line:
            continue
        try:
            r = json.loads(line)
        except ValueError:
            continue
        m = r.get('message') or {}
        u, ts = m.get('usage'), r.get('timestamp', '')
        if not u or not ts or m.get('id') in seen or (main and r.get('isSidechain')):
            continue
        seen.add(m.get('id'))
        t = time.mktime(time.strptime(ts[:19], '%Y-%m-%dT%H:%M:%S')) - time.timezone
        if t < cut:
            continue
        ctx = u.get('input_tokens', 0) + u.get('cache_creation_input_tokens', 0) + u.get('cache_read_input_tokens', 0)
        yield t, ctx, weight(u)


kinds = collections.defaultdict(lambda: [0, 0.0])  # calls, weight
sessions = collections.defaultdict(lambda: [0, 0.0, None, None, 0, ''])  # calls, weight, first, last, peak ctx, folder
first, before, after = [], [], []

for p in glob.glob(os.path.join(root, '*', '*.jsonl')):
    sid = os.path.basename(p)[:8]
    rows = list(calls(p))
    if not rows:
        continue
    s = sessions[sid]
    s[5] = os.path.basename(os.path.dirname(p))[-30:]
    for t, ctx, w in rows:
        kinds['main session'][0] += 1
        kinds['main session'][1] += w
        s[0] += 1
        s[1] += w
        s[2] = t if s[2] is None else min(s[2], t)
        s[3] = t if s[3] is None else max(s[3], t)
        s[4] = max(s[4], ctx)
    ctxs = [c for _, c, _ in rows]
    if len(ctxs) >= 3:
        first.append(ctxs[0])
        for a, b in zip(ctxs, ctxs[1:]):
            if a > 200_000 and b < a * 0.6:  # a compaction (or a handoff swap)
                before.append(a)
                after.append(b)

for p in glob.glob(os.path.join(root, '*', '*', 'subagents', '*.jsonl')):
    kind = 'subagent'
    try:
        kind = 'subagent: ' + json.load(open(p[:-6] + '.meta.json', encoding='utf-8')).get('agentType', '?')
    except (OSError, ValueError):
        pass
    sid = p.split(os.sep)[-3][:8]
    for t, ctx, w in calls(p, main=False):
        kinds[kind][0] += 1
        kinds[kind][1] += w
        sessions[sid][1] += w

total = sum(w for _, w in kinds.values()) or 1
M = 1e6
print(f'== Last {args.days:g} day(s): {total / M:,.0f}M input-token equivalents')
print('-- by who made the call')
for k, (n, w) in sorted(kinds.items(), key=lambda kv: -kv[1][1])[:12]:
    print(f'{k:40} {n:7} calls {w / M:9.1f}M  {100 * w / total:5.1f}%')
print('-- top sessions (subagents included in their session)')
for sid, (n, w, a, b, peak, folder) in sorted(sessions.items(), key=lambda kv: -kv[1][1])[:8]:
    span = (b - a) / 3600 if a and b else 0
    print(f'{sid} {folder:30} {w / M:9.1f}M  {100 * w / total:5.1f}%  ran {span:5.1f}h  peak context {peak / 1000:4.0f}k')


def q(xs):
    if not xs:
        return 'none'
    xs = sorted(xs)
    return f'median {statistics.median(xs) / 1000:.0f}k (middle half {xs[len(xs) // 4] / 1000:.0f}-{xs[3 * len(xs) // 4] / 1000:.0f}k, n={len(xs)})'


print('-- context size at the moments that matter (main sessions)')
print(f'first call of a fresh session      {q(first)}')
print(f'just before a compaction           {q(before)}')
print(f'just after it                      {q(after)}')
