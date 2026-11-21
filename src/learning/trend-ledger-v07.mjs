// Shadow trend ledger v0.7 — independent PAPER account for the v0.7 trend filter.
// Pure: no network/DB/broker. Runs every hour ("decide at any moment"), but the
// posture only uses CLOSED daily candles, so an hourly run never peeks ahead.
// Fills happen at the CURRENT executable Bitso quote (buy at ask, sell at bid)
// plus taker fee, i.e. strictly after the information used to decide.
// Risk limits are MEASURED ("would have halted") but do not stop the ledger,
// so the experiment keeps collecting experience. Real orders: impossible.
import crypto from 'node:crypto';
import { paperTargetWeights, TREND_FILTER_UNIVERSE, TREND_FILTER_VERSION } from './trend-filter-v07.mjs';

export const TREND_LEDGER_VERSION = 'shadow_trend_ledger_v0.7.1';
export const TREND_LEDGER_POLICY = Object.freeze({
  initialUsd: 10000, takerFee: 0.0036, minTradeUsd: 15,
  measuredMaxDayLossPct: 2, measuredMaxDrawdownPct: 10
});
const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
export const ledgerHash = x => crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const r2 = x => Math.round(x * 100) / 100;
function fail(m) { throw new Error('trend_ledger_v07:' + m); }

export function initialLedger(now = new Date(), policy = TREND_LEDGER_POLICY) {
  return { version: TREND_LEDGER_VERSION, createdAt: new Date(+now).toISOString(), cashUsd: policy.initialUsd,
    units: Object.fromEntries(TREND_FILTER_UNIVERSE.map(a => [a, 0])), targetWeights: {}, abstainDays: {}, lastAbstainDay: {},
    peakEquityUsd: policy.initialUsd, dayUtc: new Date(+now).toISOString().slice(0, 10), dayStartEquityUsd: policy.initialUsd,
    trades: 0, feesUsd: 0, wouldHaltDayLoss: 0, wouldHaltDrawdown: 0, realOrders: 0 };
}

function validQuote(q) { return q && q.bid > 0 && q.ask > 0 && q.ask >= q.bid && (q.ask - q.bid) / q.bid < 0.02; }

/**
 * One hourly step. `postures` from trendPosture(); `quotes` = {BTC:{bid,ask}, ETH:{bid,ask}} from Bitso.
 * Returns {state, report}. Never throws on market-data problems: it holds and records why.
 */
export function stepTrendLedger({ previous, postures, quotes, now = new Date(), policy = TREND_LEDGER_POLICY }) {
  const s = structuredClone(previous || initialLedger(now, policy));
  if (s.version !== TREND_LEDGER_VERSION) fail('version_mismatch');
  if (s.realOrders !== 0) fail('real_orders_must_be_zero');
  const day = new Date(+now).toISOString().slice(0, 10);
  const quotesOk = TREND_FILTER_UNIVERSE.every(a => validQuote(quotes?.[a]));
  const mid = a => (quotes[a].bid + quotes[a].ask) / 2;
  const equity = () => s.cashUsd + (quotesOk ? TREND_FILTER_UNIVERSE.reduce((t, a) => t + s.units[a] * mid(a), 0) : NaN);

  // Count consecutive ABSTAIN days per asset (once per UTC day).
  for (const p of postures) {
    if (p.posture === 'ABSTAIN') {
      if (s.lastAbstainDay[p.asset] !== day) { s.abstainDays[p.asset] = (s.abstainDays[p.asset] || 0) + 1; s.lastAbstainDay[p.asset] = day; }
    } else { s.abstainDays[p.asset] = 0; delete s.lastAbstainDay[p.asset]; }
  }
  const target = paperTargetWeights(postures.filter(p => TREND_FILTER_UNIVERSE.includes(p.asset)),
    { previousWeights: s.targetWeights, abstainDays: s.abstainDays });
  const fills = [];
  let action = 'NO_CHANGE', why = null;
  const changed = TREND_FILTER_UNIVERSE.some(a => (target.weights[a] || 0) !== (s.targetWeights[a] || 0));
  if (changed && !quotesOk) { action = 'HOLD_NO_VALID_QUOTE'; why = 'bitso_quote_invalid_or_missing'; }
  else if (changed) {
    const eq0 = equity();
    // Sells first (raise cash), then buys; each fill at the executable side plus taker fee.
    const order = [...TREND_FILTER_UNIVERSE].sort((a, b) => ((target.weights[a] || 0) * eq0 - s.units[a] * mid(a)) - ((target.weights[b] || 0) * eq0 - s.units[b] * mid(b)));
    for (const a of order) {
      const wantUsd = (target.weights[a] || 0) * eq0, haveUsd = s.units[a] * mid(a), delta = wantUsd - haveUsd;
      if (Math.abs(delta) < policy.minTradeUsd) continue;
      if (delta < 0) {
        const sellUnits = Math.min(s.units[a], -delta / quotes[a].bid);
        const gross = sellUnits * quotes[a].bid, fee = gross * policy.takerFee;
        s.units[a] -= sellUnits; s.cashUsd += gross - fee; s.feesUsd += fee;
        fills.push({ asset: a, side: 'SELL_PAPER', units: sellUnits, price: quotes[a].bid, feeUsd: r2(fee) });
      } else {
        const spend = Math.min(delta, s.cashUsd / (1 + policy.takerFee));
        const units = spend / quotes[a].ask, fee = spend * policy.takerFee;
        s.units[a] += units; s.cashUsd -= spend + fee; s.feesUsd += fee;
        fills.push({ asset: a, side: 'BUY_PAPER', units, price: quotes[a].ask, feeUsd: r2(fee) });
      }
      s.trades++;
    }
    if (s.cashUsd < -1e-6) fail('negative_cash');
    s.targetWeights = target.weights; action = fills.length ? 'REBALANCED_PAPER' : 'TARGET_UPDATED_NO_FILL';
  }

  // Measure (never enforce) the v0.6 limits.
  let marks = null;
  if (quotesOk) {
    const eq = equity();
    if (s.dayUtc !== day) { s.dayUtc = day; s.dayStartEquityUsd = eq; }
    s.peakEquityUsd = Math.max(s.peakEquityUsd, eq);
    const dayLossPct = Math.max(0, 100 * (s.dayStartEquityUsd - eq) / s.dayStartEquityUsd);
    const ddPct = Math.max(0, 100 * (s.peakEquityUsd - eq) / s.peakEquityUsd);
    if (dayLossPct >= policy.measuredMaxDayLossPct) s.wouldHaltDayLoss++;
    if (ddPct >= policy.measuredMaxDrawdownPct) s.wouldHaltDrawdown++;
    marks = { equityUsd: r2(eq), dayLossPct: r2(dayLossPct), drawdownPct: r2(ddPct),
      exposurePct: r2(100 * (eq - s.cashUsd) / eq), returnPct: r2(100 * (eq / policy.initialUsd - 1)) };
  }
  const report = { version: TREND_LEDGER_VERSION, filterVersion: TREND_FILTER_VERSION, at: new Date(+now).toISOString(),
    postures: postures.map(p => ({ asset: p.asset, posture: p.posture, reason: p.reason, distancePct: p.distancePct ?? null, lastCloseDay: p.lastCloseDay ?? null })),
    action, why, targetWeights: s.targetWeights, fills, marks, cashUsd: r2(s.cashUsd), units: s.units,
    trades: s.trades, feesUsd: r2(s.feesUsd), wouldHalt: { dayLoss: s.wouldHaltDayLoss, drawdown: s.wouldHaltDrawdown },
    pricing: 'BITSO_PUBLIC_BID_ASK_PLUS_TAKER_FEE', realOrders: 0, executionEnabled: false, tradeable: false };
  report.reportHash = ledgerHash({ report, state: s });
  return { state: s, report };
}
