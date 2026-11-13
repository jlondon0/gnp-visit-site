// Contracts for the pages' side of canon rule 4, "unknown must block", paired
// with backend v2.38.0: a booking whose visit date cannot be read has no policy
// refund (the admin cancel dialog must not pre-fill 100%), and a booking without
// a known currency cannot be paid (the pay page must say it is under review).
// The functions are taken from the exact bytes in public/ and run against a stub DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const admin = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const pay = readFileSync(new URL('../public/pay.html', import.meta.url), 'utf8');

// The source of one top-level function, found by name and brace matching.
function fnSource(html, name) {
  const start = html.search(new RegExp('(async\\s+)?function ' + name + '\\s*\\('));
  assert.ok(start >= 0, name + ' is in the page');
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start, i + 1);
}

function stubDom() {
  const els = {};
  const el = () => ({ value: '', textContent: '', innerHTML: '', disabled: false, style: {}, classList: { add() {}, remove() {} } });
  return { els, document: { getElementById: (id) => els[id] || (els[id] = el()) } };
}

function adminSandbox() {
  const { els, document } = stubDom();
  const posted = [];
  const ctx = {
    document, DATA: { cancelReasons: ['Cliente', 'Otro'], fullRefundReason: 'Fuerza mayor / clima', operators: ['Carlos'] },
    CANCEL_RESID: '', API: 'https://example.invalid', pwd: 'x', String, Number, isNaN, JSON,
    confirm: () => true, deviceLabel: () => 'test', closeCancel() {}, refreshData: async () => {},
    fetch: async (url, init) => { posted.push(JSON.parse(init.body)); return { json: async () => ({ ok: true }) }; },
  };
  vm.createContext(ctx);
  vm.runInContext(['openCancel', 'onReasonChange', 'confirmCancel'].map(n => fnSource(admin, n)).join('\n'), ctx);
  return { ctx, els, posted };
}

test('admin cancel: no policy figure leaves the refund blank and explains why', () => {
  const { ctx, els } = adminSandbox();
  ctx.openCancel('GNP-1', null);
  assert.equal(els.cancelRefund.value, '');
  assert.match(els.cancelMsg.textContent, /fecha/i);
});

test('admin cancel: a blank refund cannot be submitted (it would be read as 0%)', async () => {
  const { ctx, els, posted } = adminSandbox();
  ctx.openCancel('GNP-1', null);
  els.cancelOperator.value = 'Carlos';
  await ctx.confirmCancel();
  assert.equal(posted.length, 0, 'nothing sent to the backend');
  assert.match(els.cancelMsg.textContent, /reembolso/i);
});

test('admin cancel: a known policy figure is still pre-filled and can be submitted', async () => {
  const { ctx, els, posted } = adminSandbox();
  ctx.openCancel('GNP-2', 50);
  assert.equal(String(els.cancelRefund.value), '50');
  els.cancelOperator.value = 'Carlos';
  await ctx.confirmCancel();
  assert.equal(posted.length, 1);
  assert.equal(posted[0].refundPct, 50);
});

function payRender(data) {
  const { els, document } = stubDom();
  const ctx = { document, String, Number, copFmt: (n) => 'COP ' + n, usdFmt: (n) => 'USD ' + n, esc: (s) => String(s) };
  vm.createContext(ctx);
  vm.runInContext(fnSource(pay, 'render'), ctx);
  ctx.render({ reservationId: 'GNP-3', estado: 'Pendiente Pago', paymentStatus: 'Pending', fecha: '2026-12-01', jornada: 'AMANECER', paymentAmount: 250000, ...data });
  return els;
}

test('pay page: a booking with no known currency says it is under review, shows no amount, offers no payment', () => {
  const els = payRender({ paymentCurrency: '', currencyUnknown: true, canPay: false });
  assert.match(els.payZone.innerHTML, /revisi[oó]n/i);
  assert.equal(els.amt.textContent, '—');
  assert.doesNotMatch(els.amt.textContent, /USD/);
});

test('pay page: a booking already paid still gets the existing notice', () => {
  const els = payRender({ paymentCurrency: 'COP', currencyUnknown: false, canPay: false });
  assert.match(els.payZone.innerHTML, /no está pendiente de pago/);
});
