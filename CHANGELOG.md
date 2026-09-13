# Changelog

Newest first. Each entry states the symptom, the cause and the fix, per
`SWL_Engineering_Standard.md`.

## 2026-09-13 - SWL-FSBY: images missing from guayacanpreserve.com; this site now serves them
- Symptom: every image gone from https://guayacanpreserve.com/ while browsing.
  The chat bird on this booking site went blank at the same time.
- Cause: the main website is a separate Cloudflare Worker named `gnp`, deployed
  by hand with `wrangler deploy` and held in no repository. Its page loads every
  image by absolute URL from `https://gnp.guayacanpreserve.com/`, and this site's
  chat widget loaded `bird-body.png` and `bird-wing.png` from
  `https://guayacanpreserve.com/` the same way. That Worker stopped serving its
  images (redeployed without them, or the hostname lost its route; not
  observable from the cloud lane), and both sites lost them together.
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
- The main site itself still needs one Mac-lane action; see DEPLOY.md.

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

