# Notice

This folder is a copy of the `to-tickets` skill from https://github.com/mattpocock/skills, path `skills/engineering/to-tickets/`, upstream commit `5863806dd4e15c63174bee4e7515a4256792ecfa` (2026-11-12), copyright (c) 2026 Matt Pocock, MIT licence (see `LICENSE`).

Changes from upstream, made so the skill works without the rest of the upstream set:

- `SKILL.md`: the instruction to run `/setup-matt-pocock-skills` when no tracker is configured (a setup skill not included here) is replaced with a fallback: use the repo's own issue tracker when one is evident (GitHub Issues via `gh`), otherwise local markdown files as described in step 5, with `ready-for-agent` as the agent-ready label.
- `SKILL.md` step 5: "the tracker `/setup-matt-pocock-skills` configured" now reads "the tracker in use".
