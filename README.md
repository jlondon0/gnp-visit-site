# gnp-visit-site

Booking site for Guayacan Natural Preserve: https://visit.guayacanpreserve.com/

Static pages in `public/` (booking form, availability calendar, review, pay,
manage, admin, sign) served as Cloudflare Workers Static Assets, plus one
Worker script (entry `src/worker.js`, which exports only the handler; the
calendar copy in `src/calendar.js`) that serves `/api/calendar` from an edge
copy of the backend's availability. The backend (pricing, bookings, payments) is the Apps
Script web app in `jlondon0/guayacan-reservations-updated`, or the sv7n engine
when the Worker variable `ENGINE_BASE` is set (`src/engine.js`,
`public/engine-client.js`; DEPLOY.md, "Backend switch").

## Run the checks

```bash
./tests/run.sh
WRANGLER_BIN=/path/to/wrangler ./tests/run.sh   # also dry-runs the deploy config
./scripts/preflight.sh                           # lane, remote, deployed version, baseline
```

Exits non-zero on any failure; prints `PASSED: n, FAILED: m` and one verdict
line. `ENGINE_SITE=<site> node tests/engine-live.mjs [--book]` checks a site
running in engine mode against the live engine (not part of the runner), e.g.
`ENGINE_SITE=https://qa.gnp-visit.sv7n.app`, the QA deployment. Baseline on 2026-09-13: 61 passed, 0 failed (62 with a wrangler binary).

`.github/workflows/live-check.yml` measures the running site and the Apps
Script backend from a GitHub runner; DEPLOY.md says when to run it.

## Deploy

Push to `main`. Workers Builds runs `wrangler deploy`. QA (engine mode, its
own Worker `gnp-visit-site-qa` on https://qa.gnp-visit.sv7n.app) is deployed
from the NAS with `--env qa`. See DEPLOY.md.

## Versions

Pages carry their own build marker (`GNP-BUILD` comment and a `*_BUILD`
constant): index `v2.34.0`, calendar `v2.29.0`, manage `v2.29.0`, pay
`v2.40.0`, review `v2.29.0`, admin `v2.39.1` (its `ADMIN_BUILD` stays the
Apps Script backend version it matches), listado `v1.1.0`, sign `v1.0.0`. The Worker reports its own,
`WORKER_BUILD` in `src/calendar.js`, as `x-gnp-worker` on `/api/calendar`. The index page compares its
marker against the backend's reported version in the console. Number bump for
a change request, alpha suffix for an issue fix.
