#!/usr/bin/python3 -I
"""List pending OS updates and decide which security updates are safe to apply unattended.

Prints JSON on stdout:
  {"distro": ..., "codename": ..., "security": [...], "other": [...]}
Each security entry has "held": true when installing it would (or could) restart a running
service or container, with the reasons in "hold_reasons". Reads only; changes nothing.
"""
import json
import os
import re
import subprocess
import sys

import apt
import apt_pkg

HOLD_ALWAYS = os.environ.get(
    "SWEEP_HOLD_ALWAYS",
    r"^docker-ce$ ^docker-ce-cli$ ^docker-ce-rootless-extras$ ^docker\.io$ ^containerd$ ^containerd\.io$ ^runc$",
).split()
HOLD_EXTRA = os.environ.get("SWEEP_HOLD_EXTRA", "").split()
HOLD_RES = [re.compile(p) for p in HOLD_ALWAYS + HOLD_EXTRA]

# Maintainer-script calls that restart or reload a service.
RESTART_RE = re.compile(
    r"invoke-rc\.d\s+(--\S+\s+)*\S+\s+(restart|try-restart|reload|force-reload|\$)"
    r"|deb-systemd-invoke\s+(--\S+\s+)*(restart|try-restart|reload|reload-or-restart|\$)"
    r"|systemctl\s+(--\S+\s+)*(restart|try-restart|reload-or-restart|condrestart)\b"
    r"|\bservice\s+\S+\s+restart"
)
UNIT_DIRS = ("/lib/systemd/system/", "/usr/lib/systemd/system/", "/etc/systemd/system/")


def os_release():
    d = {}
    with open("/etc/os-release") as f:
        for line in f:
            if "=" in line:
                k, v = line.rstrip("\n").split("=", 1)
                d[k] = v.strip('"')
    return d


def security_origins(distro, codename):
    if distro == "ubuntu":
        return {("Ubuntu", f"{codename}-security"), ("UbuntuESM", f"{codename}-infra-security"),
                ("UbuntuESMApps", f"{codename}-apps-security")}
    if distro == "debian":
        return {("Debian", f"{codename}-security")}
    return set()


def active_units():
    out = subprocess.run(["systemctl", "list-units", "--all", "--state=active", "--no-legend", "--plain"],
                         capture_output=True, text=True, check=False).stdout
    return {line.split()[0] for line in out.splitlines() if line.strip()}


def unit_is_active(unit, active):
    if "@." in unit:  # template: any active instance counts
        prefix = unit.split("@.")[0] + "@"
        return any(u.startswith(prefix) for u in active)
    return unit in active


def hold_reasons(pkg, active):
    reasons = []
    if any(r.search(pkg.name) for r in HOLD_RES):
        reasons.append("container runtime or always-held package")
    units = set()
    try:
        files = pkg.installed_files
    except Exception:  # noqa: BLE001 - a missing .list file just means no unit info
        files = []
    for f in files:
        if f.startswith(UNIT_DIRS) and f.endswith((".service", ".socket")):
            units.add(os.path.basename(f))
        elif f.startswith("/etc/init.d/") and len(f) > len("/etc/init.d/"):
            units.add(os.path.basename(f) + ".service")
    running = sorted(u for u in units if unit_is_active(u, active))
    if running:
        shown = ", ".join(running[:5]) + (f" and {len(running) - 5} more" if len(running) > 5 else "")
        reasons.append("its own running service would restart: " + shown)
    arch = pkg.installed.architecture if pkg.installed else ""
    for name in (f"{pkg.shortname}:{arch}", pkg.shortname):
        path = f"/var/lib/dpkg/info/{name}.postinst"
        if os.path.exists(path):
            try:
                with open(path, errors="replace") as fh:
                    text = fh.read()
            except OSError:
                break
            if RESTART_RE.search(text) and not running:
                reasons.append("its install script restarts or starts services")
            break
    return reasons


def main():
    rel = os_release()
    distro, codename = rel.get("ID", ""), rel.get("VERSION_CODENAME", "")
    sec = security_origins(distro, codename)
    apt_pkg.init()
    cache = apt.Cache()
    active = active_units()
    security, other = [], []
    for pkg in cache:
        if not pkg.is_installed or not pkg.is_upgradable:
            continue
        inst = pkg.installed.version
        newer = [v for v in pkg.versions if apt_pkg.version_compare(v.version, inst) > 0]
        sec_versions = [v for v in newer if any((o.origin, o.archive) in sec for o in v.origins)]
        cand = pkg.candidate
        cand_origin = cand.origins[0] if cand and cand.origins else None
        if sec_versions:
            best = sec_versions[0]  # keep the newest security version
            for v in sec_versions[1:]:
                if apt_pkg.version_compare(v.version, best.version) > 0:
                    best = v
            o = next(o for o in best.origins if (o.origin, o.archive) in sec)
            reasons = hold_reasons(pkg, active)
            security.append({
                "name": pkg.shortname, "arch": pkg.installed.architecture, "installed": inst,
                "security_version": best.version, "origin": o.origin, "archive": o.archive,
                "source": best.source_name, "held": bool(reasons), "hold_reasons": reasons,
            })
        else:
            other.append({
                "name": pkg.shortname, "installed": inst, "candidate": cand.version if cand else None,
                "origin": cand_origin.origin if cand_origin else "", "archive": cand_origin.archive if cand_origin else "",
                "site": cand_origin.site if cand_origin else "",
            })
    security.sort(key=lambda p: p["name"])
    other.sort(key=lambda p: p["name"])
    json.dump({"distro": distro, "codename": codename, "security": security, "other": other}, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
