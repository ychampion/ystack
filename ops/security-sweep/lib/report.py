#!/usr/bin/python3 -I
"""Turn one sweep's raw results into a Markdown report and decision-inbox entries.

usage: report.py --raw DIR --report FILE --state FILE [--inbox DIR ...]

Inbox entries follow the decision-inbox mod's Decision shape exactly:
  {id, question, options, recommended, context, isBlocking, sessionId, from, at, status[, answer]}
One entry per issue group. An open entry for the same group is refreshed in place; an answered
one is left alone unless the findings changed; a group that is gone is closed as resolved.
"""
import argparse
import glob
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import time

SEV_ORDER = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1, "UNKNOWN": 0}
OPT_QUIET = "Update during a quiet hour"
OPT_NOW = "Look into it with Claude now"
OPT_IGNORE = "Ignore for now"

try:
    import apt_pkg
    apt_pkg.init()
except Exception:  # noqa: BLE001 - report still works without python3-apt, minus host details
    apt_pkg = None


# ----------------------------------------------------------------------------- helpers
def load(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def text(path, default=""):
    try:
        with open(path, errors="replace") as f:
            return f.read()
    except OSError:
        return default


def deb_cmp(a, b):
    if apt_pkg:
        return apt_pkg.version_compare(a, b)
    return loose_cmp(a, b)


def _tok(v):
    out = []
    for t in re.findall(r"\d+|[A-Za-z]+", v or ""):
        out.append((1, int(t), "") if t.isdigit() else (0, 0, t.lower()))
    return out


def loose_cmp(a, b):
    ta, tb = _tok(a), _tok(b)
    return (ta > tb) - (ta < tb)


def cvss_level(score):
    try:
        s = float(score)
    except (TypeError, ValueError):
        return None
    if s >= 9:
        return "CRITICAL"
    if s >= 7:
        return "HIGH"
    if s >= 4:
        return "MEDIUM"
    if s > 0:
        return "LOW"
    return None


def norm(name):
    return re.sub(r"[-_.]+", "-", (name or "").lower())


def plural(n, word, many=None):
    return f"{n} {word if n == 1 else (many or word + 's')}"


def sev_phrase(c, h, kev=0):
    parts = []
    if c:
        parts.append(f"{c} critical")
    if h:
        parts.append(f"{h} high-severity")
    s = " and ".join(parts) + " known security " + ("hole" if c + h == 1 else "holes") if parts else "no critical or high-severity holes"
    if kev:
        s += f" ({kev} of them are being actively exploited by attackers right now)"
    return s


def short_list(items, n=5):
    items = list(items)
    return ", ".join(items[:n]) + (f" and {len(items) - n} more" if len(items) > n else "")


# Suggested commands are run by a Claude session, and their values come from repo paths, container
# labels and package names, which an image or a repo can control. Only plain values go into a command,
# each through shlex.quote; anything else is shown as data for a person to check.
SAFE_VALUE = re.compile(r"^[A-Za-z0-9._/@:+-]+$")


FIELD_NAMES = {"d": "compose folder name", "s": "compose service name", "proj": "project folder name",
               "osv": "scanner path", "pkgs": "package name", "svcs": "service name", "p": "package name",
               "img": "image name", "n": "package name", "v": "version"}


def shell_cmd(fmt, **vals):
    """Fill {name} placeholders in a constant template. List values are quoted item by item.
    Returns the command, or, when any value is not plain, a note naming the field (never echoing
    the value, which stays out of anything a session might run)."""
    bad, out = [], {}
    for k, v in vals.items():
        items = list(v) if isinstance(v, (list, tuple, set)) else [v]
        if any(not SAFE_VALUE.match(str(i)) for i in items):
            bad.append(FIELD_NAMES.get(k, k))
        out[k] = " ".join(shlex.quote(str(i)) for i in items)
    if bad:
        return "none suggested: the " + " and ".join(dict.fromkeys(bad)) + " has unusual characters; check it by hand"
    return fmt.format(**out)


def show(v):
    """A value for prose: as is when plain, otherwise repr'd and cut short so it reads as data."""
    v = str(v)
    return v if SAFE_VALUE.match(v) else repr(v)[:80]


def self_test():
    """python3 -I report.py --self-test : hostile labels and paths must never reach a command unquoted."""
    import tempfile
    hostile = ["x; rm -rf ~", "$(id)", "`id`", "a b", "x\nrm -rf /", "x|sh", "x&&y", "~/x", "x'y", 'x"y', "x>y", "*"]
    for h in hostile:
        r = shell_cmd("cd {d} && docker compose up -d {s}", d=h, s="web")
        assert r.startswith("none suggested") and h not in r, (h, r)
        r = shell_cmd("npm install -g {p}", p=["ok-pkg", h])
        assert r.startswith("none suggested") and h not in r, (h, r)
    assert shell_cmd("cd {d} && docker compose up -d {s}", d="/srv/app-1", s="web") == "cd /srv/app-1 && docker compose up -d web"
    assert shell_cmd("x {p}", p=["@scope/pkg", "a+b", "v1.2:3"]) == "x @scope/pkg a+b v1.2:3"
    for ok in ["/srv/app-1", "@scope/pkg", "a+b", "v1.2:3"]:
        assert shlex.quote(ok) == ok  # plain values need no quoting, so quoting never changes them
    # end to end: hostile compose labels and a hostile repo path must not appear in any inbox command
    with tempfile.TemporaryDirectory() as t:
        os.makedirs(f"{t}/raw/trivy-images")
        os.makedirs(f"{t}/raw/osv-repos")
        iid = "sha256:" + "a" * 64
        bad_dir, bad_svc, bad_repo = "/srv/x; rm -rf ~", "web$(id)", "/root/evil`id`"
        json.dump({"mode": "dry-run", "host": "t", "date": "2000-01-01", "home": "/opt/security-sweep"}, open(f"{t}/raw/meta.json", "w"))
        json.dump([{"id": "c1", "name": "c1", "image_id": iid, "image": "img:1", "state": "running", "restarting": False,
                    "project": "p", "service": bad_svc, "workdir": bad_dir}], open(f"{t}/raw/containers.json", "w"))
        json.dump({"Results": [{"Target": "t", "Vulnerabilities": [{"VulnerabilityID": "CVE-1", "PkgName": "openssl", "InstalledVersion": "1",
                                                                     "FixedVersion": "2", "Severity": "CRITICAL"}]}]},
                  open(f"{t}/raw/trivy-images/{'a' * 64}.json", "w"))
        open(f"{t}/raw/repos.txt", "w").write(bad_repo + "\n")
        json.dump({"results": [{"source": {"path": bad_repo + "/package-lock.json"}, "packages": [
            {"package": {"name": "lodash", "version": "1.0.0", "ecosystem": "npm"},
             "groups": [{"ids": ["GHSA-x"], "aliases": ["CVE-2"], "max_severity": "9.8"}],
             "vulnerabilities": [{"id": "GHSA-x", "affected": [{"package": {"name": "lodash"}, "ranges": [{"events": [{"introduced": "0"}, {"fixed": "4.17.21"}]}]}]}]}]}]},
                  open(f"{t}/raw/osv-repos/x.json", "w"))
        subprocess.run([sys.executable, "-I", os.path.abspath(__file__), "--raw", f"{t}/raw", "--report", f"{t}/r.md",
                        "--state", f"{t}/s.json", "--inbox", f"{t}/inbox"], check=True, capture_output=True)
        entries = [json.load(open(f)) for f in glob.glob(f"{t}/inbox/*.json")]
        assert {e["question"][:12] for e in entries}, "no inbox entries written"
        for e in entries:
            cmd = e["context"].split("Command for Claude:", 1)[-1]
            for h in (bad_dir, bad_svc, bad_repo):
                assert h not in cmd, (h, cmd)
            assert "rm -rf" not in cmd and "$(id)" not in cmd and "`id`" not in cmd, cmd
        assert any("unusual characters" in e["context"] for e in entries)
    print("self-test passed")


# ----------------------------------------------------------------------------- inputs
if "--self-test" in sys.argv:
    self_test()
    sys.exit(0)
ap = argparse.ArgumentParser()
ap.add_argument("--raw", required=True)
ap.add_argument("--report", required=True)
ap.add_argument("--state", required=True)
ap.add_argument("--inbox", action="append", default=[])
args = ap.parse_args()
R = args.raw

meta = load(f"{R}/meta.json", {})
DRY = meta.get("mode") != "apply"
HOME = meta.get("home", "")
kev_ids = {v.get("cveID") for v in (load(f"{R}/kev.json", {}) or {}).get("vulnerabilities", [])}
errors = [ln.split("\t", 1) for ln in text(f"{R}/errors.txt").splitlines() if "\t" in ln]


def is_kev(*ids):
    return any(i in kev_ids for i in ids if i)


# ----------------------------------------------------------------------------- OS
aptj = load(f"{R}/apt.json")
os_ran = aptj is not None
sec = (aptj or {}).get("security", [])
other = (aptj or {}).get("other", [])
held = [p for p in sec if p["held"]]
applyable = [p for p in sec if not p["held"]]
uu_log = text(f"{R}/uu.log")
uu_mode = text(f"{R}/uu-mode.txt").strip()
m = re.findall(r"Packages that will be upgraded: (.*)", uu_log)
uu_pkgs = m[-1].split() if m else []
uu_kept = re.findall(r"Packages with upgradable origin but kept back:\s*(.*)", uu_log)
applied = (not DRY) and uu_mode == "applied" and "All upgrades installed" in uu_log
reboot_lines = text(f"{R}/reboot.txt").split()
reboot_required = bool(reboot_lines) and reboot_lines[0] == "required"
reboot_pkgs = reboot_lines[1:] if reboot_required else []
nr = text(f"{R}/needrestart.txt")
k_cur = (re.search(r"NEEDRESTART-KCUR: (\S+)", nr) or [None, ""])[1]
k_exp = (re.search(r"NEEDRESTART-KEXP: (\S+)", nr) or [None, ""])[1]
k_sta = (re.search(r"NEEDRESTART-KSTA: (\d)", nr) or [None, "0"])[1]
svc_restart = sorted(set(re.findall(r"NEEDRESTART-SVC: (\S+)", nr)))
nr_mode = text(f"{R}/needrestart-mode.txt").strip()
daily = text(f"{R}/daily.txt")
periodic = (re.search(r"periodic_unattended=(\S*)", daily) or [None, ""])[1]
daily_restarts = {}
for d, svcs in re.findall(r"^restarted (\S+) (.*)$", daily, re.M):
    for s in svcs.split():
        daily_restarts.setdefault(s, set()).add(d)

# host package vulnerabilities (trivy on a copy of the dpkg database)
host = load(f"{R}/host-trivy.json")
host_vulns = []
for res in (host or {}).get("Results", []) or []:
    host_vulns += res.get("Vulnerabilities", []) or []

installed_now = {}
candidates = {}
newest_image = None
if apt_pkg and os_ran:
    try:
        import apt  # noqa: E402
        cache = apt.Cache()
        for p in cache:
            if p.is_installed:
                installed_now[p.shortname] = p.installed.version
                if p.candidate:
                    candidates[p.shortname] = p.candidate.version
        for name, ver in installed_now.items():
            if re.match(r"linux-image-\d", name) and (newest_image is None or deb_cmp(ver, newest_image) > 0):
                newest_image = ver
    except Exception:  # noqa: BLE001
        pass
running_abi = re.sub(r"-[a-z]+$", "", meta.get("kernel", ""))  # 6.8.0-138-generic -> 6.8.0-138
KERNEL_PKG = re.compile(r"^linux-(image|modules|modules-extra|headers|tools|cloud-tools|buildinfo|objects|signatures|lib-rust)(-unsigned)?-(\d+\.\d+\.\d+-\d+)")
sec_names = {p["name"]: p for p in sec}

kernel_reboot, kernel_newer, host_pending, host_nofix, host_fixed_now = {}, {}, {}, {}, {}
for v in host_vulns:
    pkg, inst, fixed, vid, sev = v.get("PkgName", ""), v.get("InstalledVersion", ""), v.get("FixedVersion", ""), v.get("VulnerabilityID", ""), v.get("Severity", "UNKNOWN")
    fixed_first = fixed.split(",")[0].strip()
    rec = {"id": vid, "sev": sev, "pkg": pkg, "installed": inst, "fixed": fixed_first, "title": v.get("Title", ""), "kev": is_kev(vid)}
    km = KERNEL_PKG.match(pkg)
    if km:
        if km.group(3) != running_abi:
            continue  # package for a kernel that is not running: not exploitable, ignore
        if newest_image and deb_cmp(newest_image, fixed_first) >= 0:
            kernel_reboot.setdefault(vid, rec)
        else:
            kernel_newer.setdefault(vid, rec)
        continue
    now = installed_now.get(pkg)
    if now and fixed_first and deb_cmp(now, fixed_first) >= 0:
        host_fixed_now.setdefault(vid, rec)  # fixed by this run's updates
    elif pkg in sec_names or (candidates.get(pkg) and fixed_first and deb_cmp(candidates[pkg], fixed_first) >= 0):
        host_pending.setdefault(vid, rec)
    else:
        host_nofix.setdefault(vid, rec)


def count(recs):
    c = sum(1 for r in recs if r["sev"] == "CRITICAL")
    h = sum(1 for r in recs if r["sev"] == "HIGH")
    k = sum(1 for r in recs if r["kev"])
    return c, h, k


# per-package severity for pending security updates
pkg_sev = {}
for r in list(host_pending.values()) + list(host_fixed_now.values()):
    if SEV_ORDER[r["sev"]] > SEV_ORDER.get(pkg_sev.get(r["pkg"], ("UNKNOWN", 0))[0], 0):
        pkg_sev[r["pkg"]] = (r["sev"], r["kev"])


# ----------------------------------------------------------------------------- OSV (repos + globals)
def osv_findings(files):
    """Return {source_path: [finding]}; finding = dict(pkg, version, eco, sev, ids, fixed, kev, summary)."""
    out = {}
    for f in files:
        data = load(f, {}) or {}
        for res in data.get("results", []) or []:
            src = (res.get("source") or {}).get("path", "?")
            if src in out:
                continue  # nested repos get scanned twice; keep the first
            items = []
            for p in res.get("packages", []) or []:
                pk = p.get("package", {})
                name, ver, eco = pk.get("name", ""), pk.get("version", ""), pk.get("ecosystem", "")
                vulns = {v.get("id"): v for v in p.get("vulnerabilities", []) or []}
                for g in p.get("groups", []) or []:
                    ids = g.get("ids", [])
                    aliases = set(g.get("aliases", []) or []) | set(ids)
                    sev = cvss_level(g.get("max_severity"))
                    if not sev:
                        for i in ids:
                            ds = (vulns.get(i, {}).get("database_specific") or {}).get("severity", "")
                            ds = {"MODERATE": "MEDIUM"}.get(str(ds).upper(), str(ds).upper())
                            if ds in SEV_ORDER and SEV_ORDER[ds] > SEV_ORDER.get(sev or "UNKNOWN", 0):
                                sev = ds
                    sev = sev or "UNKNOWN"
                    fixes = []
                    for i in ids:
                        for aff in vulns.get(i, {}).get("affected", []) or []:
                            if norm(aff.get("package", {}).get("name")) != norm(name):
                                continue
                            for rg in aff.get("ranges", []) or []:
                                intro = "0"
                                for ev in rg.get("events", []) or []:
                                    if "introduced" in ev:
                                        intro = ev["introduced"]
                                    if "fixed" in ev:
                                        fx = ev["fixed"]
                                        if (intro == "0" or loose_cmp(ver, intro) >= 0) and loose_cmp(ver, fx) < 0:
                                            fixes.append(fx)
                    fixed = min(fixes, key=_tok) if fixes else ""
                    summary = next((vulns[i].get("summary", "") for i in ids if vulns.get(i, {}).get("summary")), "")
                    items.append({"pkg": name, "version": ver, "eco": eco, "sev": sev, "ids": sorted(aliases),
                                  "fixed": fixed, "kev": is_kev(*aliases), "summary": summary})
            out[src] = items
    return out


repo_files = sorted(glob.glob(f"{R}/osv-repos/*.json"))
repos_ran = os.path.isdir(f"{R}/osv-repos")
repo_list = [ln for ln in text(f"{R}/repos.txt").splitlines() if ln]
groups = {}
for ln in text(f"{R}/repo-groups.tsv").splitlines():
    if "\t" in ln:
        r, g = ln.split("\t", 1)
        groups[r] = g
repo_find = osv_findings(repo_files)


def owner_repo(path):
    best = ""
    for r in repo_list:
        if (path == r or path.startswith(r + "/")) and len(r) > len(best):
            best = r
    return best or os.path.dirname(path)


def project_of(repo):
    g = groups.get(repo, repo)
    return g[:-5] if g.endswith("/.git") else g


projects = {}   # project -> {"repos": set, "findings": {key: finding}}
uniq = {}       # key -> finding + projects
for src, items in repo_find.items():
    if not items:
        continue
    repo = owner_repo(src)
    proj = project_of(repo)
    pr = projects.setdefault(proj, {"repos": set(), "findings": {}, "lockfiles": set()})
    pr["repos"].add(repo)
    pr["lockfiles"].add(src)
    for it in items:
        key = f'{it["eco"]}|{it["pkg"]}|{it["version"]}|{it["ids"][0] if it["ids"] else ""}'
        pr["findings"][key] = it
        u = uniq.setdefault(key, dict(it, projects=set(), example=src))
        u["projects"].add(proj)


def counts_of(findings):
    c = sum(1 for f in findings if f["sev"] == "CRITICAL")
    h = sum(1 for f in findings if f["sev"] == "HIGH")
    k = sum(1 for f in findings if f["kev"])
    return c, h, k


# ----------------------------------------------------------------------------- docker
containers = load(f"{R}/containers.json")
missing_images = set(text(f"{R}/images-missing.txt").split())
docker_ran = containers is not None
images = {}
for c in containers or []:
    im = images.setdefault(c["image_id"], {"names": set(), "containers": [], "vulns": {}, "scanned": False})
    im["names"].add(c["image"])
    im["containers"].append(c)
for iid, im in images.items():
    d = load(f'{R}/trivy-images/{iid.replace("sha256:", "")}.json')
    if d is None:
        continue
    im["scanned"] = True
    im["os"] = ((d.get("Metadata") or {}).get("OS") or {})
    for res in d.get("Results", []) or []:
        for v in res.get("Vulnerabilities", []) or []:
            key = (v.get("VulnerabilityID"), v.get("PkgName"), v.get("InstalledVersion"))
            im["vulns"][key] = {"id": v.get("VulnerabilityID"), "pkg": v.get("PkgName"), "version": v.get("InstalledVersion"),
                                "fixed": v.get("FixedVersion", ""), "sev": v.get("Severity", "UNKNOWN"),
                                "kev": is_kev(v.get("VulnerabilityID")), "target": res.get("Target", ""), "title": v.get("Title", "")}

# ----------------------------------------------------------------------------- globals
glob_inv = load(f"{R}/globals.json")
globals_ran = glob_inv is not None
glob_find = osv_findings(sorted(glob.glob(f"{R}/osv-globals/*.json")))
npm_lock = load(f"{R}/osv-globals/npm-global.lock", {}) or {}


def npm_owner(name, version):
    for key, v in (npm_lock.get("packages") or {}).items():
        if v.get("name") == name and v.get("version") == version:
            m2 = re.match(r"(?:r\d+/)?node_modules/((?:@[^/]+/)?[^/]+)", key)
            if m2:
                return m2.group(1)
    return name


glob_items = []
for src, items in glob_find.items():
    kind = "npm" if "package-lock" in src else ("pip" if "requirements" in src else "bun")
    for it in items:
        glob_items.append(dict(it, kind=kind, owner=npm_owner(it["pkg"], it["version"]) if kind == "npm" else it["pkg"]))
runtimes = (glob_inv or {}).get("runtimes", {})
runtime_notes = []
nd = runtimes.get("node", {})
if nd.get("apt_candidate") and nd.get("apt_installed") and nd["apt_candidate"] != nd["apt_installed"]:
    runtime_notes.append(("node", nd["apt_installed"], nd["apt_candidate"], "apt-get install --only-upgrade -y nodejs"))
bn = runtimes.get("bun", {})
if bn.get("latest") and bn.get("version") and loose_cmp(bn["latest"], bn["version"]) > 0:
    runtime_notes.append(("bun", bn["version"], bn["latest"], "bun upgrade"))

# ----------------------------------------------------------------------------- issue groups
issues = []   # dict(key, stage, question, options, recommended, context, blocking, fingerprint)


def fp(items):
    return hashlib.sha1("\n".join(sorted(set(items))).encode()).hexdigest()[:16]


def add(key, stage, question, options, recommended, context, blocking, fingerprint_items):
    issues.append({"key": key, "stage": stage, "question": question, "options": options, "recommended": recommended,
                   "context": context, "blocking": blocking, "fingerprint": fp(fingerprint_items)})


SW = f"{HOME}/bin" if HOME else "bin"

if held:
    hold_c = sum(1 for p in held if pkg_sev.get(p["name"], ("",))[0] == "CRITICAL")
    hold_h = sum(1 for p in held if pkg_sev.get(p["name"], ("",))[0] == "HIGH")
    hold_k = sum(1 for p in held if pkg_sev.get(p["name"], ("", False))[1])
    why = "; ".join(f'{p["name"]} ({p["hold_reasons"][0]})' for p in held[:5]) + (f"; and {len(held) - 5} more" if len(held) > 5 else "")
    sevtxt = f"The most serious fixes in them: {sev_phrase(hold_c, hold_h, hold_k)}." if hold_c + hold_h else "None of them is rated critical or high by the scanner."
    add("os-held", "os",
        f"Install {plural(len(held), 'held-back security update')} for the server, even though installing restarts running services?",
        [OPT_QUIET, OPT_NOW, OPT_IGNORE], OPT_QUIET,
        ("(Dry run: nothing was installed.) " if DRY else "")
        + f"{plural(len(held), 'security update')} for the server's own software {'were' if len(held) != 1 else 'was'} not installed automatically, "
        f"because installing restarts something that is running: {why}. {sevtxt} "
        "Answering here only records your choice; a Claude session does the work. "
        "Command for Claude: " + shell_cmd("sudo NEEDRESTART_MODE=l apt-get install --only-upgrade -y {pkgs}", pkgs=[p["name"] for p in held]),
        bool(hold_c or hold_k), [f'{p["name"]}={p["security_version"]}' for p in held])

kr = list(kernel_reboot.values())
kc, kh, kk = count(kr)
if reboot_required or svc_restart or k_sta in ("2", "3"):
    bits = []
    if k_sta in ("2", "3") and k_cur and k_exp:
        bits.append(f"The server is still running the old system core (kernel {k_cur}) although a newer one ({k_exp}) is installed")
        if kr:
            bits[-1] += f"; a restart activates fixes for {sev_phrase(kc, kh, kk)} in it"
    elif reboot_required:
        bits.append(f"Ubuntu says a restart is needed for: {short_list(reboot_pkgs, 4)}")
    if svc_restart:
        bits.append(f"These services still run old code: {short_list(svc_restart, 6)}"
                    + (" (restarting Docker restarts every container)" if any(s.startswith("docker") for s in svc_restart) else ""))
    opts = (["Reboot during a quiet hour", "Restart only the listed services during a quiet hour", OPT_IGNORE] if (reboot_required or k_sta in ("2", "3"))
            else ["Restart the listed services during a quiet hour", OPT_NOW, OPT_IGNORE])
    cmd = "sudo systemctl reboot" if opts[0].startswith("Reboot") else ""
    if svc_restart:
        svc_cmd = shell_cmd("sudo systemctl restart {svcs}", svcs=svc_restart)
        cmd = f"{cmd} (services only: {svc_cmd})" if cmd else svc_cmd
    add("restart-pending", "os",
        "Restart the server during a quiet hour so already-installed security fixes take effect?" if opts[0].startswith("Reboot")
        else "Restart some services during a quiet hour so already-installed security fixes take effect?",
        opts, opts[0],
        ". ".join(bits) + ". A reboot takes the whole machine down for a few minutes: every container restarts and live Claude sessions are interrupted. "
        f"The sweep never restarts anything itself. Command for Claude: {cmd}",
        bool(kc or kk), [f"k:{k_cur}>{k_exp}"] + [f"s:{s}" for s in svc_restart] + [f"r:{p}" for p in reboot_pkgs])

if periodic not in ("", "0"):
    seen = sorted(daily_restarts, key=lambda s: -len(daily_restarts[s]))
    restarted = (f" Its logs show it restarted {short_list(seen, 6)} on its own." if seen else "")
    add("daily-auto-updates", "os",
        "Turn off Ubuntu's own daily automatic updates, which can restart running services, and rely on this weekly no-restart sweep instead?",
        ["Turn off the daily job; keep the weekly sweep", "Keep the daily job as it is", OPT_NOW], "Turn off the daily job; keep the weekly sweep",
        "Besides this weekly sweep, Ubuntu's built-in job installs security updates every morning without checking what is running." + restarted
        + " Its restart helper is now set to only list restarts, but package install scripts still restart their own service (for example ssh or cron; "
        "a Docker update would restart every container). Turning it off means fixes arrive weekly, without restarts, instead of daily. "
        "Command for Claude: echo 'APT::Periodic::Unattended-Upgrade \"0\";' | sudo tee /etc/apt/apt.conf.d/99-security-sweep-no-daily-install",
        False, [f"periodic={periodic}"])

nofix = list(host_nofix.values())
if nofix:
    nc, nh, nk = count(nofix)
    pkgs = sorted({r["pkg"] for r in nofix})
    pro_on = False
    if os.path.exists("/usr/bin/pro"):
        try:
            pro_on = bool(json.loads(subprocess.run(["pro", "status", "--format", "json"], capture_output=True, text=True,
                                                    timeout=60, check=False).stdout).get("attached"))
        except (ValueError, OSError, subprocess.TimeoutExpired):
            pro_on = False
    if not pro_on:
        add("ubuntu-pro", "os",
            "Turn on Ubuntu Pro so the server can get security fixes that plain Ubuntu does not ship?",
            ["Turn on free Ubuntu Pro (personal use, up to 5 machines)", OPT_NOW, OPT_IGNORE], OPT_NOW,
            f"{plural(len(pkgs), 'installed package')} ({short_list(pkgs, 5)}) {'have' if len(pkgs) != 1 else 'has'} {sev_phrase(nc, nh, nk)} "
            "with fixes published by Ubuntu, but those fixes are not in this server's update sources; for community packages they come only through Ubuntu Pro. "
            "Pro is free for personal use on up to 5 machines and paid for companies. "
            "Command for Claude: sudo pro attach <token from ubuntu.com/pro/dashboard>, then run the sweep again",
            bool(nk), [r["id"] for r in nofix])

if projects:
    pc, ph, pk = counts_of(list(uniq.values()))
    worst = sorted(uniq.values(), key=lambda u: (-SEV_ORDER[u["sev"]], -int(u["kev"]), -len(u["projects"]), u["pkg"]))
    top = []
    seenp = set()
    for u in worst:
        k = (u["pkg"], u["version"])
        if k in seenp:
            continue
        seenp.add(k)
        top.append(f'{u["pkg"]} {u["version"]} -> {u["fixed"] or "no fix yet"} ({u["sev"].lower()}, {plural(len(u["projects"]), "project")})')
        if len(top) == 4:
            break
    worst_proj = max(projects.items(), key=lambda kv: (counts_of(kv[1]["findings"].values())[:2], len(kv[1]["findings"])))[0]
    add("repos", "repos",
        f"{plural(len(projects), 'code project')} on the server use libraries with known security holes. How do you want to handle them?",
        [OPT_NOW, "Fix each one in its next planned piece of work", OPT_IGNORE],
        OPT_NOW if (pc or pk) else "Fix each one in its next planned piece of work",
        f"Across {plural(len(projects), 'project')} there are {len(uniq)} distinct library problems: {sev_phrase(pc, ph, pk)}. "
        f"Worst: {'; '.join(top)}. Most affected project: {show(worst_proj)}. "
        "Nothing was changed; updating a library can break a project, so each one needs its tests run after the update. "
        "Command for Claude: " + shell_cmd("cd {proj} && {osv} scan source -r .", proj=worst_proj, osv=f"{SW}/osv-scanner")
        + " (then raise each listed library to its fixed version and run the tests)",
        bool(pc or pk), list(uniq.keys()))

vuln_images = {iid: im for iid, im in images.items() if im["vulns"]}
if vuln_images:
    allv = [v for im in vuln_images.values() for v in im["vulns"].values()]
    ic, ih, ik = count(allv)
    ranked = sorted(vuln_images.items(), key=lambda kv: (-count(kv[1]["vulns"].values())[0], -len(kv[1]["vulns"])))
    lines, cmds = [], []
    for iid, im in ranked[:4]:
        c, h, _ = count(im["vulns"].values())
        nm = sorted(im["names"])[0]
        lines.append(f"{show(nm)} ({c} critical, {h} high; used by {short_list(sorted(show(x['name']) for x in im['containers']), 3)})")
    for iid, im in ranked[:3]:
        ct = im["containers"][0]
        if ct.get("workdir") and ct.get("service"):
            cmds.append(shell_cmd("cd {d} && docker compose build --pull {s} && docker compose up -d {s}", d=ct["workdir"], s=ct["service"])
                        + " (use docker compose pull instead of build for a pulled image)")
        else:
            cmds.append(shell_cmd("docker pull {img}", img=sorted(im["names"])[0])
                        + ", then recreate the container " + show(ct["name"]))
    add("images", "docker",
        f"{plural(len(vuln_images), 'Docker image')} used by running apps {'have' if len(vuln_images) != 1 else 'has'} known security holes with fixes available. When should they be rebuilt?",
        ["Rebuild the affected images during a quiet hour", OPT_NOW, OPT_IGNORE],
        OPT_NOW if (ic or ik) else "Rebuild the affected images during a quiet hour",
        f"{plural(len(vuln_images), 'image')} used by running containers {'contain' if len(vuln_images) != 1 else 'contains'} {sev_phrase(ic, ih, ik)} that already have fixes. "
        f"Worst: {'; '.join(lines)}. Fixing means rebuilding each image on updated parts and recreating its containers, a short outage for that app; nothing was changed. "
        f"Command for Claude: {' ; '.join(cmds)}",
        bool(ic or ik), [f"{iid}|{k[0]}|{k[1]}" for iid, im in vuln_images.items() for k in im["vulns"]])

if glob_items or runtime_notes:
    gc, gh, gk = counts_of(glob_items)
    owners = {}
    for it in glob_items:
        owners.setdefault((it["kind"], it["owner"]), []).append(it)
    descr, cmds = [], []
    for (kind, owner), its in sorted(owners.items(), key=lambda kv: -max(SEV_ORDER[i["sev"]] for i in kv[1])):
        fx = sorted({i["fixed"] for i in its if i["fixed"] and i["pkg"] == owner}, key=_tok)
        descr.append(f"{owner} ({kind}, {plural(len(its), 'issue')}{', fixed in ' + fx[-1] if fx else ''})")
        if kind == "npm":
            cmds.append(shell_cmd("sudo npm install -g {p}", p=f"{owner}@latest"))
        elif kind == "pip":
            # validate name and version separately; the composed spec contains '>=' and is then quoted
            chk = shell_cmd("{n} {v}", n=owner, v=fx[-1]) if fx else shell_cmd("{n}", n=owner)
            cmds.append(chk if chk.startswith("none suggested") else
                        "sudo pip install --break-system-packages -U " + shlex.quote(f"{owner}>={fx[-1]}" if fx else owner))
        else:
            cmds.append(shell_cmd("bun add -g {p}", p=f"{owner}@latest"))
    for name, cur, new, cmd in runtime_notes:
        descr.append(f"{name} {cur} (newer: {new})")
        cmds.append(f"sudo {cmd}" if cmd.startswith("apt") else cmd)
    if glob_items or runtime_notes:
        add("globals", "globals",
            "Update the command-line tools installed for everyone on the server?",
            [OPT_QUIET, OPT_NOW, OPT_IGNORE], OPT_NOW if (gc or gk) else OPT_QUIET,
            (f"Shared tools have {sev_phrase(gc, gh, gk)}: " if glob_items else "Shared tools have updates: ")
            + short_list(descr, 6) + ". Updating can change how these tools behave for running jobs. "
            f"Command for Claude: {' ; '.join(cmds[:6])}",
            bool(gc or gk), [f'{i["owner"]}|{i["ids"][0] if i["ids"] else ""}' for i in glob_items] + [f"{n}>{v}" for n, _, v, _ in runtime_notes])

if errors:
    add("sweep-problems", "always",
        "The weekly security sweep could not check everything. Look into why?",
        [OPT_NOW, OPT_IGNORE], OPT_NOW,
        "Parts of the sweep failed, so this week's picture is incomplete: " + "; ".join(f"{a}: {b}" for a, b in errors[:4])
        + f". Command for Claude: journalctl -u security-sweep --since -2d --no-pager | tail -100",
        False, [f"{a}:{b}" for a, b in errors])

# ----------------------------------------------------------------------------- inbox
stage_ok = {"os": os_ran, "repos": repos_ran, "docker": docker_ran, "globals": globals_ran, "always": True}
state = load(args.state, {}) or {}
now_ms = int(time.time() * 1000)
inbox_log = []


def b36(n):
    s, a = "", "0123456789abcdefghijklmnopqrstuvwxyz"
    while n:
        n, r = divmod(n, 36)
        s = a[r] + s
    return s or "0"


def write_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f)
    os.replace(tmp, path)


for d in args.inbox:
    os.makedirs(d, exist_ok=True)
    st = state.setdefault(d, {})
    raised = set()
    stamp = now_ms
    for it in issues:
        raised.add(it["key"])
        prev = st.get(it["key"])
        prev_doc = load(f'{d}/{prev["id"]}.json') if prev else None
        if prev_doc and prev_doc.get("status") == "answered" and prev.get("fingerprint") == it["fingerprint"] and not str(prev_doc.get("answer", "")).startswith("Resolved:"):
            inbox_log.append(f'{it["key"]}: unchanged since you answered "{prev_doc.get("answer")}" ({prev["id"]}); not re-raised')
            continue
        if prev_doc and prev_doc.get("status") == "open":
            did = prev["id"]
            at = prev_doc.get("at", stamp)
        else:
            while True:
                did = f"D-{b36(stamp)[-5:]}"
                stamp += 1
                if not os.path.exists(f"{d}/{did}.json"):
                    break
            at = now_ms
        doc = {"id": did, "question": it["question"], "options": it["options"], "recommended": it["recommended"],
               "context": it["context"], "isBlocking": it["blocking"], "sessionId": "security-sweep",
               "from": f"security sweep ({meta.get('host', 'server')}, {meta.get('date', '')}{', dry run' if DRY else ''})",
               "at": at, "status": "open"}
        write_json(f"{d}/{did}.json", doc)
        st[it["key"]] = {"id": did, "fingerprint": it["fingerprint"], "stage": it["stage"]}
        inbox_log.append(f'{it["key"]}: {"refreshed" if prev_doc and prev_doc.get("status") == "open" else "new"} {did}{" (blocking)" if it["blocking"] else ""}')
    for key, prev in list(st.items()):
        if key in raised or not stage_ok.get(prev.get("stage", "always"), False):
            continue
        doc = load(f'{d}/{prev["id"]}.json')
        if doc and doc.get("status") == "open":
            doc.update(status="answered", answer=f"Resolved: the {meta.get('date', '')} sweep no longer found this")
            write_json(f'{d}/{prev["id"]}.json', doc)
            inbox_log.append(f'{key}: resolved, closed {prev["id"]}')
        del st[key]
if args.inbox:
    os.makedirs(os.path.dirname(args.state), exist_ok=True)
    write_json(args.state, state)

# ----------------------------------------------------------------------------- report
L = []
w = L.append
w(f"# Security sweep: {meta.get('host', '')}, {meta.get('date', '')}{' (DRY RUN: nothing was installed)' if DRY else ''}")
w("")
w(f"Run `{meta.get('run_id', '')}`, mode **{meta.get('mode', '')}**. Disk free {meta.get('disk_free_mb', '?')} MB ({meta.get('disk_use_pct', '?')} used), "
  f"memory available {meta.get('mem_avail_mb', '?')} MB. trivy {meta.get('trivy', '?')}, osv-scanner {meta.get('osv_scanner', '?')}. "
  f"CISA known-exploited list: {len(kev_ids)} entries.")
w("")
w("## Summary")
w("")
w("| Area | Critical | High | Actively exploited | Notes |")
w("|---|---|---|---|---|")
if os_ran:
    hp = list(host_pending.values())
    c1, h1, k1 = count(hp)
    w(f"| Ubuntu packages: pending security updates | {c1} | {h1} | {k1} | {len(sec)} pending, {len(applyable)} {'would be' if DRY else 'were'} applied, {len(held)} held back |")
    w(f"| Ubuntu: kernel fixes waiting for a reboot | {kc} | {kh} | {kk} | running {k_cur or meta.get('kernel')}, installed {k_exp or '?'} |")
    c2, h2, k2 = count(nofix)
    w(f"| Ubuntu: fixes not in your update sources | {c2} | {h2} | {k2} | {len({r['pkg'] for r in nofix})} packages |")
if repos_ran:
    pc, ph, pk = counts_of(list(uniq.values()))
    w(f"| Code repos (distinct issues) | {pc} | {ph} | {pk} | {len(repo_list)} repos, {len(projects)} projects with issues |")
if docker_ran:
    allv = [v for im in images.values() for v in im["vulns"].values()]
    ic, ih, ik = count(allv)
    w(f"| Container images (fix available) | {ic} | {ih} | {ik} | {len(images)} images, {sum(1 for i in images.values() if i['scanned'])} scanned |")
if globals_ran:
    gc, gh, gk = counts_of(glob_items)
    w(f"| Global CLIs | {gc} | {gh} | {gk} | {glob_inv.get('npm_count', 0)} npm, {glob_inv.get('pip_count', 0)} pip packages |")
w("")
w("## Needs the owner (decision inbox)")
w("")
if issues:
    for it in issues:
        w(f"- {'**[blocking]** ' if it['blocking'] else ''}**{it['question']}** Recommended: {it['recommended']}.  ")
        w(f"  {it['context']}")
else:
    w("- Nothing this week.")
if inbox_log:
    w("")
    w("Inbox actions: " + "; ".join(inbox_log))
w("")

if os_ran:
    w("## 1. Ubuntu packages")
    w("")
    w(f"- needrestart restart mode: `{nr_mode}` ({'list only, good' if nr_mode == 'l' else 'NOT list-only: updates are not applied until this is fixed'}).")
    w(f"- unattended-upgrades: {'applied' if applied else ('simulated (' + uu_mode + ')' if uu_mode and uu_mode != 'applied' else 'ran')}; packages: {' '.join(uu_pkgs) or 'none'}.")
    if uu_kept:
        w(f"- kept back by unattended-upgrades: {uu_kept[-1]}")
    if sec:
        w("")
        w("| Package | Installed | Security version | Severity | Action |")
        w("|---|---|---|---|---|")
        for p in sec:
            s = pkg_sev.get(p["name"], ("", False))
            act = "held: " + "; ".join(p["hold_reasons"]) if p["held"] else ("would apply" if DRY else ("applied" if p["name"] in uu_pkgs and applied else "apply attempted"))
            w(f"| {p['name']} | {p['installed']} | {p['security_version']} | {(s[0] or '-').lower()}{' (exploited)' if s[1] else ''} | {act} |")
    else:
        w("- No pending security updates.")
    w("")
    w(f"- Reboot required: **{'yes' if reboot_required else 'no'}**{' (' + short_list(reboot_pkgs, 8) + ')' if reboot_pkgs else ''}. "
      f"Kernel running {k_cur or meta.get('kernel')}, newest installed {k_exp or newest_image or '?'}.")
    if kr:
        w(f"- Kernel issues a reboot would fix: {kc} critical, {kh} high. Examples: "
          + ", ".join(f"{r['id']} ({r['sev'].lower()})" for r in sorted(kr, key=lambda r: (-SEV_ORDER[r['sev']], r['id']))[:6]) + ".")
    if kernel_newer:
        c3, h3, _ = count(kernel_newer.values())
        w(f"- Kernel issues fixed only in a kernel newer than the installed one: {c3} critical, {h3} high.")
    w(f"- Services still running old code (needrestart): {', '.join(svc_restart) or 'none'}.")
    w(f"- Ubuntu's own daily auto-install (APT::Periodic::Unattended-Upgrade): `{periodic or 'unset'}`."
      + (f" Restarts it did, from its logs: " + "; ".join(f"{s} ({', '.join(sorted(d))})" for s, d in sorted(daily_restarts.items())) if daily_restarts else ""))
    if nofix:
        w(f"- High/critical fixes not available from the configured sources ({len(nofix)}):")
        for r in sorted(nofix, key=lambda r: (-SEV_ORDER[r['sev']], r['pkg']))[:15]:
            w(f"  - {r['sev'].lower()}: {r['pkg']} {r['installed']} -> {r['fixed']} ({r['id']}){' EXPLOITED' if r['kev'] else ''}")
    if host_fixed_now:
        c4, h4, _ = count(host_fixed_now.values())
        w(f"- Fixed by this run's updates: {c4} critical, {h4} high.")
    by_origin = {}
    for p in other:
        by_origin.setdefault(f"{p['origin'] or '?'}/{p['archive'] or '?'}", []).append(p)
    if by_origin:
        w("- Other pending updates, not security-pocket, **not applied**: " + "; ".join(
            f"{k}: {len(v)}" + (f" ({short_list([x['name'] + ' ' + str(x['candidate']) for x in v], 4)})" if not k.startswith("Ubuntu/") else "")
            for k, v in sorted(by_origin.items())))
    w("")

if repos_ran:
    w("## 2. Code repositories")
    w("")
    w(f"{len(repo_list)} git repos found; {len([s for s in repo_find if repo_find[s]])} lockfiles with vulnerable packages across {len(projects)} projects (worktrees grouped). Nothing was changed.")
    w("")
    if uniq:
        w("| Severity | Package | Version | Ecosystem | Fixed in | Projects | Advisory | Example lockfile |")
        w("|---|---|---|---|---|---|---|---|")
        for u in sorted(uniq.values(), key=lambda u: (-SEV_ORDER[u["sev"]], -int(u["kev"]), -len(u["projects"]), u["pkg"]))[:40]:
            adv = next((i for i in u["ids"] if i.startswith("CVE-")), u["ids"][0] if u["ids"] else "")
            w(f"| {u['sev'].lower()}{' EXPLOITED' if u['kev'] else ''} | {u['pkg']} | {u['version']} | {u['eco']} | {u['fixed'] or 'no fix yet'} | {len(u['projects'])} | {adv} | {u['example']} |")
        if len(uniq) > 40:
            w(f"\n...and {len(uniq) - 40} more distinct issues (full data in the run archive).")
        w("")
        w("| Project | Critical | High | Other | Checkouts |")
        w("|---|---|---|---|---|")
        for proj, pr in sorted(projects.items(), key=lambda kv: (-counts_of(kv[1]["findings"].values())[0], -counts_of(kv[1]["findings"].values())[1], kv[0]))[:30]:
            c, h, _ = counts_of(pr["findings"].values())
            w(f"| {proj} | {c} | {h} | {len(pr['findings']) - c - h} | {len(pr['repos'])} |")
        if len(projects) > 30:
            w(f"\n...and {len(projects) - 30} more projects.")
    w("")

if docker_ran:
    w("## 3. Images of running containers (HIGH/CRITICAL with a fix)")
    w("")
    if images:
        w("| Image | Containers | Critical | High | Exploited | Worst packages |")
        w("|---|---|---|---|---|---|")
        for iid, im in sorted(images.items(), key=lambda kv: (-count(kv[1]["vulns"].values())[0], -len(kv[1]["vulns"]))):
            c, h, k = count(im["vulns"].values())
            worst = sorted(im["vulns"].values(), key=lambda v: (-SEV_ORDER[v["sev"]], v["pkg"]))
            wp = short_list(sorted({f"{v['pkg']} {v['version']}->{v['fixed']}" for v in worst[:12]}), 3) if worst else ""
            status = "" if im["scanned"] else (" (image no longer exists locally; not scanned)" if iid in missing_images else " (not scanned)")
            w(f"| {', '.join(sorted(im['names']))} `{iid[7:19]}`{status} | {short_list(sorted(x['name'] for x in im['containers']), 3)} | {c} | {h} | {k} | {wp} |")
    else:
        w("No running containers.")
    w("")

if globals_ran:
    w("## 4. Global CLIs")
    w("")
    w("Runtimes: " + ", ".join(f"{k} {v.get('version')}" + (f" (latest {v['latest']})" if v.get("latest") else "") + (f" (apt candidate {v['apt_candidate']})" if v.get("apt_candidate") and v.get("apt_candidate") != v.get("apt_installed") else "") for k, v in runtimes.items()) + ".")
    w("Top-level npm globals: " + ", ".join(f"{p['name']} {p['version']}" for p in glob_inv.get("npm_top", [])) + ".")
    w("")
    if glob_items:
        w("| Severity | Package | Version | Kind | Comes with | Fixed in | Advisory |")
        w("|---|---|---|---|---|---|---|")
        for it in sorted(glob_items, key=lambda i: (-SEV_ORDER[i["sev"]], i["pkg"]))[:30]:
            adv = next((i for i in it["ids"] if i.startswith("CVE-")), it["ids"][0] if it["ids"] else "")
            w(f"| {it['sev'].lower()}{' EXPLOITED' if it['kev'] else ''} | {it['pkg']} | {it['version']} | {it['kind']} | {it['owner']} | {it['fixed'] or 'no fix yet'} | {adv} |")
        if len(glob_items) > 30:
            w(f"\n...and {len(glob_items) - 30} more.")
    else:
        w("No known vulnerabilities in global npm, bun or pip packages.")
    w("")

w("## Problems during the sweep")
w("")
w("\n".join(f"- {a}: {b}" for a, b in errors) if errors else "- None.")
w("")
os.makedirs(os.path.dirname(args.report), exist_ok=True)
with open(args.report, "w") as f:
    f.write("\n".join(L) + "\n")
print(f"report written: {args.report}; issues: {len(issues)}; " + "; ".join(inbox_log))
