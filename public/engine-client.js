/*
 * gnp-visit-site: the pages' side of the sv7n engine (track/engine).
 *
 * window.GNP_ENGINE is written by the Worker at /config.js from its ENGINE_BASE
 * variable: null means the pages keep calling Apps Script exactly as before;
 * an object means they call the engine through the Worker at /engine/api.
 * Every request a page sends to the engine is built here, by pure functions
 * the test suite runs directly (tests/engine-client.test.mjs), so the shapes
 * are checked against the engine's routes without a browser.
 *
 * Unknown must block: a missing slot, currency, price or refund figure stops
 * the step with a message; nothing is defaulted.
 */
(function (root) {
  'use strict';

  // The waiver text on index.html is the engine's waiver template 1.0.0 (the
  // QA seed builds that template from these exact strings); the services
  // approval text has no engine template and is named after the page build
  // that introduced it.
  var WAIVER_TEXT_VERSION = 'waiver@1.0.0';
  var ACK_TEXT_VERSION = 'gnp-visit-index-v2.32.0';

  function cfg(c) { return c === undefined ? (root.GNP_ENGINE || null) : c; }

  /* True when the Worker switched this site to the engine. */
  function enabled(c) {
    c = cfg(c);
    return !!(c && c.enabled === true);
  }

  function lang(L) { return String(L || 'ES').toLowerCase() === 'en' ? 'en' : 'es'; }

  /* A {lang: text} value from the engine, in the page language; a plain string as is. */
  function localized(v, L) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v !== 'object') return String(v);
    var l = lang(L);
    if (v[l] != null) return v[l];
    var keys = Object.keys(v);
    return keys.length ? v[keys[0]] : '';
  }

  /* Minor units and an ISO code to display text, or null when the currency is
   * unknown (the caller must then block, not guess). COP and USD have exponent 2. */
  function formatMoney(minor, currency) {
    if (typeof minor !== 'number' || !isFinite(minor)) return null;
    // Thousands with '.', as es-CO writes them, without relying on the
    // runtime's locale data (small-ICU runtimes print es-CO as '130,000').
    if (currency === 'COP') return '$' + String(Math.round(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' COP';
    if (currency === 'USD') return 'US$' + (minor / 100).toFixed(2);
    return null;
  }

  function api(c) { c = cfg(c); return (c && c.api) || '/engine/api'; }

  /* The engine slug for a plan (and session, for Pasadia), or null. */
  function slugFor(planKey, subKey, c) {
    c = cfg(c);
    var types = (c && c.eventTypes) || {};
    var key = subKey || planKey;
    return typeof types[key] === 'string' && types[key] ? types[key] : null;
  }

  function availabilityUrl(slug, from, to, c) {
    return api(c) + '/availability?event_type=' + encodeURIComponent(slug) + '&from=' + from + '&to=' + (to || from);
  }

  /* The slot an availability answer offers on a date (YYYY-MM-DD), or null. */
  function slotOn(json, date) {
    if (!json || json.ok !== true || !Array.isArray(json.slots)) return null;
    for (var i = 0; i < json.slots.length; i++) {
      var s = json.slots[i];
      if (s && typeof s.start === 'string' && s.start.slice(0, 10) === date) return s;
    }
    return null;
  }

  /* 'HH:MM' from an ISO time written in the site time zone. */
  function clock(iso) { return typeof iso === 'string' && iso.length >= 16 ? iso.slice(11, 16) : ''; }

  /* "Plan - Session" names split at the first " - ": [plan, session]. */
  function splitTitle(name) {
    var i = String(name || '').indexOf(' - ');
    return i < 0 ? [String(name || ''), ''] : [name.slice(0, i), name.slice(i + 3)];
  }

  /* The plan list index.html renders, from the engine's three availability
   * answers (the event type rides on each). Pasadia groups the two sessions,
   * as the Apps Script config did; its label is the part the session names
   * share before " - " (QA: "Pasadía - Mañana", "Pasadía - Tarde"), and each
   * session keeps the rest. Prices are per person in the event type's
   * currency; a missing or non-per-person price is null, so no receipt is drawn. */
  function planCatalog(answers) {
    function et(a) { return a && a.ok === true && a.event_type ? a.event_type : null; }
    function price(e) { return e && e.price_unit === 'person' && typeof e.price_minor === 'number' ? e.price_minor : null; }
    var am = et(answers.AMANECER), ta = et(answers.TARDE), g = et(answers.GUAYACAN24);
    var plans = [];
    if (am || ta) {
      var first = am || ta;
      var label = { ES: 'Pasadía', EN: 'Pasadía' };
      ['ES', 'EN'].forEach(function (L) {
        var a = am ? splitTitle(localized(am.name, L)) : null, b = ta ? splitTitle(localized(ta.name, L)) : null;
        var shared = a && b ? (a[0] === b[0] && a[1] && b[1] ? a[0] : null) : ((a || b)[1] ? (a || b)[0] : null);
        if (shared) label[L] = shared;
      });
      function sub(key, e) {
        var es = splitTitle(localized(e.name, 'ES')), en = splitTitle(localized(e.name, 'EN'));
        return { key: key, labelEs: es[1] && es[0] === label.ES ? es[1] : localized(e.name, 'ES'),
          labelEn: en[1] && en[0] === label.EN ? en[1] : localized(e.name, 'EN'), arrivalWindow: '' };
      }
      var subs = [];
      if (am) subs.push(sub('AMANECER', am));
      if (ta) subs.push(sub('TARDE', ta));
      // One plan price only when both sessions agree on it and its currency.
      var same = !(am && ta) || (price(am) === price(ta) && am.currency === ta.currency);
      plans.push({ key: 'PASADIA', labelEs: label.ES, labelEn: label.EN, priceMinor: same ? price(first) : null,
        currency: same ? first.currency : null, subOptions: subs, allowsAlmuerzo: false });
    }
    if (g) {
      plans.push({ key: 'GUAYACAN24', labelEs: localized(g.name, 'ES'), labelEn: localized(g.name, 'EN'), priceMinor: price(g),
        currency: g.currency || null, subOptions: [], allowsAlmuerzo: false });
    }
    return plans;
  }

  /* Receipt lines for index.html: per-person price x people. The deposit is
   * not known until the engine prices the booking, so it is not shown here. */
  function receipt(plan, people) {
    if (!plan || typeof plan.priceMinor !== 'number' || formatMoney(0, plan.currency) === null) return null;
    var total = plan.priceMinor * people;
    return { currency: plan.currency, unitMinor: plan.priceMinor, people: people, totalMinor: total };
  }

  function splitName(full) {
    var s = String(full || '').trim().replace(/\s+/g, ' ');
    var i = s.indexOf(' ');
    return i < 0 ? { first_name: s, last_name: null } : { first_name: s.slice(0, i), last_name: s.slice(i + 1) };
  }

  function blocked(code, message) { var e = new Error(message || code); e.code = code; return e; }

  /* POST /api/bookings body from the booking form.
   * f: { plan, subOption, slot, people, lang, nombre, email, phone, requerimientos,
   *      arrivalTime, hasMinors, minorWith, ackAccepted, ackText, waiverAccepted,
   *      waiverName, waiverText, page }
   * The waiver is recorded the two ways the engine takes from a booking form:
   * a consent (purpose waiver, with the text version) on the customer, and the
   * typed name, the text and its version in the booking intake. The engine's
   * document signature (sealed copy, evidence) is a separate signing link it
   * emails when the event type lists a waiver template; the form cannot sign it. */
  function bookingRequest(f) {
    if (!f || !f.slot || typeof f.slot.start !== 'string') throw blocked('slot_missing', 'no slot chosen');
    if (!(Number.isInteger(f.people) && f.people > 0)) throw blocked('people_invalid', 'people must be a positive whole number');
    if (f.ackAccepted !== true) throw blocked('ack_required', 'the services and cost breakdown must be approved');
    if (f.waiverAccepted !== true) throw blocked('waiver_required', 'the waiver must be accepted');
    var signed = String(f.waiverName || '').trim();
    if (!signed) throw blocked('waiver_name_required', 'the waiver needs the typed full name');
    var slug = slugFor(f.plan, f.subOption, f.config);
    if (!slug) throw blocked('event_type_unknown', 'no engine event type for ' + (f.subOption || f.plan));
    var l = lang(f.lang);
    var name = String(f.nombre || '').trim();
    var parts = splitName(name);
    var at = f.now || new Date().toISOString();
    var intake = {
      plan: f.plan,
      sub_option: f.subOption || null,
      arrival_time: f.arrivalTime || null,
      special_requests: f.requerimientos || null,
      has_minors: f.hasMinors === true ? true : (f.hasMinors === false ? false : null),
      minor_accompanied_by: f.hasMinors === true ? (String(f.minorWith || '').trim() || null) : null,
      services_ack: { accepted: true, text: f.ackText || null, text_version: ACK_TEXT_VERSION, at: at },
      waiver: { accepted: true, signed_name: signed, text: f.waiverText || null, text_lang: l, text_version: WAIVER_TEXT_VERSION, at: at },
      source_page: f.page || 'index',
    };
    return {
      event_type: slug,
      slot_start: f.slot.start,
      quantity: f.people,
      language: l,
      customer: {
        display_name: name,
        first_name: parts.first_name || null,
        last_name: parts.last_name,
        email: String(f.email || '').trim() || null,
        phone: String(f.phone || '').trim() || null,
        language: l,
      },
      intake: intake,
      consents: [
        { purpose: 'services_ack', granted: true, text_version: ACK_TEXT_VERSION, channel: 'web' },
        { purpose: 'waiver', granted: true, text_version: WAIVER_TEXT_VERSION, channel: 'web' },
      ],
    };
  }

  /* The booking answer, reduced to what the success view needs. */
  function bookingResult(json) {
    if (!json || json.ok !== true || !json.booking || typeof json.guest_token !== 'string') {
      return { ok: false, error: (json && json.error) || 'unknown', message: (json && json.message) || null };
    }
    var b = json.booking;
    return {
      ok: true, ref: b.ref, status: b.status, token: json.guest_token,
      payNow: b.status === 'pending_payment' && b.deposit_minor > 0,
      depositText: formatMoney(b.deposit_minor, b.currency), totalText: formatMoney(b.total_minor, b.currency),
      manageUrl: '/manage?token=' + encodeURIComponent(json.guest_token),
      payUrl: '/pay?token=' + encodeURIComponent(json.guest_token),
    };
  }

  function guestUrl(token, suffix, c) {
    return api(c) + '/guest/bookings/' + encodeURIComponent(token) + (suffix || '');
  }

  /* POST .../cancel body: pins the refund the guest was shown, so a change in
   * between is refused by the engine (refund_changed) instead of applied. */
  function cancelRequest(view) {
    var p = view && view.refund_preview;
    if (!view || view.can_cancel !== true || !p) throw blocked('cannot_cancel', 'this booking cannot be cancelled online');
    if (p.blocked || typeof p.refund_minor !== 'number') throw blocked('refund_unknown', 'the refund is not known');
    return { expected_refund_minor: p.refund_minor };
  }

  var T = {
    es: {
      refund: function (amt, pct) { return 'Si cancelas ahora te reembolsamos ' + amt + (pct != null ? ' (' + pct + '% de lo pagado)' : '') + '.'; },
      nothingPaid: 'Aún no hay pagos en esta reserva; cancelarla no genera reembolso.',
      refundUnknown: 'No podemos calcular el reembolso de esta reserva en línea. Contáctanos directamente.',
      cannot: 'Esta reserva ya no puede cancelarse en línea. Contáctanos directamente.',
      cancelled: function (amt) { return 'Reserva cancelada.' + (amt ? ' Reembolso: ' + amt + '.' : ''); },
      refundChanged: 'El reembolso cambió desde que abriste esta página. Recárgala y revísalo de nuevo.',
      payBtn: 'Pagar con tarjeta, Apple Pay o Google Pay',
      notDue: 'Esta reserva no está pendiente de pago o ya fue confirmada.',
      noStripe: 'El pago en línea no está disponible. Te contactaremos para coordinar el pago del depósito.',
      review: 'Tu reserva está en revisión antes del pago. Te contactaremos pronto. / Your booking is being reviewed before payment. We will contact you shortly.',
      paid: 'Recibimos tu pago. Te confirmaremos la reserva por correo en cuanto el pago se acredite.',
      payCancelled: 'El pago no se completó. Puedes intentarlo de nuevo.',
      redirecting: 'Abriendo el pago seguro...',
      deposit: 'Depósito requerido', balance: 'Saldo pendiente',
    },
    en: {
      refund: function (amt, pct) { return 'If you cancel now we refund ' + amt + (pct != null ? ' (' + pct + '% of what you paid)' : '') + '.'; },
      nothingPaid: 'Nothing has been paid on this booking yet; cancelling it carries no refund.',
      refundUnknown: 'We cannot work out the refund for this booking online. Please contact us directly.',
      cannot: 'This reservation can no longer be cancelled online. Please contact us directly.',
      cancelled: function (amt) { return 'Reservation cancelled.' + (amt ? ' Refund: ' + amt + '.' : ''); },
      refundChanged: 'The refund changed since you opened this page. Reload it and review it again.',
      payBtn: 'Pay by card, Apple Pay or Google Pay',
      notDue: 'This reservation is not awaiting payment or is already confirmed.',
      noStripe: 'Online payment is not available. We will contact you to arrange the deposit payment.',
      review: 'Tu reserva está en revisión antes del pago. Te contactaremos pronto. / Your booking is being reviewed before payment. We will contact you shortly.',
      paid: 'We received your payment. We will confirm the reservation by email as soon as it clears.',
      payCancelled: 'The payment was not completed. You can try again.',
      redirecting: 'Opening the secure payment page...',
      deposit: 'Deposit required', balance: 'Balance due',
    },
  };
  function text(L) { return T[lang(L)]; }

  /* The refund line manage.html shows above the cancel button. */
  function refundLine(view, L) {
    var t = text(L);
    if (!view || view.can_cancel !== true) return t.cannot;
    var p = view.refund_preview;
    if (!p || p.blocked || typeof p.refund_minor !== 'number') return t.refundUnknown;
    if (p.rule === 'nothing_paid') return t.nothingPaid;
    var amt = formatMoney(p.refund_minor, p.currency || (view.booking && view.booking.currency));
    if (amt === null) return t.refundUnknown;
    return t.refund(amt, p.pct_applied);
  }

  /* What manage.html and pay.html show about a booking. */
  function bookingSummary(view, L) {
    var b = (view && view.booking) || {};
    var l = lang(L || b.language);
    return {
      lang: l,
      ref: b.ref || '',
      date: typeof b.slot_start === 'string' ? b.slot_start.slice(0, 10) : '',
      session: localized(view && view.event_type && view.event_type.name, l) + (b.slot_start ? ' · ' + clock(b.slot_start) : ''),
      people: b.quantity,
      status: localized(b.status_label, l) || b.status || '',
      paid: formatMoney(b.paid_minor || 0, b.currency),
      payable: b.status === 'pending_payment',
    };
  }

  /* The pay step from the payment-options answer: Stripe Checkout or a reason not to. */
  function payState(opts, L) {
    var t = text(L);
    if (!opts || opts.ok !== true) return { kind: 'error', message: (opts && (opts.message || opts.error)) || 'error' };
    var amount = formatMoney(opts.amount_due_minor, opts.currency);
    if (amount === null) return { kind: 'review', message: t.review, amount: null };
    if (!(opts.amount_due_minor > 0)) return { kind: 'not_due', message: t.notDue, amount: null };
    if (!Array.isArray(opts.methods) || opts.methods.indexOf('stripe') < 0) return { kind: 'no_stripe', message: t.noStripe, amount: amount };
    return { kind: 'pay', amount: amount, label: opts.due_kind === 'balance' ? t.balance : t.deposit, button: t.payBtn };
  }

  /* The Checkout URL from POST .../pay, only when it is Stripe's. */
  function checkoutUrl(json) {
    if (!json || json.ok !== true || typeof json.url !== 'string') return null;
    return /^https:\/\/checkout\.stripe\.com\//.test(json.url) ? json.url : null;
  }

  var FRIENDLY = {
    es: {
      sold_out: 'Ya no hay cupo para esa fecha y jornada. Elige otra.',
      date_unavailable: 'Esa fecha no está disponible. Elige otra.',
      slot_unavailable: 'Esa fecha no está disponible para reservar en línea. Elige otra.',
      refund_changed: 'El reembolso cambió desde que abriste esta página. Recárgala y revísalo de nuevo.',
      engine_unavailable: 'No pudimos conectar con el sistema de reservas. Intenta de nuevo en unos minutos.',
      engine_misconfigured: 'Las reservas en línea no están disponibles en este momento. Escríbenos por WhatsApp.',
      not_found: 'No encontramos esta reserva. Verifica el enlace.',
    },
    en: {
      sold_out: 'There is no room left on that date and session. Please choose another.',
      date_unavailable: 'That date is not available. Please choose another.',
      slot_unavailable: 'That date cannot be booked online. Please choose another.',
      refund_changed: 'The refund changed since you opened this page. Reload it and review it again.',
      engine_unavailable: 'We could not reach the booking system. Please try again in a few minutes.',
      engine_misconfigured: 'Online booking is not available right now. Please message us on WhatsApp.',
      not_found: 'We could not find this reservation. Please check the link.',
    },
  };

  function bookingsUrl(c) { return api(c) + '/bookings'; }

  /* A message for the guest: a known engine code in the page language, else
   * the engine's own message, else the fallback. */
  function errorText(json, fallback, L) {
    var known = json && typeof json.error === 'string' ? FRIENDLY[lang(L)][json.error] : null;
    if (known) return known;
    if (json && typeof json.message === 'string' && json.message) return json.message;
    if (json && typeof json.error === 'string' && json.error) return json.error;
    return fallback || 'Error';
  }

  /* Pages the engine replaces with its own admin (operator review, admin). */
  function adminUrl(c) { c = cfg(c); return (c && c.admin) || null; }

  var UNAVAILABLE = {
    title: 'No disponible / Not available',
    es: 'Esta función no está disponible por ahora. Si necesitas ayuda escríbenos por WhatsApp.',
    en: 'This feature is not available for now. If you need help, message us on WhatsApp.',
  };
  var MOVED = {
    title: 'Administración / Admin',
    es: 'La administración de reservas está ahora en el panel del motor de reservas.',
    en: 'Booking administration now lives in the booking engine admin.',
    link: 'Abrir el panel de reservas / Open the bookings board',
    missing: 'El panel no está configurado (ENGINE_BASE). / The admin is not configured (ENGINE_BASE).',
  };

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  /* HTML for the bilingual notice on a page that is not offered in engine mode. */
  function noticeHtml(kind, c) {
    if (kind === 'admin') {
      var url = adminUrl(c);
      return '<div style="background:#fff;border-radius:18px;padding:24px 22px;max-width:520px;margin:24px auto;font-family:Inter,system-ui,sans-serif;color:#15201A;box-shadow:0 20px 40px -16px rgba(0,0,0,.18)">' +
        '<h1 style="font-family:Fraunces,Georgia,serif;font-size:1.3rem;margin-bottom:10px">' + esc(MOVED.title) + '</h1>' +
        '<p style="font-size:.92rem;line-height:1.5;margin-bottom:6px">' + esc(MOVED.es) + '</p>' +
        '<p style="font-size:.92rem;line-height:1.5;color:#6B7568;margin-bottom:16px">' + esc(MOVED.en) + '</p>' +
        (url ? '<a id="engineAdminLink" href="' + esc(url) + '" style="display:block;text-align:center;background:#1F3B2E;color:#FBF6EC;border-radius:11px;padding:14px;font-weight:600;text-decoration:none">' + esc(MOVED.link) + '</a>'
          : '<p style="color:#A3274C;font-size:.9rem">' + esc(MOVED.missing) + '</p>') +
        '</div>';
    }
    return '<div style="background:#fff;border-radius:18px;padding:24px 22px;max-width:520px;margin:24px auto;font-family:Inter,system-ui,sans-serif;color:#15201A;box-shadow:0 20px 40px -16px rgba(0,0,0,.18)">' +
      '<h1 style="font-family:Fraunces,Georgia,serif;font-size:1.3rem;margin-bottom:10px">' + esc(UNAVAILABLE.title) + '</h1>' +
      '<p style="font-size:.92rem;line-height:1.5;margin-bottom:6px">' + esc(UNAVAILABLE.es) + '</p>' +
      '<p style="font-size:.92rem;line-height:1.5;color:#6B7568;margin-bottom:16px">' + esc(UNAVAILABLE.en) + '</p>' +
      '<a href="https://wa.me/573102915558" style="color:#1F5C3A;font-weight:600">WhatsApp</a></div>';
  }

  /* In engine mode: replace the page's container with the notice and, for the
   * operator pages, send the browser to the engine admin. Returns true when the
   * page must not start its Apps Script flow. */
  function takeOver(kind, doc, loc, c) {
    if (!enabled(c)) return false;
    var box = doc.querySelector('.wrap') || doc.body;
    var brand = box.querySelector ? box.querySelector('.brand') : null;
    box.innerHTML = (brand ? brand.outerHTML : '') + noticeHtml(kind, c);
    var extra = doc.querySelectorAll ? doc.querySelectorAll('.progress, .sendwrap, #cam') : [];
    for (var i = 0; i < extra.length; i++) extra[i].style.display = 'none';
    var url = kind === 'admin' ? adminUrl(c) : null;
    if (url && loc && typeof loc.replace === 'function') loc.replace(url);
    return true;
  }

  async function getJson(url, init, fetchImpl) {
    var f = fetchImpl || root.fetch;
    var res = await f(url, init);
    var body;
    try { body = await res.json(); } catch (e) { body = { ok: false, error: 'bad_response', message: 'HTTP ' + res.status }; }
    return body;
  }
  function postJson(url, body, fetchImpl) {
    return getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fetchImpl);
  }

  root.GnpEngine = {
    WAIVER_TEXT_VERSION: WAIVER_TEXT_VERSION, ACK_TEXT_VERSION: ACK_TEXT_VERSION,
    enabled: enabled, lang: lang, localized: localized, formatMoney: formatMoney, slugFor: slugFor,
    availabilityUrl: availabilityUrl, slotOn: slotOn, clock: clock, planCatalog: planCatalog, receipt: receipt,
    splitName: splitName, bookingRequest: bookingRequest, bookingResult: bookingResult, guestUrl: guestUrl,
    cancelRequest: cancelRequest, refundLine: refundLine, bookingSummary: bookingSummary, payState: payState,
    checkoutUrl: checkoutUrl, errorText: errorText, bookingsUrl: bookingsUrl, adminUrl: adminUrl, noticeHtml: noticeHtml, takeOver: takeOver,
    text: text, getJson: getJson, postJson: postJson,
  };
})(typeof window !== 'undefined' ? window : globalThis);
