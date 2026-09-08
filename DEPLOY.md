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
