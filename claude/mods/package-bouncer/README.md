# package-bouncer

Checks the package installs Claude runs (npm, bun, pnpm, yarn, pip, uv, cargo, go, gem, composer) against the public registries and the OSV advisory database. It stops made-up names, brand-new packages, look-alike names and versions with known security holes. A package name the shell would expand (`$VAR`, `$(...)`, backticks, globs) is refused until it is written out literally.

Scope: it catches honest mistakes, not deliberate evasion. Installs hidden behind `eval`, `xargs`, `source`/`.`, a script file or a renamed binary are not seen.

## Install

```
/plugin install package-bouncer --marketplace ychampion/ystack
```
