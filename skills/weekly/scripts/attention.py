#!/usr/bin/env python3
"""Rough split of the last N days of agent prompts by category.

Reads Claude Code (~/.claude/history.jsonl) and Codex (~/.codex/history.jsonl)
prompt history when present. Keyword heuristic, roughly 80% accurate: report
the output as a rough split, not a measurement.

Usage: python attention.py [days] [extra history.jsonl ...]
"""
import collections
import json
import re
import sys
import time
from pathlib import Path

CATEGORIES = {
    "customer/selling": r"interview|customer|prospect|outreach|pilot|linkedin|cold email|sales|pricing|demo call|user feedback|sign.?up",
    "fundraising": r"\byc\b|y combinator|investor|fundrais|pitch deck|accelerator|application",
    "tooling/meta": r"claude code|codex|opencode|\bvps\b|hook|plugin|skill|settings\.json|mcp|agent config|effort|subagent|tmux|ssh|dotfiles",
    "fixing": r"\bfix|bug|error|broken|fails?\b|crash",
}


def records(path):
    """Yield (timestamp_seconds, text, project) from a history file."""
    with open(path, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            try:
                r = json.loads(line)
            except Exception:
                continue
            if "timestamp" in r:  # Claude Code: ms epoch, "display", "project"
                yield r["timestamp"] / 1000, r.get("display") or "", r.get("project") or ""
            elif "ts" in r:  # Codex: s epoch, "text", no project
                yield r["ts"], r.get("text") or "", ""


def main():
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        print(__doc__.strip())
        return
    try:
        days = int(sys.argv[1]) if len(sys.argv) > 1 else 7
    except ValueError:
        sys.exit(f"days must be a whole number, got {sys.argv[1]!r}. Usage: python attention.py [days] [extra history.jsonl ...]")
    paths = [Path.home() / ".claude" / "history.jsonl", Path.home() / ".codex" / "history.jsonl"]
    paths += [Path(p) for p in sys.argv[2:]]
    paths = [p for p in paths if p.is_file()]
    if not paths:
        print("No prompt history found (looked for ~/.claude/history.jsonl and ~/.codex/history.jsonl).")
        print("Skip the attention section, or pass a history file path.")
        return
    since = time.time() - days * 86400
    cats, projects = collections.Counter(), collections.Counter()
    for path in paths:
        for ts, text, project in records(path):
            if ts < since:
                continue
            t = text.lower().strip()
            if t.startswith("/") and len(t) < 30:  # bare slash commands
                continue
            cat = next((n for n, p in CATEGORIES.items() if re.search(p, t)), "building/other")
            cats[cat] += 1
            if project:
                projects[re.split(r"[\\/]", project.rstrip("\\/"))[-1] or "home"] += 1
    total = sum(cats.values())
    print(f"Prompts in the last {days} days: {total} (from {', '.join(str(p) for p in paths)})")
    for k, v in cats.most_common():
        print(f"{k:18} {v:4} {100 * v / (total or 1):5.1f}%")
    if projects:
        print("projects:", projects.most_common(8))


if __name__ == "__main__":
    main()
