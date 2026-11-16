/*
 * gnp-visit-site Worker entry. It exports the fetch handler and nothing else:
 * current workerd treats every named export of the entry module as an
 * entrypoint and refuses a plain value, so constants, the build marker and the
 * calendar copy live in src/calendar.js, the backend switch in src/engine.js.
 *
 *   /config.js            which backend the pages use (src/engine.js)
 *   /engine/api/...       the engine's guest routes, forwarded (src/engine.js)
 *   /api/calendar         a month of availability from the edge copy
 *   /guest/bookings/<t>, /bookings/<t>   engine guest links to pay and manage
 *   everything else       the static pages in ./public/
 */

import { engineConfig, configScript, handleEngineApi, guestRedirect, engineMonth } from './engine.js';
import { handleCalendar, json } from './calendar.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/config.js') return configScript(env);
    if (url.pathname.startsWith('/engine/')) return handleEngineApi(request, env, (u, init) => fetch(u, init));
    if (url.pathname === '/api/calendar') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ ok: false, error: 'method not allowed' }, 405);
      }
      const deps = { cache: caches.default, fetch: (u, init) => fetch(u, init), now: () => Date.now() };
      const engine = engineConfig(env);
      if (engine.on) {
        if (!engine.base) return json({ ok: false, error: 'engine_misconfigured', message: engine.error }, 503);
        deps.source = new URL(engine.base).host;
        deps.upstream = (month) => engineMonth(month, engine.base, engine.eventTypes, deps.fetch);
      }
      return handleCalendar(request, ctx, deps);
    }
    const redirect = guestRedirect(env, url);
    if (redirect) return redirect;
    return env.ASSETS.fetch(request);
  },
};
