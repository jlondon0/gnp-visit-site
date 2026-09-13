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

## What deploys

Workers Builds runs `wrangler deploy` on `wrangler.jsonc`: `src/worker.js` is
the Worker and `./public/` its static assets (binding `ASSETS`). A request for
a file in `public/` is answered by the asset; anything else reaches the Worker,
which serves `/api/calendar` and falls through to the assets' own 404 for the
rest. Nothing is created by hand: the calendar cache uses the Cache API, which
needs no namespace or binding.

## Verifying on the running site from a cloud session

The cloud lane reaches GitHub and nothing else. `live-check.yml` runs on a
GitHub-hosted runner, which reaches both Cloudflare and Google, and is the way
a session sees the site: trigger it (Actions, live-check, Run workflow, or the
Actions API with `ref` set to the branch holding the checkout) after the push
to `main` has built. It fails until the deployed `x-gnp-worker` header equals
`WORKER_BUILD` in `src/worker.js`, then requires a well-formed month and a
cached answer under 1.5 s, and checks the live `calendar.html` build marker.
Its first step times Apps Script directly, which is the baseline the cache is
measured against.

By hand from any machine that reaches the site:

```bash
M=$(date -u +%Y-%m)
curl -sS -D - -o /dev/null -w 'total %{time_total}s\n' "https://visit.guayacanpreserve.com/api/calendar?month=$M" | grep -iE '^(HTTP|x-gnp)|total'
curl -sS -D - -o /dev/null -w 'total %{time_total}s\n' "https://visit.guayacanpreserve.com/api/calendar?month=$M" | grep -iE '^(HTTP|x-gnp)|total'
```

The first line may say `x-gnp-cache: MISS` and take seconds; the second says
`HIT` or `STALE` and takes milliseconds. `x-gnp-age` is the seconds since Apps
Script last answered for that month; `x-gnp-upstream-ms` is how long it took.

## Calendar cache: tuning and the KV upgrade path

`src/worker.js` holds the four knobs: `FRESH_SECONDS` (300, served without
asking upstream), `STALE_SECONDS` (a week, served while refreshing),
`REVALIDATE_GAP_SECONDS` (30, one background refresh per colo per gap) and
`UPSTREAM_TIMEOUT_MS` (25 s). The Cache API is per Cloudflare colo, so the
first visitor at each colo after a week, or after an eviction, waits for Apps
Script once. If that ever matters, the upgrade is a KV namespace shared by all
colos, warmed by a cron trigger: create the namespace in the Cloudflare
dashboard (Workers and Pages, KV), bind it as `CAL_KV` in `wrangler.jsonc`, and
have `calendar()` read KV before the Cache API. A binding to a namespace that
does not exist fails the deploy, so the namespace comes first and the config
second. UNVERIFIED: not built.

## Making the deployed-vs-repo check real

`preflight.sh` cannot compare this repo to production until it is told how.
`.swl-preflight` (committed) points it at the `GNP-BUILD` marker of
`public/calendar.html` on the live site. Each page carries its own marker, so
the check covers the page most recently changed; move it when another page is.
Without the file it reports that check as NOT CHECKED, which is the honest
answer and not the same as passing.

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
