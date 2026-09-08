#!/usr/bin/env bash
# SWL PREFLIGHT — the facts to establish before touching anything.
#
# Working Protocol §2: "Establish what access actually exists. Not what should
# exist — what responds right now." This is that step, mechanically.
#
# It exists because of one incident. On 2026-09-01 a session designed and built an
# entire release against a working copy that had never pulled: production was on
# 2.40a, the copy was on 2.37d. Every patch had to be re-applied against the real
# head, and a design document had to be corrected three times. The check that
# would have caught it costs four tenths of a second.
#
# This is the estate-wide version, synced from canon. A repo that needs more —
# pxpns checks its Apps Script artifact too — replaces it with its own and the
# sync leaves that alone.
#
# Declare what this repo can check by creating `.swl-preflight`:
#     URL=https://example.com          # where the deployed artifact answers
#     VERSION_GREP='const APP_VERSION = "\([^"]*\)"'   # \1 = the version
#     VERSION_FILE=src/index.html
# Anything not declared is reported as NOT CHECKED — never as passing.
#
# Usage:  ./scripts/preflight.sh [--no-tests]
# Exit:   0 = clear to work.  1 = something needs attention first.
set -u
cd "$(dirname "$0")/.." || exit 1
REPO=$(basename "$(pwd -P)")

RUN_TESTS=1
[ "${1:-}" = "--no-tests" ] && RUN_TESTS=0
[ -f .swl-preflight ] && . ./.swl-preflight

ok(){   printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad(){  printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
skip(){ printf '  \033[33m—\033[0m %s\n' "$1"; }
note(){ printf '    %s\n' "$1"; }
FAIL=0

echo "=== $REPO preflight ==="

# ── 1. Lane ─────────────────────────────────────────────────────────────────
# The single working copy of every repo is /volume1/Projects/<repo>. /Volumes is
# an SMB mount of the same volume: case-insensitive, it sets the exec bit on
# everything written through it, and on 2026-09-07 it served a file's previous
# contents at the current file's exact size. Edit there; never run git there.
case "$(pwd -P)" in
  /Volumes/*) bad "lane: SMB ($(pwd -P)) — use: ssh nas, /volume1/Projects/$REPO" ;;
  /volume1/*) ok  "lane: NAS ($(pwd -P))" ;;
  *)          ok  "lane: $(pwd -P)" ;;
esac

# ── 2. Working copy against the remote ──────────────────────────────────────
if git rev-parse --git-dir >/dev/null 2>&1; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  case "$(git remote get-url origin 2>/dev/null)" in
    git@*) : ;;
    "")    bad "no origin remote" ;;
    *)     bad "origin is not SSH — a headless box cannot authenticate over HTTPS" ;;
  esac
  if git fetch --quiet origin 2>/dev/null; then
    UP=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)
    [ -z "$UP" ] && UP="origin/main"
    if git rev-parse --verify --quiet "$UP" >/dev/null; then
      BEHIND=$(git rev-list --count "HEAD..$UP" 2>/dev/null || echo 0)
      AHEAD=$(git rev-list --count "$UP..HEAD" 2>/dev/null || echo 0)
      if [ "$BEHIND" -gt 0 ]; then
        bad "$BRANCH is $BEHIND commit(s) BEHIND $UP — pull before planning anything"
      else
        ok "$BRANCH current with $UP (ahead $AHEAD)"
      fi
    else
      bad "no upstream to compare against — cannot tell if this copy is current"
    fi
  else
    bad "cannot reach origin"
  fi
  if [ -n "$(git status --porcelain)" ]; then
    note "uncommitted changes present:"
    git status --porcelain | sed 's/^/      /' | head -12
  fi
fi

# ── 3. The repo against what is actually serving ────────────────────────────
# A green build means an upload succeeded, not that the running artifact is
# current. Only checkable where the repo declares how; silence is not a pass.
if [ -n "${URL:-}" ] && [ -n "${VERSION_GREP:-}" ] && [ -n "${VERSION_FILE:-}" ]; then
  REPO_V=$(sed -n "s/.*$VERSION_GREP.*/\1/p" "$VERSION_FILE" 2>/dev/null | head -1)
  LIVE_RAW=$(curl -sS -L --max-time 20 "$URL" 2>/dev/null)
  LIVE_V=$(printf '%s' "$LIVE_RAW" | sed -n "s/.*$VERSION_GREP.*/\1/p" | head -1)
  if [ -z "$REPO_V" ]; then
    bad "VERSION_GREP matched nothing in $VERSION_FILE — the check is misconfigured"
  elif [ -z "$LIVE_V" ]; then
    bad "deployed version unreadable from $URL (fetched ${#LIVE_RAW} bytes)"
  elif [ "$REPO_V" = "$LIVE_V" ]; then
    ok "deployed $LIVE_V matches repo $REPO_V"
  else
    bad "repo is $REPO_V, deployed is $LIVE_V — one of them is not what you think"
  fi
else
  skip "deployed-vs-repo NOT CHECKED — this repo declares no version marker"
  note "add .swl-preflight with URL, VERSION_FILE and VERSION_GREP to enable it"
fi

# ── 4. The baseline you are starting from ───────────────────────────────────
# A repo with no runner is not a repo that passes. It is a repo where nothing
# would notice a regression, and that is stated on every run rather than left
# to be inferred from a blank space.
if [ ! -x scripts/run-tests.sh ]; then
  skip "NO TEST RUNNER IN THIS REPO — nothing here would notice a regression"
  note "the estate contract wants tests/ plus a runner that exits non-zero"
  note "and prints one verdict line. pxpns/scripts/run-tests.sh is the model."
elif [ "$RUN_TESTS" = "1" ]; then
  OUT=$(./scripts/run-tests.sh 2>&1)
  V=$(printf '%s' "$OUT" | grep -E 'PASSED:|passed,' | tail -1)
  if printf '%s' "$OUT" | grep -q 'BASELINE OK'; then
    ok "baseline: ${V:-green}"
  else
    bad "baseline is NOT green before you start: ${V:-see below}"
    printf '%s\n' "$OUT" | grep -iE 'fail|crash' | head -6 | sed 's/^/      /'
  fi
else
  note "tests skipped (--no-tests)"
fi

echo
[ "$FAIL" = "0" ] && { echo "PREFLIGHT CLEAR"; exit 0; }
echo "PREFLIGHT NOT CLEAR — resolve the ✗ above before planning"; exit 1
