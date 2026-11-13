# ystack-guards (Antigravity plugin)

Three guards for Antigravity (the app and the `agy` CLI), ported from ystack's Claude Code mods. They run
as hooks: plain Node scripts (Node 18 or later, no dependencies).

| Guard | Hook | What it does |
|---|---|---|
| push-guard | before `run_command` | Stops a `git push` whose outgoing commits add something that looks like a key (AWS, GitHub, Anthropic, OpenAI, Slack, Stripe, Google, private key blocks, `.env` files). Stops making a GitHub repo public (`gh repo edit --visibility public`, `gh repo create --public`, or an API call that sets `private=false`). Stops a force-push to `main` or `master`. The message names the file, line and kind of key, never the key. |
| package-bouncer | before `run_command` | Looks each package up on its registry before `npm`/`npx`/`bun`/`bunx`/`pnpm`/`yarn` and `pip`/`python -m pip`/`uv`/`uvx`/`pipx` install it. Stops packages that don't exist, versions that don't exist, packages npm pulled for malware, versions with known vulnerabilities (OSV), and names it can't read. Asks first when the package or version is under 14 days old, or the name looks like a misspelling of a popular package. If a registry can't be reached, the install goes ahead. |
| verify | when the agent stops | If the agent edited code and ran no test, build or check after its last edit, it is sent back once to run one and report what it showed. Once per conversation at most. |

Each guard lets the command through (and writes to stderr) if it crashes or runs out of time: a guard never
blocks the agent by failing. "Allow" from a guard only means "no objection": your own permission settings
still apply.

## Install

```sh
./setup --host agy          # from a ystack checkout; also installs ystack's skills
./setup --host agy --uninstall
```

The plugin lands in `~/.gemini/config/plugins/ystack-guards`. To turn one guard off, add
`"enabled": false` to its entry in that folder's `hooks.json` (setup will then keep your edited copy), or
switch the whole plugin off in Antigravity's plugin settings.

## Tests

```sh
node --test scripts/*.test.mjs
```
