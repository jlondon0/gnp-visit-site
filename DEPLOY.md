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

## Images this site does not own

The chat widget on `index.html` and `calendar.html` loads `bird-body.png` and
`bird-wing.png` from `https://guayacanpreserve.com/`. That host is the marketing
site, a separate Cloudflare Worker named `gnp` with its own `public/` directory,
deployed by hand with `wrangler deploy` from a workstation. It is not in this
repository and not on Workers Builds. If that Worker is redeployed without its
images, or `guayacanpreserve.com` / `gnp.guayacanpreserve.com` stop routing to
it, the chat bird here goes blank together with every image on the main site.

To make this site self-contained, copy the two PNGs into `public/` and point
the four `<img>` tags at the relative paths. The files are not in git history;
take them from the `gnp` Worker's working copy or from the live host while it
serves them.

## Restoring the marketing site's images (SWL-FSBY, 2026-09-13)

Runs only where `wrangler` is logged in to Cloudflare; the NAS holds no
Cloudflare token, so this is a Mac-lane action. UNVERIFIED from the cloud lane.

1. Discriminate the cause first. Both commands below must be run from a machine
   that can reach the site:

   ```bash
   curl -sI https://gnp.guayacanpreserve.com/gallery-2.jpg | head -1
   curl -sI https://www.guayacanpreserve.com/gallery-2.jpg | head -1
   ```

   404 on both: the `gnp` Worker was deployed from a `public/` without the
   images (Workers Static Assets replaces the whole file set on every deploy).
   Redeploy from a working copy whose `public/` holds them.
   404 or a foreign page on `gnp.` only: the hostname lost its route to the
   `gnp` Worker. Fix the custom domain in the dashboard; no deploy needed.

2. Source of truth for the images: the `gnp` working copy on the NAS if it
   exists (`/volume1/Projects/gnp-site` per the toolbox request), otherwise the
   Drive folder "GNP latest site / guayacan-gnp-worker / public" (July 2026:
   `index.html`, `logo.png`, `logo-icon.png`, `birdwatchers.jpg`,
   `hero-forest-mist.jpg`, `gallery-1-wide.jpg` .. `gallery-7.jpg`).
   Do not deploy the older "guayacan-new-site/index.html": it still carries the
   eBird API key client-side, which the worker version moved server-side.
   The bird PNGs are not in that snapshot; keep the live copies if any deploy
   still serves them before overwriting.

3. Verify on the running site after the deploy, image by image, with the two
   `curl -sI` lines above returning `200`.
