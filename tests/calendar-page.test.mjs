// Contracts for public/calendar.html as shipped: the page script is extracted
// from the exact bytes in public/ and run against a stub DOM, a stub
// localStorage and a scripted fetch. SWL-KFMU: availability comes through the
// Worker's /api/calendar, a saved month paints before the network answers, and
// a network failure with a saved month still shows the grid.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/calendar.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
assert.ok(script.includes('renderMonth'), 'first script block is the calendar logic');

function element() {
  const classes = new Set();
  return { innerHTML: '', textContent: '', disabled: false, classList: { toggle(c, on) { on ? classes.add(c) : classes.delete(c); }, add(c) { classes.add(c); }, contains(c) { return classes.has(c); } } };
}

function page(opts) {
  const els = {};
  const store = new Map(Object.entries(opts.storage || {}));
  const fetches = [];
  const g = {
    document: { getElementById: (id) => els[id] || (els[id] = element()) },
    localStorage: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    navigator: { language: 'en-US' },
    window: { location: { href: '' } },
    console: { log() {}, warn() {} },
    fetch: (url, init) => { fetches.push({ url: String(url), init }); return opts.fetch(String(url), init); },
    AbortController, setTimeout, clearTimeout, Date, JSON, Object, String, Number, Array, Error, Promise
  };
  const names = Object.keys(g);
  const fn = new Function(...names, script + '\nreturn { renderMonth, fetchMonth, paintMonth, cache };');
  const api = fn(...names.map((n) => g[n]));
  return { els, store, fetches, api };
}

const now = new Date();
const key = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
const day = (d) => key + '-' + String(d).padStart(2, '0');
const payload = (status) => ({ ok: true, data: { days: { [day(28)]: { status, remaining: { AMANECER: 2 } } }, minDaysAdvance: 0 } });
const settle = () => new Promise((r) => setTimeout(r, 30));

test('the current month is requested from /api/calendar, never from script.google.com', async () => {
  const p = page({ fetch: async () => new Response(JSON.stringify(payload('open'))) });
  await settle();
  const first = p.fetches[0];
  assert.ok(first, 'the page fetched availability on load');
  assert.equal(first.url, '/api/calendar?month=' + key);
  assert.ok(first.init && first.init.signal, 'the request carries a timeout signal');
  for (const f of p.fetches) assert.doesNotMatch(f.url, /script\.google\.com/);
  assert.match(p.els.calBody.innerHTML, /class="day open/);
  assert.match(p.store.get('gnp.cal.' + key) || '', /"open"/);
});

test('a month saved from a previous visit paints before the network answers', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const saved = JSON.stringify({ at: Date.now(), data: payload('limited').data });
  const p = page({ storage: { ['gnp.cal.' + key]: saved }, fetch: async () => { await gate; return new Response(JSON.stringify(payload('open'))); } });
  await settle();
  assert.match(p.els.calBody.innerHTML, /class="day limited/, 'saved availability shown while loading');
  assert.doesNotMatch(p.els.calBody.innerHTML, /cal-degraded/);
  release();
  await settle();
  assert.match(p.els.calBody.innerHTML, /class="day open/, 'fresh availability replaces it');
});

test('when the network fails, a saved month still shows the grid with the degraded notice', async () => {
  const saved = JSON.stringify({ at: Date.now(), data: payload('open').data });
  const p = page({ storage: { ['gnp.cal.' + key]: saved }, fetch: async () => { throw new Error('offline'); } });
  await settle();
  assert.match(p.els.calBody.innerHTML, /cal-degraded/);
  assert.match(p.els.calBody.innerHTML, /class="day open/);
  const stale = JSON.stringify({ at: Date.now() - 2 * 24 * 3600 * 1000, data: payload('open').data });
  const q = page({ storage: { ['gnp.cal.' + key]: stale }, fetch: async () => { throw new Error('offline'); } });
  await settle();
  assert.match(q.els.calBody.innerHTML, /cal-degraded/);
  assert.doesNotMatch(q.els.calBody.innerHTML, /class="day open/, 'a saved month older than a day is not shown as known');
});
