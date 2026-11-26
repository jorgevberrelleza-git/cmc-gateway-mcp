import assert from 'node:assert/strict';
import { initialLedger, stepTrendLedger, TREND_LEDGER_VERSION } from '../src/learning/trend-ledger-v07.mjs';

const t = d => new Date(Date.UTC(2026, 10, d, 12));
const q = (btc, eth) => ({ BTC: { bid: btc * 0.9998, ask: btc * 1.0002 }, ETH: { bid: eth * 0.9995, ask: eth * 1.0005 } });
const P = (btc, eth) => [{ asset: 'BTC', posture: btc }, { asset: 'ETH', posture: eth }];

// Start flat; RISK_OFF keeps cash.
let { state, report } = stepTrendLedger({ previous: null, postures: P('RISK_OFF', 'RISK_OFF'), quotes: q(60000, 1600), now: t(21) });
assert.equal(report.action, 'NO_CHANGE');
assert.equal(report.marks.exposurePct, 0);

// RISK_ON BTC -> buys ~7.5% at the ask with fee; ETH stays 0.
({ state, report } = stepTrendLedger({ previous: state, postures: P('RISK_ON', 'RISK_OFF'), quotes: q(60000, 1600), now: t(22) }));
assert.equal(report.action, 'REBALANCED_PAPER');
assert.equal(report.fills.length, 1);
assert.equal(report.fills[0].side, 'BUY_PAPER');
assert.ok(report.fills[0].price > 60000, 'buys at ask');
assert.ok(Math.abs(report.marks.exposurePct - 7.5) < 0.1);
assert.ok(report.feesUsd > 0);
assert.equal(report.realOrders, 0);

// Same posture next hour -> no churn.
({ state, report } = stepTrendLedger({ previous: state, postures: P('RISK_ON', 'RISK_OFF'), quotes: q(61000, 1600), now: new Date(+t(22) + 3600e3) }));
assert.equal(report.action, 'NO_CHANGE');
assert.equal(report.fills.length, 0);

// Invalid quote while target changes -> HOLD, no fill, target NOT updated (retries next hour).
const bad = { ...q(60000, 1600), ETH: { bid: 0, ask: 0 } };
({ state, report } = stepTrendLedger({ previous: state, postures: P('RISK_OFF', 'RISK_OFF'), quotes: bad, now: t(23) }));
assert.equal(report.action, 'HOLD_NO_VALID_QUOTE');
assert.equal(report.fills.length, 0);
assert.ok(state.units.BTC > 0);
// Quote back -> sells at the bid.
({ state, report } = stepTrendLedger({ previous: state, postures: P('RISK_OFF', 'RISK_OFF'), quotes: q(60000, 1600), now: new Date(+t(23) + 3600e3) }));
assert.equal(report.fills[0].side, 'SELL_PAPER');
assert.ok(report.fills[0].price < 60000, 'sells at bid');
assert.ok(state.units.BTC < 1e-12);
assert.ok(report.marks.equityUsd < 10000, 'round trip costs money');

// ABSTAIN keeps position up to the TTL, then exits.
({ state } = stepTrendLedger({ previous: initialLedger(t(1)), postures: P('RISK_ON', 'RISK_OFF'), quotes: q(60000, 1600), now: t(1) }));
for (const d of [2, 3]) ({ state, report } = stepTrendLedger({ previous: state, postures: P('ABSTAIN', 'RISK_OFF'), quotes: q(60000, 1600), now: t(d) }));
assert.ok(state.units.BTC > 0, 'kept during 2 abstain days');
({ state, report } = stepTrendLedger({ previous: state, postures: P('ABSTAIN', 'RISK_OFF'), quotes: q(60000, 1600), now: t(4) }));
assert.ok(state.units.BTC < 1e-12, 'exits on 3rd consecutive abstain day');

// Limits are measured, not enforced: a crash counts a would-halt but the ledger keeps running.
({ state } = stepTrendLedger({ previous: initialLedger(t(5)), postures: P('RISK_ON', 'RISK_ON'), quotes: q(60000, 1600), now: t(5) }));
({ state, report } = stepTrendLedger({ previous: state, postures: P('RISK_ON', 'RISK_ON'), quotes: q(20000, 500), now: new Date(+t(5) + 3600e3) }));
assert.ok(report.wouldHalt.dayLoss >= 1);
assert.equal(report.action, 'NO_CHANGE');

// Tamper guards.
assert.throws(() => stepTrendLedger({ previous: { ...initialLedger(), realOrders: 1 }, postures: [], quotes: q(1, 1) }), /real_orders_must_be_zero/);
assert.throws(() => stepTrendLedger({ previous: { ...initialLedger(), version: 'x' }, postures: [], quotes: q(1, 1) }), /version_mismatch/);

console.log('SHADOW_TREND_LEDGER_V07_SELFTEST=' + JSON.stringify({ ok: true, version: TREND_LEDGER_VERSION, fillsAtBidAsk: true, noChurn: true, holdOnBadQuote: true, abstainTtl: true, limitsMeasuredNotEnforced: true, realOrders: 0 }));
