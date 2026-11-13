// Contracts for the pages' side of backend v2.39.0 (owner decision 2026-11-13):
//   pay.html   never offers the "Pagar con tarjeta" mock unless the backend says
//              mockEnabled === true. Older backends (v2.37.x, v2.38.0) send no such
//              field, which must read as off. Without the manual lane the guest is
//              told we will contact them.
//   admin.html never shows a secret SysAdmin value (the backend sends none), says
//              whether it is set, and never sends a blank in place of a secret.
// The functions are taken from the exact bytes in public/ and run against a stub DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const admin = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const pay = readFileSync(new URL('../public/pay.html', import.meta.url), 'utf8');

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

function el() {
  return { value: '', textContent: '', innerHTML: '', className: '', disabled: false, style: {}, children: [],
    classList: { add() {}, remove() {} }, appendChild(c) { this.children.push(c); return c; } };
}
function stubDom() {
  const els = {};
  return { els, document: { getElementById: (id) => els[id] || (els[id] = el()), createElement: () => el() } };
}

// --- pay page ------------------------------------------------------------------

function payRender(data) {
  const { els, document } = stubDom();
  const ctx = { document, String, Number, copFmt: (n) => 'COP ' + n, usdFmt: (n) => 'USD ' + n, esc: (s) => String(s) };
  vm.createContext(ctx);
  vm.runInContext(fnSource(pay, 'render'), ctx);
  ctx.render({ reservationId: 'GNP-5', estado: 'Pendiente Pago', paymentStatus: 'Pending', fecha: '2026-12-01',
    jornada: 'AMANECER', paymentAmount: 250000, paymentCurrency: 'COP', currencyUnknown: false, canPay: true,
    pay: { nequi: '300', qr: '' }, ...data });
  return els.payZone.innerHTML;
}

test('pay page: an older backend (no mockEnabled) never gets the mock button', () => {
  for (const d of [{ isColombian: false, manualEnabled: true }, { isColombian: true, manualEnabled: false },
    { isColombian: false, manualEnabled: false }]) {
    const html = payRender(d);
    assert.doesNotMatch(html, /btnPay|doPay|tarjeta/i, JSON.stringify(d));
    assert.match(html, /contactaremos/i, JSON.stringify(d));
  }
});

test('pay page: mockEnabled anything but true is off', () => {
  for (const v of [false, 'true', 1, null]) {
    assert.doesNotMatch(payRender({ isColombian: false, manualEnabled: false, mockEnabled: v }), /doPay/, String(v));
  }
});

test('pay page: the manual lane is unchanged when it is offered', () => {
  const html = payRender({ isColombian: true, manualEnabled: true });
  assert.match(html, /Subir comprobante/);
  assert.match(html, /Nequi/);
  assert.doesNotMatch(html, /doPay/);
});

test('pay page: the mock button appears only when the backend says mockEnabled === true', () => {
  assert.match(payRender({ isColombian: false, manualEnabled: false, mockEnabled: true }), /doPay/);
});

test('pay page: doPay sends nothing unless the backend enabled the mock for this page load', async () => {
  const { els, document } = stubDom();
  const posted = [];
  const ctx = { document, JSON, String, API: 'https://example.invalid', token: 't', PAY_DATA: null,
    setMsg: (k, t) => { document.getElementById('msg').textContent = t; }, showDone() {},
    fetch: async (u, init) => { posted.push(init); return { json: async () => ({ ok: true }) }; } };
  vm.createContext(ctx);
  vm.runInContext(fnSource(pay, 'doPay'), ctx);
  await ctx.doPay();
  assert.equal(posted.length, 0);
  assert.match(els.msg.textContent, /contactaremos/i);
  ctx.PAY_DATA = { mockEnabled: false };
  await ctx.doPay();
  assert.equal(posted.length, 0);
});

test('pay page carries the v2.39.0 build marker', () => {
  assert.match(pay, /<!-- GNP-BUILD: pay v2\.39\.0 /);
});

// --- admin page ------------------------------------------------------------------

function adminConfig(rows) {
  const { els, document } = stubDom();
  const ctx = { document, String, DATA: { sysadmin: rows }, CONFIG_GROUPS: [], groupFor: () => 'Otros' };
  vm.createContext(ctx);
  vm.runInContext(['renderConfig', 'cfgIsSecret', 'cfgIsSet'].filter(n => admin.includes('function ' + n)).map(n => fnSource(admin, n)).join('\n'), ctx);
  ctx.renderConfig();
  const html = (n) => [n.innerHTML, ...n.children.map(html)].join('\n');
  return html(els.sysGroups);
}

test('admin: a redacted secret shows an empty password field that says it is set', () => {
  const html = adminConfig([['OPS_PASSWORD', '', { isSecret: true, isSet: true }], ['WOMPI_PRIVATE_KEY', '', { isSecret: true, isSet: false }], ['OPERATOR_EMAILS', 'ops@example.com']]);
  const row = (k) => html.split('<div class="key">').find(s => s.startsWith(k));
  assert.match(row('OPS_PASSWORD'), /type="password"/);
  assert.match(row('OPS_PASSWORD'), /value=""/);
  assert.match(row('OPS_PASSWORD'), /placeholder="[^"]*configurado[^"]*reemplazar/i);
  assert.match(row('WOMPI_PRIVATE_KEY'), /placeholder="[^"]*sin configurar/i);
  assert.match(row('OPERATOR_EMAILS'), /value="ops@example.com"/);
  // Defence in depth: a secret row that somehow carries a value never renders it.
  assert.doesNotMatch(adminConfig([['ADMIN_PASSWORD', 'leak-999', { isSecret: true, isSet: true }]]), /leak-999/);
});

async function adminSave(key, row, typed) {
  const { els, document } = stubDom();
  els['cfg_' + key] = { ...el(), value: typed };
  const posted = [];
  const ctx = { document, JSON, String, API: 'https://example.invalid', pwd: 'x', DATA: { sysadmin: [row] },
    showMsg: (id, t) => { els[id] = { textContent: t }; }, renderConfig() {},
    fetch: async (u, init) => { posted.push(JSON.parse(init.body)); return { json: async () => ({ ok: true }) }; } };
  vm.createContext(ctx);
  vm.runInContext(['saveKey', 'cfgIsSecret', 'cfgIsSet'].filter(n => admin.includes('function ' + n)).map(n => fnSource(admin, n)).join('\n'), ctx);
  await ctx.saveKey(key);
  return { posted, els, ctx };
}

test('admin: saving a secret with an empty field sends nothing', async () => {
  const { posted, els } = await adminSave('OPS_PASSWORD', ['OPS_PASSWORD', '', { isSecret: true, isSet: true }], '');
  assert.equal(posted.length, 0);
  assert.match(els.configMsg.textContent, /OPS_PASSWORD/);
});

test('admin: a typed new secret is sent, and the page never keeps it in DATA', async () => {
  const { posted, ctx } = await adminSave('OPS_PASSWORD', ['OPS_PASSWORD', '', { isSecret: true, isSet: false }], 'nuevo-123');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].value, 'nuevo-123');
  assert.equal(ctx.DATA.sysadmin[0][1], '');
  assert.equal(ctx.DATA.sysadmin[0][2].isSet, true);
});

test('admin: a plain key still saves an empty value', async () => {
  const { posted } = await adminSave('OPERATOR_EMAILS', ['OPERATOR_EMAILS', 'a@b.c'], '');
  assert.equal(posted.length, 1);
});

test('admin page carries the v2.39.0 build marker', () => {
  assert.match(admin, /<!-- GNP-BUILD: admin v2\.39\.0 /);
});
