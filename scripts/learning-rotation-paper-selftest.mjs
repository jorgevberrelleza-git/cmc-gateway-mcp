import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assetSignal, stepRotationPaper, ROTATION_UNIVERSE } from '../src/learning/rotation-paper-v01.mjs';

const DAY = 86_400_000, start = Date.UTC(2026, 0, 1);
// Candles through day k (closed); `f(i)` gives the close of day i.
const candles = (f, days) => Array.from({ length: days }, (_, i) => ({ t: start + i * DAY, close: f(i) }));
const at = days => new Date(start + days * DAY + 3_600_000); // 1h after the close of day (days-1)
const up = (b, g) => i => b * (1 + g) ** i, down = (b, g) => i => b * (1 - g) ** i, flat = b => () => b;
function signalsAt(days, fs_) { return ROTATION_UNIVERSE.map(a => assetSignal({ asset: a, candles: candles(fs_[a], days), now: at(days) })); }
const px = (days, fs_) => Object.fromEntries(ROTATION_UNIVERSE.map(a => [a, fs_[a](days - 1)]));

// Market: SOL strongest uptrend, BTC mild uptrend, others down/flat.
const M = { BTC: up(60000, 0.001), ETH: down(2000, 0.001), SOL: up(100, 0.004), XRP: flat(1), ADA: down(0.5, 0.002), AAVE: down(150, 0.001) };
// Day count chosen so that the last closed day is a Monday (2026-01-01 is Thursday; day index 305 -> 2026-11-02, a Monday).
let d = 306;
assert.equal(new Date(start + (d - 1) * DAY).getUTCDay(), 1);
let o = stepRotationPaper({ previous: null, signals: signalsAt(d, M), lastPx: px(d, M), now: at(d) });
assert.equal(o.state.accounts.ROTATE_TOP1.asset, 'SOL', 'rotation picks the strongest trend');
assert.equal(o.state.accounts.BTC_TREND.asset, 'BTC');
assert.ok(Math.abs(o.report.startUsd - (0.01249 * M.BTC(d - 1) + 12000 * M.ADA(d - 1))) < 0.01, 'starts with the HOLD mandate value');
assert.ok(o.report.accounts.ROTATE_TOP1.equityUsd < o.report.startUsd, 'entry cost is charged');
assert.equal(o.report.realOrders, 0);

// Same day again: no new decision (idempotent per closed day).
const again = stepRotationPaper({ previous: o.state, signals: signalsAt(d, M), lastPx: px(d, M), now: new Date(+at(d) + 1800_000) });
assert.equal(again.report.accounts.ROTATE_TOP1.action, 'NO_CHANGE'); assert.equal(again.state.accounts.ROTATE_TOP1.trades.length, 1);

// Tuesday: SOL leadership changes but rotation waits for Monday; BTC_TREND re-checks daily.
const M2 = { ...M, SOL: i => i < 306 ? M.SOL(i) : M.SOL(305) * 0.5 };
o = stepRotationPaper({ previous: o.state, signals: signalsAt(d + 1, M2), lastPx: px(d + 1, M2), now: at(d + 1) });
assert.equal(o.state.accounts.ROTATE_TOP1.asset, 'SOL', 'rotation only decides on Mondays');
assert.ok(o.report.accounts.ROTATE_TOP1.equityUsd < o.report.startUsd * 0.6, 'marked to market');

// Next Monday: SOL fell below trend -> rotation moves to the best remaining (BTC).
d = 313; o = stepRotationPaper({ previous: o.state, signals: signalsAt(d, M2), lastPx: px(d, M2), now: at(d) });
assert.equal(o.state.accounts.ROTATE_TOP1.asset, 'BTC'); assert.match(o.report.accounts.ROTATE_TOP1.why, /SOL->BTC/);

// Fail closed: one asset's candles missing -> rotation holds; stale candles -> everything holds.
const sigs = signalsAt(d + 7, M2); sigs[2] = { asset: 'SOL', posture: 'ABSTAIN', reason: 'candles_unavailable' };
const held = stepRotationPaper({ previous: o.state, signals: sigs, lastPx: px(d + 7, M2), now: at(d + 7) });
assert.equal(held.report.accounts.ROTATE_TOP1.action, 'HOLD');
const stale = stepRotationPaper({ previous: o.state, signals: signalsAt(d, M2), lastPx: px(d, M2), now: new Date(+at(d) + 4 * DAY) });
assert.equal(stale.report.accounts.BTC_TREND.why, 'stale_or_missing_candles');

// BTC loses its trend -> BTC_TREND goes to cash on the next daily close.
const M3 = { ...M2, BTC: i => i < 313 ? M.BTC(i) : M.BTC(312) * 0.6 };
const cash = stepRotationPaper({ previous: o.state, signals: signalsAt(d + 1, M3), lastPx: px(d + 1, M3), now: at(d + 1) });
assert.equal(cash.state.accounts.BTC_TREND.asset, null); assert.equal(cash.report.accounts.BTC_TREND.holding, 'CASH');
assert.ok(cash.report.accounts.BTC_TREND.extraVsHoldPct != null);


// C5: each SWITCH is logged and graded 30 days later against "not acting" (after costs).
{
  const { scoreDecisions } = await import('../src/learning/rotation-paper-v01.mjs');
  let st = stepRotationPaper({ previous: null, signals: signalsAt(306, M), lastPx: px(306, M), now: at(306) }).state; // CASH -> SOL, CASH -> BTC
  const acc = st.accounts.ROTATE_TOP1;
  assert.equal(acc.decisions.length, 1); assert.equal(acc.decisions[0].to, 'SOL'); assert.equal(acc.decisions[0].result, null);
  // 10 days later: not graded yet.
  let o2 = stepRotationPaper({ previous: st, signals: signalsAt(316, M), lastPx: px(316, M), now: at(316) });
  assert.equal(o2.report.accounts.ROTATE_TOP1.decisions.graded, 0);
  // 31 days later: SOL kept rising (+0.4%/day) vs staying in cash -> hit.
  const o3 = stepRotationPaper({ previous: o2.state, signals: signalsAt(337, M), lastPx: px(337, M), now: at(337) });
  const d = o3.state.accounts.ROTATE_TOP1.decisions[0];
  assert.equal(d.result.hit, true); assert.ok(d.result.edgePct > 10);
  assert.equal(o3.report.accounts.ROTATE_TOP1.decisions.hitPct, 100);
  // A losing switch is graded as a miss.
  const miss = scoreDecisions([{ result: { hit: false, edgePct: -4 } }, { result: { hit: true, edgePct: 6 } }, { result: null }]);
  assert.deepEqual(miss, { total: 3, graded: 2, hits: 1, hitPct: 50, avgEdgePct: 1 });
}
// Paper only: no order code, no keys.
const src = ['../src/learning/rotation-paper-v01.mjs', './learning-rotation-paper.mjs'].map(p => fs.readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
assert.ok(!/api\/v3\/orders|BITSO_.*SECRET|['"]POST['"]|['"]DELETE['"]/.test(src));
console.log('SHADOW_ROTATION_SELFTEST=' + JSON.stringify({ ok: true, picksLeader: true, mondayOnly: true, btcTrendDaily: true, failClosed: true, idempotentPerDay: true, decisionsGraded30d: true, realOrders: 0 }));
