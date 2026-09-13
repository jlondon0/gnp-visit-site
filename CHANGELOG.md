# Changelog

Newest first. Each entry states the symptom, the cause and the fix, per
`SWL_Engineering_Standard.md`.

## 2026-09-13 - SWL-KFMU: calendar takes too long to load
- Symptom: reported from https://visit.guayacanpreserve.com/calendar.html while
  reviewing availability, with an error message on screen. The page's only
  error text is the degraded notice ("No pudimos cargar la disponibilidad en
  vivo..."), shown when the availability call fails; the screenshot itself was
  not readable from the cloud lane, so that reading is inferred from the page.
- Cause: every visit fetched each month straight from the Apps Script Web App,
  which answers a calendar month in seconds and, under load, with an HTML error
  page rather than JSON. The page had no timeout and no memory of a previous
  answer, so every visitor paid the full wait and any bad answer became the
  degraded notice.
- Fix: this Worker now has code (`src/worker.js`, build
  `calendar-cache v1.0.0 · 2026-09-13`) serving `/api/calendar?month=YYYY-MM`
  from the Cache API in front of Apps Script. A month is served as-is for five
  minutes, then served stale for up to a week while one background refresh per
  colo asks Apps Script again; an error page or a not-ok payload never
  displaces a cached answer. `calendar.html` (`v2.28.2a`) reads through that
  path with a 20 second timeout, keeps the last good month in localStorage for
  a day and paints it at once while the fresh copy loads, and still shows the
  saved grid with the degraded notice if the network fails. Month navigation
  during a load no longer paints out of order.
- Not changed: `index.html` still asks Apps Script directly for `config` and
  per-date `availability`; the chat widget posts to it. Only the calendar page
  was reported.
- Tests: `tests/worker.test.mjs` (miss caches, second visitor does not wait,
  stale served at once with one refresh per gap, error page never displaces a
  cached answer, 502 caches nothing, validation, build marker in this file) and
  `tests/calendar-page.test.mjs` (the shipped page script against a stub DOM:
  requests go to `/api/calendar`, a saved month paints before the network
  answers, a failed network with a saved month keeps the grid). Runner adds the
  wrangler and page contracts. Mutation-tested: without `cache.put` the second
  visitor waits; without the background refresh the stale copy never updates;
  the previous `calendar.html` fails all three page contracts.
- Verification on the running site is `.github/workflows/live-check.yml`
  (workflow_dispatch): a GitHub runner measures Apps Script directly, waits for
  the deployed Worker build to match the checkout, and requires a cached month
  under 1.5 s. The cloud lane reaches neither Cloudflare nor Google, so this
  job is its eyes; see DEPLOY.md.
- `.swl-preflight` added so `scripts/preflight.sh` compares the deployed
  calendar build marker against the repo.

## 2026-09-13 - SWL-FSBY: images missing from guayacanpreserve.com; this site now serves them
- Symptom: every image gone from https://guayacanpreserve.com/ while browsing.
  The chat bird on this booking site went blank at the same time.
- Cause: the main website is a separate Cloudflare Worker named `gnp`, deployed
  by hand with `wrangler deploy` and held in no repository. Its page loads every
  image by absolute URL from `https://gnp.guayacanpreserve.com/`, and this site's
  chat widget loaded `bird-body.png` and `bird-wing.png` from
  `https://guayacanpreserve.com/` the same way. Confirmed from the Mac on
  2026-09-13: `gnp.guayacanpreserve.com` had no DNS record at all (its custom
  domain was gone), and the `gnp` Worker never held the photos itself (404 on
  `www.guayacanpreserve.com/gallery-2.jpg`). Both sites lost them together.
- Fix here: the marketing image set (`birdwatchers.jpg`, `hero-forest-mist.jpg`,
  `gallery-1-wide.jpg`, `gallery-2.jpg` .. `gallery-7.jpg`, plus the marketing
  `logo.png` and `logo-icon.png` as `site-logo.png` and `site-logo-icon.png`)
  now lives in `public/` under the exact names the main page requests, so this
  Worker can serve them for `gnp.guayacanpreserve.com`. The chat widget on
  `index.html` and `calendar.html` loads its bird from this origin.
- `bird-body.png` and `bird-wing.png` existed nowhere reachable. Rebuilt from
  the transparent marketing logo (`site-logo-icon.png`): the large pale wing is
  one component, the other four shapes are the body, both on one 420 px square
  canvas so the wing's CSS pivot lands on the same point. Derived from the real
  artwork, not drawn; compare with the original cutouts if a copy turns up.
- Source folders pushed from the NAS (`guayacan-new-site`,
  `guayacan-gnp-site-validated`) were byte-identical July 2026 snapshots;
  collapsed into `public/` and removed, with their `@eaDir` metadata and their
  `index.html`, which embedded the eBird API key client-side. That key is in
  this branch's history and the repository is public: rotate it at
  https://ebird.org/api/keygen and set the new value with `wrangler secret put`
  on the `gnp` Worker.
- First test runner in this repo (`scripts/run-tests.sh`, entry `tests/run.sh`):
  every image a page references must be a file in `public/`; no image may load
  from a guayacanpreserve.com host; the marketing image set must be present by
  name; every image file must carry its format's signature; the bird pair must
  share one canvas; `wrangler.jsonc` must serve `./public/`; no Synology
  metadata tracked. Mutation-tested: a remote `src`, a deleted gallery file and
  a resized wing each turn the suite red. Closes part of gap G5.
- `.gitignore` added (`@eaDir/`, `.DS_Store`, `.env*`, `node_modules/`).
- Version markers untouched; this repo tracks the GNP platform version.
- Later 2026-09-13: `bird-body.png` and `bird-wing.png` replaced with the
  original cutouts from `jlondon0/gnp-site`, which turned out to hold them.
  The main site now serves its own images, so the custom domain below is a
  safety net, not a dependency; see DEPLOY.md.
- Resolved 2026-09-13: `gnp.guayacanpreserve.com` added as a custom domain of
  this Worker in the Cloudflare dashboard (path A). Verified from the Mac:
  `https://gnp.guayacanpreserve.com/gallery-2.jpg` returns 200. That hostname
  is now a production dependency of the main website; see DEPLOY.md.

## 2026-08-04 - correct the legal entity name in the attribution line
- The line first shipped as "Sketch With Light LLC", which is the brand styling
  rather than the registered entity. The signed Articles of Organization and
  Operating Agreement, and the bank beneficial-owner certification, all name the
  entity as SketchWithLight LLC - one word.
- Now reads "Developed in the US by sketchwithlight LLC".
- No registration mark used. No USPTO registration was found in company records;
  the only trade-name filing is a 2015 New Jersey county fictitious-name
  certificate, which is not a trademark. Revisit when a registration issues.

## 2026-08-04 - SWL attribution line (change request)
- Adds "Developed in the US by Sketch With Light LLC" as the last element on
  every page, muted and unobtrusive.
- Wrapped in a `<!-- swl-credit -->` marker and a `.swl-credit` class, identical
  across every SWL application, so the line can be found and asserted estate-wide
  rather than as unrelated per-repo edits.
- Styled inline so it carries no dependency on the page stylesheet.
- Version markers deliberately untouched: this repo tracks the GNP platform
  version, which is kept in lockstep with the Apps Script backend. Bumping the
  frontend alone would desync that pairing.

