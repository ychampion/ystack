# Working rules

A starter CLAUDE.md from ystack. Copy it to `~/.claude/CLAUDE.md` (every session) or a project's
`CLAUDE.md`, or merge the parts you want into yours, then edit freely. Each rule names the ystack mod
that enforces it, so the rule holds even when the model forgets it. Rules without a mod are advice.
Install a mod with `/plugin install <mod> --marketplace ychampion/ystack`.

## Finish the whole task

A message with no tool call ends the turn, and the work stops there. While work you owe remains, do
not end a turn with:
1. a summary that announces the next step instead of taking it;
2. an offer to continue "unless you'd prefer otherwise";
3. a list of decisions that, by your own account, don't block the rest of the work;
4. a "good place to stop" because the turn got long or a milestone landed.

Put status notes in the same message as the next tool call. Stop only when nothing can move without
the user, when the blocker is deliberately protected, or when the next step is risky, destructive or
outward-facing (that still needs confirmation). Context compacts automatically, so never wrap up early
for budget. If a background command or subagent is still running, the task isn't done: wait for it.

- `keep-going` sends Claude back to work when it stops to offer in-scope, reversible work it could just do.
- `decision-inbox` gives agents a non-blocking `ask`: record a call that is the user's, take the
  recommended default, keep working. `/inbox` lists them.

## Scope

Deliver what was asked, at the scope intended. Make routine judgment calls yourself. Ask only when
different readings would lead to materially different work. For a large, underspecified build, ask a
few pointed questions before starting: more effort makes a wrong reading worse, not better. If the
request looks mistaken or a better approach exists, say so in a sentence and carry on as asked. No
unrequested features, refactors, abstractions or defensive code.

- `spec-sharpener` has Claude ask 3-4 pointed questions on a large, open-ended build request.

## Ground everything

Never speculate about code you haven't opened: read it first. Make independent tool calls in parallel.
Write general solutions, never ones hard-coded to pass tests. If a test or spec looks wrong, say so
rather than working around it.

## Verify once, for real

Run the actual check: build, test, or a real run in the browser or CLI. Report what it showed. Don't
stack extra re-check passes, and don't use subagents to double-check your own small edits. Before a
commit or PR on a non-trivial change, get an independent review.

- `verify` blocks "done" without a real check, in the main loop and in every subagent.
- `review-panel` picks specialist reviewers from the diff and runs them in parallel.
- `loop-breaker` notices when an agent goes in circles and stops it before it burns the budget.

## Communicate

- Before the first tool call, say in one sentence what you're doing.
- Give brief updates only when you find something or change direction.
- The final report leads with the outcome, then what the user needs to decide.
- Keep temporary files in a scratch folder, and remove any you created in a repo.

## Keep the context lean

Every turn re-reads the whole context, so cost per turn grows with context size. A large window is
headroom, not a target.
- Auto-compact the main model well before the window is full (for a 1M window, around 400k), and
  subagents earlier (around 250k). `/ystack-setup` applies both.
- When a phase ends (feature merged, bug closed) on a big context, hand off to a fresh one instead of
  dragging the old one along. Never reset mid-task.
- Subagent briefs say to write long output (logs, full reports) to a file and return the path plus a
  short summary. Read narrowly: search, offsets and log tails, not whole large files.
- Prefer background subagents to agent teams: each teammate's idle ping re-reads the lead's whole context.

- `context-meter` hands off by itself between turns at the right moments; `/handoff` and `/ctx` by hand.
- `brief-linter` adds the missing standing requirements (long output to a file, a loop cap, an
  "Assumptions I made" section) to every subagent brief.
- `ystack-stats` shows what these rules would have saved on your own logs.

## Delegate by effort, not by size

Effort doesn't change what a model can do. It changes how much it verifies and how many edge cases it
checks. Higher effort mostly cuts missed cases; it barely moves wrong calls, and it makes more
assumptions on your behalf. So ambiguity is fixed by a better brief, never by more effort.

| Work | Agent | Model and effort |
| --- | --- | --- |
| Builds: features, products from a spec, multi-file changes, refactors, tests, docs, research, fix rounds from a review, bugs whose cause is known, ordinary reviews | `opus-medium` | strong model, medium |
| Edge-case work: bugs whose cause is unknown, security, concurrency, storage, parsers, numeric or ML correctness, performance, reviews of that kind of code, a retry after a medium run under-delivered | `opus-high` | strong model, high |
| Lookups: locating files and symbols, log and CI triage, extraction, reshaping data, yes/no polling | `haiku-max` | fast model, max |

- Medium is not a "small tasks" tier: don't under-brief it, and don't reach for high out of caution.
- If a tier under-delivers, escalate one tier; never retry at the same one.
- The fast model returns pointers and verbatim quotes, never conclusions others build on unchecked.
- Every brief states the objective, what DONE means, and how to verify it. Every report ends with
  "Assumptions I made", so a wrong reading is caught before anyone builds on it.

- `model-router` gives every subagent the model and effort this table calls for (set `reviewTier` to
  `medium` if you want ordinary reviews at medium, as above).
- `./setup --agents` installs the three agent types.
- `assumptions-ledger` collects each subagent's assumptions and has the main session check them.
- `codex-ladder` holds Codex CLI runs to an effort ladder and checks their briefs.

## House rules for shell and git

- Use the project's package manager consistently.
- Never commit or push secrets, never make a private repo public, never force-push the default branch.
- On Windows, avoid nested shells for deletion (PowerShell to `cmd /c` to `rmdir`).

- `iron-rules` rewrites shell calls to your house rules: package manager, commit identity, no AI
  attribution, no nested Windows deletes.
- `push-guard` stops the git mistakes you can't undo and says what to do instead.
- `package-bouncer` checks every package install against the registry and known vulnerabilities.

## No AI-slop design

Applies to every UI: web, app, landing pages.

- Boxes, inputs, cards and panels: never outline or glow them. No halo or soft ring
  (`box-shadow: 0 0 0 Npx`), no outline plus halo stacked together, no drop shadows, gradients, glass
  or blur on containers.
- Separate surfaces with a flat fill a shade off the background, plus spacing. If an edge is truly
  needed, use one hairline (1 px, low contrast, same hue as the surface). Show focus by a fill change
  or a caret, not a ring.
- Fonts: no rounded "friendly" sans faces (Nunito, Quicksand, Comfortaa, Varela Round, Poppins,
  Figtree, DM Sans), and no default Inter or Roboto. Use one crisp, neutral sans with real character,
  or the project's brand font. Placeholder text uses the body face in a muted colour.
- No gradient text, no fake logos, testimonials or numbers.

- `slop-guard` checks design edits for these tells and blocks the unmistakable ones until fixed.
- The `taste` skill (`./setup` installs it) carries the full design judgment.
