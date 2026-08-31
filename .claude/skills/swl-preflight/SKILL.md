---
name: swl-preflight
description: The Sketch With Light working protocol and engineering standard — PREFLIGHT checks, the change protocol, dangerous defaults, the deploy map, and the three execution lanes. Load before any functional change to any SWL project, and whenever a session needs to know how a repo deploys, where its working copy lives, or what escalates to Jorge.
---

# SWL PREFLIGHT

Vendored from `jlondon0/swl-canon` (`protocol/SWL_Working_Protocol.md`,
`protocol/SWL_Engineering_Standard.md`, `infrastructure/NAS.md`). Canon lives
there; this is the operating copy. If they disagree, canon wins — and fix this
file in the same change.

---

## 1. The three lanes

Know which one you are in before planning anything. Each reaches different things.

| Lane | Runs on | Can reach | Cannot reach |
|---|---|---|---|
| **Cloud** — claude.ai/code session | Anthropic sandbox | GitHub, Anthropic API | Cloudflare, Google, the NAS, any LAN host, any vendor API |
| **NAS** — local session using `ssh nas` | Synology DS920+ | Everything: Cloudflare (stored token), the working copies, deploy paths | — |
| **Mac** — local session, no ssh | this Mac | SMB shares, photos, local files | the working copies (see below) |

**In the Cloud lane, the git push *is* the deploy.** That is the documented
bridge: Claude pushes, the platform builds. Do not attempt `wrangler`, `clasp`,
or any vendor API call from the cloud sandbox — it will fail at the egress
allowlist, not at auth, and the error will mislead you.

**Never touch a repository over SMB.** `/Volumes/Projects` is case-insensitive
and copying through it sets the executable bit on every file — that produced 95
phantom modifications across two repos on 2026-08-28. The single working copy of
every repository is `/volume1/Projects/<repo>`, reached with `ssh nas`. Neither
Mac has a `~/Projects`; a command beginning `cd ~/Projects/...` is a defect.

### NAS lane mechanics

- A non-login SSH command gets a minimal PATH. **Every** remote script begins:
  `export PATH=$PATH:/usr/bin:/usr/local/bin` — otherwise `node`, `npm` and
  `git` all report as not found.
- **`npx` does not exist.** Invoke local binaries directly:
  `./node_modules/.bin/wrangler`.
- Every git remote there must be SSH, never HTTPS. HTTPS cannot authenticate on
  a headless box (`could not read Username for 'https://github.com'`).
- `@eaDir` directories reappear after every clone. Gitignored, not fought.

---

## 2. PREFLIGHT — establish reality before touching anything

In order. Do not begin proposing until it is complete.

1. **Read canon.** This skill, the repo's own `README.md` / `DEPLOY.md` /
   `CHANGELOG.md`.
2. **Establish what access actually exists.** Not what should exist — what
   responds right now. Each is a separate check: repository read/write (call the
   API, read the status code), network egress, browser automation, Drive.
3. **Verify the deployed artifact matches the repo.** A green build means an
   upload succeeded, not that the running app is current. Compare the repo's
   version marker against the version the app reports.
4. **State the gaps before starting**, not when blocked halfway.

### Distinguish "cannot" from "have not checked"

The single most expensive error is reporting a limit that was never tested.
Status codes lie by omission: an unauthenticated GitHub API call returns 403
when rate-limited and 404 for a private repo. Read the body, read the headers,
then conclude.

---

## 3. Change protocol

Non-negotiable order. Each step gates the next.

1. **Reproduce.** Write the failing assertion first, against the real code
   extracted from the shipped artifact — never against a re-implementation.
   If it cannot be reproduced, the cause is not yet understood.
2. **Fix.**
3. **Mutation-test.** Revert the fix and confirm the harness fails. *A check
   that cannot fail is worth no more than no check at all.* If the mutation
   passes, the test is wrong, not the code — say so and strengthen it.
4. **Verify on the shipped artifact.** Re-check the property against the exact
   bytes that will deploy, and confirm the harness reads the staged file rather
   than a stale copy elsewhere in the tree.
5. **Full suite green before pushing.** Gate the push on the runner's own
   verdict, mechanically. Never push and then check.

**Contracts assert invariants, not implementation shape.** When a guard fires
because a legitimate refactor moved the code it was pinned to, repoint it at the
invariant and make it stricter — never delete it, never loosen it. When a guard
fires because something genuinely new was added, account for it explicitly in
the contract with a comment naming what and why.

---

## 4. Diagnosis

- **Never guess a cause when the code destroys the evidence.** If failures are
  masked — a generic message overwriting a specific one, an error styled as help
  text, a handler that never runs — fix the evidence path first and re-observe.
  Three consecutive pXPNS defects were in the feedback path, not the logic.
- When the answer is genuinely not derivable, **ask one precise question** with
  the discriminating options. Do not offer a ranked list of hypotheses in place
  of asking, and do not ask for anything obtainable.
- A screenshot from the operator is evidence: read it for what it actually
  shows, including the things they did not point at.

---

## 5. Dangerous defaults

Patterns that produce plausible, wrong data — the worst failure class, because
nothing looks broken.

- **An unknown value silently treated as a known one.** An undetected currency
  falling through to "already USD" wrote raw COP figures as dollars. Unknown
  must block, never default.
- **Merge semantics.** Where an update merges, a present-but-empty key erases
  and an absent key preserves. Write nothing when nothing was touched.
- **Identity built from volatile strings.** Deduplication keys on what does not
  vary between two views of the same record, and compares the value the record
  will *land* with, not the one it arrived with.
- **Model output used for facts it cannot know.** Never ask a language model for
  a historical exchange rate, a legal rate, or any published figure. Use an
  authoritative source; the model reads and structures, it does not supply data.

---

## 6. Repository contract

Every repo, no exceptions:

| Artifact | Purpose |
|---|---|
| `.gitignore` | Committed first. Excludes `node_modules`, venvs, `.env*`, credentials, build output |
| `README.md` | What it is, how it runs, current version, test baseline |
| `DEPLOY.md` | The pipeline, its trigger, and every constraint that would break it |
| `CHANGELOG.md` | Newest first. Symptom, cause, fix |
| `tests/` + runner | Exits non-zero on failure, prints one verdict line |
| Deploy config | `wrangler.jsonc` (Cloudflare) or `.clasp.json` (Apps Script) |
| Version marker | Single source in code, asserted by a test, reported at runtime |

Binary assets do not belong in Git unless they are the product.

**Versioning:** number bump for a feature or change request, alpha suffix for an
issue fix. Tag every release. **Complete files only** — no partial snippets, no
emoji. **One deploy path per target**; two pipelines racing on one artifact is
how the wrong build wins.

---

## 7. Deploy map — verified 2026-08-28

| Project | Repo | Mechanism | Trigger | Manual step |
|---|---|---|---|---|
| pXPNS | `jlondon0/pxpns` | Cloudflare Workers Builds | push to `main` | none |
| GNP booking site | `jlondon0/gnp-visit-site` | Cloudflare Workers Builds | push to `main` | none |
| GNP backend | `jlondon0/guayacan-reservations-updated` | clasp push to Apps Script | manual | **"Deploy > New version" in the editor** |
| JLP site | `jlondon0/jlp-website` | GitHub Actions (`publish.yml`) | 30-min schedule + on demand | none, but not push-triggered |
| SWL Toolbox | `jlondon0/swl-toolbox` | `node ship.mjs` on the NAS | run by hand | typed `y` for production |
| SWL Requests | `jlondon0/swl-toolbox` (`requests/`) | same release as the toolbox | same | same |
| SWL main site | `jlondon0/swl-site` | `wrangler deploy` on the NAS | run by hand | not yet on Workers Builds |

The toolbox and requests Workers deploy as **one release** from one repository.
They share a version; deploying them separately is how `intake` sat a release
behind.

**Target for all new projects:** GitHub repo, tests, Cloudflare Workers Builds
Git integration. Push to `main` is the deploy.

### Constraints that hold everywhere

- **An environment inherits the top-level `[[routes]]` unless it declares its
  own.** A ship script running with `CI=true` auto-answers *yes* to wrangler's
  domain-reassignment prompt. On 2026-08-28 that moved
  `toolbox.sketchwithlight.com` onto the sandbox Worker mid-deploy and the live
  site served the QA database. **Every `[env.*]` in every wrangler config must
  carry `routes = []`.** `workers_dev = true` adds a workers.dev host; it does
  not remove an inherited custom domain.
- **Workers Static Assets requires a dedicated directory** (`./public/`,
  `./src/`). Pointing it at the repo root serves the wrong files and 404s.
- Where OAuth `redirect_uri` derives from `window.location.origin`, renaming or
  re-routing a Worker breaks sign-in *and* orphans per-origin local storage.
  Treat the origin as a fixed contract.

---

## 8. Keys and credentials

- **Never in Git.** `.env` per project, `.env.example` committed, secret
  scanning before commit.
- Enumerate everything needed **before** asking, and ask once, in one message.
  The only legitimate asks are credentials only Jorge can mint and OAuth grants
  against his own accounts. Everything else is to be obtained, not requested.
- Specify scopes exactly. A fine-grained GitHub PAT needs Metadata:Read plus
  Contents:Read-and-write — Contents does not auto-select. Writing
  `.github/workflows/*` additionally needs Workflows.
- Tokens are session-scoped: environment variables, never written to disk, never
  echoed. A token pasted into a transcript has been disclosed.
- **Known exception:** `~/.swl-env` on the NAS holds `CLOUDFLARE_API_TOKEN`, mode
  600, because `wrangler login` needs a browser and the build host is headless.
  Documented, not hidden. Never read, echo, or copy it.
- **Third-party APIs are a dependency, not a detail.** Record which host, which
  endpoint, the free-tier limit, and the failure mode. Some vendors answer quota
  exhaustion with HTTP 200 and prose — handle that explicitly or it reads as
  success.

---

## 9. Register — lead with the build, not the boundary

Every constraint is a design input. Write it as one.

- Open with the ambition and the path to it. Never open with a limitation.
- When something gets in the way, name the mechanism that handles it rather than
  the wall. Not "the agent cannot see its own output" but "the preview URL is
  how the agent sees its work."
- Put the engineering caveat inside the plan, at the step where it does work. A
  risk with a mitigation beside it is design; the same risk alone is a complaint.
- Offer shapes, not gates. Two named options with their trade-offs move faster
  than one question waiting for an answer.

**This is framing, never substance.** A real defect, a security concern, or a
wrong fact is stated plainly and immediately, however it reads. Accuracy is not
negotiable; pessimism as a default posture is.

Own errors plainly and immediately, including errors in verification. A
verification claim that turns out to be unfounded is a defect in its own right
and is corrected in writing — in the changelog, not only in conversation.

---

## 10. House spellings and fixed strings

- **`Guayacan` — no tilde, everywhere.** Code, templates, config, UI strings,
  documents. Not `Guayacán`.
- Meta's consoles are dense and change often; when writing instructions for
  them, start from an exact URL, name every click by its printed label in order,
  and name the controls to leave alone. See canon §6b for the full recipe and
  the four recorded mistakes.

---

## 11. Open gap register

Deviations from the standard, severity ordered. Treat one found in the estate as
a defect to log, not a local peculiarity to work around.

- **G1** — GNP backend requires a manual "Deploy > New version". The only
  undocumented-by-design manual step left, and it is on the system that takes
  money.
- **G2** — No tests anywhere except pXPNS. GNP handles bookings, pricing, tax
  and payments with zero automated verification; pXPNS has 45 suites. The risk
  is inverted.
- **G3** — `node_modules` committed in `jlp-website`, which has no `.gitignore`.
- **G4** — ~7 MB of JPEGs committed at repo root in `jlp-website`. Git or Drive
  is the source of truth for photographs; it cannot be both.
- **G5** — `gnp-visit-site` has no README, DEPLOY, CHANGELOG or tests.
- **G6** — No CHANGELOG on GNP, gnp-visit-site or JLP.
- **G7** — Config format drift. Standardise on `wrangler.jsonc`.
- **G8** — JLP deploys on a 30-minute schedule, not on push.
- **G9** — `swl-site` is not on Workers Builds.
- **G10** — Retired Workers still on the account (`old-pxpns`, `demo-pxpns`,
  `gnptst`, `qhabibi`, `habibi`). A dead Worker on a live name is how the wrong
  thing ends up serving a hostname.
- **G11** — **The pXPNS baseline tolerates failures by count, not identity.**
  `scripts/run-tests.sh:56` is `[ "$FAILS" -le 2 ] && exit 0 || exit 1`, so any
  two failing assertions pass. It sits at exactly two today, so one more does
  block — but the guard cannot tell a known-benign failure from a fresh
  regression. **The push gate delegates to this verdict, so every automated push
  in that repo inherits the tolerance.** Close by pinning the baseline to the
  identity of the two known assertions rather than their count.
- **G12** — pXPNS has no committed lockfile. `npm ci` fails; `fake-indexeddb` is
  pinned to `"*"`. A clean clone is not reproducible, and a missing dependency
  crashes two suites, which reads as red for an environment reason.

Sequencing: G3/G7 first (minutes, no risk) → G5/G6 → G12 → G11 → G2 on GNP →
G1 → G8 → G4.

**On the push gate's authority.** `.claude/hooks/gate-push.sh` blocks a push
when the repo's own runner exits non-zero. It is a relay, not a judge: it is
exactly as strict as the runner it calls, and a repo with no runner passes
through with a warning. Strengthening a weak runner is the way to strengthen the
gate — never loosen the gate to get a push through.
