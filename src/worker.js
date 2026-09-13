// gnp-visit-site Worker.
//
// Serves ./public/ as static assets and puts an edge cache in front of the
// Apps Script calendar endpoint (SWL-KFMU). Apps Script answers a calendar
// month in several seconds on a good day and with an HTML error page on a bad
// one; the calendar page waited on every visit. Now the first visitor at a
// Cloudflare colo pays that cost once, the answer is kept for a week, and any
// later visitor gets it in milliseconds while the Worker asks Apps Script
// again in the background whenever the copy is older than FRESH_SECONDS.
//
// Cache API is per-colo and needs no binding, so this deploys with nothing
// created by hand. A KV-backed shared copy is the documented upgrade path in
// DEPLOY.md if per-colo misses ever matter.

export const WORKER_BUILD = 'calendar-cache v1.0.0 · 2026-09-13';

// Same Apps Script Web App the pages call directly for every other action.
export const UPSTREAM = 'https://script.google.com/macros/s/AKfycbx4OJcB72Mqp3RiLB2iZdFv1j_Gt9NBPU6EgKbWnTVCWkdsKB6AXuVQR7a36iGHDEHC/exec';

export const FRESH_SECONDS = 300;          // served as-is, upstream not asked
export const STALE_SECONDS = 7 * 86400;    // served while upstream is asked again in the background
export const REVALIDATE_GAP_SECONDS = 30;  // at most one background refresh per gap per colo
export const UPSTREAM_TIMEOUT_MS = 25000;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const JSON_TYPE = 'application/json; charset=utf-8';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/calendar') return calendar(request, url, ctx);
    return env.ASSETS.fetch(request);
  }
};

function jsonResponse(status, body, extra) {
  const headers = new Headers({ 'content-type': JSON_TYPE, 'cache-control': 'no-store', 'x-gnp-worker': WORKER_BUILD });
  for (const k in (extra || {})) headers.set(k, extra[k]);
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

function cacheKeyFor(url, month) {
  return new Request(url.origin + '/api/calendar?month=' + month, { method: 'GET' });
}

async function calendar(request, url, ctx) {
  if (request.method !== 'GET') return jsonResponse(405, { ok: false, error: 'GET only' }, { allow: 'GET' });
  const month = url.searchParams.get('month') || '';
  if (!MONTH_RE.test(month)) return jsonResponse(400, { ok: false, error: 'month must be YYYY-MM' });

  const cache = caches.default;
  const key = cacheKeyFor(url, month);
  const now = Date.now();
  const hit = await cache.match(key);

  if (hit) {
    const fetchedAt = Number(hit.headers.get('x-gnp-fetched-at')) || 0;
    const ageSeconds = Math.max(0, Math.round((now - fetchedAt) / 1000));
    const state = ageSeconds <= FRESH_SECONDS ? 'HIT' : 'STALE';
    if (state === 'STALE') {
      const revalidatingAt = Number(hit.headers.get('x-gnp-revalidating-at')) || 0;
      if (now - revalidatingAt > REVALIDATE_GAP_SECONDS * 1000) {
        ctx.waitUntil(revalidate(cache, key, hit.clone(), month, now));
      }
    }
    return jsonResponse(200, await hit.text(), {
      'x-gnp-cache': state,
      'x-gnp-age': String(ageSeconds),
      'x-gnp-upstream-ms': hit.headers.get('x-gnp-upstream-ms') || ''
    });
  }

  let fetched;
  try { fetched = await fetchUpstream(month); }
  catch (err) {
    return jsonResponse(502, { ok: false, error: 'upstream: ' + (err && err.message || err) }, { 'x-gnp-cache': 'MISS' });
  }
  await cache.put(key, storable(fetched, now));
  return jsonResponse(200, fetched.body, { 'x-gnp-cache': 'MISS', 'x-gnp-age': '0', 'x-gnp-upstream-ms': String(fetched.ms) });
}

// Mark the entry as being refreshed so the next STALE hits in the gap do not
// each start their own upstream call, then replace it when upstream answers.
// A failed refresh leaves the stale copy in place: old availability with a
// retry pending beats an error page.
async function revalidate(cache, key, stale, month, now) {
  const marker = new Response(stale.body, { headers: new Headers(stale.headers) });
  marker.headers.set('x-gnp-revalidating-at', String(now));
  await cache.put(key, marker);
  try {
    const fetched = await fetchUpstream(month);
    await cache.put(key, storable(fetched, Date.now()));
  } catch (err) {
    console.warn('calendar revalidate failed for ' + month + ': ' + (err && err.message || err));
  }
}

function storable(fetched, at) {
  return new Response(fetched.body, {
    headers: {
      'content-type': JSON_TYPE,
      'cache-control': 'public, max-age=' + STALE_SECONDS,
      'x-gnp-fetched-at': String(at),
      'x-gnp-upstream-ms': String(fetched.ms)
    }
  });
}

// Resolves to { body, ms } only for a well-formed calendar payload. Anything
// else - a timeout, an HTML error page, a JSON error - rejects, so a bad
// answer never displaces a good cached one.
export async function fetchUpstream(month) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetch(UPSTREAM + '?action=calendar&month=' + month, { redirect: 'follow', signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 120));
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error('not JSON: ' + text.slice(0, 120)); }
    if (!json || json.ok !== true || !json.data || typeof json.data !== 'object') {
      throw new Error((json && json.error) || 'calendar payload not ok');
    }
    return { body: JSON.stringify(json), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
