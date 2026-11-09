# Codex

Material for driving the [Codex CLI](https://github.com/openai/codex) well, especially unattended
`codex exec` runs started from Claude Code or a script.

| Path | What it is |
| --- | --- |
| [`briefs/brief-template.md`](briefs/brief-template.md) | A brief to copy for each `codex exec` run: objective, a checkable DONE line, verification commands, iteration and time caps, unattended-mode rules (no questions, log assumptions), test sizing, and precedence (the brief outranks skills). |

Skills in [`../skills/`](../skills/) install for Codex too: `./setup --host codex` puts them in
`${CODEX_HOME:-~/.codex}/skills`.

## With the `codex-ladder` mod

If you start Codex runs from Claude Code, the [`codex-ladder`](../claude/mods/codex-ladder/) mod checks
each run: it keeps effort on a ladder (escalate a tier instead of retrying the same one, the top tier
only with a one-shot grant) and flags a brief that lacks DONE criteria, verification steps or a stop
condition. The template has all three, so a brief started from it passes.

Point the mod at your copy of the template so a brief that falls short names it:

```
/plugin install codex-ladder --marketplace ychampion/ystack
```

then set `briefTemplate` to the template's path in the mod's settings (`/config`).

## Why a template

Unattended runs fail in predictable ways: the agent asks a question nobody will answer and stops, it
declares victory after a first draft, it over-tests a small change, or a skill's general advice
overrides the task. Each block in the template answers one of those. Keep the opening stable across
briefs so the prompt cache hits; put dates and volatile facts low.
