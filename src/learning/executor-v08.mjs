// Shadow executor v0.8 — OWNER MANDATE planner. Pure: no network, no DB.
//
// The owner authorises Shadow to manage specific holdings she already owns
// (SHADOW_MANDATE_JSON, e.g. {"BTC":0.01249,"ADA":12000}). Each asset is an
// independent sleeve: Shadow's units of that asset + the USD it raised by
// selling it. Rule per asset (frozen, docs/shadow-trend-filter-v07.md §5):
//   RISK_OFF (close < SMA200)              -> sell all units to USD
//   RISK_ON and sleeve all USD             -> buy back with all sleeve USD
//   RISK_ON, full, price >= entry * 1.30   -> take profit: sell HALF
//   RISK_ON, half, price <= tp * 0.85      -> re-buy the half (pullback)
//   ABSTAIN (bad data)                     -> hold, never force a trade
// Safety: mandate <= maxPortfolioFraction (< 1) of the portfolio; never sells
// more than Shadow's units; never buys with more than Shadow's USD; account stop
// at -20% of the combined sleeves (latched); per-order/day caps; fail closed;
// idempotent ids. mode is DRY_RUN: nothing is ever sent.
import crypto from 'node:crypto';

export const EXECUTOR_VERSION = 'shadow_executor_v0.8.1';
export const EXECUTOR_BOOKS = Object.freeze({ BTC: 'btc_usd', ETH: 'eth_usd', ADA: 'ada_usd' });
export const EXECUTOR_POLICY = Object.freeze({
  maxPortfolioFraction: 0.5, stopDrawdownPct: 20, takeProfitPct: 30, rebuyPullbackPct: 15,
  maxOrdersPerDay: 6, minOrderUsd: 15, maxSpreadPct: 1.0, maxPostureAgeHours: 3, takerFee: 0.0036,
  // Pre-trade controls (RTS 6 art. 15 style): reference-price collar, max order value,
  // depth-aware size, and an execution throttle that latches a halt.
  priceCollarPct: 2.0, maxOrderUsd: 2500, maxDepthShare: 0.5, maxExecutions7d: 8
});
const sha = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const r2 = x => Math.round(x * 100) / 100;
function fail(m) { throw new Error('executor_v08:' + m); }

export function checkPolicy(p) {
  if (!(p.maxPortfolioFraction > 0 && p.maxPortfolioFraction < 1)) fail('portfolio_fraction_must_be_below_1');
  if (!(p.stopDrawdownPct > 0 && p.stopDrawdownPct <= 30)) fail('bad_stop');
  if (!(p.takeProfitPct >= 10 && p.rebuyPullbackPct > 0 && p.rebuyPullbackPct < p.takeProfitPct)) fail('bad_take_profit');
  if (!(p.maxOrdersPerDay >= 1 && p.maxOrdersPerDay <= 10)) fail('bad_daily_cap');
  if (!(p.priceCollarPct > 0 && p.priceCollarPct <= 5 && p.maxOrderUsd > 0 && p.maxDepthShare > 0 && p.maxDepthShare <= 1 && p.maxExecutions7d >= 2)) fail('bad_pretrade_controls');
}
export function parseMandate(raw) {
  let m; try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { fail('mandate_not_json'); }
  if (!m || typeof m !== 'object' || !Object.keys(m).length) fail('mandate_empty');
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    const a = String(k).toUpperCase();
    if (!EXECUTOR_BOOKS[a]) fail('mandate_asset_not_supported:' + a);
    if (!(Number(v) > 0)) fail('mandate_bad_units:' + a);
    out[a] = Number(v);
  }
  return out;
}

export function initialExecutorState(mandate, now = new Date()) {
  return { version: EXECUTOR_VERSION, createdAt: new Date(+now).toISOString(), mandate,
    sleeves: Object.fromEntries(Object.entries(mandate).map(([a, u]) => [a, { units: u, usd: 0, phase: 'FULL', entry: null, tpPx: null }])),
    peakUsd: null, stopped: false, stopReason: null, throttled: false, executions: [], day: null, ordersToday: 0, plannedOrders: 0, realOrdersSent: 0 };
}

function validQuote(q, maxSpreadPct) { return q && q.bid > 0 && q.ask >= q.bid && 100 * (q.ask - q.bid) / q.bid <= maxSpreadPct; }

/**
 * @param postures {BTC:'RISK_ON'|'RISK_OFF'|'ABSTAIN', ADA:...}
 * @param balances {usd:{available,total}, btc:{total}, ada:{total}, ...}
 * @param portfolioUsd total value of the owner's portfolio (all assets incl. non-Bitso), for the cap
 */
export function planMandate({ previous, mandate, postures, postureAt, balances, portfolioUsd, quotes, refPrices = null, depthUsd = null, now = new Date(), policy = EXECUTOR_POLICY, dryRun = true }) {
  if (!dryRun) fail('live_mode_not_available_in_this_build');
  checkPolicy(policy);
  const s = structuredClone(previous || initialExecutorState(mandate, now));
  if (s.version !== EXECUTOR_VERSION) fail('version_mismatch');
  if (s.realOrdersSent !== 0) fail('dry_run_state_has_real_orders');
  if (JSON.stringify(s.mandate) !== JSON.stringify(mandate)) fail('mandate_changed_requires_new_state');
  const day = new Date(+now).toISOString().slice(0, 10);
  if (s.day !== day) { s.day = day; s.ordersToday = 0; }
  const base = { version: EXECUTOR_VERSION, mode: 'DRY_RUN', at: new Date(+now).toISOString(), realOrdersSent: 0 };
  const hold = why => ({ state: s, report: { ...base, action: 'HOLD', why, orders: [] } });
  const assets = Object.keys(mandate);

  const ageH = (+now - Date.parse(postureAt)) / 3_600_000;
  if (!(ageH >= 0 && ageH <= policy.maxPostureAgeHours)) return hold('stale_or_missing_postures');
  if (!balances || !balances.usd) return hold('balances_unavailable');
  if (!assets.every(a => validQuote(quotes?.[a], policy.maxSpreadPct))) return hold('invalid_quote');
  const mid = a => (quotes[a].bid + quotes[a].ask) / 2;
  // Price collar: the venue mid must agree with an independent reference (Kraken).
  for (const a of assets) {
    const ref = Number(refPrices?.[a]);
    if (!(ref > 0)) return hold('reference_price_missing:' + a);
    if (Math.abs(mid(a) / ref - 1) * 100 > policy.priceCollarPct) return hold('price_collar_breach:' + a);
  }
  s.executions = (s.executions || []).filter(t => +now - Date.parse(t) < 7 * 86_400_000);
  if (s.throttled) return hold('execution_throttle_latched_requires_owner_reset');
  // Reconciliation. LIVE: Shadow's simulated sleeve must exist in the account.
  // DRY_RUN: nothing was really sold or bought, so the account must still hold
  // the MANDATED units (the owner has not moved them); the sleeve is virtual.
  for (const a of assets) {
    const held = Number(balances[a.toLowerCase()]?.total ?? 0);
    const need = dryRun ? mandate[a] : s.sleeves[a].units;
    if (need > held + 1e-9) return hold('mandate_units_exceed_balance_reconcile:' + a);
  }
  const sleeveUsd = assets.reduce((t, a) => t + s.sleeves[a].units * mid(a) + s.sleeves[a].usd, 0);
  const shadowUsd = assets.reduce((t, a) => t + s.sleeves[a].usd, 0);
  if (!dryRun && shadowUsd > Number(balances.usd.available ?? 0) + 0.01) return hold('shadow_usd_exceeds_available_reconcile');
  if (!(portfolioUsd > 0)) return hold('portfolio_value_unknown');
  const capUsd = policy.maxPortfolioFraction * portfolioUsd;
  if (sleeveUsd > capUsd * 1.05) return hold('mandate_exceeds_portfolio_cap'); // 5% tolerance for price drift

  s.peakUsd = Math.max(s.peakUsd ?? sleeveUsd, sleeveUsd);
  const ddPct = 100 * (s.peakUsd - sleeveUsd) / s.peakUsd;
  if (!s.stopped && ddPct >= policy.stopDrawdownPct) { s.stopped = true; s.stopReason = `mandate_drawdown_${r2(ddPct)}pct`; }

  const orders = [];
  const fee = policy.takerFee;
  for (const a of assets) {
    if (s.ordersToday + orders.length >= policy.maxOrdersPerDay) break;
    const sl = s.sleeves[a], px = mid(a), posture = postures[a] || 'ABSTAIN';
    let side = null, units = 0, why = null;
    if (s.stopped || posture === 'RISK_OFF') {
      if (sl.units > 0) { side = 'sell'; units = sl.units; why = s.stopped ? 'account_stop' : 'risk_off'; }
    } else if (posture === 'RISK_ON') {
      // Re-entry (and completion of a size-capped re-entry): spend the asset's own USD.
      if (sl.usd >= policy.minOrderUsd && sl.phase !== 'HALF') { side = 'buy'; units = sl.usd / (1 + fee) / quotes[a].ask; why = 'risk_on_reentry'; }
      else if (sl.entry == null) { sl.entry = px; sl.phase = 'FULL'; }
      else if (sl.phase === 'FULL' && px >= sl.entry * (1 + policy.takeProfitPct / 100)) { side = 'sell'; units = sl.units / 2; why = 'take_profit_half'; }
      else if (sl.phase === 'HALF' && sl.tpPx && px <= sl.tpPx * (1 - policy.rebuyPullbackPct / 100) && sl.usd > 0) { side = 'buy'; units = sl.usd / (1 + fee) / quotes[a].ask; why = 'rebuy_after_pullback'; }
    }
    if (!side) continue;
    // Max order value and depth-aware size: clamp; any remainder is handled next hour.
    const execPx = side === 'sell' ? quotes[a].bid : quotes[a].ask;
    const depth = Number(depthUsd?.[a]?.[side === 'sell' ? 'bid' : 'ask']);
    const capUsd = Math.min(policy.maxOrderUsd, depth > 0 ? policy.maxDepthShare * depth : Infinity);
    if (!(depth > 0)) { continue; } // no depth data: do not trade this asset this hour
    if (units * execPx > capUsd) { units = capUsd / execPx; why += '_size_capped'; }
    const notional = units * execPx;
    if (notional < policy.minOrderUsd) continue;
    const id = 'shadow-' + sha({ day, a, side, why, units: +units.toFixed(8), entry: sl.entry, tp: sl.tpPx }).slice(0, 24);
    orders.push({ book: EXECUTOR_BOOKS[a], asset: a, side, type: 'market', major: +units.toFixed(8), notionalUsd: r2(notional), clientOrderId: id, reason: why });
    // DRY_RUN: assume the fill at the executable side so the sleeve evolves like the real one.
    if (side === 'sell') {
      sl.units -= units; sl.usd += notional * (1 - fee);
      if (why.startsWith('take_profit_half')) { sl.phase = 'HALF'; sl.tpPx = px; }
      else if (sl.units * px < policy.minOrderUsd) { sl.phase = 'CASH'; sl.entry = null; sl.tpPx = null; }
    } else {
      sl.units += units; sl.usd = Math.max(0, sl.usd - notional * (1 + fee));
      sl.phase = sl.usd >= policy.minOrderUsd ? 'CASH' : 'FULL'; sl.entry = px; sl.tpPx = null;
    }
    s.executions.push(new Date(+now).toISOString());
    if (sl.units < 1e-12) sl.units = 0;
  }
  s.ordersToday += orders.length; s.plannedOrders += orders.length;
  if (s.executions.length > policy.maxExecutions7d) { s.throttled = true; s.stopReason = 'execution_throttle_' + s.executions.length + '_in_7d'; }
  return { state: s, report: { ...base, action: orders.length ? 'WOULD_SEND' : 'NO_CHANGE', why: s.stopped ? s.stopReason : null, orders,
    mandate: { valueUsd: r2(sleeveUsd), peakUsd: r2(s.peakUsd), drawdownPct: r2(ddPct), capUsd: r2(capUsd), portfolioUsd: r2(portfolioUsd), maxPortfolioFraction: policy.maxPortfolioFraction },
    sleeves: Object.fromEntries(assets.map(a => [a, { units: +s.sleeves[a].units.toFixed(8), usd: r2(s.sleeves[a].usd), phase: s.sleeves[a].phase, posture: postures[a] || 'ABSTAIN' }])),
    stopped: s.stopped } };
}
