import assert from 'node:assert/strict';
import fs from 'node:fs';
import { planMandate, parseMandate, checkPolicy, initialExecutorState, canonicalMandate, migrateExecutorState, EXECUTOR_POLICY, EXECUTOR_VERSION } from '../src/learning/executor-v08.mjs';
import { signBitso, makeBitsoReadOnlyClient } from '../src/learning/bitso-readonly-client.mjs';

const t0 = Date.parse('2027-02-01T12:20:00Z');
const at = i => new Date(t0 + i * 3600e3);
const mandate = parseMandate('{"BTC":0.01249,"ADA":12000}');
const q = (btc, ada) => ({ BTC: { bid: btc * 0.9998, ask: btc * 1.0002 }, ADA: { bid: ada * 0.999, ask: ada * 1.001 } });
const bal = (b, usd = 0, btc = 0.01249, ada = 12000) => ({ usd: { available: usd, total: usd }, btc: { total: btc }, ada: { total: ada }, ...b });
const PORT = 10500;
const refOf = qs => Object.fromEntries(Object.entries(qs).map(([a, x]) => [a, (x.bid + x.ask) / 2]));
const DEEP = { BTC: { bid: 1e6, ask: 1e6 }, ADA: { bid: 1e6, ask: 1e6 } };
const step = (prev, postures, quotes, i, balances, portfolioUsd = PORT, extra = {}) =>
  planMandate({ previous: prev, mandate, postures, postureAt: at(i).toISOString(), balances, portfolioUsd, quotes, refPrices: refOf(quotes), depthUsd: DEEP, now: at(i), ...extra });

// Mandate parsing and policy guards.
assert.throws(() => parseMandate('{"AAVE":61}'), /not_supported:AAVE/);
assert.throws(() => parseMandate('{}'), /mandate_empty/);
assert.throws(() => checkPolicy({ ...EXECUTOR_POLICY, maxPortfolioFraction: 1 }), /below_1/);

// Day 1: RISK_OFF -> sells all of BOTH mandated holdings to USD (never more than mandated).
let r = step(null, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 0, bal({}, 0, 0.05, 20000));
assert.equal(r.report.orders.length, 2);
assert.ok(r.report.orders.every(o => o.side === 'sell'));
assert.equal(r.report.orders.find(o => o.asset === 'BTC').major, 0.01249, 'sells only the mandated BTC, not the extra 0.03751');
assert.equal(r.report.orders.find(o => o.asset === 'ADA').major, 12000);
let s = r.state; const usdBtc = s.sleeves.BTC.usd, usdAda = s.sleeves.ADA.usd;
assert.ok(usdBtc > 700 && usdAda > 1600);
assert.equal(s.sleeves.BTC.phase, 'CASH');

// RISK_ON later: re-buys each asset only with ITS OWN sleeve USD.
const usdNow = usdBtc + usdAda;
r = step(s, { BTC: 'RISK_ON', ADA: 'RISK_OFF' }, q(60000, 0.14), 24, bal({}, usdNow));
assert.equal(r.report.orders.length, 1);
assert.equal(r.report.orders[0].asset, 'BTC');
assert.equal(r.report.orders[0].side, 'buy');
assert.ok(r.report.orders[0].notionalUsd * 1.0036 <= usdBtc + 0.01, 'never spends ADA sleeve cash on BTC');
s = r.state; const btcUnits = s.sleeves.BTC.units;
assert.equal(s.sleeves.BTC.phase, 'FULL');

// +30% from entry -> take profit on HALF.
r = step(s, { BTC: 'RISK_ON', ADA: 'RISK_OFF' }, q(60000 * 1.31, 0.14), 48, bal({}, usdAda));
assert.equal(r.report.orders[0].reason, 'take_profit_half');
assert.ok(Math.abs(r.report.orders[0].major - btcUnits / 2) < 1e-8);
s = r.state; assert.equal(s.sleeves.BTC.phase, 'HALF');
// Still rising: hold the remaining half (no churn).
r = step(s, { BTC: 'RISK_ON', ADA: 'RISK_OFF' }, q(60000 * 1.4, 0.14), 49, bal({}, usdAda + s.sleeves.BTC.usd));
assert.equal(r.report.orders.length, 0);
// Pullback 15% from the take-profit price -> re-buy the half.
r = step(s, { BTC: 'RISK_ON', ADA: 'RISK_OFF' }, q(60000 * 1.31 * 0.84, 0.14), 72, bal({}, usdAda + s.sleeves.BTC.usd));
assert.equal(r.report.orders[0].reason, 'rebuy_after_pullback');
assert.ok(['FULL', 'CASH'].includes(r.state.sleeves.BTC.phase));

// DRY_RUN continuity: real balances unchanged (nothing was really sold) -> the next
// hour must NOT block on reconciliation, and RISK_OFF in CASH phase produces no orders.
const d1 = step(null, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 0, bal({}));
const d2 = step(d1.state, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 1, bal({}));
assert.equal(d2.report.action, 'NO_CHANGE');
assert.equal(d2.report.why, null);
assert.throws(() => planMandate({ mandate, postures: {}, postureAt: at(0).toISOString(), balances: bal({}), portfolioUsd: PORT, quotes: q(1, 1), now: at(0), dryRun: false }), /live_mode_not_available/);

// ABSTAIN: hold, never trade on bad data.
const fresh = initialExecutorState(mandate, at(0));
assert.equal(step(fresh, { BTC: 'ABSTAIN', ADA: 'ABSTAIN' }, q(57000, 0.137), 0, bal({})).report.orders.length, 0);

// Cap: mandate above 50% of the portfolio -> HOLD.
assert.equal(step(null, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 0, bal({}), 3000).report.why, 'mandate_exceeds_portfolio_cap');
// Reconcile: owner moved coins out -> HOLD, never oversell.
assert.match(step(null, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 0, bal({}, 0, 0.005)).report.why, /mandate_units_exceed_balance_reconcile:BTC/);
// Fail closed: stale postures / no balances / bad spread.
assert.equal(planMandate({ mandate, postures: { BTC: 'RISK_OFF' }, postureAt: at(-5).toISOString(), balances: bal({}), portfolioUsd: PORT, quotes: q(57000, 0.137), refPrices: refOf(q(57000, 0.137)), depthUsd: DEEP, now: at(0) }).report.why, 'stale_or_missing_postures');
assert.equal(step(null, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 0, null).report.why, 'balances_unavailable');
assert.equal(step(null, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, { BTC: { bid: 100, ask: 110 }, ADA: { bid: 1, ask: 1 } }, 0, bal({})).report.why, 'invalid_quote');

// Account stop: combined mandate -20% from its peak -> sell all and latch.
let st = step(null, { BTC: 'RISK_ON', ADA: 'RISK_ON' }, q(57000, 0.137), 0, bal({})).state;
let r2 = step(st, { BTC: 'RISK_ON', ADA: 'RISK_ON' }, q(57000 * 0.75, 0.137 * 0.75), 1, bal({}));
assert.equal(r2.state.stopped, true);
assert.ok(r2.report.orders.every(o => o.side === 'sell') && r2.report.orders.length === 2);
r2 = step(r2.state, { BTC: 'RISK_ON', ADA: 'RISK_ON' }, q(70000, 0.2), 2, bal({}));
assert.equal(r2.report.orders.length, 0, 'stop latches: no re-buy until the owner resets');

// Mandate changes require an explicit new state.
assert.throws(() => planMandate({ previous: st, mandate: { BTC: 0.02 }, postures: {}, postureAt: at(0).toISOString(), balances: bal({}), portfolioUsd: PORT, quotes: q(1, 1), now: at(0) }), /mandate_changed/);
assert.throws(() => planMandate({ previous: { ...st, realOrdersSent: 1 }, mandate, postures: {}, postureAt: at(0).toISOString(), balances: bal({}), portfolioUsd: PORT, quotes: q(1, 1), now: at(0) }), /dry_run_state_has_real_orders/);

// --- Pre-trade controls (v0.8.1) ---
// Price collar: Bitso mid 3% away from the Kraken reference -> HOLD.
assert.equal(step(null, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 0, bal({}), PORT, { refPrices: { BTC: 57000 * 1.03, ADA: 0.137 } }).report.why, 'price_collar_breach:BTC');
assert.equal(step(null, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 0, bal({}), PORT, { refPrices: { ADA: 0.137 } }).report.why, 'reference_price_missing:BTC');
// Max order value: a 1,640 USD ADA sale with a 1,000 USD cap -> capped now, remainder next hour.
const capPol = { ...EXECUTOR_POLICY, maxOrderUsd: 1000 };
const c1 = step(null, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 0, bal({}), PORT, { policy: capPol });
const adaO = c1.report.orders.find(o => o.asset === 'ADA');
assert.ok(adaO.notionalUsd <= 1000.01 && /size_capped/.test(adaO.reason));
const c2 = step(c1.state, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 1, bal({}), PORT, { policy: capPol });
assert.ok(c2.report.orders.some(o => o.asset === 'ADA' && o.side === 'sell'), 'remainder sold next hour');
assert.equal(c2.state.sleeves.ADA.units, 0);
// Depth: order limited to 50% of visible depth within 0.5%; no depth data -> no trade for that asset.
const dp1 = step(null, { BTC: "RISK_OFF", ADA: "RISK_OFF" }, q(57000, 0.137), 0, bal({}), PORT, { depthUsd: { BTC: { bid: 1e6, ask: 1e6 }, ADA: { bid: 1000, ask: 1000 } } });
assert.ok(dp1.report.orders.find(o => o.asset === 'ADA').notionalUsd <= 500.01);
const dp2 = step(null, { BTC: "RISK_OFF", ADA: "RISK_OFF" }, q(57000, 0.137), 0, bal({}), PORT, { depthUsd: { BTC: { bid: 1e6, ask: 1e6 } } });
assert.ok(!dp2.report.orders.some(o => o.asset === 'ADA'));
// Execution throttle: more than maxExecutions7d executions -> latched halt until owner reset.
const thrPol = { ...EXECUTOR_POLICY, maxExecutions7d: 2 };
let th = step(null, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 0, bal({}), PORT, { policy: thrPol }).state; // 2 executions
th = step(th, { BTC: 'RISK_ON', ADA: 'RISK_OFF' }, q(57000, 0.137), 1, bal({}), PORT, { policy: thrPol }).state;      // 3rd -> throttle
assert.equal(th.throttled, true);
assert.equal(step(th, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 2, bal({}), PORT, { policy: thrPol }).report.why, 'execution_throttle_latched_requires_owner_reset');

// Persistence round-trip: Postgres jsonb sorts object keys. A state read back from
// the DB ({"ADA":..,"BTC":..}) must continue, not fail as "mandate changed".
const jsonbRoundTrip = x => JSON.parse(JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v))
  ? Object.fromEntries(Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map(key => [key, v[key]])) : v));
const rt0 = step(null, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57000, 0.137), 0, bal({}));
const rtState = jsonbRoundTrip(rt0.state);
assert.deepEqual(Object.keys(rtState.mandate), ['ADA', 'BTC'], 'round-trip reorders keys like jsonb');
const rt1 = step(rtState, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(57500, 0.138), 1, bal({}));
assert.equal(rt1.report.action, 'NO_CHANGE', 'second hour after a DB round-trip continues');
assert.equal(canonicalMandate({ BTC: 0.01249, ADA: 12000 }), canonicalMandate({ ADA: 12000, BTC: 0.01249 }));
// A real mandate change is still refused.
assert.throws(() => planMandate({ previous: rtState, mandate: parseMandate('{"BTC":0.02,"ADA":12000}'), postures: { BTC: 'RISK_OFF', ADA: 'RISK_OFF' },
  postureAt: at(1).toISOString(), balances: bal({}), portfolioUsd: PORT, quotes: q(57000, 0.137), refPrices: refOf(q(57000, 0.137)), depthUsd: DEEP, now: at(1) }), /mandate_changed_requires_new_state/);
// Deploy continuity: a compatible earlier version's state is carried over (sleeves kept, not re-sold).
const oldState = { ...jsonbRoundTrip(rt0.state), version: 'shadow_executor_v0.8.1' };
const mig = step(oldState, { BTC: 'RISK_OFF', ADA: 'RISK_OFF' }, q(59000, 0.142), 2, bal({}));
assert.equal(mig.state.version, EXECUTOR_VERSION);
assert.deepEqual(mig.state.migratedFrom, ['shadow_executor_v0.8.1']);
assert.equal(mig.report.orders.length, 0, 'no re-sell after a deploy');
assert.equal(mig.state.sleeves.BTC.usd, rt0.state.sleeves.BTC.usd, 'sleeve USD preserved across versions');
const v08 = { ...jsonbRoundTrip(rt0.state), version: 'shadow_executor_v0.8' }; delete v08.executions; delete v08.throttled;
assert.equal(migrateExecutorState(v08).throttled, false);
assert.ok(Array.isArray(migrateExecutorState(v08).executions));
assert.throws(() => migrateExecutorState({ ...rt0.state, version: 'shadow_executor_v0.7' }), /version_mismatch/);
assert.throws(() => migrateExecutorState({ ...rt0.state, version: 'shadow_executor_v0.9' }), /version_mismatch/);

// Read-only client & no order code anywhere in the executor build.
assert.match(signBitso({ key: 'k', secret: 's', nonce: 1, method: 'GET', path: '/api/v3/balance/' }), /^Bitso k:1:[a-f0-9]{64}$/);
assert.throws(() => makeBitsoReadOnlyClient({ key: '', secret: '' }), /credentials_missing/);
const src = ['../src/learning/bitso-readonly-client.mjs', '../src/learning/executor-v08.mjs', './learning-executor.mjs']
  .map(p => fs.readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
assert.ok(!/['"]POST['"]|['"]DELETE['"]|\/api\/v3\/orders/.test(src), 'no order-sending code in the dry-run build');


// Owner metric (extra vs HOLD) and Bitso-vs-Kraken quote check, computed in-engine.
{
  const { holdVsMandate, quoteCheck } = await import('../src/learning/mandate-metrics-v01.mjs');
  const q = { BTC: { bid: 63900, ask: 64100 }, ADA: { bid: 0.1499, ask: 0.1501 } };
  const h = holdVsMandate({ mandate: { BTC: 0.01249, ADA: 12000 }, quotes: q, mandateUsd: 2299.7 });
  assert.equal(h.holdUsd, 2599.36); assert.equal(h.extraUsd, -299.66); assert.equal(h.extraPct, -11.53);
  assert.equal(holdVsMandate({ mandate: { BTC: 1 }, quotes: {}, mandateUsd: 10 }), null, 'no quote -> no metric, never a guess');
  assert.equal(holdVsMandate({ mandate: { BTC: 1 }, quotes: q, mandateUsd: null }), null);
  // The suspected 2026-11-20 exit: Bitso ~55.6k while Kraken ~64k -> flagged.
  const c = quoteCheck({ quotes: { BTC: { bid: 55500, ask: 55700 }, ADA: q.ADA }, refPrices: { BTC: 64000, ADA: 0.15 } });
  assert.equal(c.BTC.warn, true); assert.ok(c.BTC.devPct < -12); assert.equal(c.ADA.warn, false);
  assert.deepEqual(quoteCheck({ quotes: { BTC: q.BTC }, refPrices: {} }).BTC, { devPct: null });
}
console.log('SHADOW_EXECUTOR_V08_SELFTEST=' + JSON.stringify({ ok: true, version: EXECUTOR_VERSION, mandateOnly: true, sellsOnRiskOff: true, takeProfitHalf: true, rebuyOnPullback: true, sleevesIsolated: true, capBelow100: true, accountStopLatches: true, failClosed: true, priceCollar: true, maxOrderValue: true, depthAware: true, executionThrottle: true, jsonbRoundTrip: true, deployContinuity: true, realOrdersSent: 0 }));
