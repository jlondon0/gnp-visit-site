/*
 * gnp-visit-site Worker.
 *
 * Static pages come from ./public/ (Workers Static Assets). This script adds
 * one endpoint in front of the Apps Script backend:
 *
 *   GET /api/calendar?month=YYYY-MM
 *
 * The backend computes a month of availability from the bookings sheet and
 * answers in several seconds on a cold start, which is what SWL-KFMU reported:
 * the calendar page sat on "Cargando disponibilidad..." and then showed its
 * degraded notice. This endpoint keeps a copy of every month at the Cloudflare
 * edge and serves it in milliseconds:
 *
 *   - fresher than FRESH_MS      served as is
 *   - older, within STALE_MS     served at once, refreshed in the background
 *   - backend down               the last good copy is served, however old
 *   - nothing cached, backend down   502 with { ok:false }, never cached
 *
 * Only a response the backend marked ok:true is ever stored, so an error can
 * not be pinned in the cache. An invalid month is refused, not passed upstream.
 *
 * The cache is the Workers Cache API, which needs no binding and no dashboard
 * step: a push to main deploys this file. It is per data centre, so the first
 * visitor in each region after a deploy pays one backend round trip; the copy
 * then serves everyone behind that data centre. KV would make the copy global
 * and survive evictions; that is the documented next step in DEPLOY.md and
 * needs a namespace created in the dashboard first.
 */

export const UPSTREAM =
  'https://script.google.com/macros/s/AKfycbx4OJcB72Mqp3RiLB2iZdFv1j_Gt9NBPU6EgKbWnTVCWkdsKB6AXuVQR7a36iGHDEHC/exec';

export const FRESH_MS = 5 * 60 * 1000;       // serve without asking the backend
export const STALE_MS = 24 * 60 * 60 * 1000; // serve while refreshing behind the visitor
export const UPSTREAM_TIMEOUT_MS = 25 * 1000; // Apps Script cold starts are slow, not infinite

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const CACHE_ORIGIN = 'https://gnp-visit-site.cache';

function json(body, status, extra) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': status === 200 ? 'public, max-age=60' : 'no-store',
  };
  for (const k in (extra || {})) headers[k] = extra[k];
  return new Response(JSON.stringify(body), { status, headers });
}

function cacheKey(month) {
  return new Request(CACHE_ORIGIN + '/calendar/' + month, { method: 'GET' });
}

/* Ask the backend for one month. Resolves to the raw JSON text only when the
 * backend answered ok:true; rejects on anything else so the caller never
 * stores an error. */
async function fetchUpstream(month, fetchImpl) {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout
    ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) : undefined;
  const res = await fetchImpl(UPSTREAM + '?action=calendar&month=' + month, {
    redirect: 'follow',
    signal,
    headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error('upstream HTTP ' + res.status);
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error('upstream returned non-JSON'); }
  if (!parsed || parsed.ok !== true || typeof parsed.data !== 'object') {
    throw new Error((parsed && parsed.error) || 'upstream returned ok:false');
  }
  return text;
}

async function storeCopy(cache, month, text, fetchedAt) {
  await cache.put(cacheKey(month), new Response(text, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, s-maxage=' + Math.floor(STALE_MS / 1000),
      'x-gnp-fetched-at': String(fetchedAt),
    },
  }));
}

/* Fetch a month from the backend and store it. Returns the text, or null when
 * the backend failed (already logged). */
async function refresh(cache, month, deps) {
  try {
    const text = await fetchUpstream(month, deps.fetch);
    await storeCopy(cache, month, text, deps.now());
    return text;
  } catch (err) {
    console.warn('[calendar] backend failed for ' + month + ': ' + (err && err.message));
    return null;
  }
}

export async function handleCalendar(request, ctx, deps) {
  const url = new URL(request.url);
  const month = url.searchParams.get('month') || '';
  if (!MONTH_RE.test(month)) {
    return json({ ok: false, error: 'month must be YYYY-MM' }, 400);
  }

  const cache = deps.cache;
  const now = deps.now();
  const hit = await cache.match(cacheKey(month));
  if (hit) {
    const fetchedAt = Number(hit.headers.get('x-gnp-fetched-at')) || 0;
    const age = now - fetchedAt;
    const text = await hit.text();
    if (age <= FRESH_MS) {
      return new Response(text, { status: 200, headers: json({}, 200, {
        'x-gnp-cache': 'hit', 'age': String(Math.floor(age / 1000)) }).headers });
    }
    // Stale: answer now, refresh behind the visitor.
    ctx.waitUntil(refresh(cache, month, deps));
    return new Response(text, { status: 200, headers: json({}, 200, {
      'x-gnp-cache': 'stale', 'age': String(Math.floor(age / 1000)) }).headers });
  }

  const text = await refresh(cache, month, deps);
  if (text === null) {
    return json({ ok: false, error: 'availability backend unavailable' }, 502,
      { 'x-gnp-cache': 'miss' });
  }
  return new Response(text, { status: 200, headers: json({}, 200, {
    'x-gnp-cache': 'miss', 'age': '0' }).headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/calendar') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ ok: false, error: 'method not allowed' }, 405);
      }
      return handleCalendar(request, ctx, {
        cache: caches.default,
        fetch: (u, init) => fetch(u, init),
        now: () => Date.now(),
      });
    }
    return env.ASSETS.fetch(request);
  },
};
