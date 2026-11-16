// Contracts for the backend switch (track/engine): the Worker variable
// ENGINE_BASE moves the pages from Apps Script to the sv7n engine, and unset
// puts every page back on Apps Script. Covers the Worker side (src/engine.js
// through the default export), the request shapes the pages send (built by
// public/engine-client.js, loaded from the exact bytes in public/), and the
// pages' wiring (each page reads /config.js and keeps the Apps Script path).
//
// Engine fixtures are answers recorded from https://qa.gnp.sv7n.app on
// 2026-11-16 (engine 0.6.0, gnp-qa seed), trimmed to two days.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker from '../src/worker.js';
import { engineConfig, engineMonth, DEFAULT_EVENT_TYPES } from '../src/engine.js';

const QA = 'https://qa.gnp.sv7n.app';
const TOKEN = 'gT0k3n_abcdefghijklmnopqrstuvwxyz012345';
const read = (f) => readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');

const REC = {
  'pasadia-amanecer': { ok: true, event_type: { slug: 'pasadia-amanecer', name: { es: 'Pasadía - Mañana', en: 'Day Pass - Morning Session' }, currency: 'COP', price_minor: 13000000, price_unit: 'person', capacity_model: 'per_slot' }, timezone: 'America/Bogota',
    slots: [{ start: '2026-12-01T07:00:00-05:00', end: '2026-12-01T11:30:00-05:00', capacity: 8, remaining: 8 }, { start: '2026-12-02T07:00:00-05:00', end: '2026-12-02T11:30:00-05:00', capacity: 8, remaining: 8 }] },
  'pasadia-tarde': { ok: true, event_type: { slug: 'pasadia-tarde', name: { es: 'Pasadía - Tarde', en: 'Day Pass - Afternoon Session' }, currency: 'COP', price_minor: 13000000, price_unit: 'person', capacity_model: 'per_slot' }, timezone: 'America/Bogota',
    slots: [{ start: '2026-12-01T15:00:00-05:00', end: '2026-12-01T18:00:00-05:00', capacity: 8, remaining: 8 }, { start: '2026-12-02T15:00:00-05:00', end: '2026-12-02T18:00:00-05:00', capacity: 8, remaining: 8 }] },
  'guayacan24': { ok: true, event_type: { slug: 'guayacan24', name: { es: 'Guayacan 24 Horas', en: 'Guayacan 24 Hours' }, currency: 'COP', price_minor: 22000000, price_unit: 'person', capacity_model: 'per_slot' }, timezone: 'America/Bogota',
    slots: [{ start: '2026-12-01T14:00:00-05:00', end: '2026-12-02T14:00:00-05:00', capacity: 5, remaining: 5 }, { start: '2026-12-02T14:00:00-05:00', end: '2026-12-03T14:00:00-05:00', capacity: 5, remaining: 5 }] },
};

class FakeCache {
  constructor() { this.store = new Map(); }
  async match(req) { const h = this.store.get(req.url); return h ? h.clone() : undefined; }
  async put(req, res) { this.store.set(req.url, res); }
}

// The Worker's default export with stubbed fetch, Cache API and ASSETS.
function run(env, answer) {
  const calls = [];
  const assets = [];
  globalThis.caches = { default: new FakeCache() };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return answer ? answer(String(url), init || {}) : new Response('{"ok":true}', { status: 200 });
  };
  const e = { ASSETS: { fetch: async (req) => { assets.push(new URL(req.url).pathname); return new Response('asset', { status: 200 }); } }, ...env };
  const ctx = { waitUntil() {} };
  return {
    calls, assets,
    async go(path, init) {
      try { return await worker.fetch(new Request('https://visit.guayacanpreserve.com' + path, init), e, ctx); }
      finally { globalThis.fetch = realFetch; }
    },
  };
}

// engine-client.js from the shipped bytes, in a sandbox with its own window.
function client(engine, extra) {
  const sandbox = { window: { GNP_ENGINE: engine, fetch: extra && extra.fetch }, console, Promise, JSON, Object, Array, String, Number, Math, Error, Date, isFinite, encodeURIComponent, ...(extra || {}) };
  vm.createContext(sandbox);
  vm.runInContext(read('engine-client.js'), sandbox);
  return sandbox.window.GnpEngine;
}
const ON = { enabled: true, api: '/engine/api', admin: QA + '/admin/bookings', eventTypes: { ...DEFAULT_EVENT_TYPES } };

// ------------------------------------------------------------ the switch --

test('config.js: ENGINE_BASE unset (or blank) keeps every page on Apps Script', async () => {
  for (const env of [{}, { ENGINE_BASE: '' }, { ENGINE_BASE: '   ' }]) {
    const res = await run(env).go('/config.js');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /javascript/);
    const body = await res.text();
    assert.match(body, /window\.GNP_ENGINE = null;/);
    const win = {};
    vm.runInNewContext(body, { window: win });
    assert.equal(win.GNP_ENGINE, null);
  }
});

test('config.js: ENGINE_BASE set turns the engine on, with the admin and slugs from configuration', async () => {
  const body = await (await run({ ENGINE_BASE: QA + '/' }).go('/config.js')).text();
  const win = {};
  vm.runInNewContext(body, { window: win });
  assert.deepEqual(JSON.parse(JSON.stringify(win.GNP_ENGINE)), { enabled: true, api: '/engine/api', admin: QA + '/admin/bookings', eventTypes: DEFAULT_EVENT_TYPES, error: null });
  assert.doesNotMatch(body, /script\.google\.com/);
  // Another host is a variable change, not a page change.
  const prod = await (await run({ ENGINE_BASE: 'https://gnp.sv7n.app' }).go('/config.js')).text();
  assert.match(prod, /"admin":"https:\/\/gnp\.sv7n\.app\/admin\/bookings"/);
  // A short cache: a rollback reaches browsers within a minute.
  assert.match((await run({}).go('/config.js')).headers.get('cache-control'), /max-age=60\b/);
});

test('a set but unusable ENGINE_BASE blocks in engine mode, never falls back to Apps Script', async () => {
  for (const bad of ['http://qa.gnp.sv7n.app', 'https://qa.gnp.sv7n.app/api', 'not a url', 'https://qa.gnp.sv7n.app/?x=1']) {
    const c = engineConfig({ ENGINE_BASE: bad });
    assert.equal(c.on, true, bad);
    assert.equal(c.base, null, bad);
    const h = run({ ENGINE_BASE: bad });
    const res = await h.go('/engine/api/availability?event_type=guayacan24&from=2026-12-01&to=2026-12-01');
    assert.equal(res.status, 503, bad);
    assert.equal((await res.json()).error, 'engine_misconfigured');
    assert.equal(h.calls.length, 0, 'nothing is fetched for ' + bad);
  }
  assert.equal(engineConfig({ ENGINE_BASE: 'http://localhost:8787' }).base, 'http://localhost:8787', 'plain http only for a local engine');
  const cfg = await (await run({ ENGINE_BASE: 'http://qa.gnp.sv7n.app' }).go('/config.js')).text();
  assert.match(cfg, /"enabled":true/);
  assert.match(cfg, /"admin":null/);
});

test('ENGINE_EVENT_TYPES overrides slugs; a malformed value blocks', () => {
  assert.equal(engineConfig({ ENGINE_BASE: QA, ENGINE_EVENT_TYPES: '{"TARDE":"tarde"}' }).eventTypes.TARDE, 'tarde');
  assert.equal(engineConfig({ ENGINE_BASE: QA, ENGINE_EVENT_TYPES: '{"TARDE":"tarde"}' }).eventTypes.AMANECER, 'pasadia-amanecer');
  for (const bad of ['{', '[]', '{"TARDE":"Bad Slug"}', '{"TARDE":3}']) {
    assert.equal(engineConfig({ ENGINE_BASE: QA, ENGINE_EVENT_TYPES: bad }).base, null, bad);
  }
});

// ------------------------------------------------------------- the proxy --

test('the engine API is off when ENGINE_BASE is unset: 404, nothing fetched', async () => {
  const h = run({});
  const res = await h.go('/engine/api/availability?event_type=guayacan24&from=2026-12-01&to=2026-12-01');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'engine_off');
  assert.equal(h.calls.length, 0);
});

test('the guest routes the pages use are forwarded to ENGINE_BASE, method, query and body intact', async () => {
  const cases = [
    ['GET', '/api/availability?event_type=pasadia-tarde&from=2026-12-01&to=2026-12-01'],
    ['POST', '/api/bookings', '{"event_type":"guayacan24"}'],
    ['GET', '/api/guest/bookings/' + TOKEN],
    ['POST', '/api/guest/bookings/' + TOKEN + '/cancel', '{"expected_refund_minor":0}'],
    ['GET', '/api/guest/bookings/' + TOKEN + '/payment-options'],
    ['POST', '/api/guest/bookings/' + TOKEN + '/pay', '{}'],
  ];
  for (const [method, path, body] of cases) {
    const h = run({ ENGINE_BASE: QA }, () => new Response('{"ok":true,"x":1}', { status: 201, headers: { 'content-type': 'application/json' } }));
    const res = await h.go('/engine' + path, { method, body, headers: { 'cf-connecting-ip': '203.0.113.9', 'content-type': 'text/plain' } });
    assert.equal(res.status, 201, path);
    assert.equal(await res.text(), '{"ok":true,"x":1}');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(h.calls.length, 1, path);
    assert.equal(h.calls[0].url, QA + path);
    assert.equal(h.calls[0].init.method, method);
    assert.equal(h.calls[0].init.body, body);
    assert.equal(h.calls[0].init.headers['x-forwarded-for'], '203.0.113.9');
    if (method === 'POST') assert.equal(h.calls[0].init.headers['content-type'], 'application/json');
  }
});

test('nothing else reaches the engine through this site: admin, manual payment, reschedule, holds, documents', async () => {
  const refused = [
    ['GET', '/api/admin/bookings'], ['POST', '/api/admin/bookings/bk_1/transition'], ['GET', '/api/admin/settings'],
    ['POST', '/api/guest/bookings/' + TOKEN + '/manual-payment'], ['POST', '/api/guest/bookings/' + TOKEN + '/reschedule'],
    ['POST', '/api/holds'], ['GET', '/api/documents/abc'], ['DELETE', '/api/guest/bookings/' + TOKEN],
    ['GET', '/api/guest/bookings/short'], ['GET', '/api/guest/bookings/' + TOKEN + '/../../admin/bookings'],
    ['POST', '/api/availability'], ['GET', '/admin/bookings'],
  ];
  for (const [method, path] of refused) {
    const h = run({ ENGINE_BASE: QA });
    const res = await h.go('/engine' + path, { method, body: method === 'GET' ? undefined : '{}' });
    assert.equal(res.status, 404, method + ' ' + path);
    assert.equal(h.calls.length, 0, method + ' ' + path);
  }
});

test('an engine that does not answer is a 502 the page can explain', async () => {
  const h = run({ ENGINE_BASE: QA }, () => { throw new Error('connect timeout'); });
  const res = await h.go('/engine/api/guest/bookings/' + TOKEN);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, 'engine_unavailable');
});

test('the engine\'s guest links land on pay and manage; with the engine off they go to the assets', async () => {
  let res = await run({ ENGINE_BASE: QA }).go('/guest/bookings/' + TOKEN + '?payment=success');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/pay?token=' + TOKEN + '&payment=success');
  res = await run({ ENGINE_BASE: QA }).go('/guest/bookings/' + TOKEN + '?payment=cancelled');
  assert.equal(res.headers.get('location'), '/pay?token=' + TOKEN + '&payment=cancelled');
  res = await run({ ENGINE_BASE: QA }).go('/bookings/' + TOKEN);
  assert.equal(res.headers.get('location'), '/manage?token=' + TOKEN);
  const h = run({});
  res = await h.go('/guest/bookings/' + TOKEN + '?payment=success');
  assert.deepEqual(h.assets, ['/guest/bookings/' + TOKEN]);
});

// ---------------------------------------------------------- the calendar --

function engineAnswer(byslug) {
  return (url) => {
    const u = new URL(url);
    assert.equal(u.origin, QA, 'calendar asks the engine, never Apps Script');
    assert.equal(u.pathname, '/api/availability');
    const slug = u.searchParams.get('event_type');
    if (!(slug in byslug)) return new Response(JSON.stringify({ ok: false, error: 'not_found' }), { status: 404 });
    return new Response(JSON.stringify({ ok: true, event_type: { slug }, timezone: 'America/Bogota', slots: byslug[slug] }), { status: 200 });
  };
}
const slot = (day, hhmm, remaining, extra) => ({ start: `${day}T${hhmm}:00-05:00`, end: `${day}T23:00:00-05:00`, capacity: 8, remaining, ...(extra || {}) });

test('calendar in engine mode: a month from the engine in the shape calendar.html reads; Guayacan24 dates are full', async () => {
  const h = run({ ENGINE_BASE: QA }, engineAnswer({
    'pasadia-amanecer': [slot('2026-12-01', '07:00', 8), slot('2026-12-02', '07:00', 2), slot('2026-12-03', '07:00', 0, { unavailable: 'date_exclusive' }), slot('2026-12-04', '07:00', 0, { unavailable: 'date_exclusive' })],
    'pasadia-tarde': [slot('2026-12-01', '15:00', 6), slot('2026-12-02', '15:00', 8), slot('2026-12-03', '15:00', 0, { unavailable: 'date_exclusive' }), slot('2026-12-04', '15:00', 0, { unavailable: 'date_exclusive' }), slot('2026-12-06', '15:00', 8)],
  }));
  const res = await h.go('/api/calendar?month=2026-12');
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(h.calls.length, 2);
  for (const c of h.calls) {
    assert.match(c.url, /from=2026-12-01&to=2026-12-31$/);
    assert.doesNotMatch(c.url, /script\.google\.com/);
  }
  assert.deepEqual(h.calls.map((c) => new URL(c.url).searchParams.get('event_type')).sort(), ['pasadia-amanecer', 'pasadia-tarde']);
  assert.equal(j.ok, true);
  assert.equal(j.data.source, 'engine');
  assert.equal(j.data.minDaysAdvance, null);
  assert.deepEqual(j.data.days['2026-12-01'], { status: 'open', remaining: { AMANECER: 8, TARDE: 6 } });
  assert.deepEqual(j.data.days['2026-12-02'], { status: 'limited', remaining: { AMANECER: 2, TARDE: 8 } });
  assert.deepEqual(j.data.days['2026-12-03'], { status: 'full', remaining: { AMANECER: 0, TARDE: 0 } }, 'Guayacan24 arrival');
  assert.deepEqual(j.data.days['2026-12-04'], { status: 'full', remaining: { AMANECER: 0, TARDE: 0 } }, 'Guayacan24 departure');
  assert.deepEqual(j.data.days['2026-12-06'], { status: 'limited', remaining: { AMANECER: 0, TARDE: 8 } }, 'a session the engine does not offer that day has no room');
  assert.equal(j.data.days['2026-12-05'], undefined, 'a day the engine offers nothing on is absent, so the page shows it unavailable');
});

test('calendar in engine mode: an engine error is never cached, and an Apps Script copy is never served', async () => {
  // A legacy copy of the month sits in the cache from before the switch.
  const h = run({ ENGINE_BASE: QA }, engineAnswer({ 'pasadia-amanecer': [] }));
  await caches.default.put(new Request('https://gnp-visit-site.cache/calendar/2026-12'), new Response('{"ok":true,"data":{"days":{"2026-12-09":{"status":"open"}}}}', { headers: { 'x-gnp-fetched-at': String(Date.now()) } }));
  const res = await h.go('/api/calendar?month=2026-12');
  assert.equal(res.status, 502, 'pasadia-tarde is unknown to the engine: the month cannot be computed');
  assert.equal(caches.default.store.size, 1, 'only the old legacy copy; the failure stored nothing');
});

test('engineMonth reads the recorded QA answers', async () => {
  const text = await engineMonth('2026-12', QA, DEFAULT_EVENT_TYPES, async (url) => new Response(JSON.stringify(REC[new URL(url).searchParams.get('event_type')])));
  const j = JSON.parse(text);
  assert.deepEqual(j.data.days['2026-12-01'], { status: 'open', remaining: { AMANECER: 8, TARDE: 8 } });
});

test('calendar with ENGINE_BASE unset still asks Apps Script', async () => {
  const h = run({}, () => new Response('{"ok":true,"data":{"days":{}}}'));
  await h.go('/api/calendar?month=2026-12');
  assert.match(h.calls[0].url, /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\?action=calendar&month=2026-12$/);
});

// ------------------------------------------------- request shapes (client) --

test('client: off unless /config.js turned it on', () => {
  assert.equal(client(null).enabled(), false);
  assert.equal(client(undefined).enabled(), false);
  assert.equal(client({ enabled: false }).enabled(), false);
  assert.equal(client(ON).enabled(), true);
});

test('client: plans, sessions and prices come from the engine\'s event types', () => {
  const E = client(ON);
  const plans = JSON.parse(JSON.stringify(E.planCatalog({ AMANECER: REC['pasadia-amanecer'], TARDE: REC['pasadia-tarde'], GUAYACAN24: REC.guayacan24 })));
  assert.deepEqual(plans.map((p) => [p.key, p.labelEs, p.labelEn, p.priceMinor, p.currency]), [
    ['PASADIA', 'Pasadía', 'Day Pass', 13000000, 'COP'], ['GUAYACAN24', 'Guayacan 24 Horas', 'Guayacan 24 Hours', 22000000, 'COP']]);
  assert.deepEqual(plans[0].subOptions.map((s) => [s.key, s.labelEs, s.labelEn]), [['AMANECER', 'Mañana', 'Morning Session'], ['TARDE', 'Tarde', 'Afternoon Session']]);
  assert.equal(E.formatMoney(13000000, 'COP'), '$130.000 COP');
  assert.equal(E.formatMoney(13000000, 'XYZ'), null, 'an unknown currency is not displayed as anything');
  // Sessions that disagree on price: no plan price, so no receipt.
  const odd = JSON.parse(JSON.stringify(REC['pasadia-tarde'])); odd.event_type.price_minor = 1;
  const p2 = E.planCatalog({ AMANECER: REC['pasadia-amanecer'], TARDE: odd });
  assert.equal(p2[0].priceMinor, null);
  assert.equal(E.receipt(p2[0], 2), null);
  assert.equal(E.receipt(plans[0], 3).totalMinor, 39000000);
});

test('client: availability URL and slot pick for a date', () => {
  const E = client(ON);
  assert.equal(E.availabilityUrl('pasadia-tarde', '2026-12-02'), '/engine/api/availability?event_type=pasadia-tarde&from=2026-12-02&to=2026-12-02');
  assert.equal(E.slotOn(REC['pasadia-tarde'], '2026-12-02').start, '2026-12-02T15:00:00-05:00');
  assert.equal(E.slotOn(REC['pasadia-tarde'], '2026-12-09'), null);
  assert.equal(E.slotOn({ ok: false }, '2026-12-02'), null);
});

const FORM = {
  plan: 'PASADIA', subOption: 'TARDE', slot: REC['pasadia-tarde'].slots[1], people: 3, lang: 'EN',
  nombre: '  Ana  Maria Lopez ', email: 'ana@example.test', phone: '+573001234567', requerimientos: 'vegetarian',
  arrivalTime: '15:15', hasMinors: true, minorWith: 'Ana', ackAccepted: true, ackText: 'I have read...',
  waiverAccepted: true, waiverName: 'Ana Maria Lopez', waiverText: 'I understand birdwatching...', now: '2026-11-16T12:00:00Z', page: 'index v2.33.0',
};

test('client: POST /api/bookings body has the shape the engine route takes', () => {
  const E = client(ON);
  const b = JSON.parse(JSON.stringify(E.bookingRequest(FORM)));
  assert.equal(E.bookingsUrl(), '/engine/api/bookings');
  assert.equal(b.event_type, 'pasadia-tarde');
  assert.equal(b.slot_start, '2026-12-02T15:00:00-05:00');
  assert.equal(b.quantity, 3);
  assert.equal(b.language, 'en');
  assert.deepEqual(b.customer, { display_name: 'Ana  Maria Lopez', first_name: 'Ana', last_name: 'Maria Lopez', email: 'ana@example.test', phone: '+573001234567', language: 'en' });
  assert.deepEqual(b.consents, [
    { purpose: 'services_ack', granted: true, text_version: 'gnp-visit-index-v2.32.0', channel: 'web' },
    { purpose: 'waiver', granted: true, text_version: 'waiver@1.0.0', channel: 'web' }]);
  for (const c of b.consents) assert.match(c.purpose, /^[a-z][a-z0-9_]{1,39}$/, 'engine consent purpose pattern');
  assert.deepEqual(b.intake.waiver, { accepted: true, signed_name: 'Ana Maria Lopez', text: 'I understand birdwatching...', text_lang: 'en', text_version: 'waiver@1.0.0', at: '2026-11-16T12:00:00Z' });
  assert.equal(b.intake.sub_option, 'TARDE');
  assert.equal(b.intake.arrival_time, '15:15');
  assert.equal(b.intake.special_requests, 'vegetarian');
  assert.equal(b.intake.minor_accompanied_by, 'Ana');
  assert.equal(b.intake.services_ack.accepted, true);
  assert.ok(JSON.stringify(b).length < 64 * 1024, 'under the engine body limit');
  // Guayacan24 has no session: the plan key picks the slug.
  assert.equal(E.bookingRequest({ ...FORM, plan: 'GUAYACAN24', subOption: null, slot: REC.guayacan24.slots[0] }).event_type, 'guayacan24');
  assert.equal(E.bookingRequest({ ...FORM, hasMinors: false }).intake.minor_accompanied_by, null);
});

test('client: the booking request blocks on a missing waiver, signature, slot or event type', () => {
  const E = client(ON);
  const code = (f) => { try { E.bookingRequest(f); return 'none'; } catch (e) { return e.code; } };
  assert.equal(code({ ...FORM, waiverAccepted: false }), 'waiver_required');
  assert.equal(code({ ...FORM, waiverName: '   ' }), 'waiver_name_required');
  assert.equal(code({ ...FORM, ackAccepted: false }), 'ack_required');
  assert.equal(code({ ...FORM, slot: null }), 'slot_missing');
  assert.equal(code({ ...FORM, people: 0 }), 'people_invalid');
  assert.equal(code({ ...FORM, subOption: 'NOCHE' }), 'event_type_unknown');
  const bare = client({ enabled: true, api: '/engine/api' });
  assert.throws(() => bare.bookingRequest(FORM), (e) => e.code === 'event_type_unknown', 'without eventTypes from config the slug is unknown, never guessed');
});

test('client: the booking answer gives the guest their links (the engine emails none)', () => {
  const E = client(ON);
  const r = E.bookingResult({ ok: true, booking: { id: 'bk_1', ref: 'BK-7Q2', status: 'pending_payment', total_minor: 39000000, deposit_minor: 19500000, currency: 'COP' }, guest_token: TOKEN });
  assert.equal(r.ok, true);
  assert.equal(r.ref, 'BK-7Q2');
  assert.equal(r.payNow, true);
  assert.equal(r.depositText, '$195.000 COP');
  assert.equal(r.payUrl, '/pay?token=' + TOKEN);
  assert.equal(r.manageUrl, '/manage?token=' + TOKEN);
  const req = E.bookingResult({ ok: true, booking: { ref: 'BK-1', status: 'requested', deposit_minor: 19500000, currency: 'COP' }, guest_token: TOKEN });
  assert.equal(req.payNow, false, 'a request waits for an operator before any payment');
  assert.equal(E.bookingResult({ ok: false, error: 'sold_out', message: 'there is no room left at that time' }).ok, false);
  assert.equal(E.errorText({ ok: false, error: 'sold_out', message: 'x' }, 'Error', 'ES'), 'Ya no hay cupo para esa fecha y jornada. Elige otra.');
  assert.equal(E.errorText({ ok: false, error: 'weird', message: 'engine says' }, 'Error', 'ES'), 'engine says');
});

const VIEW = {
  ok: true,
  booking: { ref: 'BK-7Q2', status: 'confirmed', status_label: { es: 'Confirmada', en: 'Confirmed' }, slot_start: '2026-12-02T15:00:00-05:00', timezone: 'America/Bogota', quantity: 3, currency: 'COP', total_minor: 39000000, deposit_minor: 19500000, paid_minor: 19500000, refunded_minor: 0, language: 'es' },
  event_type: { slug: 'pasadia-tarde', name: { es: 'Pasadía - Tarde', en: 'Day Pass - Afternoon Session' } },
  can_cancel: true,
  refund_preview: { refund_minor: 9750000, pct_applied: 50, rule: 'tier_0h', hours_before: 30, currency: 'COP' },
};

test('client: manage shows the engine\'s refund preview and cancel pins it', () => {
  const E = client(ON);
  assert.equal(E.guestUrl(TOKEN), '/engine/api/guest/bookings/' + TOKEN);
  assert.equal(E.guestUrl(TOKEN, '/cancel'), '/engine/api/guest/bookings/' + TOKEN + '/cancel');
  assert.equal(E.refundLine(VIEW, 'ES'), 'Si cancelas ahora te reembolsamos $97.500 COP (50% de lo pagado).');
  assert.equal(E.refundLine(VIEW, 'EN'), 'If you cancel now we refund $97.500 COP (50% of what you paid).');
  assert.deepEqual(JSON.parse(JSON.stringify(E.cancelRequest(VIEW))), { expected_refund_minor: 9750000 });
  const s = E.bookingSummary(VIEW);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), { lang: 'es', ref: 'BK-7Q2', date: '2026-12-02', session: 'Pasadía - Tarde · 15:00', people: 3, status: 'Confirmada', paid: '$195.000 COP', payable: false });
  // Unknown refund blocks the cancel button; it is never shown as 0 or 100%.
  const blockedView = { ...VIEW, refund_preview: { blocked: 'policy_missing', message: 'x' } };
  assert.throws(() => E.cancelRequest(blockedView), (e) => e.code === 'refund_unknown');
  assert.match(E.refundLine(blockedView, 'ES'), /No podemos calcular/);
  assert.throws(() => E.cancelRequest({ ...VIEW, can_cancel: false, refund_preview: null }), (e) => e.code === 'cannot_cancel');
  assert.match(E.refundLine({ ...VIEW, refund_preview: { refund_minor: 0, pct_applied: null, rule: 'nothing_paid', currency: 'COP' } }, 'ES'), /Aún no hay pagos/);
});

test('client: pay is Stripe Checkout only; every other answer is a notice', () => {
  const E = client(ON);
  const opts = { ok: true, booking_ref: 'BK-7Q2', currency: 'COP', amount_due_minor: 19500000, due_kind: 'deposit', reason: null, methods: ['stripe'], manual_instructions: null };
  assert.deepEqual(JSON.parse(JSON.stringify(E.payState(opts, 'ES'))), { kind: 'pay', amount: '$195.000 COP', label: 'Depósito requerido', button: 'Pagar con tarjeta, Apple Pay o Google Pay' });
  assert.equal(E.payState({ ...opts, methods: ['manual'] }, 'ES').kind, 'no_stripe', 'a manual method is never offered');
  assert.equal(E.payState({ ...opts, amount_due_minor: 0, reason: 'nothing_due' }, 'ES').kind, 'not_due');
  assert.equal(E.payState({ ...opts, currency: null }, 'ES').kind, 'review', 'unknown currency blocks the payment');
  assert.equal(E.payState({ ok: false, error: 'not_found' }, 'ES').kind, 'error');
  assert.equal(E.checkoutUrl({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), 'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.equal(E.checkoutUrl({ ok: true, url: 'https://evil.example/pay' }), null);
  assert.equal(E.checkoutUrl({ ok: false, error: 'method_disabled' }), null);
});

// ------------------------------------------------------------- the pages --

const PAGES = ['index.html', 'manage.html', 'pay.html', 'review.html', 'admin.html', 'listado.html', 'partner.html'];

test('every page that calls Apps Script reads /config.js and engine-client.js before its own script, and keeps the Apps Script path', () => {
  for (const f of PAGES) {
    const html = read(f);
    const cfg = html.indexOf('<script src="/config.js"></script>');
    const cl = html.indexOf('<script src="/engine-client.js"></script>');
    const api = html.search(/script\.google\.com\/macros\/s\//);
    assert.ok(cfg > 0 && cl > cfg && api > cl, f + ': config.js, then engine-client.js, then the page script');
    assert.ok(api > 0, f + ' keeps the Apps Script URL for ENGINE_BASE unset');
  }
  assert.doesNotMatch(read('calendar.html'), /script\.google\.com/, 'calendar reads /api/calendar in both modes');
});

test('pay page in engine mode offers Stripe only: no transfer, Nequi, Bre-B, QR, receipt upload or mock', async () => {
  const html = read('pay.html');
  const els = {};
  const el = () => ({ value: '', textContent: '', innerHTML: '', className: '', disabled: false, style: {}, classList: { add() {}, remove() {} } });
  const document = { getElementById: (id) => els[id] || (els[id] = el()), querySelector: (q) => els[q] || (els[q] = el()) };
  const E = client(ON);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nload\(\);\s*$/, '\n');
  const sandbox = { window: { GnpEngine: E, location: { search: '?token=' + TOKEN, href: '' } }, document, URLSearchParams, console, JSON, String, Number, Math, Promise };
  sandbox.GnpEngine = E;
  vm.createContext(sandbox);
  vm.runInContext(script + '\nthis.renderEngine = renderEngine; this.ENGINE = ENGINE;', sandbox);
  assert.equal(sandbox.ENGINE, true);
  sandbox.renderEngine({ ...VIEW, booking: { ...VIEW.booking, status: 'pending_payment', paid_minor: 0 } },
    { ok: true, currency: 'COP', amount_due_minor: 19500000, due_kind: 'deposit', methods: ['stripe', 'manual'], manual_instructions: 'Nequi 300' });
  const zone = els.payZone.innerHTML;
  assert.match(zone, /doPayEngine\(\)/);
  assert.match(zone, /Apple Pay/);
  assert.doesNotMatch(zone, /Nequi|Bre-B|Llaves|comprobante|QR|transferencia|Zelle|doPay\(\)/i);
  assert.equal(els.amt.textContent, '$195.000 COP');
});

test('pay page after the Stripe return: success shows a notice and no second pay button', () => {
  const html = read('pay.html');
  const els = {};
  const el = () => ({ value: '', textContent: '', innerHTML: '', className: '', disabled: false, style: {}, classList: { add() {}, remove() {} } });
  const document = { getElementById: (id) => els[id] || (els[id] = el()), querySelector: (q) => els[q] || (els[q] = el()) };
  const E = client(ON);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nload\(\);\s*$/, '\n');
  const sandbox = { window: { GnpEngine: E, location: { search: '?token=' + TOKEN + '&payment=success', href: '' } }, document, URLSearchParams, console, JSON, String, Number, Math, Promise };
  sandbox.GnpEngine = E;
  vm.createContext(sandbox);
  vm.runInContext(script + '\nthis.renderEngine = renderEngine;', sandbox);
  sandbox.renderEngine({ ...VIEW, booking: { ...VIEW.booking, status: 'pending_payment', paid_minor: 0 } },
    { ok: true, currency: 'COP', amount_due_minor: 19500000, due_kind: 'deposit', methods: ['stripe'] });
  assert.match(els.payZone.innerHTML, /Recibimos tu pago/);
  assert.doesNotMatch(els.payZone.innerHTML, /doPayEngine/);
});

test('pay page engine path posts to the guest pay route and follows only a Stripe URL', async () => {
  const html = read('pay.html');
  const posted = [];
  const E = client(ON, { fetch: async (url, init) => { posted.push([url, init]); return { status: 200, json: async () => ({ ok: true, url: 'https://checkout.stripe.com/c/pay/cs_test_9' }) }; } });
  const els = {};
  const document = { getElementById: (id) => els[id] || (els[id] = { textContent: '', className: '', disabled: false, style: {} }) };
  const loc = { search: '?token=' + TOKEN, href: '' };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\nload\(\);\s*$/, '\n');
  const sandbox = { window: { GnpEngine: E, location: loc }, document, URLSearchParams, console, JSON, String, Number, Math, Promise };
  sandbox.GnpEngine = E;
  vm.createContext(sandbox);
  vm.runInContext(script + '\nthis.doPayEngine = doPayEngine;', sandbox);
  await sandbox.doPayEngine();
  assert.equal(posted.length, 1);
  assert.equal(posted[0][0], '/engine/api/guest/bookings/' + TOKEN + '/pay');
  assert.equal(posted[0][1].method, 'POST');
  assert.equal(loc.href, 'https://checkout.stripe.com/c/pay/cs_test_9');
});

test('operator pages hand over to the engine admin; deferred pages say so in both languages', () => {
  const E = client(ON);
  let replaced = null;
  const wrap = { innerHTML: '<div class="brand"><img src="logo.png"></div>old', querySelector: () => ({ outerHTML: '<div class="brand"><img src="logo.png"></div>' }) };
  const hidden = [{ style: {} }];
  const doc = { querySelector: () => wrap, querySelectorAll: () => hidden, body: wrap };
  assert.equal(E.takeOver('admin', doc, { replace: (u) => { replaced = u; } }), true);
  assert.equal(replaced, QA + '/admin/bookings');
  assert.match(wrap.innerHTML, /Abrir el panel de reservas \/ Open the bookings board/);
  assert.match(wrap.innerHTML, /href="https:\/\/qa\.gnp\.sv7n\.app\/admin\/bookings"/);
  assert.match(wrap.innerHTML, /^<div class="brand">/);
  assert.equal(hidden[0].style.display, 'none');

  replaced = null;
  assert.equal(E.takeOver('unavailable', doc, { replace: (u) => { replaced = u; } }), true);
  assert.equal(replaced, null, 'deferred pages do not redirect');
  assert.match(wrap.innerHTML, /No disponible \/ Not available/);
  assert.match(wrap.innerHTML, /no está disponible por ahora/);
  assert.match(wrap.innerHTML, /not available for now/);

  // Engine off: the page runs its Apps Script flow untouched.
  const off = client(null);
  wrap.innerHTML = 'untouched';
  assert.equal(off.takeOver('admin', doc, { replace: () => { throw new Error('no redirect when off'); } }), false);
  assert.equal(wrap.innerHTML, 'untouched');

  // And each page gates its start on it.
  assert.match(read('review.html'), /if \(!\(window\.GnpEngine && window\.GnpEngine\.takeOver\('admin', document, window\.location\)\)\) loadReview\(\);/);
  assert.match(read('admin.html'), /window\.GnpEngine\.takeOver\('admin', document, window\.location\)/);
  assert.match(read('admin.html'), /async function login\(\) \{\n  if \(window\.GnpEngine && window\.GnpEngine\.enabled\(\)\) return;/);
  assert.match(read('listado.html'), /if \(!\(window\.GnpEngine && window\.GnpEngine\.takeOver\('unavailable', document, window\.location\)\)\) \(async function init\(\)/);
  assert.match(read('partner.html'), /if \(!\(window\.GnpEngine && window\.GnpEngine\.takeOver\('unavailable', document, window\.location\)\)\) \{ applyLang\(\); load\(\); \}/);
});

test('index and manage send their engine calls through GnpEngine, never Apps Script, in engine mode', () => {
  const index = read('index.html');
  assert.match(index, /if \(ENGINE\) return submitEngine\(/);
  assert.match(index, /GnpEngine\.postJson\(GnpEngine\.bookingsUrl\(\), body\)/);
  assert.match(index, /GnpEngine\.bookingRequest\(\{/);
  assert.match(index, /if \(ENGINE\) \{\n      CONFIG = await loadEngineConfig\(\);/);
  const manage = read('manage.html');
  assert.match(manage, /if \(ENGINE\) return loadEngine\(\);/);
  assert.match(manage, /if \(ENGINE\) return doCancelEngine\(\);/);
  assert.match(manage, /GnpEngine\.postJson\(GnpEngine\.guestUrl\(token, '\/cancel'\), body\)/);
});
