# security-sweep

A weekly security sweep for one Ubuntu machine that runs live services and containers.

It fixes one thing by itself: **Ubuntu security-pocket updates, and only those whose install restarts
nothing that is running**. Everything else it finds goes into a Markdown report and, optionally, into a
Claude decision inbox for a person to decide on.

| Area | What it does | Changes anything? |
|---|---|---|
| Ubuntu packages | Lists pending `-security` updates and installs them with `unattended-upgrades`, limited to the security pocket. Holds back any package whose install would restart or start a running service, plus the container runtime (`docker.io`, `docker-ce`, `containerd`, `containerd.io`, `runc`). Forces needrestart to list-only mode. Afterwards it records whether a reboot or service restarts are needed. | Yes: restart-free security updates only (not in `--dry-run`) |
| Kernel and host packages | Scans a copy of the dpkg database with trivy to rate pending fixes, count kernel fixes that wait for a reboot, and find fixes missing from your update sources (often Ubuntu Pro only). | No |
| Code repos | Finds every git repo under the configured roots and scans its lockfiles with osv-scanner. Lists vulnerable packages with their fixed versions, with worktrees grouped per project. | No |
| Docker | Scans the image of every running container with trivy (HIGH and CRITICAL, fix available). | No |
| Global CLIs | Checks global npm, bun and pip packages against OSV, and notes when node or bun has a newer release. | No |

It never restarts a service, never stops, restarts or recreates a container, and never reboots.
Reboots and restarts are reported for a person to schedule.

## How the "no restart" rule is enforced

1. `NEEDRESTART_MODE=l` in the environment and `$nrconf{restart} = 'l'` in
   `/etc/needrestart/conf.d/90-security-sweep-list-only.conf`. needrestart only lists restarts.
2. Before installing, every pending security update is checked. It is held back when:
   - the package ships a systemd unit or init script that is active now (its install script would restart it), or
   - its current install script restarts or starts services (libc6 and libpam0g do this for other services), or
   - it matches the always-held list or `SWEEP_HOLD_EXTRA`.
3. unattended-upgrades runs with a private copy of `/etc/apt/apt.conf.d`, so the allowed origins are
   exactly `<codename>-security` plus the ESM security pockets, and the held packages are blacklisted.
   `/etc/apt` itself is never edited. Auto-reboot and autoremove are off.
4. The sweep refuses to install anything if needrestart is not in list-only mode, or if `/` has less than
   `SWEEP_MIN_FREE_MB` free.

Held packages are reported, with the exact command to install them at a quiet hour.

## Disk and memory

The trivy vulnerability databases are large (about 1.6 GB, plus 1.5 GB for the Java DB). The sweep
downloads them into a RAM-backed scratch folder (`/dev/shm` by default) and deletes it at the end of
every run, together with image exports and downloaded `.deb` files. A run needs a few GB of free memory
for its duration and almost no disk. Image and host scans are skipped when less than `SWEEP_MIN_MEM_MB`
of memory is available. Kept on disk: the scanner binaries (about 230 MB), the reports, and small
compressed raw-result archives (`runs/`, about 40 MB each on a busy machine, last 4 kept).

## Install

As root, on the machine to protect (Ubuntu 22.04 or newer; needs `python3-apt`, `unattended-upgrades`,
`needrestart`, `jq`, `curl`, `git`):

```bash
apt-get install -y python3-apt unattended-upgrades needrestart jq curl git

# 1. Files
install -d -m 0700 /opt/security-sweep
cp -r sweep.sh install-tools.sh lib security-sweep.env.example /opt/security-sweep/
cp /opt/security-sweep/security-sweep.env.example /opt/security-sweep/security-sweep.env   # then edit
chmod 700 /opt/security-sweep/sweep.sh /opt/security-sweep/install-tools.sh

# 2. Scanners: official release binaries, SHA-256 checked against the release checksum files
df -h /opt          # check free space first: about 300 MB is needed
/opt/security-sweep/install-tools.sh

# 3. needrestart: list restarts, never perform them (affects every apt run on the machine)
install -m 0644 needrestart-list-only.conf /etc/needrestart/conf.d/90-security-sweep-list-only.conf

# 4. Decision inbox folder (skip if you do not use the inbox; see below)
install -d -m 0700 /root/.claude/decision-inbox

# 5. First run: a dry run that changes nothing. Read the report before going further.
/opt/security-sweep/sweep.sh --dry-run
less /opt/security-sweep/reports/$(date +%F)-dry-run.md

# 6. Weekly schedule (Sunday 03:30 server time, up to 30 min random delay, catches up after downtime)
cp security-sweep.service security-sweep.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now security-sweep.timer
systemctl list-timers security-sweep.timer
```

If you install somewhere other than `/opt/security-sweep`, change the paths in `security-sweep.service`
(`EnvironmentFile`, `ExecStart`, `ReadWritePaths`).

Run it by hand at any time with `systemctl start security-sweep.service`. Follow it with
`journalctl -u security-sweep -f`.

Options: `sweep.sh [--dry-run|--apply] [--no-inbox] [--skip os,repos,docker,globals]`.
`python3 -I lib/report.py --self-test` checks that hostile repo paths or container labels never reach a
suggested command unquoted.
Settings live in `security-sweep.env`; every one is described in `security-sweep.env.example`.

## Reports

`reports/<date>.md` after a real run, `reports/<date>-dry-run.md` after a dry run. Each report has a summary
table with counts by severity, the items that need a person, and one section per area.

## Decision-inbox alerts

When `SWEEP_INBOX_DIRS` is set, the sweep writes one JSON file per issue group into each folder, in the
shape the decision-inbox mod uses:

```json
{"id": "D-xxxxx", "question": "...?", "options": ["...", "..."], "recommended": "...",
 "context": "... Command for Claude: ...", "isBlocking": false, "sessionId": "security-sweep",
 "from": "security sweep (host, date)", "at": 1790000000000, "status": "open"}
```

- Groups: held-back OS updates, pending reboot or service restarts, Ubuntu's own daily auto-install
  (when it is on), fixes that need Ubuntu Pro, code repos, container images, global CLIs, and sweep failures.
- `isBlocking` is true when a group contains a CRITICAL issue or one on the CISA known-exploited list.
- Each entry ends with the exact command a Claude session would run.
- The next run refreshes an open entry in place, leaves an answered one alone unless the findings changed,
  and closes an entry as "Resolved" when the issue is gone.

How they appear: the mod reads every `*.json` in the folder when a Claude session starts (with a toast
"N decisions waiting on you") and re-reads it every 30 seconds in every running session, which updates
the "inbox: N open decisions" line above the prompt and the `/inbox` pane. Entries written by the sweep
do not trigger the desktop notification (that only fires for entries made through the tool in a session),
and answering one only records the answer in the file: no session is listening for it, so act on it
by asking Claude to run the command in the entry.

## Uninstall

```bash
systemctl disable --now security-sweep.timer
rm /etc/systemd/system/security-sweep.{service,timer} && systemctl daemon-reload
rm /etc/needrestart/conf.d/90-security-sweep-list-only.conf
rm -rf /opt/security-sweep
```
