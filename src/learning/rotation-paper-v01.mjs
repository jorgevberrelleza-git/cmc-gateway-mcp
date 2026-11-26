// Shadow paper competition (pure, no I/O, no orders). Two candidate rules run on
// paper in real time, starting with the same money as the owner's HOLD mandate:
//   ROTATE_TOP1 - every Monday close: hold the ONE asset with the best 90-day return
//                 among those above their SMA200 (and with positive momentum); else cash.
//   BTC_TREND   - every daily close: hold BTC if above its SMA200, else cash.
// Both chosen by the 2026-11-24 walk-forward backtest (PR #42). Fills at the
// reference last price with 0.42% per side (Bitso taker + half spread), as in the backtest.
// Success metric: equity minus the HOLD mandate (0.01249 BTC + 12,000 ADA) scaled to the same start.
import { trendPosture } from './trend-filter-v07.mjs';

export const ROTATION_VERSION = 'shadow_rotation_paper_v0.1';
export const ROTATION_UNIVERSE = Object.freeze(['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'AAVE']);
export const ROTATION_POLICIES = Object.freeze(['ROTATE_TOP1', 'BTC_TREND']);
export const ROTATION_PARAMS = Object.freeze({ costPerSide: 0.0042, momentumDays: 90, maxCloseAgeHours: 50 });
const DAY = 86_400_000;
const r2 = x => Math.round(x * 100) / 100;

/** Per-asset signal from Kraken daily candles (closed days only). */
export function assetSignal({ asset, candles, now }) {
  const p = trendPosture({ asset, candles, now, universe: [asset] });
  const closed = (candles || []).filter(c => Number.isFinite(+c.t) && +c.close > 0 && +c.t + DAY <= +now).sort((a, b) => a.t - b.t);
  const n = ROTATION_PARAMS.momentumDays;
  const mom = closed.length > n ? closed[closed.length - 1].close / closed[closed.length - 1 - n].close - 1 : null;
  return { asset, posture: p.posture, reason: p.reason, distancePct: p.distancePct ?? null, lastCloseDay: p.lastCloseDay ?? null,
    mom90Pct: mom == null ? null : r2(100 * mom) };
}

function pickTop1(signals) {
  const ok = signals.filter(s => s.posture === 'RISK_ON' && s.mom90Pct != null && s.mom90Pct > 0).sort((a, b) => b.mom90Pct - a.mom90Pct);
  return ok[0]?.asset || null;
}
export const GRADE_DAYS = 30;
export function scoreDecisions(list = []) {
  const graded = list.filter(d => d.result);
  const hits = graded.filter(d => d.result.hit).length;
  return { total: list.length, graded: graded.length, hits, hitPct: graded.length ? r2(100 * hits / graded.length) : null,
    avgEdgePct: graded.length ? r2(graded.reduce((x, d) => x + d.result.edgePct, 0) / graded.length) : null };
}
const isMonday = day => new Date(day + 'T00:00:00Z').getUTCDay() === 1;

export function stepRotationPaper({ previous, signals, lastPx, holdMandate = { BTC: 0.01249, ADA: 12000 }, now = new Date() }) {
  const cost = ROTATION_PARAMS.costPerSide, errors = [];
  const sig = Object.fromEntries(signals.map(s => [s.asset, s]));
  const holdValue = () => { let v = 0; for (const [a, u] of Object.entries(holdMandate)) { if (!(lastPx[a] > 0)) return null; v += u * lastPx[a]; } return v; };
  let s = previous ? structuredClone(previous) : null;
  if (!s) {
    const hv = holdValue();
    if (!(hv > 0)) return { state: null, report: { version: ROTATION_VERSION, at: now.toISOString(), action: 'WAIT', why: 'no_prices_to_start', realOrders: 0 } };
    s = { version: ROTATION_VERSION, startedAt: now.toISOString(), startUsd: r2(hv), holdStartUsd: hv,
      accounts: Object.fromEntries(ROTATION_POLICIES.map(p => [p, { cashUsd: r2(hv), asset: null, units: 0, lastDecisionDay: null, peakUsd: r2(hv), trades: [] }])) };
  }
  // Freshness: every decision uses the same closed day; abstain if candles are stale.
  const lastDay = signals.map(x => x.lastCloseDay).filter(Boolean).sort().pop() || null;
  const fresh = lastDay && (+now - (Date.parse(lastDay) + DAY)) / 3_600_000 <= ROTATION_PARAMS.maxCloseAgeHours;
  const actions = {};
  for (const p of ROTATION_POLICIES) {
    const acc = s.accounts[p]; let action = 'NO_CHANGE', why = null;
    const due = fresh && acc.lastDecisionDay !== lastDay && (p === 'BTC_TREND' || acc.lastDecisionDay == null || isMonday(lastDay));
    if (!fresh) { action = 'HOLD'; why = 'stale_or_missing_candles'; }
    else if (due) {
      const target = p === 'ROTATE_TOP1' ? pickTop1(signals) : (sig.BTC?.posture === 'RISK_ON' ? 'BTC' : null);
      // Fail closed: rotation needs the WHOLE universe (a missing leader must not cause a wrong switch).
      const abstain = p === 'BTC_TREND' ? sig.BTC?.posture === 'ABSTAIN' : (signals.length < ROTATION_UNIVERSE.length || signals.some(x => x.posture === 'ABSTAIN'));
      if (abstain) { action = 'HOLD'; why = 'abstain_signal'; }
      else if (target !== acc.asset) {
        const sellPx = acc.asset ? lastPx[acc.asset] : null, buyPx = target ? lastPx[target] : null;
        if ((acc.asset && !(sellPx > 0)) || (target && !(buyPx > 0))) { action = 'HOLD'; why = 'missing_price'; errors.push(`${p}:missing_price`); }
        else {
          // C5: log the decision so it can be graded 30 days later against "not acting".
          (acc.decisions ||= []).push({ day: lastDay, at: now.toISOString(), from: acc.asset, to: target,
            pxFrom: acc.asset ? sellPx : null, pxTo: target ? buyPx : null, result: null });
          acc.decisions = acc.decisions.slice(-50);
          if (acc.asset) { acc.cashUsd += acc.units * sellPx * (1 - cost); acc.trades.push({ day: lastDay, side: 'sell', asset: acc.asset, px: sellPx }); }
          if (target) { acc.units = acc.cashUsd / (buyPx * (1 + cost)); acc.cashUsd = 0; acc.trades.push({ day: lastDay, side: 'buy', asset: target, px: buyPx }); }
          else acc.units = 0;
          why = `${acc.asset || 'CASH'}->${target || 'CASH'}`; acc.asset = target; action = 'SWITCH';
          acc.trades = acc.trades.slice(-20);
        }
      }
      if (action !== 'HOLD') acc.lastDecisionDay = lastDay;
    }
    actions[p] = { action, why };
  }
  // Grade decisions that are at least 30 days old: hit = the switch beat staying put, after costs.
  for (const p of ROTATION_POLICIES) {
    for (const d of s.accounts[p].decisions || []) {
      if (d.result || +now - Date.parse(d.at) < GRADE_DAYS * DAY) continue;
      const rTo = d.to ? (lastPx[d.to] > 0 ? lastPx[d.to] / d.pxTo - 1 : null) : 0;
      const rFrom = d.from ? (lastPx[d.from] > 0 ? lastPx[d.from] / d.pxFrom - 1 : null) : 0;
      if (rTo == null || rFrom == null) continue;
      const edge = rTo - rFrom - 2 * cost;
      d.result = { gradedAt: now.toISOString(), edgePct: r2(100 * edge), hit: edge > 0 };
    }
  }
  const hv = holdValue();
  const holdEq = hv > 0 ? s.startUsd * hv / s.holdStartUsd : null;
  const accounts = {};
  for (const p of ROTATION_POLICIES) {
    const acc = s.accounts[p];
    const px = acc.asset ? lastPx[acc.asset] : 1;
    const eq = acc.asset ? (px > 0 ? acc.units * px : null) : acc.cashUsd;
    if (eq != null) acc.peakUsd = Math.max(acc.peakUsd, eq);
    accounts[p] = { holding: acc.asset || 'CASH', equityUsd: eq == null ? null : r2(eq), retPct: eq == null ? null : r2(100 * (eq / s.startUsd - 1)),
      ddPct: eq == null ? null : r2(100 * (1 - eq / acc.peakUsd)), extraVsHoldUsd: eq != null && holdEq ? r2(eq - holdEq) : null,
      extraVsHoldPct: eq != null && holdEq ? r2(100 * (eq / holdEq - 1)) : null, trades: acc.trades.length,
      decisions: scoreDecisions(acc.decisions), ...actions[p] };
  }
  return { state: s, report: { version: ROTATION_VERSION, at: now.toISOString(), startedAt: s.startedAt, startUsd: s.startUsd, lastCloseDay: lastDay,
    holdMandateUsd: holdEq == null ? null : r2(holdEq), accounts,
    signals: signals.map(x => ({ asset: x.asset, posture: x.posture, distancePct: x.distancePct, mom90Pct: x.mom90Pct })),
    nextRotationCheck: 'first run after a Monday daily close (UTC)', dataErrors: errors, realOrders: 0 } };
}
