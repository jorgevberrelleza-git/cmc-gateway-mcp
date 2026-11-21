import assert from 'node:assert/strict';
import { planExecution, initialExecutorState, checkPolicy, EXECUTOR_POLICY, EXECUTOR_VERSION } from '../src/learning/executor-v07.mjs';
import { signBitso, makeBitsoReadOnlyClient } from '../src/learning/bitso-readonly-client.mjs';
import fs from 'node:fs';

const now = new Date('2026-12-01T12:20:00Z');
const at = '2026-12-01T12:16:00Z';
const q = (btc, eth) => ({ BTC: { bid: btc * 0.9998, ask: btc * 1.0002 }, ETH: { bid: eth * 0.9995, ask: eth * 1.0005 } });
const P = (b, e) => [{ asset: 'BTC', posture: b }, { asset: 'ETH', posture: e }];
// Owner portfolio: 10,000 USD cash + 0.1 BTC + 2 ETH they already held, + 1,000 USD in other assets.
const bal = (usd = 10000, btc = 0.1, eth = 2) => ({ usd: { available: usd, total: usd }, btc: { total: btc }, eth: { total: eth } });

// Owner rule: never 100% of the portfolio.
assert.throws(() => checkPolicy({ ...EXECUTOR_POLICY, maxPortfolioFraction: 1 }), /below_1/);
assert.throws(() => checkPolicy({ ...EXECUTOR_POLICY, stopDrawdownPct: 50 }), /bad_stop/);

// RISK_OFF on both: no orders, sleeve funded from USD up to the cap.
let { state, report } = planExecution({ postures: P('RISK_OFF', 'RISK_OFF'), postureAt: at, balances: bal(), otherAssetsUsd: 1000, quotes: q(60000, 1600), now });
assert.equal(report.mode, 'DRY_RUN');
assert.equal(report.orders.length, 0);
const portfolio = 10000 + 0.1 * 60000 + 2 * 1600 + 1000; // 20,200
assert.ok(Math.abs(report.sleeve.portfolioUsd - portfolio) < 5);
assert.ok(report.sleeve.capUsd <= 0.5 * portfolio + 1);
assert.equal(report.sleeve.shadowCashUsd, 10000 > 0.5 * portfolio ? Math.round(0.5 * portfolio * 100) / 100 : 10000);

// BTC RISK_ON: buys half the sleeve at most, capped per order; never above the portfolio cap.
({ state, report } = planExecution({ previous: state, postures: P('RISK_ON', 'RISK_OFF'), postureAt: at, balances: bal(), otherAssetsUsd: 1000, quotes: q(60000, 1600), now }));
assert.equal(report.action, 'WOULD_SEND');
assert.equal(report.orders.length, 1);
assert.equal(report.orders[0].book, 'btc_usd');
assert.equal(report.orders[0].side, 'buy');
assert.ok(report.orders[0].notionalUsd <= 0.5 * report.sleeve.valueUsd + 0.01);
assert.match(report.orders[0].clientOrderId, /^shadow-[a-f0-9]{24}$/);
assert.equal(report.realOrdersSent, 0);
const boughtBtc = state.shadowUnits.BTC;
assert.ok(state.shadowCashUsd >= 0 && state.shadowCashUsd + report.orders[0].notionalUsd * 1.0036 <= report.sleeve.shadowCashUsd + report.orders[0].notionalUsd * 1.0036 + 0.01);
assert.ok(boughtBtc > 0);

// RISK_OFF later: sells ONLY what Shadow bought, never the owner's original 0.1 BTC.
({ state, report } = planExecution({ previous: state, postures: P('RISK_OFF', 'RISK_OFF'), postureAt: at, balances: bal(5000, 0.1 + boughtBtc, 2), otherAssetsUsd: 1000, quotes: q(60000, 1600), now: new Date(+now + 3600e3) }));
assert.equal(report.orders[0].side, 'sell');
assert.ok(Math.abs(report.orders[0].major - boughtBtc) < 1e-8, 'sells exactly the Shadow units');
assert.equal(state.shadowUnits.BTC, 0);

// Owner withdrew coins Shadow thinks it has -> HOLD and reconcile, never oversell.
const s2 = { ...initialExecutorState(now), shadowUnits: { BTC: 0.5, ETH: 0 } };
assert.equal(planExecution({ previous: s2, postures: P('RISK_OFF', 'RISK_OFF'), postureAt: at, balances: bal(10000, 0.1, 2), quotes: q(60000, 1600), now }).report.why, 'shadow_units_exceed_balance_reconcile');

// Fail closed: stale postures, missing balances, bad spread.
assert.equal(planExecution({ postures: P('RISK_ON', 'RISK_ON'), postureAt: '2026-12-01T06:00:00Z', balances: bal(), quotes: q(60000, 1600), now }).report.why, 'stale_or_missing_postures');
assert.equal(planExecution({ postures: P('RISK_ON', 'RISK_ON'), postureAt: at, balances: null, quotes: q(60000, 1600), now }).report.why, 'balances_unavailable');
assert.equal(planExecution({ postures: P('RISK_ON', 'RISK_ON'), postureAt: at, balances: bal(), quotes: { BTC: { bid: 100, ask: 110 }, ETH: { bid: 1, ask: 1 } }, now }).report.why, 'invalid_quote');

// ABSTAIN keeps Shadow's position (no forced sale on bad data).
const held = { ...initialExecutorState(now), shadowUnits: { BTC: 0.05, ETH: 0 }, shadowCashUsd: 5000, sleevePeakUsd: 8000 };
const ab = planExecution({ previous: held, postures: P('ABSTAIN', 'RISK_OFF'), postureAt: at, balances: bal(10000, 0.15, 2), quotes: q(60000, 1600), now }).report;
assert.equal(ab.orders.filter(o => o.asset === 'BTC').length, 0);

// Account stop: sleeve -20% from peak -> sell all and latch, even if RISK_ON.
const peak = { ...initialExecutorState(now), shadowUnits: { BTC: 0.1, ETH: 0 }, shadowCashUsd: 4000, sleevePeakUsd: 10000 };
let st = planExecution({ previous: peak, postures: P('RISK_ON', 'RISK_ON'), postureAt: at, balances: bal(10000, 0.2, 2), quotes: q(40000, 1600), now });
assert.equal(st.state.stopped, true);
assert.ok(st.report.orders.some(o => o.asset === 'BTC' && o.side === 'sell'));
assert.ok(!st.report.orders.some(o => o.side === 'buy'));
st = planExecution({ previous: st.state, postures: P('RISK_ON', 'RISK_ON'), postureAt: at, balances: bal(10000, 0.1, 2), quotes: q(70000, 1600), now: new Date(+now + 3600e3) });
assert.equal(st.state.stopped, true, 'stop latches until the owner resets');
assert.ok(!st.report.orders.some(o => o.side === 'buy'));

// Owner withdrawing USD does not fake a drawdown (Shadow has its own cash).
const own = planExecution({ postures: P('RISK_OFF', 'RISK_OFF'), postureAt: at, balances: bal(), otherAssetsUsd: 1000, quotes: q(60000, 1600), now }).state;
const afterWithdraw = planExecution({ previous: own, postures: P('RISK_OFF', 'RISK_OFF'), postureAt: at, balances: bal(2000), otherAssetsUsd: 1000, quotes: q(60000, 1600), now: new Date(+now + 3600e3) });
assert.equal(afterWithdraw.state.stopped, false);
assert.equal(afterWithdraw.report.cashShortfall, true);

// Buying both assets never overspends Shadow's cash (fees reserved).
const both = planExecution({ postures: P('RISK_ON', 'RISK_ON'), postureAt: at, balances: bal(4000, 0, 0), quotes: q(60000, 1600), now });
const spentAll = both.report.orders.reduce((t, o) => t + o.notionalUsd * 1.0036, 0);
assert.ok(spentAll <= both.report.sleeve.valueUsd + 0.05, 'fees reserved inside the sleeve cash');

// Daily order cap.
let cap = { ...initialExecutorState(now), day: '2026-12-01', ordersToday: 4 };
assert.equal(planExecution({ previous: cap, postures: P('RISK_ON', 'RISK_ON'), postureAt: at, balances: bal(), quotes: q(60000, 1600), now }).report.orders.length, 0);

// Tamper guard.
assert.throws(() => planExecution({ previous: { ...initialExecutorState(now), realOrdersSent: 1 }, postures: [], postureAt: at, balances: bal(), quotes: q(1, 1), now }), /dry_run_state_has_real_orders/);

// Read-only client: Bitso doc signature format; only allowlisted GET paths; no order code exists.
const sig = signBitso({ key: 'k', secret: 's', nonce: 1, method: 'GET', path: '/api/v3/balance/' });
assert.match(sig, /^Bitso k:1:[a-f0-9]{64}$/);
let seen = null;
const client = makeBitsoReadOnlyClient({ key: 'k', secret: 's', fetchImpl: async (url, opt) => { seen = { url, opt }; return { ok: true, json: async () => ({ success: true, payload: { balances: [{ currency: 'usd', available: '5', locked: '0', total: '5' }] } }) }; } });
const b = await client.balances();
assert.equal(b.usd.total, 5);
assert.equal(seen.opt.method, 'GET');
const src = fs.readFileSync(new URL('../src/learning/bitso-readonly-client.mjs', import.meta.url), 'utf8') + fs.readFileSync(new URL('../src/learning/executor-v07.mjs', import.meta.url), 'utf8');
assert.ok(!/['"]POST['"]|['"]DELETE['"]|\/api\/v3\/orders/.test(src), 'no order-sending code in dry-run build');

console.log('SHADOW_EXECUTOR_V07_SELFTEST=' + JSON.stringify({ ok: true, version: EXECUTOR_VERSION, neverFullPortfolio: true, ownSleeveOnly: true, accountStopLatches: true, failClosed: true, idempotentIds: true, readOnlyClient: true, realOrdersSent: 0 }));
