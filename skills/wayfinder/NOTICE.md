# Notice

This folder is a copy of the `wayfinder` skill from https://github.com/mattpocock/skills, path `skills/engineering/wayfinder/`, upstream commit `5863806dd4e15c63174bee4e7515a4256792ecfa` (2026-11-12), copyright (c) 2026 Matt Pocock, MIT licence (see `LICENSE`).

Changes from upstream, made so the skill works without the rest of the upstream set:

- `SKILL.md`: the instruction to run `/setup-matt-pocock-skills` when no tracker is configured (a setup skill not included here) is replaced with a fallback to GitHub Issues via `gh` or the local-markdown tracker, pointing at the two tracker docs below.
- Added `trackers/github.md` and `trackers/local.md`: copies of `skills/engineering/setup-matt-pocock-skills/issue-tracker-github.md` and `issue-tracker-local.md` from the same upstream commit, so the "Wayfinding operations" the skill relies on are available without the setup skill. `trackers/github.md` is unchanged (its PR-triage section mentions a `/triage` skill not included here; wayfinder does not use that section). `trackers/local.md` lists the five triage role strings inline instead of pointing at `triage-labels.md`, which is not included.
