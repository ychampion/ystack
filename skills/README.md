# Skills

Skills are folders with a `SKILL.md` that an agent loads when a task matches its description. Claude Code, Codex, OpenCode and Antigravity all read them, so these work in any of the four.

Install them all with `./setup` from the root of this repo; it finds every folder here, so new skills need no installer change. See the root [README](../README.md#install).

## Design

| Skill | What it does | Needs |
| --- | --- | --- |
| `taste` | Design judgment for any web page or app screen: the AI tells never to ship, when a device earns its place, and checking the result in a real browser at three widths. The entry point for design work. | `taste-skill` for its inspector |
| `taste-skill` | The toolkit `taste` drives: a real-browser inspector that measures type, colour, rules and contrast at three widths, a source linter, a scroll-scene checker, a picture finder that records credits, and a deck of researched art directions. | Node 22+, Chrome |
| `make-media` | Images and short video when code isn't enough: atmosphere, textures, hero loops, illustration sets, OG images. | a Gemini API key, or your browser (Google Flow) without one |

## Shooting and sound

| Skill | What it does | Needs |
| --- | --- | --- |
| `clean-ui-shot` | Framed, cropped screenshots of a web app's real UI for docs, changelogs, landing pages and READMEs, in a clean or glass style. | Playwright, sharp |
| `cinematic-shot` | Shoots software UI like a film: oblique close-ups, a thin focal plane, slow camera drift, hard cuts. For launch videos and hero stills. | a video stack (Remotion, HyperFrames or HTML) |
| `real-sound` | Soundtracks for code-made videos from real licensed recordings, with credits and a loudness and sync audit. | Python audio libs, ffmpeg |
| `earshot` | Ears for an agent: judge, compare and check sound it can't hear, and quote the numbers instead of guessing. | the [earshot](https://github.com/Leonxlnx/earshot) CLI |

## Engineering workflow

| Skill | What it does |
| --- | --- |
| `blast-radius` | Before a change ships: finds what it can break outside the diff (including names held as strings and old-format data on disk), sorts every consumer by risk, and proves the riskiest one safe by running code. |
| `interrogate` | Reviewers from different model families (for example Claude and Codex) review the same change independently; every finding is then confirmed or rejected by running code, not by vote. |
| `arena` | 2-4 deliberately different attempts at the same task in separate worktrees, judged by one acceptance check you write first; the best becomes the base and the others' strongest parts are grafted in. |
| `recall` | "Where did I leave off?": rebuilds the state of a piece of work from git, handoff notes and past Claude Code or Codex sessions, checks each claim against the live repo, and returns a short brief. |
| `debug-loop` | A bug you can reproduce, in one tight loop: a failing test, halving (git bisect, input, toggles), a written hypothesis log, the fix, a guard test, cleanup. |
| `flaky-test` | Turns "sometimes fails" into a measured rate, isolates the cause (order, time, randomness, async, network, machine), fixes it and proves 0 failures in N runs. |
| `perf-loop` | Faster by measurement: a target, a repeatable benchmark, a profile, one change at a time, and only changes that beat the noise are kept. |
| `dep-upgrade` | Dependencies upgraded one at a time: changelog first, bump, build and test, keep or roll back, one commit each. |
| `migration-plan` | Schema and data changes as expand / backfill / switch / contract steps, each with a tested rollback, rehearsed on a copy first. |
| `secure-diff` | The author's security check of their own diff before handing it over: secrets, every new input traced to where it is used, authorization, defaults, and a probe of each suspect. |
| `repo-map` | A one-page map of an unfamiliar repo: run and test commands (each actually run), entry points, one traced flow, and the traps. |
| `release-notes` | Release notes for users, not developers, from git history: internals dropped, breaking changes and required actions first, outcomes in plain words. |
| `postmortem` | A blameless incident write-up from logs, deploys and chat: a sourced timeline, trigger vs root cause, impact, and actions with owners. |

## Planning and agents

| Skill | What it does |
| --- | --- |
| `grill` | A quick stress-test of a plan: pointed questions one at a time, each with a recommended answer, ending in a short spec and tickets that say what blocks what. For the long open interview, see `grilling` below. |
| `agent-writing` | Briefs, system prompts and rules files that agents actually follow: trigger wording, what to cut, length budgets, DONE criteria and verification, a pre-ship checklist. |
| `eval-judge` | A grader for your agent's outputs that agrees with your own judgment: ~20 real runs you label, a rubric, measured agreement, fixes, and a held-out check. Any model or CLI; never a paid API key without your okay. |

## Agent operations

Fixes learned the hard way, written so the next agent recognises the symptom.

| Skill | Use when |
| --- | --- |
| `subagent-report-recovery` | A Claude Code subagent finished with many tool uses but its report is empty or one line ("Done."). |
| `multi-agent-windows-hazards` | Many parallel agents on one Windows machine: process spawns dying with 0xC0000142, stashes shared across worktrees, CI runs not triggering, silent merge-train failures. |
| `windows-bash-backslash-halving` | A Windows path or regex with backslashes arrives corrupted after an agent writes it in a Bash-tool command. |
| `bun-playwright-runner-selection` | "Playwright Test did not expect test() to be called here": a spec file run with `bun test`. |
| `ystack-upgrade` | Pull the latest ystack and re-run setup for the same hosts, then update installed mods. |

## Ideas

| Skill | What it does |
| --- | --- |
| `idea-scout` | What to build, from what people are struggling with now, not from the model's memory. Scans Hacker News, GitHub issues and new repos, Reddit, changelogs and launches for dated, linked evidence of real problems, runs them through five lenses for less obvious angles (new capability × old pain, tool refugees, abandoned-but-loved projects, shared scripts, agents as users), checks what already exists, and writes 5-8 ranked briefs: open-source tools, side projects or company-size ideas, each with quotes, links, the gap, why now and a first build. `dig <idea>` goes deep on one: demand over time, every competitor and its users' complaints, the first 10 users and a test to run this week. No link, no claim. Needs web search. |

## From other skill collections

Copied as they are, each with its licence and a `NOTICE.md` listing any change. "Asks first" means the skill runs only when you call it by name.

| Skill | What it does |
| --- | --- |
| `diagnosing-bugs` | The long diagnosis for hard bugs and performance regressions with no reliable repro yet: a loop that goes red on the bug, ranked hypotheses, instrumentation, a regression test. |
| `tdd` | Test-first, red to green in vertical slices, with tests only at agreed seams and a list of test anti-patterns. |
| `prototype` | A throwaway prototype that answers one design question: a state-machine walkthrough for logic, or switchable UI variants. |
| `grilling` | A long interview over a plan's decision tree, each question with a recommended answer, until every branch is settled. |
| `to-spec` | Turns the conversation into a spec (problem, solution, user stories, test seams) in your issue tracker or a local file. Asks first. |
| `to-tickets` | Breaks a plan or spec into thin end-to-end tickets with blocking edges, in your tracker or local markdown. Asks first. |
| `wayfinder` | Plans work too big for one session as a map of decision tickets, resolved one per session. Asks first. |
| `to-questionnaire` | Turns a decision you can't answer alone into a questionnaire for the person who can. Asks first. |
| `research` | Researches a question against primary sources and writes a cited note into the repo. |
| `domain-modeling` | Builds the project's vocabulary as you design: a glossary, sharpened terms, and decision records only when warranted. |
| `codebase-design` | A vocabulary for deep modules (interface, depth, seam, adapter, locality), with deepening and design-it-twice guides. |
| `improve-codebase-architecture` | Finds deepening opportunities in the code, shows them as an HTML report with before/after diagrams, then works through the one you pick. Asks first. |
| `writing-for-agents` | The full style reference for skill and agent-doc files: context pointers, hierarchy, completion criteria, pruning. |
| `teach` | A teaching workspace that persists across sessions: a mission, short HTML lessons, reference sheets and learning records. Asks first. |
| `retro` | A retrospective on a coding session that proposes fixes to the environment: pointers, automated checks, standards, tool economy. Asks first. |
| `wizard` | Generates an interactive bash wizard that walks a person through the steps only they can do: dashboards, credentials, CI secrets, cutovers. |
| `pr` | A PR description with a visual summary (call tree, file tree, diagram, diff), before/after evidence, and how risky the merge is. |
| `migrate-to-rust` | Migrates a C, C++, Fortran, Java, Python or shell codebase to safe Rust: a blueprint, self-healing tests, A/B output parity, profile-guided optimization, and a report page. |

## Founders

These four share a founder hub folder, `$FOUNDER_HUB` (default `~/founder`), that holds the current bet, ideas and the evidence real people gave you. Each one offers to create the files it needs. The agent drafts outreach; you send it.

| Skill | What it does |
| --- | --- |
| `discover` | Customer discovery for an idea: a sharp hypothesis, 20 real prospects with sources, outreach drafts, a Mom Test script, and call notes logged as evidence with a commit / sharpen / kill call. |
| `sell` | The sales pipeline: account research, outreach and follow-ups, call prep, post-call summaries, pipeline status. |
| `weekly` | A Monday review from evidence and from where your agent time actually went (building, tooling, customers), with a commit / sharpen / kill call per idea. |
| `yc` | Drafts or refreshes a Y Combinator application from logged evidence only. Checks the current batch and questions on the web, and lists the evidence still missing. |

## Credits

`taste-skill` is [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) with the changes listed in its `NOTICE.md`. `cinematic-shot` and `clean-ui-shot` are by Yiwei Ho ([1weiho/cinematic-shot](https://github.com/1weiho/cinematic-shot)); `earshot` and `real-sound` are by Leon Lin (both in [Leonxlnx/earshot](https://github.com/Leonxlnx/earshot)). All MIT; each folder carries its licence. `migrate-to-rust` is from [google/skills](https://github.com/google/skills) (Apache-2.0); `diagnosing-bugs`, `tdd`, `prototype`, `grilling`, `to-spec`, `to-tickets`, `wayfinder`, `to-questionnaire`, `research`, `domain-modeling`, `codebase-design`, `improve-codebase-architecture`, `writing-for-agents`, `teach`, `retro`, `wizard` and `pr` are from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT; `pr` also credits HumanLayer, see its `CREDITS.md`).
