# ystack-guards (Devin plugin)

Three guards for Devin, in Devin Desktop and the `devin` CLI, ported from ystack's Claude Code mods. They run
as plugin hooks: plain Node scripts (Node 18 or later, no dependencies). They are the same scripts as the
[Antigravity plugin](../../../antigravity/plugins/ystack-guards/); Devin starts them with `--host devin`.

| Guard | Hook | What it does |
|---|---|---|
| push-guard | before `exec` | Stops a `git push` whose outgoing commits add something that looks like a key (AWS, GitHub, Anthropic, OpenAI, Slack, Stripe, Google, private key blocks, `.env` files). Stops making a GitHub repo public (`gh repo edit --visibility public`, `gh repo create --public`, or an API call that sets `private=false`). Stops a force-push to `main` or `master`. The message names the file, line and kind of key, never the key. |
| package-bouncer | before `exec` | Looks each package up on its registry before `npm`/`npx`/`bun`/`bunx`/`pnpm`/`yarn` and `pip`/`python -m pip`/`uv`/`uvx`/`pipx` install it. Stops packages that don't exist, versions that don't exist, packages npm pulled for malware, versions with known vulnerabilities (OSV), and names it can't read. Asks you first when the package or version is under 14 days old, or the name looks like a misspelling of a popular package. If a registry can't be reached, the install goes ahead. |
| verify | after edits and commands, and when Devin stops | If Devin edited code and ran no test, build or check after its last edit, it is sent back once to run one and report what it showed. Once per session at most. |

Each guard lets the command through (and writes to stderr) if it crashes or runs out of time: a guard never
blocks Devin by failing. A guard that has no objection answers nothing, so your own Devin permission settings
still apply.

## What it doesn't catch

These guards catch honest mistakes. They are not a security boundary against an agent or a repo that is
trying to get past them:
- push-guard reads the command line as written. A git alias (`git p` for `git push`), push refspecs set in
  `remote.<name>.push`, or a word escaped with backslashes in bash can hide a push or a force-push from it.
- It decides what is outgoing from your local remote-tracking refs, so a ref changed by hand can hide commits.
- When a guard crashes, times out or can't reach a registry, it lets the command through.
- verify sees Devin's own edit tools and `exec`. Files changed some other way (a script, an MCP tool) don't count.

## Install

From a ystack checkout (this also installs ystack's skills into Devin's skills folder):

```sh
./setup --host devin
./setup --host devin --uninstall
```

Setup copies the plugin to Devin's folder (`%APPDATA%\devin\ystack-plugins` on Windows,
`~/.config/devin/ystack-plugins` elsewhere) and registers it with `devin plugins install --local`. Devin
Desktop and the CLI share that registration. Registering needs the CLI to be logged in (`devin auth login`).
If it isn't, setup prints the command to run afterwards. Setup finds the CLI on `PATH`, or else the copy that
ships inside Devin Desktop.

Or install it by hand from a checkout:

```sh
devin plugins install --local ./devin/plugins/ystack-guards -y
```

Start a new Devin session after installing. `devin plugins info ystack-guards` lists its hooks.

## Editing

The scripts are copies of `antigravity/plugins/ystack-guards/scripts`, which is where they're edited and
tested (`node --test antigravity/plugins/ystack-guards/scripts/*.test.mjs`, including `devin.test.mjs` for
Devin's input and answers). `tests/devin-guards-drift.test.ts` fails if the copies differ, and its header has
the copy command.
