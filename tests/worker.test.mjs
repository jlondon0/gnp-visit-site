// Contracts for src/worker.js, the edge cache in front of the Apps Script
// calendar (SWL-KFMU). Runs under plain `node --test`; the Workers runtime is
// stood in for by a fake Cache API, a fake upstream fetch and a fake ctx.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const UPSTREAM_DELAY_MS = 800;   // what a real Apps Script answer costs, roughly
const GOOD = { ok: true, data: { days: { '2026-10-03': { status: 'open', remaining: { AMANECER: 4 } } }, minDaysAdvance: 7 } };

class FakeCache {
  constructor() { this.store = new Map(); }
  async match(req) {
    const e = this.store.get(req.url);
    return e ? new Response(e.body, { headers: e.headers }) : undefined;
  }
  async put(req, res) {
    this.store.set(req.url, { body: await res.text(), headers: new Headers(res.headers) });
  }
}

function upstream(opts) {
  const o = Object.assign({ delay: UPSTREAM_DELAY_MS, status: 200, body: JSON.stringify(GOOD) }, opts);
  const calls = [];
  globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
    calls.push({ url: String(url), init });
    const t = setTimeout(() => resolve(new Response(o.body, { status: o.status })), o.delay);
    if (init && init.signal) init.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
  });
  return calls;
}

function harness() {
  const cache = new FakeCache();
  globalThis.caches = { default: cache };
  const pending = [];
  const ctx = { waitUntil(p) { pending.push(p); } };
  const env = { ASSETS: { fetch: async (r) => new Response('asset:' + new URL(r.url).pathname, { status: 404 }) } };
  return { cache, ctx, env, pending };
}

const worker = (await import('../src/worker.js')).default;
const mod = await import('../src/worker.js');
const get = (path, h) => worker.fetch(new Request('https://visit.guayacanpreserve.com' + path), h.env, h.ctx);
const timed = async (fn) => { const s = Date.now(); const r = await fn(); return { r, ms: Date.now() - s }; };

test('a miss asks Apps Script once and caches a well-formed answer', async () => {
  const h = harness(); const calls = upstream();
  const res = await get('/api/calendar?month=2026-10', h);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-gnp-cache'), 'MISS');
  assert.equal(res.headers.get('x-gnp-worker'), mod.WORKER_BUILD);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.deepEqual(json.data, GOOD.data);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /action=calendar&month=2026-10$/);
  assert.ok(calls[0].init && calls[0].init.signal, 'upstream call carries an abort signal (timeout)');
  assert.equal(h.cache.store.size, 1);
});

test('the second visitor does not wait for Apps Script', async () => {
  const h = harness(); const calls = upstream();
  const first = await timed(() => get('/api/calendar?month=2026-10', h));
  assert.ok(first.ms >= UPSTREAM_DELAY_MS - 50, 'first visitor pays the upstream cost: ' + first.ms + 'ms');
  const second = await timed(() => get('/api/calendar?month=2026-10', h));
  assert.equal(second.r.headers.get('x-gnp-cache'), 'HIT');
  assert.ok(second.ms < 100, 'cached answer took ' + second.ms + 'ms');
  assert.deepEqual((await second.r.json()).data, GOOD.data);
  assert.equal(calls.length, 1, 'upstream asked once for two visitors');
});

test('a stale copy is served at once and refreshed in the background, once per gap', async () => {
  const h = harness(); const calls = upstream();
  await get('/api/calendar?month=2026-10', h);
  const entry = h.cache.store.get('https://visit.guayacanpreserve.com/api/calendar?month=2026-10');
  entry.headers.set('x-gnp-fetched-at', String(Date.now() - (mod.FRESH_SECONDS + 60) * 1000));
  const updated = { ok: true, data: { days: { '2026-10-03': { status: 'full' } }, minDaysAdvance: 7 } };
  upstream({ body: JSON.stringify(updated) });   // Apps Script now answers differently
  const stale = await timed(() => get('/api/calendar?month=2026-10', h));
  assert.equal(stale.r.headers.get('x-gnp-cache'), 'STALE');
  assert.ok(Number(stale.r.headers.get('x-gnp-age')) > mod.FRESH_SECONDS);
  assert.ok(stale.ms < 100, 'stale answer took ' + stale.ms + 'ms');
  assert.deepEqual((await stale.r.json()).data, GOOD.data);
  assert.equal(h.pending.length, 1, 'one background refresh scheduled');
  const again = await get('/api/calendar?month=2026-10', h);
  assert.equal(again.headers.get('x-gnp-cache'), 'STALE');
  assert.equal(h.pending.length, 1, 'a second stale hit inside the gap schedules no refresh');
  await Promise.all(h.pending);
  const fresh = await get('/api/calendar?month=2026-10', h);
  assert.equal(fresh.headers.get('x-gnp-cache'), 'HIT');
  assert.deepEqual((await fresh.json()).data, updated.data);
});

test('an Apps Script error page never displaces a cached answer', async () => {
  const h = harness();
  upstream();
  await get('/api/calendar?month=2026-11', h);
  const entry = h.cache.store.get('https://visit.guayacanpreserve.com/api/calendar?month=2026-11');
  entry.headers.set('x-gnp-fetched-at', String(Date.now() - (mod.FRESH_SECONDS + 60) * 1000));
  upstream({ body: '<html><body>Google Drive - Server error</body></html>', delay: 10 });
  const stale = await get('/api/calendar?month=2026-11', h);
  assert.equal(stale.headers.get('x-gnp-cache'), 'STALE');
  await Promise.all(h.pending);
  const after = await get('/api/calendar?month=2026-11', h);
  assert.deepEqual((await after.json()).data, GOOD.data, 'stale good data survives a failed refresh');
});

test('with nothing cached an upstream failure is a 502 that caches nothing', async () => {
  const h = harness();
  upstream({ body: '<html>error</html>', delay: 10 });
  const res = await get('/api/calendar?month=2026-12', h);
  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.match(json.error, /not JSON/);
  assert.equal(h.cache.store.size, 0);
  upstream({ body: JSON.stringify({ ok: false, error: 'Service invoked too many times' }), delay: 10 });
  const res2 = await get('/api/calendar?month=2026-12', h);
  assert.equal(res2.status, 502);
  assert.match((await res2.json()).error, /too many times/);
  assert.equal(h.cache.store.size, 0);
});

test('the request is validated and everything else falls through to the assets', async () => {
  const h = harness(); const calls = upstream();
  assert.equal((await get('/api/calendar?month=2026-13', h)).status, 400);
  assert.equal((await get('/api/calendar', h)).status, 400);
  const post = await worker.fetch(new Request('https://visit.guayacanpreserve.com/api/calendar?month=2026-10', { method: 'POST' }), h.env, h.ctx);
  assert.equal(post.status, 405);
  assert.equal(calls.length, 0, 'no upstream call for a rejected request');
  const asset = await get('/calendar.html', h);
  assert.equal(await asset.text(), 'asset:/calendar.html');
});

test('the build marker is one string, reported at runtime and recorded in the changelog', async () => {
  assert.match(mod.WORKER_BUILD, /^calendar-cache v\d+\.\d+\.\d+[a-z]? · \d{4}-\d{2}-\d{2}$/);
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(changelog.includes(mod.WORKER_BUILD), 'CHANGELOG.md names ' + mod.WORKER_BUILD);
});
