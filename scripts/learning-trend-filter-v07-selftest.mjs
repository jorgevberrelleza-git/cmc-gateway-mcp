import assert from 'node:assert/strict';
import { trendPosture, paperTargetWeights, normaliseDailyCloses, TREND_FILTER_VERSION } from '../src/learning/trend-filter-v07.mjs';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 0, 1);
const series = (n, f) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * DAY, close: f(i) }));
const closedThrough = n => new Date(t0 + n * DAY); // exactly when day n-1 closes

const up = series(220, i => 100 + i);
const down = series(220, i => 400 - i);
assert.equal(trendPosture({ asset: 'BTC', candles: up, now: closedThrough(220) }).posture, 'RISK_ON');
assert.equal(trendPosture({ asset: 'ETH', candles: down, now: closedThrough(220) }).posture, 'RISK_OFF');

// No lookahead, exact boundary: 1 ms before the close the last day is excluded; at the close it is included.
const spike = [...series(219, () => 100), { t: t0 + 219 * DAY, close: 1000 }];
const justBefore = trendPosture({ asset: 'BTC', candles: spike, now: new Date(+closedThrough(220) - 1) });
const atClose = trendPosture({ asset: 'BTC', candles: spike, now: closedThrough(220) });
assert.equal(justBefore.posture, 'RISK_OFF', 'flat == SMA is not RISK_ON; open candle ignored');
assert.equal(atClose.posture, 'RISK_ON');

// Fail closed WITHOUT throwing: gaps, duplicates, bad prices, short/stale history, outside universe.
const gap = [...series(210, () => 1), { t: t0 + 212 * DAY, close: 1 }];
assert.equal(trendPosture({ asset: 'BTC', candles: gap, now: closedThrough(213) }).reason, 'gap_in_daily_history');
assert.equal(trendPosture({ asset: 'BTC', candles: [...up, { t: t0, close: 1 }], now: closedThrough(220) }).reason, 'duplicate_day');
assert.equal(trendPosture({ asset: 'BTC', candles: [{ t: t0, close: 0 }], now: closedThrough(1) }).reason, 'invalid_candle');
assert.equal(trendPosture({ asset: 'BTC', candles: series(150, () => 1), now: closedThrough(150) }).posture, 'ABSTAIN');
assert.equal(trendPosture({ asset: 'BTC', candles: up, now: closedThrough(222) }).reason, 'stale_history');
assert.equal(trendPosture({ asset: 'XRP', candles: up, now: closedThrough(220) }).reason, 'asset_outside_universe');
assert.throws(() => normaliseDailyCloses([{ t: t0 + 5, close: 1 }]), /candle_not_utc_day_aligned/);

const p = trendPosture({ asset: 'BTC', candles: up, now: closedThrough(220) });
assert.equal(p.tradeable, false);
assert.equal(p.realOrdersAllowed, false);

// Sizing fits the v0.6 limits; ABSTAIN keeps the previous weight (no forced liquidation).
const w = paperTargetWeights([{ asset: 'BTC', posture: 'RISK_ON' }, { asset: 'ETH', posture: 'RISK_ON' }, { asset: 'ADA', posture: 'RISK_ON' }]);
assert.equal(w.weights.BTC, 0.075);
assert.equal(w.weights.ETH, 0.075);
assert.equal(w.weights.ADA, 0, 'outside universe is never sized');
assert.equal(w.cash, 0.85);
const kept = paperTargetWeights([{ asset: 'BTC', posture: 'ABSTAIN' }, { asset: 'ETH', posture: 'RISK_OFF' }], { BTC: 0.075, ETH: 0.075 });
assert.equal(kept.weights.BTC, 0.075, 'data outage keeps position');
assert.equal(kept.weights.ETH, 0);
const fresh = paperTargetWeights([{ asset: 'BTC', posture: 'ABSTAIN' }]);
assert.equal(fresh.weights.BTC, 0, 'ABSTAIN never opens a position');
assert.throws(() => paperTargetWeights([{ asset: 'BTC', posture: 'RISK_ON' }, { asset: 'BTC', posture: 'RISK_ON' }]), /duplicate_asset/);
assert.throws(() => paperTargetWeights([], {}, { maxExposure: 0.9, maxAssetWeight: 0.5 }), /unsafe_sizing/);

console.log('SHADOW_TREND_FILTER_V07_SELFTEST=' + JSON.stringify({ ok: true, version: TREND_FILTER_VERSION,
  noLookaheadAtBoundary: true, failClosedNoThrow: true, abstainKeepsPosition: true, sizingWithinV06Limits: true, realOrders: 0 }));
