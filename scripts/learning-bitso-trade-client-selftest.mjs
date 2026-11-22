// Run with SHADOW_TEST_MODE=1 (npm script sets it). Covers review findings C1–C3, A1–A3, M1–M4.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertLiveArmed, makeBitsoTradeClient, collarPrice, signBitso, TradeError, __installTestHooks, LIVE_GO_LIVE_DATE } from '../src/learning/bitso-trade-client.mjs';

if (process.env.SHADOW_TEST_MODE !== '1') { console.error('run with SHADOW_TEST_MODE=1'); process.exit(2); }
const after = new Date('2027-02-01T12:00:00Z'), before = new Date('2026-12-15T12:00:00Z');
const ARMED = { SHADOW_EXECUTION_ENABLED: 'true', SHADOW_LIVE_ARMED_UNTIL: '2027-02-02T00:00:00Z', BITSO_TRADE_API_KEY: 'tk', BITSO_TRADE_API_SECRET: 'ts', BITSO_READONLY_API_KEY: 'rk' };
const env = { ...ARMED };
const setEnv = patch => { for (const k of Object.keys(env)) delete env[k]; Object.assign(env, ARMED, patch); };
__installTestHooks({ now: after, env });

// --- Live lock (M1): exact values, ISO-Z arm date, bounded window, go-live date, separate key.
const lockCase = (patch, re, now = after) => { setEnv(patch); __installTestHooks({ now, env }); assert.throws(() => assertLiveArmed(), re); };
lockCase({ SHADOW_EXECUTION_ENABLED: 'TRUE' }, /execution_not_enabled/);
lockCase({ SHADOW_EXECUTION_ENABLED: ' true ' }, /execution_not_enabled/);
lockCase({ SHADOW_LIVE_ARMED_UNTIL: '' }, /arm_must_be_iso_utc_z/);
lockCase({ SHADOW_LIVE_ARMED_UNTIL: 'Feb 2 2027' }, /arm_must_be_iso_utc_z/);
lockCase({ SHADOW_LIVE_ARMED_UNTIL: '2027-02-02T00:00:00' }, /arm_must_be_iso_utc_z/);
lockCase({ SHADOW_LIVE_ARMED_UNTIL: '9999-12-31T00:00:00Z' }, /arm_window_too_long/);
lockCase({ SHADOW_LIVE_ARMED_UNTIL: '2027-01-31T00:00:00Z' }, /arm_expired/);
lockCase({ SHADOW_LIVE_ARMED_UNTIL: '2026-12-20T00:00:00Z' }, /before_go_live_date/, before);
lockCase({ BITSO_TRADE_API_SECRET: '' }, /trade_key_missing/);
lockCase({ BITSO_TRADE_API_KEY: 'rk' }, /must_differ_from_readonly/);
setEnv({}); __installTestHooks({ now: after, env }); assert.equal(assertLiveArmed(), true);

// --- Fixed signature vector, computed independently with openssl:
// echo -n '1700000000000POST/api/v3/orders{"a":1}' | openssl dgst -sha256 -hmac secret123
assert.equal(signBitso({ key: 'k', secret: 'secret123', nonce: 1700000000000, method: 'POST', path: '/api/v3/orders', body: '{"a":1}' }),
  'Bitso k:1700000000000:122f54ca02c4fbe1efc0ba2d7f75545d3e48c70dd696b5a40227ee22fab5627c');

// --- Helpers
const mkJournal = () => { const s = new Map(), unknown = new Set(); return { s, unknown,
  appendIfAbsent: async (id, m) => { if (s.has(id)) return false; s.set(id, m); return true; },
  markUnknown: async id => { unknown.add(id); }, unresolvedCount: async () => unknown.size }; };
const ok = payload => async () => ({ ok: true, status: 200, json: async () => ({ success: true, payload }) });
const oid = n => 'shadow-' + String(n).repeat(24).slice(0, 24);
const calls = []; const recorder = async (url, opt) => { calls.push({ url, ...opt }); return ok({ oid: 'x' })(); };

// --- C1: lock re-checked before EVERY mutating request (disarm/expiry after construction blocks).
setEnv({}); __installTestHooks({ now: after, env });
const j1 = mkJournal(); const c = makeBitsoTradeClient({ journal: j1, fetchImpl: recorder });
await c.placeLimitIoc({ book: 'btc_usd', side: 'sell', major: 0.01249, price: 58705, originId: oid(1) });
env.SHADOW_EXECUTION_ENABLED = 'false';
await assert.rejects(c.placeLimitIoc({ book: 'btc_usd', side: 'sell', major: 0.01, price: 58705, originId: oid(2) }), /execution_not_enabled/);
await assert.rejects(c.cancelShadowOrders([oid(1)]), /execution_not_enabled/);
setEnv({}); __installTestHooks({ now: new Date('2027-02-02T00:00:01Z'), env });
await assert.rejects(c.placeLimitIoc({ book: 'btc_usd', side: 'sell', major: 0.01, price: 58705, originId: oid(3) }), /arm_expired/);
setEnv({}); __installTestHooks({ now: after, env });

// --- A3: credentials from env only (the read-only key can never sign an order).
const sent = calls[0]; assert.match(sent.headers.Authorization, /^Bitso tk:/);
assert.deepEqual(JSON.parse(sent.body), { book: 'btc_usd', side: 'sell', type: 'limit', major: '0.01249000', price: '58705', time_in_force: 'immediateorcancel', origin_id: oid(1) });
const [, nonce] = sent.headers.Authorization.slice(6).split(':');
assert.equal(sent.headers.Authorization, signBitso({ key: 'tk', secret: 'ts', nonce, method: 'POST', path: '/api/v3/orders', body: sent.body }));

// --- C2 / A2: types, formatting, caps, frozen books.
const c2 = makeBitsoTradeClient({ journal: mkJournal(), fetchImpl: recorder });
await assert.rejects(c2.placeLimitIoc({ book: 'btc_usd', side: 'sell', major: [5], price: 58705, originId: oid(4) }), /bad_major/);
await assert.rejects(c2.placeLimitIoc({ book: 'btc_usd', side: 'sell', major: true, price: 58705, originId: oid(4) }), /bad_major/);
await assert.rejects(c2.placeLimitIoc({ book: 'btc_usd', side: 'sell', major: 1e-7, price: 58705, originId: oid(4) }), /below_min_order_usd/); // 1e-7 is formatted '0.00000010' (no exponent) and then blocked by the USD floor
await assert.rejects(c2.placeLimitIoc({ book: 'btc_usd', side: 'buy', major: 1, price: 58705, originId: oid(4) }), /above_max_order_usd/);
await assert.rejects(c2.placeLimitIoc({ book: 'eth_mxn', side: 'buy', major: 1, price: 1, originId: oid(4) }), /book_not_allowed/);
await assert.rejects(c2.placeLimitIoc({ book: 'btc_usd', side: 'BUY', major: 0.01, price: 58705, originId: oid(4) }), /bad_side/);
await c2.placeLimitIoc({ book: 'ada_usd', side: 'sell', major: 0.1 + 0.2 + 12000, price: 0.1 + 0.04, originId: oid(5) });
const adaBody = JSON.parse(calls.at(-1).body);
assert.equal(adaBody.major, '12000.30'); assert.equal(adaBody.price, '0.14000');
assert.ok(!/e/i.test(adaBody.major + adaBody.price), 'no exponent notation');

// --- C3: durable journal BEFORE the POST; a repeated origin_id is refused even if the first call crashed.
const j3 = mkJournal();
const crash = makeBitsoTradeClient({ journal: j3, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
const e1 = await crash.placeLimitIoc({ book: 'btc_usd', side: 'sell', major: 0.01249, price: 58705, originId: oid(6) }).catch(e => e);
assert.ok(e1 instanceof TradeError && e1.state === 'UNKNOWN' && e1.originId === oid(6));
assert.ok(j3.s.has(oid(6)), 'journaled before sending');
const retry = makeBitsoTradeClient({ journal: j3, fetchImpl: recorder }); const before3 = calls.length;
const e2 = await retry.placeLimitIoc({ book: 'btc_usd', side: 'sell', major: 0.01249, price: 58705, originId: oid(6) }).catch(e => e);
assert.equal(e2.code, 'blocked_until_unknown_orders_reconciled'); assert.equal(calls.length, before3, 'no second POST');
// A completed id can never be sent again either.
const dupe = await c.placeLimitIoc({ book: 'btc_usd', side: 'sell', major: 0.01249, price: 58705, originId: oid(1) }).catch(e => e);
assert.equal(dupe.code, 'duplicate_origin_id_in_journal');

// UNKNOWN blocks every new order until reconciled.
const e3 = await retry.placeLimitIoc({ book: 'btc_usd', side: 'sell', major: 0.01, price: 58705, originId: oid(9) }).catch(e => e);
assert.equal(e3.code, 'blocked_until_unknown_orders_reconciled');
assert.ok(j3.unknown.has(oid(6)));

// Same-id race: two concurrent calls -> exactly one POST.
let posts = 0; const slow = async () => { posts++; await new Promise(r => setTimeout(r, 30)); return ok({ oid: 'y' })(); };
const race = makeBitsoTradeClient({ journal: mkJournal(), fetchImpl: slow });
const rr = await Promise.allSettled([1, 2].map(() => race.placeLimitIoc({ book: 'ada_usd', side: 'buy', major: 100, price: 0.14, originId: oid('a') })));
assert.equal(posts, 1); assert.equal(rr.filter(x => x.status === 'fulfilled').length, 1);
// Non-atomic / no-op journal (appendIfAbsent not returning true) never sends.
const noop = makeBitsoTradeClient({ journal: { appendIfAbsent: async () => undefined, markUnknown: async () => {}, unresolvedCount: async () => 0 }, fetchImpl: recorder });
const nb = calls.length; await assert.rejects(noop.placeLimitIoc({ book: 'ada_usd', side: 'buy', major: 100, price: 0.14, originId: oid('b') }), /duplicate_origin_id_in_journal/);
assert.equal(calls.length, nb);
// Sell price off-tick is rounded UP (never sells below the requested price); buy rounded DOWN.
await c2.placeLimitIoc({ book: 'ada_usd', side: 'sell', major: 100, price: 0.140071, originId: oid('c') });
assert.equal(JSON.parse(calls.at(-1).body).price, '0.14008');
await c2.placeLimitIoc({ book: 'ada_usd', side: 'buy', major: 100, price: 0.140079, originId: oid('d') });
assert.equal(JSON.parse(calls.at(-1).body).price, '0.14007');

// --- A1: typed outcomes (incl. a body that never finishes -> UNKNOWN within the timeout).
const hung = makeBitsoTradeClient({ journal: mkJournal(), timeoutMs: 50, fetchImpl: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) });
const t0h = Date.now(); const eh = await hung.placeLimitIoc({ book: 'ada_usd', side: 'buy', major: 100, price: 0.14, originId: oid('e') }).catch(e => e);
assert.equal(eh.state, 'UNKNOWN'); assert.ok(Date.now() - t0h < 1000);
const t502 = makeBitsoTradeClient({ journal: mkJournal(), fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('html'); } }) });
assert.equal((await t502.placeLimitIoc({ book: 'ada_usd', side: 'buy', major: 100, price: 0.14, originId: oid(7) }).catch(e => e)).state, 'UNKNOWN');
const tRej = makeBitsoTradeClient({ journal: mkJournal(), fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ success: false, error: { code: '0379' } }) }) });
const er = await tRej.placeLimitIoc({ book: 'ada_usd', side: 'buy', major: 100, price: 0.14, originId: oid(8) }).catch(e => e);
assert.equal(er.state, 'REJECTED'); assert.equal(er.code, '0379');

// --- M3: kill cancels only Shadow's own orders by origin_id (never DELETE /orders/all).
await c2.cancelShadowOrders([oid(1), oid(5)]);
assert.equal(calls.at(-1).method, 'DELETE'); assert.match(calls.at(-1).url, /\/api\/v3\/orders\?origin_ids=shadow-/);
const src = fs.readFileSync(new URL('../src/learning/bitso-trade-client.mjs', import.meta.url), 'utf8');
assert.ok(!src.includes("'/api/v3/orders/all'"), 'no cancel-all of the owner orders');

// --- M4: collar price strict side, conservative rounding, float-safe.
assert.equal(collarPrice({ side: 'buy', bid: 59000, ask: 59010, collarPct: 0.5, book: 'btc_usd' }), 59305);
assert.equal(collarPrice({ side: 'sell', bid: 59000, ask: 59010, collarPct: 0.5, book: 'btc_usd' }), 58705);
assert.equal(collarPrice({ side: 'sell', bid: 0.1414, ask: 0.1415, collarPct: 0.5, book: 'ada_usd' }), 0.1407);
assert.equal(collarPrice({ side: 'buy', bid: 0.3, ask: 0.3, collarPct: 0.5, book: 'ada_usd' }), 0.3015); // exactly the collar, no float drift
assert.throws(() => collarPrice({ side: 'BUY', bid: 1, ask: 1, collarPct: 0.5, book: 'btc_usd' }), /bad_side/);
assert.throws(() => collarPrice({ side: 'buy', bid: 1, ask: 1, collarPct: 5, book: 'btc_usd' }), /bad_collar/);

// --- Test hooks: refused outside test mode or in production, and ignored once test mode is removed.
const saved = process.env.SHADOW_TEST_MODE; process.env.SHADOW_TEST_MODE = '0';
assert.throws(() => __installTestHooks({ now: after }), /require_SHADOW_TEST_MODE/);
assert.throws(() => assertLiveArmed(), /execution_not_enabled|before_go_live_date/); // hooks no longer honoured -> real env/clock
process.env.SHADOW_TEST_MODE = saved; process.env.NODE_ENV = 'production';
assert.throws(() => __installTestHooks({ now: after }), /require_SHADOW_TEST_MODE/);
delete process.env.NODE_ENV;

// --- Isolation: dry-run build never references the trade client (static or dynamic import).
for (const f of ['../src/learning/executor-v08.mjs', './learning-executor.mjs', './learning-hourly-cycle.mjs']) {
  const t = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  assert.ok(!/trade-client|trade_client|tradeClient/.test(t), f + ' must not reference the trade client');
}

console.log('SHADOW_TRADE_CLIENT_SELFTEST=' + JSON.stringify({ ok: true, goLive: LIVE_GO_LIVE_DATE, lockRecheckedPerRequest: true, envOnlyKeys: true,
  capsAndFormatting: true, journalBeforePost: true, typedUnknownVsRejected: true, killOwnOrdersOnly: true, notWiredIntoDryRun: true }));
