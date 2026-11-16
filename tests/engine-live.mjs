// Live check of the engine path, against a running site (wrangler dev with
// ENGINE_BASE set, or the deployed site once it is switched). Not part of
// tests/run.sh: it needs the network and a seeded engine.
//
//   ENGINE_SITE=http://127.0.0.1:8799 node tests/engine-live.mjs          read-only
//   ENGINE_SITE=http://127.0.0.1:8799 node tests/engine-live.mjs --book   plus one test booking
//
// Read-only: /config.js, the month calendar, availability for each plan, the
// plan catalogue the booking page builds. With --book it makes ONE booking for
// a test customer (email at example.test, which the GNP engine's
// crm.test_record_match marks as a test record: no message is ever sent to it
// and it stays out of reports), reads it back through the guest routes the
// pages use, then cancels it with the refund it was shown. The request bodies
// are built by public/engine-client.js, the code the pages run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SITE = (process.env.ENGINE_SITE || '').replace(/\/+$/, '');
if (!SITE) { console.error('set ENGINE_SITE, e.g. http://127.0.0.1:8799'); process.exit(2); }
const BOOK = process.argv.includes('--book');

const get = async (path) => { const r = await fetch(SITE + path); return { status: r.status, json: await r.json().catch(() => null), headers: r.headers }; };
const post = async (path, body) => { const r = await fetch(SITE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };

const cfgText = await (await fetch(SITE + '/config.js')).text();
const win = {};
vm.runInNewContext(cfgText, { window: win });
assert.ok(win.GNP_ENGINE && win.GNP_ENGINE.enabled, 'the site is in engine mode (ENGINE_BASE set)');
console.log('config.js: engine on, admin ' + win.GNP_ENGINE.admin);
const sandbox = { window: { GNP_ENGINE: win.GNP_ENGINE, fetch }, console, Promise, JSON, Object, Array, String, Number, Math, Error, Date, isFinite, encodeURIComponent };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../public/engine-client.js', import.meta.url), 'utf8'), sandbox);
const E = sandbox.window.GnpEngine;

const ymd = (d) => d.toISOString().slice(0, 10);
const month = ymd(new Date(Date.now() + 40 * 86400000)).slice(0, 7);
const cal = await get('/api/calendar?month=' + month);
assert.equal(cal.status, 200);
assert.equal(cal.json.data.source, 'engine');
const days = Object.keys(cal.json.data.days).sort();
console.log(`calendar ${month}: ${days.length} days from the engine (${cal.headers.get('x-gnp-cache')}, ${cal.headers.get('x-gnp-worker')}); first ${days[0]} ${JSON.stringify(cal.json.data.days[days[0]])}`);

const answers = {};
for (const k of ['AMANECER', 'TARDE', 'GUAYACAN24']) {
  const r = await get(E.availabilityUrl(E.slugFor(k, null), days[0]));
  assert.equal(r.status, 200, k);
  answers[k] = r.json;
}
const plans = E.planCatalog(answers);
console.log('plans: ' + plans.map((p) => `${p.key} "${p.labelEs}" ${E.formatMoney(p.priceMinor, p.currency)} [${p.subOptions.map((s) => s.labelEs).join(', ')}]`).join('; '));

if (!BOOK) { console.log('read-only checks passed'); process.exit(0); }

// One booking, one person, Pasadia Tarde, on the last open day of the month.
const day = [...days].reverse().find((d) => cal.json.data.days[d].remaining.TARDE > 0);
assert.ok(day, 'an open afternoon in ' + month);
const avail = await get(E.availabilityUrl(E.slugFor('PASADIA', 'TARDE'), day));
const slot = E.slotOn(avail.json, day);
const run = Date.now().toString(36);
const body = E.bookingRequest({
  plan: 'PASADIA', subOption: 'TARDE', slot, people: 1, lang: 'ES',
  nombre: 'Prueba Track Engine', email: `gnp-visit-track-engine+${run}@example.test`, phone: '',
  requerimientos: 'Reserva de prueba (track/engine); se cancela de inmediato.', arrivalTime: '15:00', hasMinors: false,
  ackAccepted: true, ackText: 'He leído y aprobado los servicios y el desglose de costo mostrado arriba.',
  waiverAccepted: true, waiverName: 'Prueba Track Engine', waiverText: 'Entiendo que el avistamiento de aves implica caminar por senderos naturales y acepto los riesgos asociados.', page: 'engine-live',
});
const made = await post(E.bookingsUrl(), JSON.parse(JSON.stringify(body)));
console.log('POST /api/bookings -> ' + made.status + ' ' + JSON.stringify(made.json && made.json.booking));
assert.equal(made.status, 201, JSON.stringify(made.json));
const res = E.bookingResult(made.json);
assert.equal(res.ok, true);
const token = res.token;
try {
  const view = await get(E.guestUrl(token));
  assert.equal(view.status, 200);
  const s = E.bookingSummary(view.json);
  console.log(`guest view: ${s.ref} ${s.status} ${s.date} ${s.session} x${s.people}; can_cancel ${view.json.can_cancel}; refund line: ${E.refundLine(view.json, 'ES')}`);
  const opts = await get(E.guestUrl(token, '/payment-options'));
  console.log('payment-options -> ' + opts.status + ' ' + JSON.stringify(opts.json) + ' => ' + JSON.stringify(E.payState(opts.json, 'ES')));
  const cancel = await post(E.guestUrl(token, '/cancel'), JSON.parse(JSON.stringify(E.cancelRequest(view.json))));
  console.log('cancel -> ' + cancel.status + ' ' + JSON.stringify(cancel.json));
  assert.equal(cancel.status, 200);
  const after = await get(E.guestUrl(token));
  console.log('after: ' + after.json.booking.status);
  assert.equal(after.json.booking.status, 'cancelled_customer');
} catch (err) {
  console.error('FAILED after the booking was made; cancel it in the engine admin: ' + res.ref);
  throw err;
}
console.log('live booking check passed: ' + res.ref + ' (test record, cancelled)');
