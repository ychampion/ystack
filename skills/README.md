# Skills

Skills are folders with a `SKILL.md` that an agent loads when a task matches its description. Claude Code, Codex and OpenCode all read them, so these work in any of the three.

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

## Agent operations

Fixes learned the hard way, written so the next agent recognises the symptom.

| Skill | Use when |
| --- | --- |
| `subagent-report-recovery` | A Claude Code subagent finished with many tool uses but its report is empty or one line ("Done."). |
| `multi-agent-windows-hazards` | Many parallel agents on one Windows machine: process spawns dying with 0xC0000142, stashes shared across worktrees, CI runs not triggering, silent merge-train failures. |
| `windows-bash-backslash-halving` | A Windows path or regex with backslashes arrives corrupted after an agent writes it in a Bash-tool command. |
| `bun-playwright-runner-selection` | "Playwright Test did not expect test() to be called here": a spec file run with `bun test`. |
| `ystack-upgrade` | Pull the latest ystack and re-run setup for the same hosts, then update installed mods. |

## Founders

These four share a founder hub folder, `$FOUNDER_HUB` (default `~/founder`), that holds the current bet, ideas and the evidence real people gave you. Each one offers to create the files it needs. The agent drafts outreach; you send it.

| Skill | What it does |
| --- | --- |
| `discover` | Customer discovery for an idea: a sharp hypothesis, 20 real prospects with sources, outreach drafts, a Mom Test script, and call notes logged as evidence with a commit / sharpen / kill call. |
| `sell` | The sales pipeline: account research, outreach and follow-ups, call prep, post-call summaries, pipeline status. |
| `weekly` | A Monday review from evidence and from where your agent time actually went (building, tooling, customers), with a commit / sharpen / kill call per idea. |
| `yc` | Drafts or refreshes a Y Combinator application from logged evidence only. Checks the current batch and questions on the web, and lists the evidence still missing. |

## Credits

`taste-skill` is [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) with the changes listed in its `NOTICE.md`. `cinematic-shot` and `clean-ui-shot` are by Yiwei Ho ([1weiho/cinematic-shot](https://github.com/1weiho/cinematic-shot)); `earshot` and `real-sound` are by Leon Lin (both in [Leonxlnx/earshot](https://github.com/Leonxlnx/earshot)). All MIT; each folder carries its licence.
