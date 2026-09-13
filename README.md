# gnp-visit-site

Booking site for Guayacan Natural Preserve: https://visit.guayacanpreserve.com/

A Cloudflare Worker (`src/worker.js`) serving the static pages in `public/`
plus one endpoint, `/api/calendar?month=YYYY-MM`, an edge cache in front of
the Apps Script backend's calendar month. Everything else the pages need
(config, per-date availability, bookings, payment, chat) goes straight to the
Apps Script Web App whose URL sits at the top of each page's script.

The backend is `jlondon0/guayacan-reservations-updated` (Apps Script, deployed
by hand). Each page carries its own build marker (`<!-- GNP-BUILD: ... -->` and
a matching constant logged at load); the platform version is the backend's.

## Running

There is no build. `wrangler dev` from a machine with wrangler logged in
serves the Worker and the assets locally; pushing to `main` deploys (see
DEPLOY.md).

## Tests

```bash
./tests/run.sh
```

Exits non-zero on any failure and prints one verdict line. Static contracts on
the shipped artifact live in `scripts/run-tests.sh`; behavioural contracts in
`tests/*.test.mjs` run under `node --test` (Node 18 or later, no dependencies).
Baseline at the time of writing: 62 passed, 0 failed.

`.github/workflows/live-check.yml` measures the running site from a GitHub
runner; see DEPLOY.md for when and how to run it.
