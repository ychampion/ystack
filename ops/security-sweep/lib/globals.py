#!/usr/bin/python3 -I
"""Inventory globally installed CLIs and write lockfiles osv-scanner can read.

usage: globals.py <out_dir>
Writes <out_dir>/npm-global/package-lock.json, <out_dir>/pip-global/requirements.txt,
copies any bun global bun.lock, and prints a JSON inventory on stdout. Reads only.
"""
import glob
import json
import os
import re
import shutil
import subprocess
import sys

out = sys.argv[1]


def run(cmd):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=False).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def homes():
    hs = ["/root"] + sorted(glob.glob("/home/*"))
    return [h for h in hs if os.path.isdir(h)]


# npm global trees: every node_modules/<name>/package.json below the global roots
NPM_ROOTS = [p for p in {"/usr/lib/node_modules", "/usr/local/lib/node_modules", run(["npm", "root", "-g"])} if p and os.path.isdir(p)]
for h in homes():
    for p in (f"{h}/.npm-global/lib/node_modules", f"{h}/.local/lib/node_modules"):
        if os.path.isdir(p):
            NPM_ROOTS.append(p)

lock = {"name": "npm-global", "lockfileVersion": 3, "requires": True, "packages": {"": {"name": "npm-global"}}}
top_npm = []
for root in NPM_ROOTS:
    base = os.path.dirname(root)
    for dirpath, dirnames, filenames in os.walk(root):
        # only descend into node_modules package folders, not into package internals
        rel = os.path.relpath(dirpath, base)
        parts = rel.split(os.sep)
        if "package.json" in filenames and len(parts) >= 2 and (
            parts[-2] == "node_modules" or (len(parts) >= 3 and parts[-3] == "node_modules" and parts[-2].startswith("@"))
        ):
            try:
                with open(os.path.join(dirpath, "package.json"), errors="replace") as f:
                    pj = json.load(f)
                name, version = pj.get("name"), pj.get("version")
            except (OSError, ValueError):
                name = version = None
            if isinstance(name, str) and isinstance(version, str):
                i = NPM_ROOTS.index(root)
                key = rel if i == 0 else f"r{i}/{rel}"
                lock["packages"][key] = {"name": name, "version": version}
                if parts.count("node_modules") == 1:
                    top_npm.append({"name": name, "version": version, "root": root})
        # prune: inside a package, only keep walking its node_modules
        if len(parts) >= 2 and parts[-2] == "node_modules" and not parts[-1].startswith("@"):
            dirnames[:] = [d for d in dirnames if d == "node_modules"]
        elif len(parts) >= 3 and parts[-3] == "node_modules" and parts[-2].startswith("@"):
            dirnames[:] = [d for d in dirnames if d == "node_modules"]

os.makedirs(f"{out}/npm-global", exist_ok=True)
with open(f"{out}/npm-global/package-lock.json", "w") as f:
    json.dump(lock, f)

# bun global installs keep a real bun.lock
bun_locks = []
for h in homes():
    p = f"{h}/.bun/install/global/bun.lock"
    if os.path.isfile(p):
        d = f"{out}/bun-global-{os.path.basename(h)}"
        os.makedirs(d, exist_ok=True)
        shutil.copy(p, f"{d}/bun.lock")
        bun_locks.append({"home": h, "lock": f"{d}/bun.lock"})

# pip: packages installed outside apt (dist-packages under /usr/local, --user, pipx venvs)
SITE_GLOBS = ["/usr/local/lib/python3*/dist-packages", "/usr/local/lib/python3*/site-packages"]
for h in homes():
    SITE_GLOBS += [f"{h}/.local/lib/python3*/site-packages", f"{h}/.local/share/pipx/venvs/*/lib/python3*/site-packages",
                   f"{h}/.local/share/uv/tools/*/lib/python3*/site-packages"]
pip = {}
for g in SITE_GLOBS:
    for site in glob.glob(g):
        for meta in glob.glob(f"{site}/*.dist-info/METADATA"):
            name = version = None
            with open(meta, errors="replace") as f:
                for line in f:
                    if line.startswith("Name:"):
                        name = line.split(":", 1)[1].strip()
                    elif line.startswith("Version:"):
                        version = line.split(":", 1)[1].strip()
                    if (name and version) or not line.strip():
                        break
            if name and version:
                pip[(re.sub(r"[-_.]+", "-", name).lower(), version)] = site
os.makedirs(f"{out}/pip-global", exist_ok=True)
with open(f"{out}/pip-global/requirements.txt", "w") as f:
    for (n, v) in sorted(pip):
        f.write(f"{n}=={v}\n")

runtimes = {}
node = run(["node", "--version"])
if node:
    runtimes["node"] = {"version": node.lstrip("v")}
    pol = run(["apt-cache", "policy", "nodejs"])
    m_i, m_c = re.search(r"Installed: (\S+)", pol), re.search(r"Candidate: (\S+)", pol)
    if m_i and m_c and m_i.group(1) != "(none)":
        runtimes["node"]["apt_installed"], runtimes["node"]["apt_candidate"] = m_i.group(1), m_c.group(1)
bun = run(["bun", "--version"])
if bun:
    runtimes["bun"] = {"version": bun}
    latest = run(["curl", "-fsS", "--max-time", "15", "https://api.github.com/repos/oven-sh/bun/releases/latest"])
    try:
        runtimes["bun"]["latest"] = json.loads(latest)["tag_name"].replace("bun-v", "")
    except (ValueError, KeyError, TypeError):
        pass
for cli, args in (("claude", ["claude", "--version"]), ("codex", ["codex", "--version"])):
    v = run(args)
    if v:
        runtimes[cli] = {"version": v.splitlines()[0]}

json.dump({"npm_roots": NPM_ROOTS, "npm_top": top_npm, "npm_count": len(lock["packages"]) - 1,
           "bun_locks": bun_locks, "pip_count": len(pip), "runtimes": runtimes}, sys.stdout, indent=1)
