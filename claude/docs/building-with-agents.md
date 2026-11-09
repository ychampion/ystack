# Building with agents: the loop behind these mods

Every mod in ystack was built with the same loop. It's written down here because it's what makes agent-built code trustworthy enough to run unattended. The mods enforce parts of it, so the loop holds even when nobody remembers to follow it.

## The loop

1. **Spec first, when the request is open.** A large, vague request goes wrong in the most expensive way: the agent builds the wrong thing well. A few pointed questions before starting cost less than any rebuild. More effort doesn't fix a wrong reading. The [`spec-sharpener`](../mods/spec-sharpener) mod asks them.
2. **Build at medium effort.** Medium builds whole features from a clear spec. Higher effort mostly buys more checking, and that's the reviewer's job. [`model-router`](../mods/model-router) puts each subagent on the right tier.
3. **Verify with a real check.** That means running the tests, the build, or the actual program. "Should work" doesn't count. [`verify`](../mods/verify) holds back "done" until a check has run.
4. **Review at high effort, with fresh eyes.** The reviewer gets the code and what it's meant to do, never the builder's conclusion. A reviewer handed a hypothesis tends to confirm it. [`review-panel`](../mods/review-panel) picks the reviewers from the diff.
5. **Every report ends with "Assumptions I made".** That's where a wrong reading shows up before more work is built on it. [`brief-linter`](../mods/brief-linter) adds the requirement to every brief. [`assumptions-ledger`](../mods/assumptions-ledger) collects the answers and sends only real decisions to you, through the [`decision-inbox`](../mods/decision-inbox).

## A real case: the in-place handoff

`context-meter`'s automatic handoff writes a handoff document and then replaces the whole conversation with it. A bug there loses your work, so it went through the whole loop. How it went:

**Tests first. 12 passed.** Then a live run in a real `claude -p` session found two engine rules no test could have shown:

- A mod may compact a session only when a turn ends, not from a command or a prompt hook.
- A mod's own timers can't reach its own hooks.

The design changed to fit: the handoff is now a short "checkpoint" turn, and the swap happens when that turn ends.

**Then an independent review at high effort.** It got the code and what the code was meant to do, but no conclusions. It found three serious bugs that all 12 passing tests had missed:

| Bug | What would have happened |
| --- | --- |
| Pressing Esc during the checkpoint turn | The half-written handoff was saved and swapped in. The conversation was gone. |
| An agent's report finishing first | A report with headings like "State" and "Next steps" was taken for the handoff and swapped in. |
| A message arriving during the checkpoint | The swap erased it, so an agent's final report or your instruction vanished. |

It also found smaller ones:

- a failed swap repeated on every later turn;
- a Slack message from you counted as you being away.

The reviewer wrote a test that reproduced each confirmed bug. All were fixed and turned into permanent tests (18 now), and the reviewer's own repro tests were run against the fix.

**The lesson isn't that tests are useless.** Tests check what the author thought of. A reviewer who didn't write the code thinks of the rest.

## Briefs that work

Agents only know what's in the brief. A good one says:

- **the goal and what DONE means:** "all tests pass" plus the exact command;
- **the verification:** which real check proves it;
- **what's already ruled out**, so the agent doesn't redo it;
- **a stop rule:** "after 3 failed fix cycles on the same problem, stop and report";
- **where long output goes:** to a file, with only the path and a short summary in the report, so the main session's context stays small;
- **"Assumptions I made"** at the end of the report.

`brief-linter` adds whichever of these a brief is missing.
