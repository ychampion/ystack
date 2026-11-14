# Notice

This folder is a copy of the `migrate-to-rust` skill from https://github.com/google/skills, path `skills/developers/migrate-to-rust/`, upstream commit `67c4dbc8ff6313ef117d938e53bb21315fc281ae` (2026-11-13), copyright Google LLC, Apache License 2.0 (see `LICENSE`). The upstream repository has no NOTICE file.

Changes from upstream:

- `references/infographic_template.html`: added an `esc()` helper and escaped every telemetry field inserted with `innerHTML` (file names, titles, descriptions, test and parity notes, benchmark labels), so text from the code being migrated can't inject HTML or script into the generated page.
