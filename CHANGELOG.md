# Changelog

Newest first. Each entry states the symptom, the cause and the fix, per
`SWL_Engineering_Standard.md`.

## 2026-09-13 - SWL-KFMU follow-up: verify the edge copy on the running site, and harden it
- Two sessions took the request at once; the entry below shipped first as #5
  and is the fix. This entry is what the second session added on top of it.
- Verification: the cloud lane reaches neither Cloudflare nor Google, so the
  first fix was shipped without being observed on the site. Added
  `.github/workflows/live-check.yml` (workflow_dispatch): a GitHub runner times
  Apps Script directly, waits for the deployed Worker to report the checkout's
  build, requires a well-formed month and a cached answer under 1.5 s, and
  checks the live `calendar.html` marker. The Worker now carries one version
  string, `WORKER_BUILD` (`calendar-cache v1.0.1 · 2026-09-13`), reported as
  `x-gnp-worker` on every `/api/calendar` answer, which is what the job and
  `scripts/preflight.sh` compare against. The run's numbers are recorded in
  the request closure.
- Hardening: every stale hit started its own background refresh, so a busy
  minute right after a copy aged sent one Apps Script call per visitor, which
  is how Apps Script gets to "Service invoked too many times". The first
  stale hit now re-stores the copy stamped as refreshing and later hits within
  `REFRESH_GAP_MS` (30 s) ride that one refresh.
- Page (`calendar.html` `v2.28.2b`): the last good month is kept in
  localStorage for a day and painted at once on the next visit while the fresh
  copy loads; if the network fails, the saved grid stays on screen under the
  degraded notice instead of an empty one. Month navigation during a load no
  longer paints out of order.
- Tests: the burst and build-marker contracts in `tests/calendar-proxy.test.mjs`;
  `tests/calendar-page.test.mjs` runs the shipped page script against a stub
  DOM (requests go to `/api/calendar`, a saved month paints before the network
  answers, a failed network with a saved month keeps the grid), wired into the
  runner. Mutation-tested: removing the refresh gap, removing the build header
  and reverting the page to `v2.28.2a` each turn the suite red.

## 2026-09-13 - SWL-KFMU: calendar takes too long to load, then shows an error
- Symptom: on https://visit.guayacanpreserve.com/calendar.html the grid sat on
  "Cargando disponibilidad..." for a long time and then showed the degraded
  notice ("No pudimos cargar la disponibilidad en vivo"). Reported while
  reviewing availability; the reporter suggested mirroring the calendar
  somewhere faster than Google Sheets.
- Cause: the page fetched every month straight from the Apps Script web app
  (`?action=calendar&month=`), which reads the bookings sheet on each call and
  answers in seconds on a cold start, through a redirect to
  script.googleusercontent.com. Three such calls left the page at once (the
  month shown plus both neighbours). Nothing cached the answer between
  visitors, and the page's fetch had no timeout, so a slow backend was
  indistinguishable from a dead one until the browser gave up.
- Fix: this Worker now runs a script (`src/worker.js`) in front of the static
  pages and serves `GET /api/calendar?month=YYYY-MM` from an edge copy of the
  backend's answer. A copy under five minutes old is served as is; an older
  one is served at once and refreshed behind the visitor; if the backend is
  down the last good copy is served for up to a day; only a response the
  backend marked `ok:true` is ever stored, so an error cannot be pinned in the
  cache; an invalid month is refused, never forwarded. `calendar.html` reads
  from that endpoint (same origin, no CORS, no redirect) and gives up on a
  month after 15 s, showing the retry notice instead of hanging. The first
  visitor behind each Cloudflare data centre after a deploy still pays one
  backend round trip; everyone after them gets milliseconds. KV would make the
  copy global; see DEPLOY.md for that step.
- Calendar build marker bumped to `v2.28.2a` (issue fix, alpha suffix) and
  `.swl-preflight` added so `scripts/preflight.sh` compares the deployed
  calendar against the repo instead of reporting NOT CHECKED.
- Tests: `tests/calendar-proxy.test.mjs` (plain node, Cache API and fetch
  stubbed) asserts the miss, fresh-hit, stale-hit, backend-down, error-never-
  cached, bad-month and routing contracts; `scripts/run-tests.sh` runs it and
  also asserts that the page reads from `/api/calendar`, no longer names
  Apps Script, carries a fetch timeout, and that `wrangler.jsonc` deploys the
  script with the `ASSETS` binding. Where a wrangler binary is present
  (`WRANGLER_BIN` or `node_modules/.bin`), `wrangler deploy --dry-run` must
  accept the config; its absence is printed as NOT CHECKED. Mutation-tested:
  pointing the page back at Apps Script, disabling the cache read, caching an
  `ok:false` answer and removing the timeout each turn the suite red.
- Screenshot attached to the request could not be opened from the cloud lane
  (toolbox host outside the egress allowlist); the diagnosis is from the code
  path, which has exactly one loading state and one error notice.
- README.md added (gap G5).

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

