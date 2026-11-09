# Notice

This folder is a modified copy of the `taste-skill` skill (`design-taste-frontend`) from
https://github.com/Leonxlnx/taste-skill, tag v2.1.5, copyright (c) 2026 Leonxlnx, MIT licence (see
`LICENSE`). Upstream has since rebuilt the skill (2.5.x) around different scripts; this copy keeps the
2.1.5 toolkit because the `taste` skill drives its `inspect.mjs`, `lint.mjs`, `scenes.mjs`,
`assets.mjs` and `draw.mjs`.

Changes from upstream v2.1.5:

- `SKILL.md`: frontmatter `name` is `taste-skill` (the folder name) and the description frames the skill
  as the toolkit the `taste` skill drives; a short note at the top says so.
- Monospace, index numbers, hairlines and grid cells, floating pill nav and tracked uppercase labels are
  allowed when they carry information, instead of banned outright. `SKILL.md` (house rules),
  `references/tells.md`, `references/critique.md` and `references/layout.md` describe the new rule;
  `scripts/lib/rules.mjs` and `scripts/lint.mjs` report these as WARN instead of FAIL, except the cases
  the study condemns (pill badges, a label above every heading, monospace over 15% of running text).
- Wording that referred to a particular person's choices is neutralised; `README.md` install path
  updated to the folder name.
- Left out: a local backup folder of pre-change files.
