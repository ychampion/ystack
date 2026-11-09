# push-guard

Stops the git and GitHub accidents that are hard to undo. It checks every Bash and PowerShell command Claude runs, in the main session and in every subagent, and refuses with a plain reason and the safe way forward.

| Rule | What happens |
| --- | --- |
| Keys in a commit | Before `git commit`, the staged diff is scanned (plus what an earlier `git add` or `commit -a` in the same command will stage, new files included). |
| Keys in a push | Before `git push`, the commits no remote has yet are scanned. |
| Making a repo public | `gh repo edit --visibility public`, `gh repo create --public`, and `gh api` / `curl` / `Invoke-RestMethod` calls that set `private:false` or `visibility=public`. Repos in `protectedRepos` are always refused; any other is refused until you type `/push-guard allow public <owner/name>`. A `PATCH`/`PUT`/`POST` to a repo whose body push-guard can't read (`--input`, a piped body, `curl -d @file`, a PowerShell `-Body` variable) is refused until you type `/push-guard allow api <owner/name>`. |
| Force-push to a protected branch | `--force`, `-f`, `--force-with-lease`, or a `+refspec` onto a branch in `protectedBranches`. Refused, with a suggestion to push a new branch. |
| Deleting a remote branch or repo | `git push --delete`, `git push origin :branch`, `--prune`, `--mirror`, `gh repo delete`, a `DELETE` on a repo or ref. Refused until you type `/push-guard allow delete <target>`. |

Key formats: AWS (not the documented example key), GitHub, OpenAI, Anthropic, Slack, Stripe and Google keys, private key blocks, and `.env` files (`.env.example`, `.sample`, `.template`, `.test` and `.development` are checked only for key patterns). A stop names the file, the line and the kind of key, never the value.

Allows last for the session and only count when you type them; Claude can't allow itself. `/push-guard` shows the settings and this session's allows.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `mode` | `block` | `warn`: nothing is refused. The command runs, and Claude is told what push-guard would have stopped, so it can check and tell you. For setups where agents do all git work. |
| `protectedBranches` | `main, master` | Comma-separated names or globs (`release/*`). |
| `protectedRepos` | (none) | Comma-separated `owner/name`, or `*` for all. |
| `allowPaths` | (none) | Paths or globs the key scan skips (`tests/fixtures/**`). |

## Scope

It catches honest mistakes, not deliberate evasion. It reads the command as written, through `cd`, `git -C`, `bash -c`, `pwsh -Command` and wrappers (`sudo`, `env`, `timeout`, `nice`, `nohup`, `command`).

No guard that reads command text can stop an agent set on getting around it: writing the push into a script file and running that is enough. For real enforcement, turn on GitHub's branch protection or rulesets (no force-push, no deletion on `main`) and secret scanning push protection. Those hold on the server, whatever runs the command. push-guard is the early, local check that explains the problem before the push happens.

- **Where it runs:** `cd ~/repo`, `cd $HOME/repo`, Git Bash paths (`/c/...`) and relative paths are followed. If the folder can't be told (`cd "$DIR"`, `cd -`), a commit or push is refused until it is run from that folder or with `git -C <path>`. push-guard never checks the session's own repo instead.
- **Unreadable targets count as protected:** a force-push to `$BRANCH`, `$(...)`, `@` or `HEAD` is checked against the real branch with git (and, for a bare push, its upstream); if that can't be told, it is refused. gh's `{owner}/{repo}` is filled from `gh repo view` in that folder. A repo named by a variable counts as protected when `protectedRepos` is set, and an allow must name it literally.
- **Fails closed:** if push-guard itself hits an error on a git, gh or curl command, the command is refused, not run unchecked.
- **Aliases and commands git runs for you:** a git or gh alias is looked up and checked as what it stands for, but only when it is the whole command; next to anything else (which could set the alias up first) a name that isn't a builtin is refused. `rebase -x`, `submodule foreach`, `bisect run`, `for-each-repo`, `filter-branch`, `difftool -x`, `-c` options that run a command (editor, pager, alias...) and launchers like `xargs` or `find -exec` running a risky git or gh command are refused rather than parsed.
- **Not seen:** `eval`, scripts, and commands built at run time.
- **Not scanned:** commits a remote already has are skipped by design (they are out already, and rescanning history on every push would be slow). New files over 4 MiB or unreadable are skipped, and only the first 1,000,000 characters of a file are scanned; the note names those files. If git can't be read (not a repo, git missing), the command goes ahead with a note saying it wasn't checked.
- git runs with hooks, fsmonitor, external diff, textconv and pager turned off, so checking a repo never runs code from it.
