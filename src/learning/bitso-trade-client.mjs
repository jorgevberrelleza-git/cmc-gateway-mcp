// Bitso TRADE client — the only module that can place or cancel orders.
// Separate from the read-only client and NOT imported by the dry-run executor.
//
// Safety by construction (independent review 21-nov-2026, findings C1–C3, A1–A3, M1–M4):
//  - Live lock re-checked against the REAL process.env and clock before EVERY
//    order/cancel (not only at construction); env/clock are not injectable
//    outside an explicit test mode.
//  - Credentials read only from BITSO_TRADE_API_KEY/SECRET (never the read-only key).
//  - Frozen book table (btc_usd, ada_usd) with per-book decimals; numbers must
//    be finite JS numbers and are formatted without exponent notation.
//  - Hard caps inside the client: min/max order value in USD.
//  - Only LIMIT + immediateorcancel orders (never rests on the book).
//  - Idempotency: a durable journal must record the origin_id BEFORE the POST;
//    a known id is refused (no automatic retries, ever).
//  - Typed outcome on failure: REJECTED (Bitso answered success:false) vs
//    UNKNOWN (timeout/network/5xx/invalid JSON: the order may or may not exist
//    -> caller must stop and reconcile by origin_id).
//  - Kill cancels only Shadow's own orders (by origin_id), never the owner's manual ones.
import crypto from 'node:crypto';
import { TRADE_LIMITS, BOOKS, ORIGIN_ID_RE, collarPrice, buildLimitIoc } from './bitso-order-spec.mjs';
export { TRADE_LIMITS, BOOKS, collarPrice }; // single source of truth: bitso-order-spec.mjs

export const LIVE_GO_LIVE_DATE = '2027-01-31T00:00:00Z';
export const MAX_ARM_WINDOW_DAYS = 31;
const ISO_Z_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

export class TradeError extends Error {
  constructor(state, code, originId = null) { super(`bitso_trade:${state}:${code}`); this.state = state; this.code = code; this.originId = originId; }
}

// ---- Test hooks: only usable when SHADOW_TEST_MODE=1 (never set in Render). ----
let testClock = null, testEnv = null;
const testModeOn = () => process.env.SHADOW_TEST_MODE === '1' && process.env.NODE_ENV !== 'production';
export function __installTestHooks({ now, env }) {
  if (!testModeOn()) throw new Error('test_hooks_require_SHADOW_TEST_MODE');
  testClock = now ? () => new Date(+now) : null; testEnv = env || null;
}
// Hooks are honoured only while test mode is still on (removing the variable disables them).
const clockNow = () => (testClock && testModeOn() ? testClock() : new Date());
const realEnv = () => (testEnv && testModeOn() ? testEnv : process.env);

/** Live lock. Exact values only; any doubt fails closed. */
export function assertLiveArmed() {
  const env = realEnv(), now = clockNow();
  if (env.SHADOW_EXECUTION_ENABLED !== 'true') throw new Error('live_lock:execution_not_enabled');
  const armRaw = String(env.SHADOW_LIVE_ARMED_UNTIL || '');
  if (!ISO_Z_RE.test(armRaw)) throw new Error('live_lock:arm_must_be_iso_utc_z');
  const until = Date.parse(armRaw);
  if (!(until > +now)) throw new Error('live_lock:not_armed_or_arm_expired');
  if (until - +now > MAX_ARM_WINDOW_DAYS * 86_400_000) throw new Error('live_lock:arm_window_too_long');
  if (+now < Date.parse(LIVE_GO_LIVE_DATE)) throw new Error('live_lock:before_go_live_date');
  if (!env.BITSO_TRADE_API_KEY || !env.BITSO_TRADE_API_SECRET) throw new Error('live_lock:trade_key_missing');
  if (env.BITSO_TRADE_API_KEY === env.BITSO_READONLY_API_KEY) throw new Error('live_lock:trade_key_must_differ_from_readonly');
  return true;
}

export function signBitso({ key, secret, nonce, method, path, body = '' }) {
  return `Bitso ${key}:${nonce}:` + crypto.createHmac('sha256', secret).update(String(nonce) + method + path + body).digest('hex');
}

/**
 * @param journal durable store of sent origin_ids (Postgres table with a UNIQUE key when wired):
 *   appendIfAbsent(id, meta): Promise<boolean>  — ATOMIC; true only if newly recorded (durable before resolving)
 *   markUnknown(id): Promise<void>               — record that the outcome of id is unknown
 *   unresolvedCount(): Promise<number>           — unknown outcomes not yet reconciled
 */
export function makeBitsoTradeClient({ journal, baseUrl = 'https://api.bitso.com', fetchImpl = fetch, timeoutMs = 8000 }) {
  assertLiveArmed();
  for (const fn of ['appendIfAbsent', 'markUnknown', 'unresolvedCount']) {
    if (!journal || typeof journal[fn] !== 'function') throw new Error('trade:journal_required:' + fn);
  }
  const inFlight = new Set(); // same-process race guard in addition to the atomic journal
  let lastNonce = 0;
  async function call(method, path, bodyObj, originId = null) {
    if (method !== 'GET') assertLiveArmed(); // re-check before every mutating request
    const env = realEnv();
    const key = env.BITSO_TRADE_API_KEY, secret = env.BITSO_TRADE_API_SECRET;
    const body = bodyObj ? JSON.stringify(bodyObj) : '';
    const nonce = Math.max(Date.now(), lastNonce + 1); lastNonce = nonce;
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    let res, j;
    try {
      const timeout = new Promise((_, rej) => ctl.signal.addEventListener('abort', () => rej(new Error('timeout'))));
      try {
        res = await Promise.race([fetchImpl(baseUrl + path, { method, signal: ctl.signal, body: body || undefined,
          headers: { Authorization: signBitso({ key, secret, nonce, method, path, body }), ...(body ? { 'Content-Type': 'application/json' } : {}) } }), timeout]);
      } catch (e) { throw new TradeError('UNKNOWN', 'network_or_timeout', originId); }
      // The timeout also covers reading the body (a hung body is an UNKNOWN outcome).
      try { j = await Promise.race([res.json(), timeout]); } catch { throw new TradeError('UNKNOWN', 'invalid_or_hung_body_http_' + res.status, originId); }
    } finally { clearTimeout(t); }
    if (res.status >= 500) throw new TradeError('UNKNOWN', 'http_' + res.status, originId);
    if (!res.ok || j?.success !== true) throw new TradeError('REJECTED', String(j?.error?.code || res.status), originId);
    return j.payload;
  }
  return {
    async placeLimitIoc({ book, side, major, price, originId }) {
      const o = buildLimitIoc({ book, side, major, price, originId }); // books, side, id, formatting, caps
      const majorS = o.major, priceS = o.price;
      if ((await journal.unresolvedCount()) > 0) throw new TradeError('REJECTED', 'blocked_until_unknown_orders_reconciled', originId);
      if (inFlight.has(originId)) throw new TradeError('REJECTED', 'duplicate_origin_id_in_flight', originId);
      inFlight.add(originId);
      try {
        const fresh = await journal.appendIfAbsent(originId, { book, side, major: majorS, price: priceS, at: clockNow().toISOString() }); // durable BEFORE sending
        if (fresh !== true) throw new TradeError('REJECTED', 'duplicate_origin_id_in_journal', originId);
        try {
          return await call('POST', '/api/v3/orders', { book, side, type: 'limit', major: majorS, price: priceS,
            time_in_force: 'immediateorcancel', origin_id: originId }, originId);
        } catch (e) { if (e instanceof TradeError && e.state === 'UNKNOWN') await journal.markUnknown(originId); throw e; }
      } finally { inFlight.delete(originId); }
    },
    async lookupByOriginIds(ids) {
      if (!ids.length || ids.length > 50 || !ids.every(i => ORIGIN_ID_RE.test(i))) throw new Error('trade:bad_origin_ids');
      return call('GET', '/api/v3/orders?origin_ids=' + ids.join(','));
    },
    async userTrades(book, limit = 25) {
      if (!BOOKS[book]) throw new Error('trade:book_not_allowed:' + book);
      const n = Number.isInteger(limit) && limit > 0 ? Math.min(100, limit) : 25;
      return call('GET', `/api/v3/user_trades?book=${book}&limit=${n}`);
    },
    /** Kill: cancel Shadow's OWN open orders (by origin_id). Never touches the owner's manual orders. */
    async cancelShadowOrders(ids) {
      if (!ids.length) return [];
      if (ids.length > 50 || !ids.every(i => ORIGIN_ID_RE.test(i))) throw new Error('trade:bad_origin_ids');
      return call('DELETE', '/api/v3/orders?origin_ids=' + ids.join(','));
    }
  };
}
// Operational notes, required BEFORE wiring (review 21-nov): (M2) the live runner
// must hold a Postgres advisory lock so only one process uses the trade key (the
// trend-ledger and executor runners already lock; the hourly cycle itself does not);
// (C3) the journal must be a Postgres table with a UNIQUE origin_id; (M5) the live executor will translate the
// planner's orders to limit-IOC with collarPrice() and must treat UNKNOWN as
// "stop and reconcile by origin_id" before any further order.
