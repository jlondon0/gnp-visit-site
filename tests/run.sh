#!/usr/bin/env bash
# Estate-standard entry point; the runner lives in scripts/run-tests.sh.
exec "$(dirname "$0")/../scripts/run-tests.sh" "$@"
