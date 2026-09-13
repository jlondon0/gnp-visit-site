#!/usr/bin/env bash
# gnp-visit-site test runner. Exits non-zero on any failure and prints one
# verdict line. Contracts assert invariants of the shipped artifact (public/),
# not implementation shape. Run from anywhere: ./scripts/run-tests.sh
set -u
cd "$(dirname "$0")/.." || exit 1
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); }
bad(){ FAIL=$((FAIL+1)); printf '  FAIL: %s\n' "$1"; }

# 1. Every image a page references must be a file this Worker serves itself.
#    Absolute image URLs to another host are how SWL-FSBY happened: the chat
#    bird loaded from the marketing Worker and vanished with it.
for page in public/*.html; do
  refs=$(grep -oE '(src|href)="[^"]+\.(png|jpe?g|webp|gif|svg|avif)"' "$page" | sed -E 's/^[a-z]+="//; s/"$//' | sort -u)
  for ref in $refs; do
    case "$ref" in
      data:*) continue ;;
      http://*|https://*|//*) bad "$page references a cross-origin image: $ref"; continue ;;
      /*) f="public$ref" ;;
      *)  f="public/$ref" ;;
    esac
    [ -s "$f" ] && ok || bad "$page references $ref but public/ has no such file"
  done
  grep -qE 'guayacanpreserve\.com/[^" )]*\.(png|jpe?g|webp|gif|svg)' "$page" \
    && bad "$page still loads an image from a guayacanpreserve.com host" || ok
done

# 2. The marketing site's image set is served from here, by the exact names its
#    page requests from gnp.guayacanpreserve.com. Removing or renaming one breaks
#    the main site once that hostname points at this Worker.
for f in birdwatchers.jpg gallery-1-wide.jpg gallery-2.jpg gallery-3.jpg gallery-4.jpg \
         gallery-5.jpg gallery-6.jpg gallery-7.jpg hero-forest-mist.jpg logo-icon.png \
         bird-body.png bird-wing.png; do
  [ -s "public/$f" ] && ok || bad "public/$f is missing or empty"
done

# 3. Image files are what their names claim. A zero-byte or HTML-error body
#    saved under a .png name is the silent version of a missing file.
for f in public/*.png public/*.jpg; do
  sig=$(head -c 4 "$f" | od -An -tx1 | tr -d ' \n')
  case "$f" in
    *.png) [ "$sig" = "89504e47" ] && ok || bad "$f is not a PNG" ;;
    *.jpg) [ "${sig:0:6}" = "ffd8ff" ] && ok || bad "$f is not a JPEG" ;;
  esac
done

# 4. The bird pair must share one canvas so the wing overlays the body exactly.
dim(){ python3 -c "import struct,sys;d=open(sys.argv[1],'rb').read(24);print(*struct.unpack('>II',d[16:24]))" "$1"; }
[ "$(dim public/bird-body.png)" = "$(dim public/bird-wing.png)" ] && ok || bad "bird-body.png and bird-wing.png differ in size"

# 5. Workers Static Assets serves ./public/ and nothing else; anything outside
#    it is not deployed. Synology metadata must never be tracked.
grep -q '"directory": *"./public/"' wrangler.jsonc && ok || bad "wrangler.jsonc assets directory is not ./public/"
git ls-files | grep -qE '(^|/)@eaDir/|\.DS_Store$' && bad "Synology metadata is tracked in git" || ok

echo "PASSED: $PASS, FAILED: $FAIL"
[ "$FAIL" -eq 0 ] && { echo "BASELINE OK"; exit 0; }
echo "SUITE RED"; exit 1
