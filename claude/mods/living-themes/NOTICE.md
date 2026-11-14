# Notice

living-themes is released under the MIT licence (see the repository's LICENSE). Parts of it derive from Anthropic's
`theme-examples` plugin, which is:

    Copyright Anthropic, PBC
    Licensed under the Apache License, Version 2.0

A copy of that licence is in [LICENSE-APACHE](LICENSE-APACHE). The derived parts stay under Apache-2.0.

## What derives from theme-examples

| File | Taken from theme-examples | What changed here |
|---|---|---|
| `hooks/register.tsx` | The three ways of setting a backdrop (`setByAWay`, `setBackdrop`, `isNotThisEnginesWay`), `clearBackdrop`, `sceneNameOf`, the `quietly` pattern, the Backdrop / Placed / AbovePrompt render hooks, the card's layout, name matching (`keyOf`), and the preview timer | The scene name now carries the moment (activity, time of day, season, subagents); backdrop changes are throttled and coalesced; the colour scheme follows the time of day for `auto` themes; faults go to the debug log only; choices are a default for every session or one session's own (no per-project keys); no fireworks |
| `hooks/themes.ts` | The idea of one table of themes and a `sceneFault` check | An LRU cache of built scenes (40), keyed by scene name |
| `hooks/scenes/*.ts` | The technique: one self-animating SVG string per scene, CSS keyframes only, a plain first frame, `prefers-reduced-motion` | Every scene is new artwork, written for this mod |

Nothing else in this folder derives from theme-examples.
