#!/usr/bin/env bash
# Tests for ./setup. Each case runs setup against a throwaway HOME, never your real one.
# Most cases use a small fixture checkout (setup + fake skills) so they don't depend on which
# skills ystack ships today; one case installs the real checkout's skills.
#
#   bash tests/setup.test.sh            # the platform's default mode (link on macOS/Linux, copy on Windows)
#   YSTACK_LINK_MODE=copy bash tests/setup.test.sh
#
# Exit code 0 when every check passes.
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd -P)"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ystack-setup-test.XXXXXX")" || { echo "setup tests: mktemp failed" >&2; exit 1; }
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then echo "setup tests: mktemp gave no directory" >&2; exit 1; fi
ROOT="$(cd "$ROOT" && pwd -P)" || exit 1
if [ -z "$ROOT" ] || [ ! -d "$ROOT" ]; then echo "setup tests: could not resolve the temp directory" >&2; exit 1; fi
trap 'rm -rf "$ROOT"' EXIT # only now that ROOT is known to be a fresh temp directory
unset CODEX_HOME

PASS=0
FAIL=0
SKIP=0
ok() { PASS=$((PASS + 1)); echo "  ok    $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL  $1"; [ -z "${2:-}" ] || printf '%s\n' "$2" | sed 's/^/        /'; }
check() { # DESC COMMAND...
  d="$1"; shift
  if "$@"; then ok "$d"; else bad "$d"; fi
}
has() { printf '%s' "$OUT" | grep -q -- "$1"; }
lacks() { ! has "$1"; }
section() { echo ""; echo "== $1"; }

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    DEFAULT_MODE=copy
    # Git Bash's ln -s copies unless told to make native links (needs Developer Mode or admin).
    export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict" ;;
  *) DEFAULT_MODE=link ;;
esac
MODE="${YSTACK_LINK_MODE:-$DEFAULT_MODE}"
export YSTACK_LINK_MODE="$MODE"
mkdir -p "$ROOT/lt"
SYMLINKS=0
if ln -s "$ROOT/lt" "$ROOT/lt-link" 2>/dev/null && [ -L "$ROOT/lt-link" ]; then SYMLINKS=1; fi
rm -rf "$ROOT/lt" "$ROOT/lt-link"
echo "setup tests: mode=$MODE, platform=$(uname -s), bash=$BASH_VERSION, symlinks=$SYMLINKS"
if [ "$MODE" = link ] && [ "$SYMLINKS" -eq 0 ]; then
  echo "setup tests: link mode needs symlinks, and this system can't make them" >&2; exit 1
fi

# A fixture checkout: the real setup script, the marketplace file, the real agents, two fake skills.
make_fixture() { # DIR
  mkdir -p "$1/.claude-plugin" "$1/claude/agents" "$1/skills/alpha" "$1/skills/beta/references"
  cp "$REPO/setup" "$1/setup"
  cp "$REPO/.claude-plugin/marketplace.json" "$1/.claude-plugin/"
  cp "$REPO"/claude/agents/*.md "$1/claude/agents/"
  printf -- '---\nname: alpha\ndescription: test skill alpha\n---\nalpha v1\n' >"$1/skills/alpha/SKILL.md"
  printf -- '---\nname: beta\ndescription: test skill beta\n---\nbeta v1\n' >"$1/skills/beta/SKILL.md"
  printf 'notes\n' >"$1/skills/beta/references/notes.md"
  mkdir -p "$1/skills/not-a-skill" # no SKILL.md: must be ignored
}

new_home() { # NAME [dirs...] -> sets H
  H="$ROOT/home-$1"; shift
  mkdir -p "$H"
  for d in "$@"; do mkdir -p "$H/$d"; done
}

run() { # FIXTURE ARGS... -> sets OUT and RC
  fx="$1"; shift
  OUT="$(HOME="$H" bash "$fx/setup" "$@" 2>&1)"
  RC=$?
}

snapshot() { # DIR: every path, file checksum and link target
  (cd "$1" && find . | LC_ALL=C sort | while IFS= read -r p; do
    if [ -L "$p" ]; then echo "L $p -> $(readlink "$p")"
    elif [ -f "$p" ]; then echo "F $p $(cksum <"$p")"
    else echo "D $p"; fi
  done)
}

# is_ours PATH: installed by ystack in the current mode
is_ours() {
  if [ "$MODE" = link ] && [ -L "$1" ]; then return 0; fi
  [ -d "$1" ] && [ -f "$1/.ystack" ]
}

FX="$ROOT/fixture"
make_fixture "$FX"

section "fresh install, every host (auto)"
new_home fresh .claude .codex .config/opencode
run "$FX"
check "exit 0" [ "$RC" -eq 0 ]
for t in .claude/skills .codex/skills .config/opencode/skills; do
  check "$t/alpha installed" is_ours "$H/$t/alpha"
  check "$t/beta installed with its references" [ -f "$H/$t/beta/references/notes.md" ]
  check "$t/alpha content is the skill" grep -q 'alpha v1' "$H/$t/alpha/SKILL.md"
  check "$t has no folder without SKILL.md" [ ! -e "$H/$t/not-a-skill" ]
done
check "summary per host" sh -c 'printf "%s" "$1" | grep -q "Claude Code (~/.claude/skills): 2 installed" && printf "%s" "$1" | grep -q "Codex (~/.codex/skills): 2 installed" && printf "%s" "$1" | grep -q "OpenCode (~/.config/opencode/skills): 2 installed"' _ "$OUT"
check "next steps mention /ystack-stats and /ystack-setup" sh -c 'printf "%s" "$1" | grep -q "/ystack-stats" && printf "%s" "$1" | grep -q "/ystack-setup"' _ "$OUT"
if [ "$MODE" = link ]; then
  check "link points into the checkout" [ "$(readlink "$H/.claude/skills/alpha")" = "$FX/skills/alpha" ]
else
  check "copy carries the .ystack marker naming the checkout" grep -q "^source=$FX\$" "$H/.claude/skills/alpha/.ystack"
fi

section "auto picks only hosts that exist; --host installs one host"
new_home onlyclaude .claude
run "$FX"
check "claude installed" is_ours "$H/.claude/skills/alpha"
check "codex not created" [ ! -e "$H/.codex" ]
check "opencode not created" [ ! -e "$H/.config/opencode" ]
run "$FX" --host codex
check "--host codex creates the codex skills folder" is_ours "$H/.codex/skills/alpha"
run "$FX" --host opencode
check "--host opencode installs there" is_ours "$H/.config/opencode/skills/beta"
new_home codexhome
OUT="$(HOME="$H" CODEX_HOME="$H/custom-codex" bash "$FX/setup" --host codex 2>&1)"
check "CODEX_HOME is honoured" is_ours "$H/custom-codex/skills/alpha"
new_home nohost
run "$FX"
check "no host found: non-zero exit with a hint" sh -c '[ "$1" -ne 0 ] && printf "%s" "$2" | grep -q -- "--host"' _ "$RC" "$OUT"
run "$FX" --host bogus
check "unknown host is an error" [ "$RC" -ne 0 ]

section "re-run updates"
H="$ROOT/home-fresh"
run "$FX"
check "unchanged re-run: all up to date" sh -c 'printf "%s" "$1" | grep -q "0 installed, 0 updated, 2 up to date"' _ "$OUT"
FX2="$ROOT/fixture-update"
make_fixture "$FX2"
new_home update .claude
run "$FX2"
printf -- '---\nname: alpha\ndescription: test skill alpha\n---\nalpha v2\n' >"$FX2/skills/alpha/SKILL.md"
mkdir -p "$FX2/skills/gamma"
printf -- '---\nname: gamma\ndescription: new\n---\ngamma\n' >"$FX2/skills/gamma/SKILL.md"
rm -rf "$FX2/skills/beta"
run "$FX2"
check "changed skill now has new content" grep -q 'alpha v2' "$H/.claude/skills/alpha/SKILL.md"
check "new skill installed" is_ours "$H/.claude/skills/gamma"
check "skill removed from ystack is pruned" [ ! -e "$H/.claude/skills/beta" ]
if [ "$MODE" = copy ]; then
  check "copy mode reports the change as updated" sh -c 'printf "%s" "$1" | grep -q "1 installed, 1 updated"' _ "$OUT"
fi
check "summary reports the removal" sh -c 'printf "%s" "$1" | grep -q "1 removed"' _ "$OUT"
# switching mode: a copy install re-run in link mode (and back) is replaced, not skipped
if [ "$MODE" = link ]; then
  new_home switch .claude
  OUT="$(HOME="$H" YSTACK_LINK_MODE=copy bash "$FX/setup" 2>&1)"
  run "$FX"
  check "copy install converted to link on re-run" [ -L "$H/.claude/skills/alpha" ]
fi

section "never clobber the user's own skill"
new_home user .claude/skills/alpha
printf 'my own alpha\n' >"$H/.claude/skills/alpha/SKILL.md"
mkdir -p "$H/.claude/skills/mine"
printf 'mine\n' >"$H/.claude/skills/mine/SKILL.md"
before="$(snapshot "$H/.claude/skills/alpha")"
run "$FX"
check "user's alpha untouched" [ "$(snapshot "$H/.claude/skills/alpha")" = "$before" ]
check "skip is reported with a reason" sh -c 'printf "%s" "$1" | grep -q "skipped alpha: ~/.claude/skills/alpha exists and is not ystack" && printf "%s" "$1" | grep -q "1 skipped"' _ "$OUT"
check "other skill still installed" is_ours "$H/.claude/skills/beta"
check "unrelated user skill untouched" grep -q '^mine$' "$H/.claude/skills/mine/SKILL.md"
if [ "$MODE" = link ]; then
  mkdir -p "$ROOT/elsewhere/beta2"
  rm -f "$H/.claude/skills/beta"
  ln -s "$ROOT/elsewhere/beta2" "$H/.claude/skills/beta"
  run "$FX"
  check "user's symlink to somewhere else is not ystack's: kept" [ "$(readlink "$H/.claude/skills/beta")" = "$ROOT/elsewhere/beta2" ]
fi
# a marker-less copy of the same content is still the user's
new_home user2 .claude/skills
cp -R "$FX/skills/alpha" "$H/.claude/skills/alpha"
run "$FX"
check "identical content without the marker is still skipped" [ ! -e "$H/.claude/skills/alpha/.ystack" ]

section "--force replaces and backs up"
H="$ROOT/home-user"
run "$FX" --force
check "alpha is now ystack's" is_ours "$H/.claude/skills/alpha"
check "alpha has ystack content" grep -q 'alpha v1' "$H/.claude/skills/alpha/SKILL.md"
bk="$(find "$H/.ystack-backup" -path '*claude/alpha/SKILL.md' 2>/dev/null | head -1)"
check "the user's alpha is in ~/.ystack-backup" sh -c '[ -n "$1" ] && grep -q "my own alpha" "$1"' _ "$bk"
check "unrelated user skill untouched by --force" grep -q '^mine$' "$H/.claude/skills/mine/SKILL.md"

section "--uninstall removes only ystack entries"
new_home un .claude .codex
run "$FX" --agents
mkdir -p "$H/.claude/skills/mine" "$H/.codex/skills/mine"
printf 'mine\n' >"$H/.claude/skills/mine/SKILL.md"
printf 'mine\n' >"$H/.codex/skills/mine/SKILL.md"
printf 'my agent\n' >"$H/.claude/agents/my-agent.md"
run "$FX" --uninstall
check "exit 0" [ "$RC" -eq 0 ]
check "claude ystack skills gone" sh -c '[ ! -e "$1/alpha" ] && [ ! -e "$1/beta" ]' _ "$H/.claude/skills"
check "codex ystack skills gone" sh -c '[ ! -e "$1/alpha" ] && [ ! -e "$1/beta" ]' _ "$H/.codex/skills"
check "user skills kept" sh -c '[ -f "$1/.claude/skills/mine/SKILL.md" ] && [ -f "$1/.codex/skills/mine/SKILL.md" ]' _ "$H"
check "ystack agents removed, user agent kept" sh -c '[ ! -e "$1/opus-medium.md" ] && [ ! -e "$1/haiku-max.md" ] && [ -f "$1/my-agent.md" ] && [ ! -e "$1/.ystack-manifest" ]' _ "$H/.claude/agents"
check "checkout itself untouched" [ -f "$FX/skills/alpha/SKILL.md" ]
new_home un2 .claude/skills/alpha
printf 'my own alpha\n' >"$H/.claude/skills/alpha/SKILL.md"
run "$FX" --uninstall
check "uninstall leaves a user's skill with a ystack name alone" grep -q 'my own alpha' "$H/.claude/skills/alpha/SKILL.md"

section "--dry-run changes nothing"
new_home dry .claude .codex .config/opencode
mkdir -p "$H/.claude/skills/alpha"; printf 'mine\n' >"$H/.claude/skills/alpha/SKILL.md"
before="$(snapshot "$H")"
run "$FX" --dry-run --agents --force
check "fresh home unchanged (with --agents --force)" [ "$(snapshot "$H")" = "$before" ]
check "says what it would do" sh -c 'printf "%s" "$1" | grep -q "would install" && printf "%s" "$1" | grep -q "nothing changed"' _ "$OUT"
rm -rf "$H/.claude/skills/alpha"
run "$FX" --agents
printf 'edited\n' >>"$FX2/skills/alpha/SKILL.md"
before="$(snapshot "$H")"
run "$FX2" --dry-run --agents
check "installed home unchanged by a dry re-run against a changed checkout" [ "$(snapshot "$H")" = "$before" ]
run "$FX" --dry-run --uninstall
check "dry uninstall changes nothing" [ "$(snapshot "$H")" = "$before" ]
check "dry uninstall says would remove" sh -c 'printf "%s" "$1" | grep -q "would remove"' _ "$OUT"

section "agents: install, no-clobber, update, --force"
new_home agents .claude/agents
printf -- '---\nname: opus-medium\nmodel: opus\neffort: high\n---\nmine\n' >"$H/.claude/agents/opus-medium.md"
mine_sum="$(cksum <"$H/.claude/agents/opus-medium.md")"
run "$FX" --agents
check "differing agent kept" [ "$(cksum <"$H/.claude/agents/opus-medium.md")" = "$mine_sum" ]
check "reported as 'differs, kept yours'" sh -c 'printf "%s" "$1" | grep -q "opus-medium.md: differs, kept yours"' _ "$OUT"
check "missing agents installed" sh -c 'cmp -s "$1/claude/agents/opus-high.md" "$2/opus-high.md" && cmp -s "$1/claude/agents/haiku-max.md" "$2/haiku-max.md"' _ "$FX" "$H/.claude/agents"
check "manifest lists only what ystack installed" sh -c 'grep -q "^opus-high.md " "$1" && ! grep -q "^opus-medium.md " "$1"' _ "$H/.claude/agents/.ystack-manifest"
printf '\nupdated upstream\n' >>"$FX2/claude/agents/haiku-max.md"
cp "$FX/claude/agents/opus-high.md" "$FX2/claude/agents/opus-high.md"
printf 'my edit\n' >>"$H/.claude/agents/opus-high.md"
printf '\nupdated upstream\n' >>"$FX2/claude/agents/opus-high.md"
run "$FX2" --agents
check "unedited ystack agent is updated" grep -q 'updated upstream' "$H/.claude/agents/haiku-max.md"
check "edited ystack agent is kept" sh -c 'grep -q "my edit" "$1" && ! grep -q "updated upstream" "$1"' _ "$H/.claude/agents/opus-high.md"
run "$FX2" --agents --force
check "--force replaces a differing agent" cmp -s "$FX2/claude/agents/opus-medium.md" "$H/.claude/agents/opus-medium.md"
check "--force backs the user's agent up" sh -c 'find "$1/.ystack-backup" -name opus-medium.md | grep -q .' _ "$H"
run "$FX" --host codex --agents
check "--agents without the claude host is skipped with a reason" sh -c 'printf "%s" "$1" | grep -q "Agents: skipped (Claude Code only"' _ "$OUT"

section "agents drift check (claude/agents vs the ystack-setup mod)"
if command -v bun >/dev/null 2>&1; then
  dout="$(cd "$REPO" && bun test ./tests/agents-drift.test.ts 2>&1)"
  if [ $? -eq 0 ]; then ok "claude/agents matches items.ts ($(printf '%s' "$dout" | grep -Eo '[0-9]+ pass' | head -1))"; else bad "agents drift test" "$dout"; fi
  # and prove it fails on drift
  DR="$ROOT/drift"
  mkdir -p "$DR/claude/agents" "$DR/tests" "$DR/claude/mods/ystack-setup/hooks"
  cp "$REPO/claude/mods/ystack-setup/hooks/items.ts" "$DR/claude/mods/ystack-setup/hooks/"
  cp "$REPO/tests/agents-drift.test.ts" "$DR/tests/"
  cp "$REPO"/claude/agents/*.md "$DR/claude/agents/"
  sed 's/effort: medium/effort: high/' "$REPO/claude/agents/opus-medium.md" >"$DR/claude/agents/opus-medium.md"
  if (cd "$DR" && bun test ./tests/agents-drift.test.ts >/dev/null 2>&1); then bad "drift test fails when a file drifts"; else ok "drift test fails when a file drifts"; fi
else
  SKIP=$((SKIP + 1)); echo "  SKIP  bun not found: agents drift check not run"
fi

section "--mods"
new_home mods .claude
run "$FX" --mods
check "prints the marketplace add and starter installs" sh -c 'printf "%s" "$1" | grep -q "claude plugin marketplace add ychampion/ystack" && printf "%s" "$1" | grep -q "claude plugin install ystack-stats@ystack" && printf "%s" "$1" | grep -q "claude plugin install context-meter@ystack"' _ "$OUT"
FAKE="$ROOT/fake-claude"
printf '#!/usr/bin/env bash\necho "$*" >>"%s"\nexit 0\n' "$ROOT/claude-calls.log" >"$FAKE"
chmod +x "$FAKE"
OUT="$(HOME="$H" YSTACK_CLAUDE="$FAKE" bash "$FX/setup" --mods --yes 2>&1)"
check "--mods --yes runs marketplace add then six installs" sh -c 'grep -q "^plugin marketplace add ychampion/ystack$" "$1" && [ "$(grep -c "^plugin install .*@ystack$" "$1")" -eq 6 ]' _ "$ROOT/claude-calls.log"
OUT="$(HOME="$H" YSTACK_CLAUDE=no-such-claude-cli bash "$FX/setup" --mods --yes 2>&1)"
check "--mods --yes without the claude CLI says so and skips" sh -c 'printf "%s" "$1" | grep -q "claude CLI was not found"' _ "$OUT"

section "-q and -h"
new_home quiet .claude
run "$FX" -q
check "-q prints the summary but not per-skill lines" sh -c 'printf "%s" "$1" | grep -q "2 installed" && ! printf "%s" "$1" | grep -q "  alpha:"' _ "$OUT"
run "$FX" -h
check "-h prints usage" sh -c '[ "$2" -eq 0 ] && printf "%s" "$1" | grep -q "Usage: ./setup"' _ "$OUT" "$RC"

# crun FIXTURE ARGS...: run setup in copy mode whatever the suite's mode (copy-only behaviour).
crun() { fx="$1"; shift; OUT="$(HOME="$H" YSTACK_LINK_MODE=copy bash "$fx/setup" "$@" 2>&1)"; RC=$?; }
no_leftovers() { [ -z "$(find "$1" -mindepth 1 -maxdepth 1 -name '.ystack-*' 2>/dev/null)" ]; }

section "a failed backup under --force leaves the user's skill and agent alone"
new_home bkfail .claude/skills/alpha .claude/agents
printf 'MY PRECIOUS WORK\n' >"$H/.claude/skills/alpha/SKILL.md"
printf -- '---\nname: opus-medium\n---\nmy own agent\n' >"$H/.claude/agents/opus-medium.md"
: >"$H/.ystack-backup" # a file, so no backup folder can be made
before_s="$(snapshot "$H/.claude/skills/alpha")"
before_a="$(cksum <"$H/.claude/agents/opus-medium.md")"
run "$FX" --force --agents
check "exit 1" [ "$RC" -eq 1 ]
check "the user's skill is untouched" [ "$(snapshot "$H/.claude/skills/alpha")" = "$before_s" ]
check "the user's agent is untouched" [ "$(cksum <"$H/.claude/agents/opus-medium.md")" = "$before_a" ]
check "FAILED reported for the skill" has "alpha: FAILED (could not back up"
check "FAILED reported for the agent" has "opus-medium.md: FAILED (could not back up"
check "no claim that it was backed up" lacks "replaced yours"
check "the rest still installed" is_ours "$H/.claude/skills/beta"
check "no temp entries left behind" no_leftovers "$H/.claude/skills"
check "the agent manifest does not claim the user's agent" sh -c '! grep -q "^opus-medium.md " "$1"' _ "$H/.claude/agents/.ystack-manifest"
run "$FX"
check "a plain re-run still leaves the user's skill alone" [ "$(snapshot "$H/.claude/skills/alpha")" = "$before_s" ]
check "and exits 0" [ "$RC" -eq 0 ]

section "a renamed copy of a ystack skill is the user's"
new_home renamed .claude
crun "$FX"
cp -R "$H/.claude/skills/alpha" "$H/.claude/skills/my-alpha" # carries the .ystack marker along
printf 'my tweak\n' >>"$H/.claude/skills/my-alpha/SKILL.md"
run "$FX"
check "renamed copy is not pruned" grep -q 'my tweak' "$H/.claude/skills/my-alpha/SKILL.md"
check "and not reported as removed" lacks "my-alpha: removed"
run "$FX" --uninstall
check "renamed copy survives --uninstall" grep -q 'my tweak' "$H/.claude/skills/my-alpha/SKILL.md"
if [ "$SYMLINKS" -eq 1 ]; then
  ln -s "$FX/skills/alpha" "$H/.claude/skills/my-link"
  run "$FX"
  check "a user's alias symlink to a ystack skill is not pruned" [ -L "$H/.claude/skills/my-link" ]
fi

section "an edited copy is kept; --force backs it up"
FX3="$ROOT/fixture-edit"
make_fixture "$FX3"
new_home edited .claude
crun "$FX3"
printf 'my edit\n' >>"$H/.claude/skills/alpha/SKILL.md"
crun "$FX3"
check "edited copy kept on a plain re-run" grep -q 'my edit' "$H/.claude/skills/alpha/SKILL.md"
check "reported as edited, kept yours" has "alpha: edited, kept yours"
check "exit 0" [ "$RC" -eq 0 ]
printf -- '---\nname: alpha\ndescription: test skill alpha\n---\nalpha v2\n' >"$FX3/skills/alpha/SKILL.md"
printf 'my notes\n' >>"$H/.claude/skills/beta/references/notes.md"
rm -rf "$FX3/skills/beta"
crun "$FX3"
check "edited copy kept when ystack changes" sh -c 'grep -q "my edit" "$1" && ! grep -q "alpha v2" "$1"' _ "$H/.claude/skills/alpha/SKILL.md"
check "edited copy of a skill gone from ystack is not pruned" grep -q 'my notes' "$H/.claude/skills/beta/references/notes.md"
crun "$FX3" --force
check "--force installs ystack's version" grep -q 'alpha v2' "$H/.claude/skills/alpha/SKILL.md"
bk="$(find "$H/.ystack-backup" -path '*alpha/SKILL.md' 2>/dev/null | head -1)"
check "--force backed the edited copy up first" sh -c '[ -n "$1" ] && grep -q "my edit" "$1"' _ "$bk"
bk="$(find "$H/.ystack-backup" -path '*beta/references/notes.md' 2>/dev/null | head -1)"
check "--force backs up an edited copy it prunes" sh -c '[ -n "$1" ] && grep -q "my notes" "$1" && [ ! -e "$2" ]' _ "$bk" "$H/.claude/skills/beta"
crun "$FX3"
check "after --force the copy counts as clean again" has "alpha: up to date"

section "a skills folder inside the checkout is refused"
FX4="$ROOT/fixture-self"
make_fixture "$FX4"
before="$(snapshot "$FX4")"
new_home selfcodex
OUT="$(HOME="$H" CODEX_HOME="$FX4/codex" bash "$FX4/setup" --host codex --force 2>&1)"; RC=$?
check "a host folder inside the checkout is skipped with a reason" has "inside this checkout"
check "the checkout is unchanged" [ "$(snapshot "$FX4")" = "$before" ]
check "exit 0 (skipped, not failed)" [ "$RC" -eq 0 ]
if [ "$SYMLINKS" -eq 1 ]; then
  new_home selflink .claude
  ln -s "$FX4/skills" "$H/.claude/skills"
  run "$FX4" --force
  check "~/.claude/skills linked to the checkout's skills: skipped with a reason" has "inside this checkout"
  check "--force left the checkout's skills alone" [ "$(snapshot "$FX4")" = "$before" ]
  run "$FX4" --uninstall --force
  check "--uninstall left the checkout's skills alone" [ "$(snapshot "$FX4")" = "$before" ]
else
  SKIP=$((SKIP + 1)); echo "  SKIP  no symlinks here: linked skills folder case not run"
fi

section "a failing or interrupted copy leaves no half state"
REAL_CP="$(command -v cp)"
FB="$ROOT/fakebin"
mkdir -p "$FB"
cat >"$FB/cp" <<EOF
#!/usr/bin/env bash
# Fake cp: for cp -R, copy SKILL.md only, then fail (FAKE_CP=fail) or hang (FAKE_CP=hang).
if [ "\$1" = "-R" ] && [ -n "\${FAKE_CP:-}" ]; then
  mkdir -p "\$3"; "$REAL_CP" "\$2/SKILL.md" "\$3/"
  if [ "\$FAKE_CP" = hang ]; then : >"\$FAKE_CP_FLAG"; sleep 5; fi
  echo "cp: error writing: No space left on device" >&2
  exit 1
fi
exec "$REAL_CP" "\$@"
EOF
chmod +x "$FB/cp"
new_home cpfail .claude
OUT="$(HOME="$H" PATH="$FB:$PATH" FAKE_CP=fail YSTACK_LINK_MODE=copy bash "$FX/setup" 2>&1)"; RC=$?
check "failing cp: exit 1" [ "$RC" -eq 1 ]
check "failing cp: FAILED with the reason" has "alpha: FAILED (copy failed: cp: error writing"
check "failing cp: nothing installed, no half copies" sh -c '[ ! -e "$1/alpha" ] && [ ! -e "$1/beta" ]' _ "$H/.claude/skills"
check "failing cp: no temp entries left behind" no_leftovers "$H/.claude/skills"
check "failing cp: summary counts the failures" has "2 failed"
FX5="$ROOT/fixture-cp"
make_fixture "$FX5"
new_home cpupd .claude
crun "$FX5"
printf 'beta v2\n' >>"$FX5/skills/beta/SKILL.md"
before="$(snapshot "$H/.claude/skills")"
OUT="$(HOME="$H" PATH="$FB:$PATH" FAKE_CP=fail YSTACK_LINK_MODE=copy bash "$FX5/setup" 2>&1)"; RC=$?
check "failing cp during an update: exit 1" [ "$RC" -eq 1 ]
check "failing cp during an update: the old copy is untouched" [ "$(snapshot "$H/.claude/skills")" = "$before" ]
crun "$FX5"
check "the next good run updates it" grep -q 'beta v2' "$H/.claude/skills/beta/SKILL.md"
new_home cpkill .claude
FLAG="$ROOT/cp-flag"
rm -f "$FLAG"
HOME="$H" PATH="$FB:$PATH" FAKE_CP=hang FAKE_CP_FLAG="$FLAG" YSTACK_LINK_MODE=copy bash "$FX/setup" >/dev/null 2>&1 &
pid=$!
i=0
while [ ! -f "$FLAG" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i + 1)); done
kill -KILL "$pid" 2>/dev/null
wait "$pid" 2>/dev/null
check "killed mid-copy: no half copy at the skill's path" [ ! -e "$H/.claude/skills/alpha" ]
check "killed mid-copy: the leftover temp folder carries the marker" sh -c 'for d in "$1"/.ystack-new-alpha.*; do [ -f "$d/.ystack" ] || exit 1; done' _ "$H/.claude/skills"
run "$FX"
check "the next run installs it" is_ours "$H/.claude/skills/alpha"
check "and removes the leftover" no_leftovers "$H/.claude/skills"
check "and says so" has "removed (left by an interrupted run)"

section "link mode falls back to copies loudly"
FL="$ROOT/fakeln"
mkdir -p "$FL"
printf '#!/usr/bin/env bash\necho "ln: failed to create symbolic link: Operation not permitted" >&2\nexit 1\n' >"$FL/ln"
chmod +x "$FL/ln"
new_home lnfail .claude
OUT="$(HOME="$H" PATH="$FL:$PATH" YSTACK_LINK_MODE=link bash "$FX/setup" 2>&1)"; RC=$?
check "fallback: exit 0, skills installed as copies" sh -c '[ "$1" -eq 0 ] && [ -f "$2/alpha/.ystack" ] && [ ! -L "$2/alpha" ]' _ "$RC" "$H/.claude/skills"
check "fallback: counted, with the first ln error" has "2 skill(s) were copied because a symlink could not be made (ln: failed to create symbolic link"
check "fallback: tells the user to re-run after git pull" has "re-run ./setup after every git pull"

section "agent manifest write failure is reported"
new_home manifail .claude/agents/.ystack-manifest.tmp # a folder, so the temp manifest can't be written
run "$FX" --agents
check "exit 1 with a FAILED line for the manifest" sh -c '[ "$1" -eq 1 ] && printf "%s" "$2" | grep -q "manifest: FAILED (could not write"' _ "$RC" "$OUT"

section "--mods --yes failures"
fake_claude() { # FILE LOG CASE-BODY: a fake claude CLI that logs its arguments
  printf '#!/usr/bin/env bash\necho "$*" >>"%s"\ncase "$*" in\n%s\n  *) exit 0 ;;\nesac\n' "$2" "$3" >"$1"
  chmod +x "$1"
}
new_home modsfail .claude
fake_claude "$ROOT/claude-addfail" "$ROOT/addfail.log" '  "plugin marketplace list --json") echo "[]" ;;
  "plugin marketplace add"*) echo "Error: network unreachable" >&2; exit 1 ;;'
OUT="$(HOME="$H" YSTACK_CLAUDE="$ROOT/claude-addfail" bash "$FX/setup" --mods --yes 2>&1)"; RC=$?
check "marketplace add fails: exit 1" [ "$RC" -eq 1 ]
check "marketplace add fails: no installs attempted" sh -c '! grep -q "^plugin install" "$1"' _ "$ROOT/addfail.log"
check "marketplace add fails: says why" has "could not add the ystack marketplace: Error: network unreachable"
check "marketplace add fails: no restart hint" lacks "restart Claude Code"
fake_claude "$ROOT/claude-listfail" "$ROOT/listfail.log" '  "plugin marketplace list --json") echo "[{\"name\": \"ystack\"}]" ;;
  "plugin list --json") echo "Error: not logged in" >&2; exit 1 ;;'
OUT="$(HOME="$H" YSTACK_CLAUDE="$ROOT/claude-listfail" bash "$FX/setup" --mods --yes 2>&1)"; RC=$?
check "plugin list fails: exit 1, can't tell, nothing installed" sh -c '[ "$1" -eq 1 ] && ! grep -q "^plugin install" "$2" && ! grep -q "^plugin marketplace add" "$2" && printf "%s" "$3" | grep -q "can.t tell"' _ "$RC" "$ROOT/listfail.log" "$OUT"
fake_claude "$ROOT/claude-allthere" "$ROOT/allthere.log" '  "plugin marketplace list --json") echo "[{\"name\": \"ystack\"}]" ;;
  "plugin list --json") for m in ystack-stats ystack-setup context-meter verify push-guard model-router; do echo "{\"id\": \"$m@ystack\"}"; done ;;'
OUT="$(HOME="$H" YSTACK_CLAUDE="$ROOT/claude-allthere" bash "$FX/setup" --mods --yes 2>&1)"; RC=$?
check "everything already there: exit 0, no add, no installs, no restart hint" sh -c '[ "$1" -eq 0 ] && ! grep -q "^plugin install" "$2" && ! grep -q "^plugin marketplace add" "$2" && ! printf "%s" "$3" | grep -q "restart"' _ "$RC" "$ROOT/allthere.log" "$OUT"

section "the real checkout: every skills/*/SKILL.md is installed"
new_home real .claude .codex .config/opencode
want=0
for f in "$REPO"/skills/*/SKILL.md; do [ -f "$f" ] && want=$((want + 1)); done
OUT="$(HOME="$H" bash "$REPO/setup" 2>&1)"; RC=$?
got=0
for f in "$REPO"/skills/*/SKILL.md; do
  [ -f "$f" ] || continue
  n="$(basename "$(dirname "$f")")"
  is_ours "$H/.claude/skills/$n" && is_ours "$H/.codex/skills/$n" && is_ours "$H/.config/opencode/skills/$n" && got=$((got + 1))
done
check "all $want real skills installed for all three hosts (exit $RC)" sh -c '[ "$1" -eq 0 ] && [ "$2" -eq "$3" ] && [ "$3" -gt 0 ]' _ "$RC" "$got" "$want"
OUT="$(HOME="$H" bash "$REPO/setup" --uninstall 2>&1)"
left="$(find "$H/.claude/skills" "$H/.codex/skills" "$H/.config/opencode/skills" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
check "uninstall leaves the skill folders empty" [ "$left" -eq 0 ]

echo ""
echo "setup tests ($MODE mode): $PASS passed, $FAIL failed, $SKIP skipped"
[ "$FAIL" -eq 0 ]
