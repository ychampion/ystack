# model-router

Gives every subagent the right model and effort, so your routing rules are applied at dispatch instead of hoped for in CLAUDE.md.

| Tier | Tasks | Default |
| --- | --- | --- |
| high | security, bugs whose cause is unknown, concurrency, parsers, edge cases, and (with `reviewTier: high`, the default) all review and verification | the session's model at `high` effort |
| medium | builds, features, refactors, tests, docs, research, fix rounds, and plain reviews with `reviewTier: medium` | the session's model at `medium` effort |
| fast | locating files and symbols, log triage, bulk classification, reshaping data, polling | `haiku` |

By default only effort is set for the high and medium tiers; the model stays whatever the session would give the subagent. Set `strongModel` to pin one.

The tier comes from keyword rules over the task's description and agent type, plus the first 600 characters of its prompt. Keywords match whole words (`fix` doesn't match `prefix`); a trailing `*` matches any ending (`verif*` matches verify and verification). The first rule that matches wins, in this order:

1. **Always high:** security terms (secret, credential, injection, XSS, auth, permission, vulnerability, crypto...), crash, race, deadlock, flaky, regression triage, and an unknown cause ("unknown cause", "not sure why", "intermittent"). No other rule lowers these.
2. **Fix rounds:** a fix round, a findings list, or a bug whose cause is known, is medium.
3. **High keywords**, then **medium keywords**, then **fast keywords.** One high word beats any number of build words, and a task is fast only when nothing high or medium is in it.

A task no rule matches gets the medium tier (or is left alone, with `unmatched: leave`). With `classifier: haiku`, an unmatched task is sent once to the small fast model to pick a tier; with the default `off`, nothing is sent anywhere.

- **Banned models:** a subagent asking for one in `bannedModels` runs on the strong model instead (with none set, the first allowed model in `fallbackModels`), and the agent that dispatched it gets a one-line note naming the model it runs on. A banned `strongModel` is replaced the same way.
- **Explicit choices stand:** a model or effort the caller set is kept. `enforce: true` makes the table win over those, for the agent types in `genericTypes`. Any other agent type always keeps its own model and effort.
- **Plain reviews:** `reviewTier: medium` sends review, verification and audit work to medium. A review that names security, a parser, concurrency, debugging or edge cases still goes high, because those keywords are checked first. In one blind test on the same code, a medium reviewer caught as many known bugs as a high one in half the time; high went deeper on parser edge cases.
- `/model-router` shows the table and the last 20 decisions, with the reason for each.

## Settings

`strongModel` (empty: the session's model), `fastModel` (`haiku`), `highEffort` (`high`), `mediumEffort` (`medium`), `reviewTier` (`high`), `highKeywords` / `mediumKeywords` / `fastKeywords` (extra comma-separated words, same `*` syntax), `unmatched` (`medium`), `bannedModels` (none), `fallbackModels` (`opus, sonnet, haiku`), `genericTypes` (`general-purpose`), `enforce` (off), `classifier` (`off`). Models are aliases or full ids.

## Limits

Effort can be set only on Agent tool calls. Workflow agents and other plugins' spawns get the model but keep their effort. A model set in a named agent type's own definition can't be seen, so a banned model there is not replaced unless the call names it. A session setting that forces one model on every subagent outranks the router.
