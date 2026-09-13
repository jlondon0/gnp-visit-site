# gnp-visit-site

Booking site for Guayacan Natural Preserve: https://visit.guayacanpreserve.com/

Static pages in `public/` (booking form, availability calendar, review, pay,
manage, admin) served as Cloudflare Workers Static Assets, plus one Worker
script, `src/worker.js`, that serves `/api/calendar` from an edge copy of the
Apps Script backend's availability. The backend itself (pricing, bookings,
payments) is the Apps Script web app in `jlondon0/guayacan-reservations-updated`.

## Run the checks

```bash
./tests/run.sh
WRANGLER_BIN=/path/to/wrangler ./tests/run.sh   # also dry-runs the deploy config
./scripts/preflight.sh                           # lane, remote, deployed version, baseline
```

Exits non-zero on any failure; prints `PASSED: n, FAILED: m` and one verdict
line. Baseline on 2026-09-13: 57 passed, 0 failed (58 with a wrangler binary).

`.github/workflows/live-check.yml` measures the running site and the Apps
Script backend from a GitHub runner; DEPLOY.md says when to run it.

## Deploy

Push to `main`. Workers Builds runs `wrangler deploy`. See DEPLOY.md.

## Versions

Pages carry their own build marker (`GNP-BUILD` comment and a `*_BUILD`
constant): index `v2.32.0`, calendar `v2.28.2b`. The Worker reports its own,
`WORKER_BUILD` in `src/worker.js`, as `x-gnp-worker` on `/api/calendar`. The index page compares its
marker against the backend's reported version in the console. Number bump for
a change request, alpha suffix for an issue fix.
