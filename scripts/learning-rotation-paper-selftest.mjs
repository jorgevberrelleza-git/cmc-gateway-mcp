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

// Euphoria brake (BTC_TREND_GUARD): Fear & Greed >= 75 -> cash; re-enter only below 70; missing -> hold.
{
  const fgAt = (v, days) => ({ fearGreed: v, day: new Date(start + (days - 1) * DAY).toISOString().slice(0, 10) });
  let g = stepRotationPaper({ previous: null, signals: signalsAt(306, M), lastPx: px(306, M), sentiment: fgAt(50, 306), now: at(306) });
  assert.equal(g.state.accounts.BTC_TREND_GUARD.asset, 'BTC', 'calm market -> same as BTC_TREND');
  g = stepRotationPaper({ previous: g.state, signals: signalsAt(307, M), lastPx: px(307, M), sentiment: fgAt(80, 307), now: at(307) });
  assert.equal(g.state.accounts.BTC_TREND_GUARD.asset, null); assert.equal(g.report.accounts.BTC_TREND_GUARD.euphoric, true);
  assert.equal(g.state.accounts.BTC_TREND.asset, 'BTC', 'unguarded account unaffected');
  g = stepRotationPaper({ previous: g.state, signals: signalsAt(308, M), lastPx: px(308, M), sentiment: fgAt(72, 308), now: at(308) });
  assert.equal(g.state.accounts.BTC_TREND_GUARD.asset, null, 'hysteresis: 72 is not low enough to re-enter');
  g = stepRotationPaper({ previous: g.state, signals: signalsAt(309, M), lastPx: px(309, M), sentiment: fgAt(65, 309), now: at(309) });
  assert.equal(g.state.accounts.BTC_TREND_GUARD.asset, 'BTC', 're-enters below 70');
  const miss = stepRotationPaper({ previous: g.state, signals: signalsAt(310, M), lastPx: px(310, M), sentiment: null, now: at(310) });
  assert.equal(miss.report.accounts.BTC_TREND_GUARD.why, 'sentiment_unavailable'); assert.equal(miss.state.accounts.BTC_TREND_GUARD.asset, 'BTC');
  // Late joiner: a live state without the account gets it with extra vs HOLD = 0 at join.
  const old = structuredClone(g.state); delete old.accounts.BTC_TREND_GUARD;
  const j = stepRotationPaper({ previous: old, signals: signalsAt(311, M), lastPx: px(311, M), sentiment: fgAt(80, 311), now: at(311) });
  assert.equal(j.report.accounts.BTC_TREND_GUARD.extraVsHoldUsd, 0); assert.ok(j.report.accounts.BTC_TREND_GUARD.joinedAt);
  assert.equal(j.state.accounts.BTC_TREND_GUARD.asset, null, 'joins in euphoria -> stays in cash');
}

// Risk variants (PR #48): FAST_EXIT needs SMA200 AND SMA50; HALF invests 50% and keeps 50% cash.
{
  const fg = { fearGreed: 40, day: new Date(start + 305 * DAY).toISOString().slice(0, 10) };
  let r = stepRotationPaper({ previous: null, signals: signalsAt(306, M), lastPx: px(306, M), sentiment: fg, now: at(306) });
  assert.equal(r.state.accounts.BTC_FAST_EXIT.asset, 'BTC'); assert.equal(r.state.accounts.BTC_TREND_HALF.asset, 'BTC');
  const half = r.state.accounts.BTC_TREND_HALF;
  assert.ok(Math.abs(half.cashUsd - r.report.startUsd / 2) < 0.01, 'half stays in cash');
  assert.ok(Math.abs(r.report.accounts.BTC_TREND_HALF.equityUsd - r.report.startUsd * (1 - 0.5 * 0.0042 / 1.0042)) < 0.05, 'cost only on the invested half');
  // BTC dips ~5% over 3 weeks: below SMA50 but still above SMA200 -> FAST_EXIT exits, BTC_TREND stays.
  const Md = { ...M, BTC: i => i < 300 ? M.BTC(i) : M.BTC(299) * (1 - 0.0025 * (i - 299)) };
  const sAt = signalsAt(321, Md); assert.equal(sAt[0].posture, 'RISK_ON'); assert.equal(sAt[0].above50, false);
  r = stepRotationPaper({ previous: r.state, signals: sAt, lastPx: px(321, Md), sentiment: { ...fg, day: new Date(start + 320 * DAY).toISOString().slice(0, 10) }, now: at(321) });
  assert.equal(r.state.accounts.BTC_FAST_EXIT.asset, null, 'fast exit leaves below SMA50');
  assert.equal(r.state.accounts.BTC_TREND.asset, 'BTC', 'plain trend still holds');
  assert.equal(r.state.accounts.BTC_TREND_HALF.asset, 'BTC');
  // Selling HALF returns everything to cash and equity = cash.
  const Mx = { ...Md, BTC: i => i < 300 ? M.BTC(i) : M.BTC(299) * 0.6 };
  r = stepRotationPaper({ previous: r.state, signals: signalsAt(322, Mx), lastPx: px(322, Mx), sentiment: { ...fg, day: new Date(start + 321 * DAY).toISOString().slice(0, 10) }, now: at(322) });
  assert.equal(r.state.accounts.BTC_TREND_HALF.asset, null); assert.equal(r.report.accounts.BTC_TREND_HALF.equityUsd, Math.round(r.state.accounts.BTC_TREND_HALF.cashUsd * 100) / 100);
}
// Paper only: no order code, no keys.
const src = ['../src/learning/rotation-paper-v01.mjs', './learning-rotation-paper.mjs'].map(p => fs.readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
assert.ok(!/api\/v3\/orders|BITSO_.*SECRET|['"]POST['"]|['"]DELETE['"]/.test(src));
console.log('SHADOW_ROTATION_SELFTEST=' + JSON.stringify({ ok: true, picksLeader: true, mondayOnly: true, btcTrendDaily: true, failClosed: true, idempotentPerDay: true, decisionsGraded30d: true, euphoriaBrake: true, lateJoin: true, fastExitSma50: true, halfSizing: true, realOrders: 0 }));
