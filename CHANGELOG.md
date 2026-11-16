# Changelog

Newest first. Each entry states the symptom, the cause and the fix, per
`SWL_Engineering_Standard.md`.

## 2026-11-16 - Engine 0.7.0 on the pages, an entry wrangler accepts, a QA deployment (track/engine)
- Symptom: `wrangler dev` 4.162 and 4.163 stopped on `src/worker.js` with
  "Incorrect type for map entry 'FRESH_MS'" (main too; found in the entry
  below). Cause: current workerd treats every named export of the entry
  module as an entrypoint, and the entry exported constants. Fix: the entry
  exports the fetch handler only; the calendar copy, its constants, `UPSTREAM`
  and `WORKER_BUILD` (now `calendar-cache v1.2.0 · 2026-11-16`) moved to
  `src/calendar.js`; `live-check.yml` and the runner read the markers there.
  The runner now fails when the entry exports anything but `default`
  (mutation-tested). `wrangler deploy --dry-run` and `wrangler dev` pass with
  4.162 (the NAS) and 4.163 (current), default and `--env qa`.
- Engine 0.7.0 (sv7n-core): index `v2.34.0` reads `GET /api/catalogue`
  through the proxy (now forwarded, with a document's view and sign routes):
  plan includes and excludes, session times and arrival instructions, the
  deposit percent, the cancellation policy as sentences, the RNT and legal
  line, the lead time for the date picker, and the waiver text in the page
  language. The booking request signs the waiver as `signatures`
  (`{slug, version, sha256, lang, typed_name, accepted: true}`, plus
  `attest_adult` only for an adult-only template; the GNP waiver is not) next
  to the consents and intake; no waiver text from the engine blocks the
  request. A 409 `document_changed` reloads the catalogue, shows the new text
  and clears the acceptance; the next attempt signs the new version. "Almost
  full" on index and on `/api/calendar` is the catalogue's
  `booking.low_availability_threshold` (a catalogue without it blocks the
  month, nothing is cached). New `sign.html` (`sign v1.0.0`): a document the
  engine left unsigned, shown and signed through `/engine/api/documents/<token>`.
  Guest links: the engine's `site.guest_links` are set by the sv7n-pilots seed
  to `/manage?token={token}`, `/pay?token={token}`, `/sign?token={token}` on
  `site.base_url`; pay already handled `?payment=success|cancelled`.
- QA deployment: `wrangler.jsonc` `env.qa`, Worker `gnp-visit-site-qa`,
  custom domain `qa.gnp-visit.sv7n.app`, `ENGINE_BASE=https://qa.gnp.sv7n.app`
  as a config variable. Production (the top level) is unchanged and Workers
  Builds never reads `env.qa` (DEPLOY.md, "QA deployment").
- Tests: `tests/engine.test.mjs` 34 (catalogue mapping from a recorded QA
  answer, policy and legal lines, the signature shape and its blocks, the
  sign page and index's own script in a stub DOM including the
  document_changed reload, the threshold, the forwarded routes, the QA config
  keeping production as it was). Mutation-tested: signatures dropped,
  attest_adult always sent, the reload removed, a fixed threshold in index or
  in the Worker, the catalogue not forwarded; each turns it red.
- Verified 2026-11-16 on https://qa.gnp-visit.sv7n.app (deployed from the NAS
  with `--env qa`; engine 0.7.0 with `site.base_url` set to this host by the
  seed): `ENGINE_SITE=https://qa.gnp-visit.sv7n.app node tests/engine-live.mjs --book`
  13/13: pages, `/config.js` engine on, the catalogue (both plans, 50%
  deposit, policy, waiver es 1.0.0 with SHA-256, RNT, threshold 2), a
  test-record Guayacan24 booking BK-54DGMU with the waiver signed in the
  request (document signed), the calendar showing 2026-12-10 and 12-11 full,
  the guest view, payment options read only (no Checkout session), the manage
  and pay paths the engine links to, and a cancel (refund 0). Production
  still serves `calendar-cache v1.0.1 · 2026-09-13`.

## 2026-11-16 - Backend switch: the pages can run on the sv7n engine (track/engine)
- Change request: Guayacan moves from Apps Script to the sv7n engine (sv7n-core
  0.6.0; scope in sv7n-core `docs/legacy/gnp-migration-plan.md`, "Scope decided
  2026-11-16"). The engine host must come from configuration, and rollback must
  be one step.
- Switch: the Worker variable `ENGINE_BASE` (dashboard, Worker settings,
  Variables; `wrangler.jsonc` now sets `keep_vars` so a deploy keeps it). Unset
  or blank: every page calls Apps Script exactly as before. Set to an origin
  (`https://qa.gnp.sv7n.app`): the pages call the engine. A set but unusable
  value (not https, has a path) blocks in engine mode with
  `engine_misconfigured`; it never falls back to Apps Script. Optional
  `ENGINE_EVENT_TYPES` (JSON) maps AMANECER, TARDE, GUAYACAN24 to slugs other
  than `pasadia-amanecer`, `pasadia-tarde`, `guayacan24`.
- Worker (`src/engine.js`, `WORKER_BUILD` `calendar-cache v1.1.0 · 2026-11-16`):
  `/config.js` tells the pages which backend to use; `/engine/api/...` forwards
  the six guest routes the pages use to `ENGINE_BASE` and refuses every other
  path (admin, manual payment, reschedule, holds, documents) with 404;
  `/api/calendar` builds the month from the engine's availability (same answer
  shape, cached the same way under a key of its own, so a switch or rollback
  never serves the other backend's copy; Guayacan24 dates come back full);
  `/guest/bookings/<token>` (Stripe return) and `/bookings/<token>` redirect to
  pay and manage.
- Pages (`public/engine-client.js` builds every engine request): index
  `v2.33.0` (plans, sessions and prices from the engine's event types; the
  waiver and the services approval go as consents `waiver` and `services_ack`
  plus intake, with the typed name; the success view carries the pay and manage
  links, since the engine emails none), calendar `v2.29.0` (the engine's lead
  time instead of a fixed 7 days), manage `v2.29.0` (refund preview from the
  engine, cancel pins it; pay link once an operator moved the request to
  pending payment; no reschedule request), pay `v2.40.0` (Stripe Checkout only;
  no transfer, Nequi, Bre-B, QR, receipt upload or mock), review `v2.29.0` and
  admin `v2.39.1` (send the operator to the engine admin, bookings board),
  listado `v1.1.0` and partner (bilingual "not available"). With `ENGINE_BASE`
  unset none of this runs.
- Tests: `tests/engine.test.mjs` (27) in the runner; mutation-tested (a bad
  base falling back to Apps Script, an open proxy, a shared cache key, a
  waiver not required, a non-Stripe checkout URL, a cancellable unknown refund,
  the manual lane in engine mode, review calling Apps Script, a page without
  `/config.js`, an absent session counted as open: each turns it red).
  `tests/defects-v2.39.test.mjs`: the pay doPay sandbox names `ENGINE`, and
  engine mode never reaches the mock; markers repointed to pay v2.40.0 and
  admin v2.39.1 (`ADMIN_BUILD` stays the backend's v2.39.0).
- Verified 2026-11-16 against https://qa.gnp.sv7n.app (engine 0.6.0, gnp-qa
  seed) with the site served by `wrangler dev` and `ENGINE_BASE` set:
  `tests/engine-live.mjs` read the calendar (lead time applied: first day
  2026-11-23), the three plans (Pasadía 130.000 COP with Mañana and Tarde,
  Guayacan 24 Horas 220.000 COP), then made one booking for a test customer
  (`@example.test`, the engine's test-record rule), BK-2VTAFC, status
  requested, deposit 65.000 COP, read it back, and cancelled it with the
  refund it showed (nothing paid, 0). index.html's own script ran against the
  same server: plans, session capacity and receipt rendered from the engine.
- Found, not changed: `wrangler dev` 4.162 refuses `src/worker.js` on `main`
  too ("Incorrect type for map entry 'FRESH_MS'"): the entry module exports
  constants, which current workerd treats as entrypoints. Production runs
  v1.0.1 from September; a deploy built by a current wrangler may be refused
  the same way. Local runs used a wrapper entry outside the repo.

## 2026-11-13 - Pay and admin pages for backend v2.39.0: no mock payment, no secrets
- Pay page (`pay` v2.39.0): whenever the manual lane was not offered the page
  showed "Pagar con tarjeta", which called `confirmPaymentMock` and confirmed the
  booking with no money received. There is no card gateway (owner decision
  2026-11-13). The button now appears only when the backend says
  `mockEnabled === true` (SysAdmin `PAYMENT_MOCK_ENABLED`, default off); an
  older backend sends no such field, which reads as off. Otherwise the guest is
  told we will contact them to arrange the deposit. `doPay` refuses on its own
  unless the last payload enabled the mock.
- Admin page (`admin` v2.39.0, `ADMIN_BUILD` aligned with the backend): backend
  v2.39.0 sends secret SysAdmin rows as `[key, '', {isSecret, isSet}]`. The page
  shows an empty password field with "configurado — escribe para reemplazar" or
  "sin configurar — escribe para definir", never renders a value on a secret
  row, and never sends a blank for a secret (empty means unchanged).
- Tests: `tests/defects-v2.39.test.mjs`, run by `scripts/run-tests.sh`. Each
  fix was removed in turn and the suite went red.

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
- Correction, same day: the first live-check run on main (34776226173) failed
  in its baseline step without measuring anything. It read `UPSTREAM` with a
  one-line pattern and the declaration wraps over two lines, so the URL came
  out empty. The job now extracts the URL by shape and fails loudly on an empty
  marker; the runner exercises the same three expressions against the checkout
  so a reformat is caught before the push.
- Second run on main (34776345783), measured from a GitHub runner: Apps Script
  asked directly answered the current month in 2.28 s, 6.03 s and 1.51 s over
  three attempts; the deployed Worker reported `calendar-cache v1.0.1`, the
  checkout's; `/api/calendar` answered `hit` in 0.120 s and 0.123 s. Its last
  step read no marker from the live `calendar.html` because it fetched the
  `.html` path without following the redirect Static Assets issues to the
  extensionless path; the step now follows redirects and prints the status.
- Third run on main (34776474621) reproduced the report against the backend
  itself: Apps Script asked directly took 33.1 s on the first attempt and
  timed out at 60 s with no bytes on the second. That is what every visitor
  paid before the edge copy. The baseline step is a measurement, so it no
  longer fails the job; only the checks against the site decide.
- Verified on the running site, run 34776650918 on main, green: in the same
  minute Apps Script asked directly took 1.75 s, 31.35 s and 35.01 s;
  `/api/calendar` answered the current month `miss` in 2.20 s (first visitor
  at that data centre after the deploy) and `hit` in 0.052 s; the deployed
  Worker reported `calendar-cache v1.0.1`; `/calendar.html` redirected to
  `/calendar` with HTTP 200 carrying the `v2.28.2b` marker and reading from
  `/api/calendar`. SWL-KFMU closed on that run.

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

