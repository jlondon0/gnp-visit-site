// Live check of the engine path, against a running site in engine mode: the
// QA deployment (https://qa.gnp-visit.sv7n.app, wrangler env qa), wrangler dev
// with ENGINE_BASE set, or the production site once it is switched. Not part
// of tests/run.sh: it needs the network and a seeded engine (engine 0.7.0).
//
//   ENGINE_SITE=https://qa.gnp-visit.sv7n.app node tests/engine-live.mjs          read-only
//   ENGINE_SITE=https://qa.gnp-visit.sv7n.app node tests/engine-live.mjs --book   plus one test booking
//
// Read-only: the pages, /config.js, the month calendar, the public catalogue
// through the /engine/api proxy (plans, waiver text and SHA-256), the plan
// list the booking page builds from it. With --book it makes ONE Guayacan24
// booking for a test customer (qa-acceptance+<run>@example.test, which the
// GNP engine's crm.test_record_match marks as a test record: its messages are
// skipped at delivery and it stays out of reports), with the waiver signed in
// the request as the booking page signs it; checks the calendar shows both of
// its dates full; reads it back through the guest route; then cancels it with
// the refund it was shown. No Stripe Checkout session is created. Request
// bodies are built by public/engine-client.js, the code the pages run. The
// guest token is never printed. One PASS or FAIL line per check.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SITE = (process.env.ENGINE_SITE || '').replace(/\/+$/, '');
if (!SITE) { console.error('set ENGINE_SITE, e.g. https://qa.gnp-visit.sv7n.app'); process.exit(2); }
const BOOK = process.argv.includes('--book');

const results = [];
const check = (name, pass, evidence) => { results.push(!!pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(evidence)}`); return !!pass; };
const get = async (path, redirect = 'manual') => { const r = await fetch(SITE + path, { redirect }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } return { status: r.status, json, text, headers: r.headers }; };
const post = async (path, body) => { const r = await fetch(SITE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d, n) => ymd(Date.parse(`${d}T12:00:00Z`) + n * 86400000);
const done = () => { const failed = results.filter((x) => !x).length; console.log(`${results.length - failed}/${results.length} checks passed`); process.exit(failed ? 1 : 0); };

// Pages.
// Static assets answer /x.html with a redirect to /x (as production does); followed here.
for (const p of ['/', '/calendar.html', '/sign?token=x']) {
  const r = await get(p, 'follow');
  const wired = p === '/calendar.html' ? r.text.includes("const API_BASE = '/api/calendar'")
    : r.text.includes('<script src="/config.js"></script>') && r.text.includes('<script src="/engine-client.js"></script>');
  check(`GET ${p} serves the page${p === '/calendar.html' ? ', reading /api/calendar' : ', wired to /config.js and engine-client.js'}`, r.status === 200 && wired,
    { status: r.status, bytes: r.text.length, build: (r.text.match(/GNP-BUILD: ([^>]*?) -->/) || [])[1] || null });
}

// Backend switch.
const cfgText = (await get('/config.js')).text;
const win = {};
vm.runInNewContext(cfgText, { window: win });
const C = win.GNP_ENGINE;
check('GET /config.js: engine enabled, API through /engine/api, no error', !!C && C.enabled === true && C.api === '/engine/api' && C.error === null, { enabled: C && C.enabled, api: C && C.api, admin: C && C.admin, eventTypes: C && C.eventTypes });
if (!C || !C.enabled) done();
const sandbox = { window: { GNP_ENGINE: C, fetch }, console, Promise, JSON, Object, Array, String, Number, Math, Error, Date, isFinite, encodeURIComponent };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../public/engine-client.js', import.meta.url), 'utf8'), sandbox);
const E = sandbox.window.GnpEngine;

// Catalogue through the proxy.
const cat = await get(E.catalogueUrl());
const cfg = E.catalogueConfig(cat.json);
const waiverEs = cfg && E.documentFor(cfg.documents.waiver, 'ES');
check('GET /engine/api/catalogue: the GNP plans with includes, sessions, 50% deposit and policy; waiver es with body and SHA-256; RNT; almost-full threshold',
  cat.status === 200 && !!cfg && cfg.plans.map((p) => p.key).join() === 'PASADIA,GUAYACAN24' && cfg.plans.every((p) => p.depositPct === 50 && p.incluyeEs.length > 0 && p.cancellation)
  && !!waiverEs && waiverEs.body.length > 0 && /^[0-9a-f]{64}$/.test(waiverEs.sha256) && cfg.site.registrationId === 'RNT 273376' && Number.isInteger(cfg.lowThreshold),
  { status: cat.status, plans: cfg && cfg.plans.map((p) => `${p.key} ${E.formatMoney(p.priceMinor, p.currency)} deposit ${p.depositPct}% [${p.subOptions.map((s) => `${s.labelEs} ${s.sessionEs}`).join(', ') || p.sessionEs}]`),
    waiver: waiverEs && { version: waiverEs.version, sha256: waiverEs.sha256, adult_only: waiverEs.adult_only, chars: waiverEs.body.length }, policy: cfg && E.policyLines(cfg.plans[0].cancellation, 'ES'), threshold: cfg && cfg.lowThreshold, lead_days: cfg && cfg.minDaysAdvance, rnt: cfg && cfg.site.registrationId });

const month = ymd(Date.now() + 31 * 86400000).slice(0, 7);
if (!BOOK) {
  const cal = await get('/api/calendar?month=' + month);
  check(`GET /api/calendar?month=${month}: engine data`, cal.status === 200 && cal.json.data.source === 'engine', { status: cal.status, cache: cal.headers.get('x-gnp-cache'), worker: cal.headers.get('x-gnp-worker'), days: cal.json && Object.keys(cal.json.data.days).length });
  done();
}

// One Guayacan24 booking in that month, the waiver signed in the request.
const g24 = E.slugFor('GUAYACAN24', null), am = E.slugFor('PASADIA', 'AMANECER'), ta = E.slugFor('PASADIA', 'TARDE');
let date = null, slot = null;
for (let d = `${month}-10`; d.slice(0, 7) === month && !slot; d = addDays(d, 1)) {
  const g = await get(E.availabilityUrl(g24, d));
  const s = E.slotOn(g.json, d);
  if (!s || s.remaining < 1 || s.unavailable) continue;
  const both = await Promise.all([am, ta].map((x) => get(E.availabilityUrl(x, d, addDays(d, 1)))));
  if (both.every((r) => r.json.slots.length === 2 && r.json.slots.every((z) => z.remaining === z.capacity))) { date = d; slot = s; }
}
const run = Date.now().toString(36);
const body = E.bookingRequest({
  plan: 'GUAYACAN24', subOption: null, slot, people: 1, lang: 'ES',
  nombre: 'QA Acceptance', email: `qa-acceptance+visit${run}@example.test`, phone: '',
  requerimientos: 'Reserva de prueba (QA gnp-visit); se cancela de inmediato.', arrivalTime: '', hasMinors: false,
  ackAccepted: true, ackText: 'He leído y aprobado los servicios y el desglose de costo mostrado arriba.',
  waiverAccepted: true, waiverName: 'QA Acceptance', document: waiverEs, attestAdult: false, page: 'engine-live',
});
const made = await post(E.bookingsUrl(), JSON.parse(JSON.stringify(body)));
const res = E.bookingResult(made.json);
check('POST /engine/api/bookings (test record, Guayacan24, waiver in signatures): 201, requested, waiver signed', made.status === 201 && res.ok && res.status === 'requested' && res.signed.join() === 'waiver',
  { status: made.status, date, ref: res.ref || null, booking_status: res.status || (made.json && made.json.error), deposit: res.depositText || null, total: res.totalText || null, signatures_sent: body.signatures.map((s) => ({ slug: s.slug, version: s.version, sha256: s.sha256, lang: s.lang, accepted: s.accepted, attest_adult: s.attest_adult })), documents: made.json && made.json.documents });
if (!res.ok) done();
const token = res.token;
try {
  // The month is an edge copy: fresh for 5 min, then served once more while
  // it refreshes. Wait until a copy made after the booking is served.
  let cal, d0, d1;
  const until = Date.now() + 8 * 60000;
  for (;;) {
    cal = await get('/api/calendar?month=' + month);
    d0 = cal.json && cal.json.data.days[date]; d1 = cal.json && cal.json.data.days[addDays(date, 1)];
    if ((d0 && d0.status === 'full') || Date.now() > until) break;
    const age = Number(cal.headers.get('age')) || 0;
    const wait = cal.headers.get('x-gnp-cache') === 'hit' ? Math.max(5, 302 - age) : 4;
    console.log(`  calendar copy ${cal.headers.get('x-gnp-cache')} (age ${age} s) predates the booking; waiting ${wait} s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
  check(`GET /api/calendar?month=${month}: engine data; the Guayacan24 arrival and departure dates read full`, cal.status === 200 && cal.json.data.source === 'engine' && d0 && d0.status === 'full' && (addDays(date, 1).slice(0, 7) !== month || (d1 && d1.status === 'full')),
    { status: cal.status, cache: cal.headers.get('x-gnp-cache'), worker: cal.headers.get('x-gnp-worker'), threshold: cal.json && cal.json.data.limitedThreshold, days: cal.json && Object.keys(cal.json.data.days).length, [date]: d0, [addDays(date, 1)]: d1 });

  const view = await get(E.guestUrl(token));
  const s = view.status === 200 ? E.bookingSummary(view.json) : null;
  check('GET /engine/api/guest/bookings/<token>: the booking, cancellable with a known refund', view.status === 200 && s.ref === res.ref && view.json.can_cancel === true,
    { status: view.status, summary: s, refund_line: view.status === 200 ? E.refundLine(view.json, 'ES') : null });

  const opts = await get(E.guestUrl(token, '/payment-options'));
  check('GET payment-options (read only, no Checkout session): a request waits for review', opts.status === 200 && E.payState(opts.json, 'ES').kind !== 'pay',
    { status: opts.status, state: E.payState(opts.json, 'ES').kind, due: opts.json && opts.json.amount_due_minor, reason: opts.json && opts.json.reason });

  for (const p of [`/manage?token=${token}`, `/pay?token=${token}&payment=success`, `/pay?token=${token}&payment=cancelled`]) {
    const r = await get(p);
    check(`GET ${p.replace(token, '<token>')} (the paths site.guest_links sends guests to) serves the page`, r.status === 200 && r.text.includes('engine-client.js'), { status: r.status });
  }

  const cancel = await post(E.guestUrl(token, '/cancel'), JSON.parse(JSON.stringify(E.cancelRequest(view.json))));
  const after = await get(E.guestUrl(token));
  check('POST .../cancel with the refund shown: cancelled, refund 0 (nothing paid)', cancel.status === 200 && after.json.booking.status === 'cancelled_customer',
    { status: cancel.status, refund_minor: cancel.json && cancel.json.refund_minor, status_after: after.json && after.json.booking.status });
} catch (err) {
  check('the run finished; if not, cancel ' + res.ref + ' in the engine admin', false, { error: String(err && err.message) });
}
done();
