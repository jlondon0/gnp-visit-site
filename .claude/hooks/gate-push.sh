#!/bin/sh
# SWL — mechanical push gate.
#
# Engineering Standard §1: "Push only on a green suite, gated mechanically on
# the runner's verdict." Working Protocol §3.5: "Never push and then check."
#
# This hook is that gate. It intercepts `git push`, runs the repo's own test
# runner, and blocks the push if the runner does not exit zero. A repo with no
# runner passes through — the gate reports what it did either way, so a silent
# pass is never mistaken for a green suite.
#
# Contract: PreToolUse hook. Reads the tool call as JSON on stdin.
# exit 0 = allow, exit 2 = block (stderr is shown to Claude).

set -u

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# Parse the command out of the tool call. If we cannot read it, allow — a
# missing jq must not brick every Bash call in the session.
command -v jq >/dev/null 2>&1 || exit 0
CMD=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -n "$CMD" ] || exit 0

# Only gate pushes. Anything else passes untouched.
#
# Parsed rather than pattern-matched, because a regex gets this wrong in both
# directions: it misses `git -C /tmp push` (an option that takes an argument)
# and it fires on `git commit -m "fix push bug"` (the word in a message). Each
# shell segment is checked for the shape `git <global-opts> push`.
IS_PUSH=$(printf '%s' "$CMD" | awk '
  BEGIN { RS = "[;&|\n]+"; found = 0 }
  {
    n = split($0, t, /[ \t]+/)
    i = 1
    while (i <= n && t[i] == "") i++          # leading blanks
    if (t[i] != "git") next
    i++
    while (i <= n) {                           # git global options
      if (t[i] == "-C" || t[i] == "-c")        { i += 2; continue }   # takes an argument
      if (t[i] ~ /^--(git-dir|work-tree|namespace|exec-path)=/) { i++; continue }
      if (t[i] ~ /^-/)                         { i++; continue }      # --no-pager, -p, ...
      break
    }
    if (t[i] == "push") found = 1
  }
  END { print found }
')
[ "$IS_PUSH" = "1" ] || exit 0

# A dry run changes nothing; let it through.
echo "$CMD" | grep -q -- '--dry-run' && exit 0

cd "$PROJECT_DIR" 2>/dev/null || exit 0

# Find the runner. package.json "test" script is the standard; tests/run.sh is
# the fallback for repos that predate it.
RUNNER=""
if [ -f package.json ] && jq -e '.scripts.test' package.json >/dev/null 2>&1; then
  RUNNER="npm test"
elif [ -x tests/run.sh ]; then
  RUNNER="./tests/run.sh"
fi

if [ -z "$RUNNER" ]; then
  # No runner in this repo. Allowed, but say so — G2 in the gap register is
  # exactly this condition, and it should stay visible rather than read as green.
  echo "swl push gate: no test runner in this repo; push allowed unverified (gap G2)." >&2
  exit 0
fi

echo "swl push gate: running '$RUNNER' before allowing the push..." >&2
OUT=$($RUNNER 2>&1)
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo "swl push gate: BLOCKED — '$RUNNER' exited $STATUS. Push is gated on a green suite." >&2
  echo "--- runner output (last 40 lines) ---" >&2
  echo "$OUT" | tail -40 >&2
  echo "--- end runner output ---" >&2
  echo "Fix the failure, or state plainly that the suite is red before asking to push again." >&2
  exit 2
fi

echo "swl push gate: '$RUNNER' green. Push allowed." >&2
exit 0
