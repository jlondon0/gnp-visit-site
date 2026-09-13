// Contract for /api/calendar (src/worker.js), the edge copy of the Apps Script
// calendar that SWL-KFMU introduced. Runs under plain node: the Cache API and
// fetch are stubbed, so the assertions are about behaviour, not about
// Cloudflare. Exits non-zero on the first failing assertion.
//
//   node tests/calendar-proxy.test.mjs

import assert from 'node:assert/strict';
import worker, { handleCalendar, FRESH_MS, STALE_MS, REFRESH_GAP_MS, UPSTREAM, WORKER_BUILD } from '../src/worker.js';
import { readFileSync } from 'node:fs';

const GOOD = JSON.stringify({ ok: true, data: { minDaysAdvance: 7, days: { '2026-10-03': { status: 'open', remaining: { AMANECER: 6 } } } } });

class FakeCache {
  constructor() { this.store = new Map(); }
  async match(req) {
    const hit = this.store.get(req.url);
    return hit ? hit.clone() : undefined;
  }
  async put(req, res) { this.store.set(req.url, res); }
}

function harness(opts) {
  const o = opts || {};
  const state = { calls: [], now: o.now || 1_000_000_000_000, pending: [] };
  const cache = new FakeCache();
  const deps = {
    cache,
    now: () => state.now,
    fetch: async (url, init) => {
      state.calls.push(url);
      if (o.upstream === 'down') throw new Error('network');
      if (o.upstream === 'http500') return new Response('boom', { status: 500 });
      if (o.upstream === 'notok') return new Response(JSON.stringify({ ok: false, error: 'sheet locked' }), { status: 200 });
      if (o.upstream === 'html') return new Response('<html>Sign in</html>', { status: 200 });
      return new Response(o.body || GOOD, { status: 200 });
    },
  };
  const ctx = { waitUntil: (p) => state.pending.push(p) };
  const call = (month) => handleCalendar(new Request('https://visit.guayacanpreserve.com/api/calendar?month=' + month), ctx, deps);
  return { state, cache, deps, ctx, call };
}

let n = 0;
async function test(name, fn) {
  n++;
  try { await fn(); console.log('  ok  ' + name); }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e && e.message)); process.exitCode = 1; }
}

await test('a miss asks the backend once, answers 200 with the backend body, and stores it', async () => {
  const h = harness();
  const res = await h.call('2026-10');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-gnp-cache'), 'miss');
  assert.equal(await res.text(), GOOD);
  assert.equal(h.state.calls.length, 1);
  assert.match(h.state.calls[0], /^https:\/\/script\.google\.com\//);
  assert.equal(h.state.calls[0], UPSTREAM + '?action=calendar&month=2026-10');
  assert.equal(h.cache.store.size, 1);
});

await test('a fresh hit is served from the edge without touching the backend', async () => {
  const h = harness();
  await h.call('2026-10');
  h.state.now += FRESH_MS - 1000;
  const res = await h.call('2026-10');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-gnp-cache'), 'hit');
  assert.equal(await res.text(), GOOD);
  assert.equal(h.state.calls.length, 1, 'backend was called again for a fresh copy');
});

await test('a stale hit is served at once and refreshed behind the visitor', async () => {
  const h = harness();
  await h.call('2026-10');
  h.state.now += FRESH_MS + 1000;
  const res = await h.call('2026-10');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-gnp-cache'), 'stale');
  assert.equal(await res.text(), GOOD);
  assert.equal(h.state.pending.length, 1, 'no background refresh was scheduled');
  await Promise.all(h.state.pending);
  assert.equal(h.state.calls.length, 2, 'background refresh did not reach the backend');
  const again = await h.call('2026-10');
  assert.equal(again.headers.get('x-gnp-cache'), 'hit', 'refresh did not renew the copy');
});

await test('many stale hits inside one gap start one backend refresh, not one each', async () => {
  const h = harness();
  await h.call('2026-10');
  h.state.now += FRESH_MS + 1000;
  let release; const gate = new Promise((r) => { release = r; });
  const slowCalls = [];
  h.deps.fetch = async (url) => { slowCalls.push(url); await gate; return new Response(GOOD, { status: 200 }); };
  const tick = () => new Promise((r) => setImmediate(r));
  for (let i = 0; i < 20; i++) {
    assert.equal((await h.call('2026-10')).headers.get('x-gnp-cache'), 'stale');
    await tick(); await tick();
  }
  assert.equal(slowCalls.length, 1, 'a burst of stale hits reached the backend ' + slowCalls.length + ' times');
  release();
  await Promise.all(h.state.pending);
  assert.equal((await h.call('2026-10')).headers.get('x-gnp-cache'), 'hit', 'the one refresh did not renew the copy');
  h.state.now += FRESH_MS + REFRESH_GAP_MS + 1000;
  assert.equal((await h.call('2026-10')).headers.get('x-gnp-cache'), 'stale');
  await Promise.all(h.state.pending);
  assert.equal(slowCalls.length, 2, 'after the gap a stale hit did not refresh again');
});

await test('every answer names the Worker build, which is recorded in the changelog', async () => {
  assert.match(WORKER_BUILD, /^calendar-cache v\d+\.\d+\.\d+[a-z]? · \d{4}-\d{2}-\d{2}$/);
  const h = harness();
  assert.equal((await h.call('2026-10')).headers.get('x-gnp-worker'), WORKER_BUILD);
  assert.equal((await h.call('2026-10')).headers.get('x-gnp-worker'), WORKER_BUILD);
  assert.equal((await h.call('bad')).headers.get('x-gnp-worker'), WORKER_BUILD);
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.ok(changelog.includes(WORKER_BUILD), 'CHANGELOG.md does not name ' + WORKER_BUILD);
});

await test('backend down with a stale copy: the copy is served, not an error', async () => {
  const h = harness();
  await h.call('2026-10');
  h.state.now += STALE_MS - 1000;
  h.deps.fetch = async () => { throw new Error('network'); };
  const res = await h.call('2026-10');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), GOOD);
  await Promise.all(h.state.pending);
  assert.equal(h.cache.store.size, 1, 'failed refresh replaced the good copy');
});

await test('backend down with nothing cached: 502 ok:false and nothing stored', async () => {
  const h = harness({ upstream: 'down' });
  const res = await h.call('2026-10');
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(h.cache.store.size, 0, 'an error was cached');
});

for (const kind of ['http500', 'notok', 'html']) {
  await test('backend answer "' + kind + '" is never cached', async () => {
    const h = harness({ upstream: kind });
    const res = await h.call('2026-10');
    assert.equal(res.status, 502);
    assert.equal((await res.json()).ok, false);
    assert.equal(h.cache.store.size, 0);
  });
}

await test('an invalid month is refused before reaching the backend', async () => {
  const h = harness();
  for (const bad of ['', '2026-13', '2026-1', 'october', '2026-10-01', '../etc']) {
    const res = await h.call(bad);
    assert.equal(res.status, 400, 'month "' + bad + '" was not refused');
    assert.equal((await res.json()).ok, false);
  }
  assert.equal(h.state.calls.length, 0);
  assert.equal(h.cache.store.size, 0);
});

await test('months are cached independently', async () => {
  const h = harness();
  await h.call('2026-10');
  await h.call('2026-11');
  assert.equal(h.state.calls.length, 2);
  assert.equal(h.cache.store.size, 2);
});

await test('the default export routes /api/calendar to the proxy and everything else to ASSETS', async () => {
  let assetHits = 0;
  const env = { ASSETS: { fetch: async () => { assetHits++; return new Response('page', { status: 200 }); } } };
  const ctx = { waitUntil: () => {} };
  globalThis.caches = { default: new FakeCache() };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(GOOD, { status: 200 });
  try {
    const page = await worker.fetch(new Request('https://visit.guayacanpreserve.com/calendar.html'), env, ctx);
    assert.equal(await page.text(), 'page');
    assert.equal(assetHits, 1);
    const api = await worker.fetch(new Request('https://visit.guayacanpreserve.com/api/calendar?month=2026-10'), env, ctx);
    assert.equal(api.status, 200);
    assert.equal(await api.text(), GOOD);
    assert.equal(assetHits, 1, 'API request fell through to ASSETS');
    const post = await worker.fetch(new Request('https://visit.guayacanpreserve.com/api/calendar?month=2026-10', { method: 'POST' }), env, ctx);
    assert.equal(post.status, 405);
  } finally {
    globalThis.fetch = realFetch;
    delete globalThis.caches;
  }
});

console.log((process.exitCode ? 'calendar-proxy: FAILED' : 'calendar-proxy: all ' + n + ' passed'));
