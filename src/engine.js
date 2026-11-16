/*
 * gnp-visit-site: the switch between the Apps Script backend and the sv7n
 * engine (track/engine).
 *
 * One setting decides which backend the pages use: the Worker variable
 * ENGINE_BASE, the engine's origin (https://qa.gnp.sv7n.app in QA, the
 * production engine later). It is read here and nowhere else:
 *
 *   ENGINE_BASE unset or empty   every page calls Apps Script exactly as before
 *                                (rollback = unset the variable)
 *   ENGINE_BASE set              the pages call the engine through this Worker
 *
 * The browser never learns a backend host from a page. It loads /config.js,
 * which this Worker writes from the variable, and calls the engine through
 * /engine/api/..., which this Worker forwards to ENGINE_BASE. Same origin, so
 * the engine needs no CORS, and the host can move (QA, production, a customer
 * domain) with a variable change and no page change.
 *
 * Only the guest routes the pages use are forwarded; everything else under
 * /engine/ answers 404. ENGINE_EVENT_TYPES (optional, JSON) maps the page's
 * plan keys to the engine's event type slugs when they differ from the
 * defaults below.
 */

export const DEFAULT_EVENT_TYPES = Object.freeze({
  AMANECER: 'pasadia-amanecer',
  TARDE: 'pasadia-tarde',
  GUAYACAN24: 'guayacan24',
});

// The month calendar's "almost full" threshold is the engine's
// booking.low_availability_threshold, read from GET /api/catalogue with the
// month (engine 0.7.0). Presentation only; it never decides whether a booking
// fits. A catalogue without it blocks the month (unknown must block).

export const ENGINE_TIMEOUT_MS = 20 * 1000;
const BODY_LIMIT = 64 * 1024;

// The guest routes the pages call. Method, pattern on the engine path.
// The catalogue is public site data (texts, prices, rules, document texts);
// the documents routes are the engine's signing link for a document left
// unsigned at booking (sign.html), opened by the document's own token.
export const FORWARDED = Object.freeze([
  ['GET', /^\/api\/catalogue$/],
  ['GET', /^\/api\/availability$/],
  ['POST', /^\/api\/bookings$/],
  ['GET', /^\/api\/guest\/bookings\/[A-Za-z0-9_-]{20,200}$/],
  ['POST', /^\/api\/guest\/bookings\/[A-Za-z0-9_-]{20,200}\/cancel$/],
  ['GET', /^\/api\/guest\/bookings\/[A-Za-z0-9_-]{20,200}\/payment-options$/],
  ['POST', /^\/api\/guest\/bookings\/[A-Za-z0-9_-]{20,200}\/pay$/],
  ['GET', /^\/api\/documents\/[A-Za-z0-9_-]{20,128}$/],
  ['POST', /^\/api\/documents\/[A-Za-z0-9_-]{20,128}\/sign$/],
]);

/* The engine origin from ENGINE_BASE.
 *   { on: false }                       unset or blank: Apps Script mode
 *   { on: true, base: 'https://host' }  a usable origin
 *   { on: true, base: null, error }     set but unusable: engine mode, blocked
 * A set-but-wrong value never falls back to Apps Script: that would send real
 * guests to the backend the operator meant to switch off. */
export function engineConfig(env) {
  const raw = env && typeof env.ENGINE_BASE === 'string' ? env.ENGINE_BASE.trim() : '';
  if (!raw) return { on: false };
  let u;
  try { u = new URL(raw); } catch (e) { return { on: true, base: null, error: 'ENGINE_BASE is not a URL' }; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return { on: true, base: null, error: 'ENGINE_BASE must be https' };
  if ((u.pathname && u.pathname !== '/') || u.search || u.hash || u.username || u.password) {
    return { on: true, base: null, error: 'ENGINE_BASE must be an origin only, e.g. https://qa.gnp.sv7n.app' };
  }
  const types = eventTypes(env);
  if (types.error) return { on: true, base: null, error: types.error };
  return { on: true, base: u.origin, eventTypes: types.map };
}

export function eventTypes(env) {
  const raw = env && typeof env.ENGINE_EVENT_TYPES === 'string' ? env.ENGINE_EVENT_TYPES.trim() : '';
  if (!raw) return { map: { ...DEFAULT_EVENT_TYPES } };
  let o;
  try { o = JSON.parse(raw); } catch (e) { return { error: 'ENGINE_EVENT_TYPES is not JSON' }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: 'ENGINE_EVENT_TYPES must be an object' };
  const map = {};
  for (const k of Object.keys(DEFAULT_EVENT_TYPES)) {
    const v = o[k] === undefined ? DEFAULT_EVENT_TYPES[k] : o[k];
    if (typeof v !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v)) return { error: 'ENGINE_EVENT_TYPES.' + k + ' is not a slug' };
    map[k] = v;
  }
  return { map };
}

/* /config.js: what the pages read before they call any backend. */
export function configScript(env) {
  const c = engineConfig(env);
  let value;
  if (!c.on) value = null;
  else value = {
    enabled: true,
    api: '/engine/api',
    admin: c.base ? c.base + '/admin/bookings' : null,
    eventTypes: c.eventTypes || null,
    error: c.error || null,
  };
  const body = '/* gnp-visit-site backend switch, written by the Worker from ENGINE_BASE */\n' +
    'window.GNP_ENGINE = ' + JSON.stringify(value) + ';\n';
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      // Short: a rollback (unset ENGINE_BASE) must reach browsers within a minute.
      'cache-control': 'public, max-age=60',
      'x-content-type-options': 'nosniff',
    },
  });
}

function jsonError(status, error, message, extra) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  for (const k in (extra || {})) headers[k] = extra[k];
  return new Response(JSON.stringify({ ok: false, error, message }), { status, headers });
}

export function forwardedRoute(method, path) {
  return FORWARDED.some(([m, re]) => m === method && re.test(path));
}

/* /engine/api/<rest> -> ENGINE_BASE/api/<rest>, guest routes only. */
export async function handleEngineApi(request, env, fetchImpl) {
  const c = engineConfig(env);
  if (!c.on) return jsonError(404, 'engine_off', 'the engine is not enabled on this site');
  if (!c.base) return jsonError(503, 'engine_misconfigured', c.error);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/engine/, '');
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  if (!forwardedRoute(method, path)) return jsonError(404, 'not_found', 'no such engine route on this site');

  const headers = { accept: 'application/json' };
  const ua = request.headers.get('user-agent');
  if (ua) headers['user-agent'] = ua.slice(0, 512);
  const lang = request.headers.get('accept-language');
  if (lang) headers['accept-language'] = lang.slice(0, 200);
  const ip = request.headers.get('cf-connecting-ip');
  if (ip) headers['x-forwarded-for'] = ip;
  let body;
  if (method === 'POST') {
    body = await request.text();
    if (body.length > BODY_LIMIT) return jsonError(413, 'too_large', 'request body too large');
    headers['content-type'] = 'application/json';
  }
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ENGINE_TIMEOUT_MS) : undefined;
  let res;
  try {
    res = await fetchImpl(c.base + path + url.search, { method, headers, body, redirect: 'manual', signal });
  } catch (err) {
    console.warn('[engine] ' + method + ' ' + path + ' failed: ' + (err && err.message));
    return jsonError(502, 'engine_unavailable', 'the booking engine did not answer');
  }
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      'content-type': res.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/* Engine guest links in their default shape, for a site whose
 * site.guest_links is not set: /guest/bookings/<token>[?payment=success|cancelled]
 * and /bookings/<token>. With site.guest_links set to this site's pages
 * (/manage?token={token}, /pay?token={token}, /sign?token={token}) the
 * engine links there directly and this is only a safety net. Null when the
 * path is not one of them or the engine is off. */
export function guestRedirect(env, url) {
  if (!engineConfig(env).on) return null;
  const m = url.pathname.match(/^\/(?:guest\/)?bookings\/([A-Za-z0-9_-]{20,200})\/?$/);
  if (!m) return null;
  const payment = url.searchParams.get('payment');
  const target = (payment === 'success' || payment === 'cancelled')
    ? '/pay?token=' + encodeURIComponent(m[1]) + '&payment=' + payment
    : '/manage?token=' + encodeURIComponent(m[1]);
  return new Response(null, { status: 302, headers: { location: target, 'cache-control': 'no-store' } });
}

// ---------------------------------------------------------------- calendar --

function lastDay(month) {
  const [y, m] = month.split('-').map(Number);
  return month + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0');
}

/* The engine's availability for one session slug over the month, as
 * { 'YYYY-MM-DD': remaining }. A date the engine offers no slot on is absent.
 * Rejects on anything but an ok:true answer with a slots list. */
async function sessionMonth(base, slug, month, fetchImpl) {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ENGINE_TIMEOUT_MS) : undefined;
  const res = await fetchImpl(base + '/api/availability?event_type=' + encodeURIComponent(slug) + '&from=' + month + '-01&to=' + lastDay(month),
    { headers: { accept: 'application/json' }, signal });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('engine returned non-JSON for ' + slug); }
  if (!res.ok || !j || j.ok !== true || !Array.isArray(j.slots)) throw new Error((j && (j.message || j.error)) || ('engine HTTP ' + res.status + ' for ' + slug));
  const out = {};
  for (const s of j.slots) {
    if (!s || typeof s.start !== 'string' || typeof s.remaining !== 'number') throw new Error('engine slot without start or remaining for ' + slug);
    const day = s.start.slice(0, 10); // the engine writes slot times in the site time zone
    out[day] = Math.max(out[day] || 0, s.remaining);
  }
  return out;
}

/* One month in the shape calendar.html already reads (the Apps Script
 * calendar's): { ok, data: { month, minDaysAdvance, limitedThreshold, days } }.
 * Guayacan24 exclusivity and the morning it closes are the engine's: on those
 * dates every session comes back with remaining 0, so the day reads full.
 * minDaysAdvance is null: the engine applies its own lead time by offering no
 * slot on those days, which the page shows as unavailable. */
export async function engineThreshold(base, fetchImpl) {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ENGINE_TIMEOUT_MS) : undefined;
  const res = await fetchImpl(base + '/api/catalogue', { headers: { accept: 'application/json' }, signal });
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('engine catalogue is not JSON'); }
  const n = j && j.ok === true && j.booking ? j.booking.low_availability_threshold : undefined;
  if (!res.ok || !Number.isInteger(n) || n < 0) throw new Error('engine catalogue has no low_availability_threshold');
  return n;
}

export async function engineMonth(month, base, types, fetchImpl) {
  const sessions = ['AMANECER', 'TARDE'];
  const [threshold, ...per] = await Promise.all([engineThreshold(base, fetchImpl), ...sessions.map((k) => sessionMonth(base, types[k], month, fetchImpl))]);
  const days = {};
  const dates = new Set();
  per.forEach((m) => Object.keys(m).forEach((d) => { if (d.slice(0, 7) === month) dates.add(d); }));
  for (const d of [...dates].sort()) {
    const remaining = {};
    let min = Infinity, allFull = true;
    sessions.forEach((k, i) => {
      const r = per[i][d] === undefined ? 0 : per[i][d];
      remaining[k] = r;
      if (r > 0) allFull = false;
      if (r < min) min = r;
    });
    days[d] = { status: allFull ? 'full' : (min <= threshold ? 'limited' : 'open'), remaining };
  }
  return JSON.stringify({ ok: true, data: { month, minDaysAdvance: null, limitedThreshold: threshold, source: 'engine', days } });
}
