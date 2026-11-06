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
# and it fires on `git commit -m "fix push bug"` (the word in a message).
#
# Probed on 2026-09-14 (SWL-PJHK). The previous parser read only the first word
# of each segment and let seven real invocations through unchecked:
#
#   env git push        command git push     GIT_DIR=.git git push
#   xargs git push      sh -c "git push"     bash -lc "git push"
#   git push origin main   # --dry-run
#
# The last one is the worst shape: line 52 grepped the WHOLE command for the
# string --dry-run, so writing it in a trailing comment exempted a real push.
#
# So: quotes are replaced by spaces (which flattens `sh -c "git push"` into
# ordinary tokens), a leading VAR=value and a known wrapper command are stepped
# over, and --dry-run counts only as its own token in the same segment, before
# any # comment.
#
# What this cannot see, and does not pretend to: a push issued from inside a
# program, e.g. `node -e "...execSync('git push')"`. Bash(node:*) is allowed in
# settings.json, so that path is open by design. The gate is a guardrail on the
# ordinary path, not a sandbox.
# Quotes and backticks become spaces (which flattens `sh -c "git push"` into
# ordinary tokens), and then heredoc BODIES are dropped. A body is data, not
# commands: writing this very release note - which quotes the force flag in
# prose - through a heredoc otherwise reads as a force-push and blocks the
# session. The delimiter is read off the introducing line and the body skipped
# up to it; quotes are already gone, so <<EOF and <<'"'"'EOF'"'"' need no separate case.
SCAN=$(printf '%s' "$CMD" | tr '"'"'"'\140' '   ' | awk '
  BEGIN { inhd = 0 }
  {
    if (inhd) { if ($0 ~ ("^[ \t]*" delim "[ \t]*$")) inhd = 0; next }
    if (match($0, /<<-?[ \t]*[A-Za-z_][A-Za-z0-9_]*/)) {
      delim = substr($0, RSTART, RLENGTH)
      sub(/^<<-?[ \t]*/, "", delim)
      inhd = 1
    }
    print
  }')
IS_PUSH=$(printf '%s' "$SCAN" | awk '
  BEGIN { RS = "[;&|\n]+"; found = 0 }
  {
    n = split($0, t, /[ \t]+/)
    i = 1
    wrapped = 0
    while (i <= n) {
      if (t[i] == "") { i++; continue }
      if (t[i] ~ /^[A-Za-z_][A-Za-z0-9_]*=/) { i++; continue }        # VAR=value
      if (t[i] ~ /(^|\/)(env|command|nohup|time|nice|ionice|stdbuf|xargs|sudo|doas|sh|bash|zsh|dash|ksh)$/) { i++; wrapped = 1; continue }
      break
    }
    # Past a wrapper, the real command can be anywhere in what follows.
    if (wrapped) { while (i <= n && t[i] != "git") i++ }
    if (t[i] != "git") next
    i++
    while (i <= n) {                           # git global options
      if (t[i] == "-C" || t[i] == "-c")        { i += 2; continue }   # takes an argument
      if (t[i] ~ /^--(git-dir|work-tree|namespace|exec-path)=/) { i++; continue }
      if (t[i] ~ /^-/)                         { i++; continue }      # --no-pager, -p, ...
      break
    }
    if (t[i] != "push") next
    # Both remaining questions are answered from the arguments of THIS push, up
    # to any trailing comment. Asking them of the whole command string is the
    # substring mistake this rewrite exists to remove - and it bit immediately:
    # the first version grepped everything for --force and refused a heredoc
    # that quoted the flag inside this very release entry.
    #
    # No apostrophe anywhere in this awk program. It is single-quoted, so one in
    # a comment closes it; the shell then parses awk as shell, dash exits 2 on
    # the syntax error, and exit 2 is this hook contract for BLOCK - so a typo in
    # a comment blocked every Bash call in the session, with a message that
    # pointed at a for loop rather than at the quote.
    force = 0
    for (j = i; j <= n; j++) {
      if (t[j] ~ /^#/) break
      if (t[j] == "--dry-run") next                                  # changes nothing
      if (t[j] ~ /^(--force|--force-with-lease|--force-if-includes|-f)(=|$)/) force = 1
    }
    found = 1
    if (force) forced = 1
  }
  END { print found (forced ? " force" : "") }
')
case "$IS_PUSH" in
  "1 force")
    # A force-push rewrites published history. CLAUDE.md lists it under "always
    # stop and ask", and the settings.json deny rules are prefix matches, so
    # `git push origin main --force` slips past them (probed 2026-09-14).
    echo "swl push gate: BLOCKED - this push rewrites history (--force/-f)." >&2
    echo "CLAUDE.md puts destroying history under 'always stop and ask'. Ask Jorge, and say what will be lost." >&2
    exit 2 ;;
  1) ;;
  *) exit 0 ;;
esac

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

# In a LOGIN shell, so the suite sees the environment ~/.profile sets and the
# hook's inherited one does not (NODE_ICU_DATA on the NAS - see the workbench
# gate, 2026-10-18). The cd is repeated inside, after the profile has run.
echo "swl push gate: running '$RUNNER' (login shell) before allowing the push..." >&2
OUT=$(bash -lc 'cd "$1" && '"$RUNNER" _ "$(pwd)" 2>&1)
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
