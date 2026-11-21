import assert from 'node:assert/strict';
import { trendPosture, paperTargetWeights, normaliseDailyCloses, TREND_FILTER_VERSION } from '../src/learning/trend-filter-v07.mjs';

const DAY = 86_400_000;
const t0 = Date.UTC(2026, 0, 1);
const series = (n, f) => Array.from({ length: n }, (_, i) => ({ t: t0 + i * DAY, close: f(i) }));
const afterDay = n => new Date(t0 + n * DAY + 3_600_000); // 1h after day n-1 closed

// Rising market -> RISK_ON; falling -> RISK_OFF.
const up = series(220, i => 100 + i);
const down = series(220, i => 400 - i);
assert.equal(trendPosture({ asset: 'BTC', candles: up, now: afterDay(220) }).posture, 'RISK_ON');
assert.equal(trendPosture({ asset: 'BTC', candles: down, now: afterDay(220) }).posture, 'RISK_OFF');

// No lookahead: a candle whose day has not closed is ignored.
const spike = [...series(219, () => 100), { t: t0 + 219 * DAY, close: 1000 }];
const beforeClose = trendPosture({ asset: 'BTC', candles: spike, now: new Date(t0 + 219 * DAY + 3_600_000) });
assert.equal(beforeClose.lastCloseDay, new Date(t0 + 218 * DAY).toISOString().slice(0, 10));
assert.equal(beforeClose.posture, 'RISK_OFF', 'flat == SMA is not RISK_ON');

// Fail closed: insufficient, stale, gaps, duplicates, bad prices.
assert.equal(trendPosture({ asset: 'ADA', candles: series(150, () => 1), now: afterDay(150) }).posture, 'ABSTAIN');
assert.equal(trendPosture({ asset: 'ADA', candles: up, now: afterDay(225) }).reason, 'stale_history');
assert.throws(() => normaliseDailyCloses([...series(5, () => 1), { t: t0 + 7 * DAY, close: 1 }]), /gap_in_daily_history/);
assert.throws(() => normaliseDailyCloses([...series(5, () => 1), { t: t0, close: 1 }]), /duplicate_day/);
assert.throws(() => normaliseDailyCloses([{ t: t0, close: 0 }]), /invalid_candle/);
assert.throws(() => normaliseDailyCloses([{ t: t0 + 5, close: 1 }]), /candle_not_utc_day_aligned/);

// Never tradeable.
const p = trendPosture({ asset: 'BTC', candles: up, now: afterDay(220) });
assert.equal(p.tradeable, false);
assert.equal(p.realOrdersAllowed, false);

// Weights respect the v0.6 paper-broker caps (<=20% per asset, <=60% total).
const w = paperTargetWeights([{ asset: 'BTC', posture: 'RISK_ON' }, { asset: 'ADA', posture: 'RISK_OFF' }, { asset: 'ETH', posture: 'RISK_ON' }]);
assert.equal(w.weights.BTC, 0.2);
assert.equal(w.weights.ADA, 0);
assert.ok(w.cash >= 0.4);
const none = paperTargetWeights([{ asset: 'BTC', posture: 'ABSTAIN' }]);
assert.equal(none.cash, 1);

console.log('SHADOW_TREND_FILTER_V07_SELFTEST=' + JSON.stringify({ ok: true, version: TREND_FILTER_VERSION,
  noLookahead: true, failClosed: true, capsRespected: true, realOrders: 0 }));
