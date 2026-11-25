import assert from 'node:assert/strict';
import { buildPanel, simulate, POLICIES } from './learning-rotation-backtest.mjs';
// Synthetic: A trends up then crashes; B trends up later; C is flat. 2021-01-01 .. 2026-06-30.
const start = Date.UTC(2021, 0, 1), n = 2007, series = { BTC: new Map(), A: new Map(), B: new Map(), ADA: new Map() };
for (let i = 0; i < n; i++) {
  const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
  series.BTC.set(d, 100 * (1 + 0.0004 * i));
  series.A.set(d, i < 1000 ? 100 * 1.002 ** i : 100 * 1.002 ** 1000 * 0.997 ** (i - 1000));
  series.B.set(d, i < 1200 ? 100 : 100 * 1.0025 ** (i - 1200));
  series.ADA.set(d, 100);
}
const panel = buildPanel(series);
const hold = simulate(panel, 'HOLD_EQUAL', '2021-07-01', '2026-06-30');
const rot = simulate(panel, 'ROTATE_TOP1', '2021-07-01', '2026-06-30');
const trend = simulate(panel, 'TREND_EQUAL', '2021-07-01', '2026-06-30');
assert.ok(rot.maxDdPct < hold.maxDdPct, 'rotation avoids the crash of A');
assert.ok(rot.returnPct > hold.returnPct, 'rotation catches B');
assert.ok(trend.maxDdPct <= hold.maxDdPct);
// No lookahead: decisions at close t only earn from t+1 -> a one-day spike is not captured.
const spike = { BTC: new Map(), ADA: new Map() };
for (let i = 0; i < 400; i++) { const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10); spike.BTC.set(d, i === 350 ? 200 : 100 + i * 0.01); spike.ADA.set(d, 100); }
const sp = simulate(buildPanel(spike), 'TREND_EQUAL', '2021-12-01', '2022-02-04');
assert.ok(sp.returnPct < 60, 'no same-day capture of a spike');
for (const p of Object.keys(POLICIES)) simulate(panel, p, '2021-07-01', '2026-06-30');
console.log('SHADOW_ROTATION_BACKTEST_SELFTEST=' + JSON.stringify({ ok: true, policies: Object.keys(POLICIES).length, noLookahead: true, realOrders: 0 }));
