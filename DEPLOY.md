# Deploying gnp-visit-site

Cloudflare Workers Builds. Push to `main` is the deploy.

## Before you deploy

```bash
./scripts/preflight.sh
```

Lane, working copy against origin, the repo against what is actually serving,
and the baseline you are starting from. A green build means an upload succeeded,
not that the running artifact is current — confirm the version the deployed thing
reports, not the one the build log claims.

## The deployed-vs-repo check

`.swl-preflight` points `preflight.sh` at `calendar.html` and its `CAL_BUILD`
marker. From the NAS or a Mac it fetches the live page and compares; from a
cloud session the fetch is blocked at the egress proxy and the check reports
the deployed version as unreadable, which is the lane, not the site.

## What deploys

Two things, from one `wrangler deploy` that Workers Builds runs on every push
to `main`:

- `public/` as Workers Static Assets (the pages, images, logos).
- `src/worker.js` as the Worker script, bound to those assets as `ASSETS`. It
  answers `GET /api/calendar?month=YYYY-MM` from an edge copy of the Apps
  Script calendar (SWL-KFMU) and hands every other path to the assets.

No package.json, so Workers Builds uses its own wrangler and no install step.
The suite runs `wrangler deploy --dry-run` when a binary is available
(`WRANGLER_BIN=/path/to/wrangler ./tests/run.sh`); that is the same bundling
the build host does, minus the upload.

### /api/calendar

| Copy age | Served | Backend |
|---|---|---|
| under 5 min | edge copy | not called |
| 5 min to 24 h | edge copy at once | refreshed in the background |
| any age, backend failing | last good copy | logged, copy kept |
| nothing cached, backend failing | 502 `{ok:false}` | nothing stored |

Only an `ok:true` answer is stored. `x-gnp-cache: hit | stale | miss` and
`age` on the response say which row applied; `x-gnp-worker` names the Worker
build serving it. A stale month starts one background refresh per data centre
per `REFRESH_GAP_MS` (30 s), not one per visitor. The Apps Script URL lives in
`src/worker.js` as `UPSTREAM`; `index.html` still calls the same web app
directly for `config`, `availability` and the booking POST.

The cache is the Workers Cache API: per data centre, no binding, nothing to
create. To make the copy global and survive evictions, create a KV namespace in
the dashboard, add its id under `kv_namespaces` in `wrangler.jsonc` with
binding `CALENDAR`, and switch `storeCopy` / `cache.match` in `src/worker.js`
to `env.CALENDAR.put` / `get` with the same fetched-at metadata. A namespace
cannot be created by a push, which is why the first version uses the Cache API.

### Verifying a deploy of the calendar

From a cloud session: run `live-check.yml` (Actions, live-check, Run workflow;
or the Actions API with `ref` set to the branch holding the checkout) once the
push to `main` has built. It runs on a GitHub-hosted runner, which reaches both
Cloudflare and Google. It times Apps Script directly as the baseline, fails
until the deployed `x-gnp-worker` header equals `WORKER_BUILD` in
`src/worker.js`, then requires a well-formed month, a cached answer under
1.5 s, and the live `calendar.html` build marker equal to the checkout's.

From a machine outside the cloud lane:

```bash
curl -sS -D - -o /dev/null 'https://visit.guayacanpreserve.com/api/calendar?month=2026-10' | grep -iE '^(HTTP|x-gnp-cache|x-gnp-worker|age)'
curl -sS 'https://visit.guayacanpreserve.com/calendar.html' | grep -o "const CAL_BUILD = '[^']*'"
```

The first call after a deploy reports `x-gnp-cache: miss` and takes as long as
Apps Script does; the second reports `hit` in well under a second. The build
marker must match `public/calendar.html`.

## Backend switch: Apps Script or the sv7n engine

One Worker variable decides it: `ENGINE_BASE`, set in the Cloudflare dashboard
(Workers and Pages, `gnp-visit-site`, Settings, Variables and Secrets, type
Text). `wrangler.jsonc` carries `keep_vars: true`, so a deploy from a push
keeps whatever is set there. Nothing else names the engine host.

| `ENGINE_BASE` | Pages call | `/api/calendar` reads |
|---|---|---|
| unset or blank | Apps Script, exactly as before | Apps Script (`UPSTREAM`) |
| `https://qa.gnp.sv7n.app` (an origin) | the engine, through `/engine/api` on this Worker | the engine's availability |
| set but not an https origin | nothing: pages show "not available", `/engine/api` and `/api/calendar` answer 503 `engine_misconfigured` | nothing |

`ENGINE_EVENT_TYPES` (optional, JSON) maps the page's plan keys to engine
slugs when they differ from `{"AMANECER":"pasadia-amanecer","TARDE":"pasadia-tarde","GUAYACAN24":"guayacan24"}`.

What changes in engine mode: `/config.js` tells every page to use the engine;
index, calendar, manage and pay call the engine's guest routes (only those
six are forwarded); pay offers Stripe Checkout only; review and admin send the
operator to `<ENGINE_BASE>/admin/bookings` (Cloudflare Access); listado and
partner say the feature is not available. `/guest/bookings/<token>` (the
Stripe return) and `/bookings/<token>` redirect to pay and manage, which only
helps once the engine's `site.base_url` is this site (in QA it is the engine
host; see the gaps in CHANGELOG.md, 2026-11-16).

Switch: set the variable, then verify. UNVERIFIED as a dashboard step (not
run from here; the NAS holds a Cloudflare token, but this change was made on a
branch only):

```bash
curl -sS https://visit.guayacanpreserve.com/config.js          # window.GNP_ENGINE = {"enabled":true,...}
ENGINE_SITE=https://visit.guayacanpreserve.com node tests/engine-live.mjs   # read-only
```

Rollback: delete `ENGINE_BASE` (or set it blank). It takes effect at once on
the Worker; `/config.js` is cached for 60 s, so browsers are back on Apps
Script within a minute. What a rollback does not revert: bookings, payments
and cancellations made in the engine stay in the engine and are not in the
Sheet. The calendar copies are keyed per backend, so no stale month from the
other backend is served.

Local run in engine mode, from the NAS. `wrangler dev` refuses `src/worker.js`
as the entry because it exports constants (CHANGELOG.md, 2026-11-16), so it
runs through a wrapper outside the repo:

```bash
mkdir -p /tmp/gnpdev && cd /tmp/gnpdev
printf "import w from '/volume1/Projects/gnp-visit-site/src/worker.js';\nexport default w;\n" > entry.js
printf '{ "name": "gnp-visit-site-dev", "main": "./entry.js", "compatibility_date": "2026-08-01", "assets": { "directory": "/volume1/Projects/gnp-visit-site/public/", "binding": "ASSETS" } }\n' > wrangler.jsonc
/volume1/Projects/sv7n-core/node_modules/.bin/wrangler dev --port 8799 --ip 127.0.0.1 --var ENGINE_BASE:https://qa.gnp.sv7n.app
# another shell:
ENGINE_SITE=http://127.0.0.1:8799 node /volume1/Projects/gnp-visit-site/tests/engine-live.mjs --book
```

## Rolling back

Record the rollback here the first time you need it, including what it does
*not* revert. A rollback that leaves the repo and production disagreeing is a
second incident waiting behind the first.

## Images this site serves for the main website

`public/` carries the main website's image set (`birdwatchers.jpg`,
`hero-forest-mist.jpg`, `gallery-1-wide.jpg`, `gallery-2.jpg` .. `gallery-7.jpg`)
under the exact names the marketing page requests from
`https://gnp.guayacanpreserve.com/`, plus `bird-body.png` and `bird-wing.png`
for the chat widget on both sites. `scripts/run-tests.sh` asserts the set by
name; renaming or removing one is a main-site outage, not a cleanup.

The main website is a separate Cloudflare Worker named `gnp` (Workers Static
Assets from its own `public/`, KV namespace `EBIRD_KV`, secret `EBIRD_API_KEY`,
daily cron). It is deployed by hand with `wrangler deploy` and is in no
repository; a July 2026 snapshot of its source is in Drive under
"04_Projects / GNP latest site / guayacan-gnp-worker".

## gnp.guayacanpreserve.com is a custom domain of this Worker

Update 2026-09-13, later the same day: the main website now serves its own
images from its own repository (`jlondon0/gnp-site`, Workers Builds), so
nothing references this host any more. The domain and the marketing image set
in `public/` can be removed once the main site has been observed serving its
photos for a week; the suite's manifest check goes with them. Until then they
are a harmless safety net.

The chat bird pair here is the original artwork copied from `gnp-site`
(256 px), replacing the reconstruction shipped earlier the same day.

Since 2026-09-13 (SWL-FSBY) the main website's image host,
`gnp.guayacanpreserve.com`, is a Custom Domain on `gnp-visit-site`, alongside
`visit.guayacanpreserve.com`. Removing it from Domains & Routes takes every
photo off www.guayacanpreserve.com again; the main page hardcodes that host.
The bare hostname shows this booking page, which is accepted.

## Restoring the main website's images (SWL-FSBY)

Path A was applied on 2026-09-13 and verified (200 on gallery-2.jpg through
the new host). Both paths kept for the next time; B is UNVERIFIED.

**A. Point the image hostname at this Worker.** No wrangler needed. In the
Cloudflare dashboard, Workers and Pages, `gnp-visit-site`, Settings, Domains
and Routes: add the custom domain `gnp.guayacanpreserve.com`, removing it from
the `gnp` Worker first. The main page keeps its HTML on `gnp` and loads its
images from here. Trade-off: `https://gnp.guayacanpreserve.com/` itself then
shows the booking page rather than the main site.

**B. Redeploy the `gnp` Worker with its images.** On the Mac, where `wrangler`
is logged in (the NAS holds no Cloudflare token):

```bash
cd /path/to/gnp-worker            # the folder holding wrangler.toml and worker.js
curl -fsS -o public/index.html https://www.guayacanpreserve.com/
for f in birdwatchers.jpg hero-forest-mist.jpg gallery-1-wide.jpg gallery-2.jpg \
         gallery-3.jpg gallery-4.jpg gallery-5.jpg gallery-6.jpg gallery-7.jpg \
         logo.png logo-icon.png bird-body.png bird-wing.png; do
  curl -fsS -o "public/$f" "https://visit.guayacanpreserve.com/$f"
done
./node_modules/.bin/wrangler deploy
```

The first `curl` keeps the live HTML rather than the July snapshot, which is
older than the chat widget. `logo.png` and `logo-icon.png` fetched this way are
the booking site's smaller renderings of the same logo; use `site-logo.png` and
`site-logo-icon.png` from this repo if the originals are wanted.

Verify either way with:

```bash
curl -sI https://gnp.guayacanpreserve.com/gallery-2.jpg | head -1
curl -sI https://www.guayacanpreserve.com/gallery-2.jpg | head -1
```

Both must return `200`, then reload both sites with the cache disabled.
