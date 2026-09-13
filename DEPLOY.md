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

## Making the deployed-vs-repo check real

`preflight.sh` cannot compare this repo to production until it is told how.
Create `.swl-preflight`:

```sh
URL=https://example.com
VERSION_FILE=src/index.html
VERSION_GREP='const APP_VERSION = "\([^"]*\)"'
```

Until then it reports that check as NOT CHECKED, which is the honest answer and
not the same as passing.

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

## Restoring the main website's images (SWL-FSBY)

Two ways. Both are UNVERIFIED from the cloud lane, which cannot reach the site.

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
