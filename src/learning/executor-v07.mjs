// Shadow executor v0.7 — ORDER PLANNER. Pure: no network, no DB.
//
// Turns the v0.7 trend postures (BTC/ETH, SMA200) into the orders that WOULD be
// sent to Bitso for a dedicated "Shadow sleeve". Safety rules live here and in
// the read-only client; the strategy code cannot bypass them.
//
//  - Capital cap: the sleeve is at most `maxPortfolioFraction` (< 1) of the total
//    portfolio value. Shadow never uses 100% of the portfolio.
//  - Own sleeve: Shadow only sells units IT bought. It never touches coins the
//    owner already held.
//  - Closed universe: btc_usd and eth_usd only.
//  - Account stop: sleeve drawdown >= stopDrawdownPct from its peak -> sell
//    everything to USD and latch STOPPED until the owner resets it.
//  - Fail closed: bad/missing quotes or balances -> no orders (hold).
//  - Idempotent client order ids derived from the decision.
//  - mode is always DRY_RUN in this version: nothing is ever sent.
import crypto from 'node:crypto';

export const EXECUTOR_VERSION = 'shadow_executor_v0.7.0';
export const EXECUTOR_BOOKS = Object.freeze({ BTC: 'btc_usd', ETH: 'eth_usd' });
export const EXECUTOR_POLICY = Object.freeze({
  maxPortfolioFraction: 0.5,   // owner rule: never 100% of the portfolio
  perAssetSleeveWeight: 0.5,   // RISK_ON asset gets half of the sleeve
  stopDrawdownPct: 20,
  maxOrderFractionOfSleeve: 0.5,
  maxOrdersPerDay: 4,
  minOrderUsd: 15,
  maxSpreadPct: 1.0,
  maxPostureAgeHours: 3,
  takerFee: 0.0036
});
const sha = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const r2 = x => Math.round(x * 100) / 100;
function fail(m) { throw new Error('executor_v07:' + m); }

export function checkPolicy(p) {
  if (!(p.maxPortfolioFraction > 0 && p.maxPortfolioFraction < 1)) fail('portfolio_fraction_must_be_below_1');
  if (!(p.perAssetSleeveWeight > 0 && p.perAssetSleeveWeight * Object.keys(EXECUTOR_BOOKS).length <= 1)) fail('bad_asset_weight');
  if (!(p.stopDrawdownPct > 0 && p.stopDrawdownPct <= 30)) fail('bad_stop');
  if (!(p.maxOrderFractionOfSleeve > 0 && p.maxOrderFractionOfSleeve <= 1)) fail('bad_order_cap');
  if (!(p.maxOrdersPerDay >= 1 && p.maxOrdersPerDay <= 10)) fail('bad_daily_cap');
}

export function initialExecutorState(now = new Date()) {
  return { version: EXECUTOR_VERSION, createdAt: new Date(+now).toISOString(),
    shadowUnits: { BTC: 0, ETH: 0 }, shadowCashUsd: null, sleevePeakUsd: null, stopped: false, stopReason: null,
    day: null, ordersToday: 0, plannedOrders: 0, realOrdersSent: 0 };
}

function validQuote(q, maxSpreadPct) {
  return q && q.bid > 0 && q.ask >= q.bid && 100 * (q.ask - q.bid) / q.bid <= maxSpreadPct;
}

/**
 * @param postures  [{asset:'BTC'|'ETH', posture:'RISK_ON'|'RISK_OFF'|'ABSTAIN', at}]
 * @param balances  {usd:{available,total}, btc:{...}, eth:{...}, ...} totals in units; null if unknown
 * @param otherAssetsUsd  USD value of every other holding (e.g. AAVE, USDC), for the total portfolio
 * @param quotes    {BTC:{bid,ask}, ETH:{bid,ask}}
 */
export function planExecution({ previous, postures, postureAt, balances, otherAssetsUsd = 0, quotes, now = new Date(), policy = EXECUTOR_POLICY }) {
  checkPolicy(policy);
  const s = structuredClone(previous || initialExecutorState(now));
  if (s.version !== EXECUTOR_VERSION) fail('version_mismatch');
  if (s.realOrdersSent !== 0) fail('dry_run_state_has_real_orders');
  const day = new Date(+now).toISOString().slice(0, 10);
  if (s.day !== day) { s.day = day; s.ordersToday = 0; }
  const base = { version: EXECUTOR_VERSION, mode: 'DRY_RUN', at: new Date(+now).toISOString(), realOrdersSent: 0 };
  const hold = why => ({ state: s, report: { ...base, action: 'HOLD', why, orders: [] } });

  const ageH = (+now - Date.parse(postureAt)) / 3_600_000;
  if (!(ageH >= 0 && ageH <= policy.maxPostureAgeHours)) return hold('stale_or_missing_postures');
  if (!balances || !balances.usd) return hold('balances_unavailable');
  const assets = Object.keys(EXECUTOR_BOOKS);
  if (!assets.every(a => validQuote(quotes?.[a], policy.maxSpreadPct))) return hold('invalid_quote');
  const mid = a => (quotes[a].bid + quotes[a].ask) / 2;

  // Never manage more units than Shadow bought AND than actually exist.
  for (const a of assets) {
    const held = Number(balances[a.toLowerCase()]?.total ?? 0);
    if (s.shadowUnits[a] > held + 1e-12) return hold('shadow_units_exceed_balance_reconcile');
  }
  const usdTotal = Number(balances.usd.total ?? 0), usdAvail = Number(balances.usd.available ?? 0);
  const coinsUsd = assets.reduce((t, a) => t + Number(balances[a.toLowerCase()]?.total ?? 0) * mid(a), 0);
  const portfolioUsd = usdTotal + coinsUsd + Number(otherAssetsUsd || 0);
  const shadowPosUsd = assets.reduce((t, a) => t + s.shadowUnits[a] * mid(a), 0);
  const sleeveCapUsd = policy.maxPortfolioFraction * portfolioUsd;

  // Shadow keeps its OWN cash account, funded once from available USD up to the
  // cap. The owner's other deposits/withdrawals never change the sleeve value,
  // so they can neither fake nor hide an account-stop drawdown.
  if (s.shadowCashUsd == null) s.shadowCashUsd = Math.max(0, Math.min(sleeveCapUsd, usdAvail));
  const cashShortfall = s.shadowCashUsd > usdAvail + 0.01;
  const sleeveUsd = shadowPosUsd + s.shadowCashUsd;
  s.sleevePeakUsd = Math.max(s.sleevePeakUsd ?? sleeveUsd, sleeveUsd);
  const sleeveDdPct = s.sleevePeakUsd > 0 ? 100 * (s.sleevePeakUsd - sleeveUsd) / s.sleevePeakUsd : 0;
  if (!s.stopped && sleeveDdPct >= policy.stopDrawdownPct) { s.stopped = true; s.stopReason = `sleeve_drawdown_${r2(sleeveDdPct)}pct`; }

  const byAsset = Object.fromEntries(postures.map(p => [p.asset, p.posture]));
  const orders = [];
  for (const a of assets) {
    const posture = byAsset[a] || 'ABSTAIN';
    let targetUsd;
    if (s.stopped || posture === 'RISK_OFF') targetUsd = 0;
    else if (posture === 'RISK_ON') targetUsd = policy.perAssetSleeveWeight * sleeveUsd;
    else continue; // ABSTAIN: keep what Shadow holds, never force a trade on bad data
    const haveUsd = s.shadowUnits[a] * mid(a);
    let delta = targetUsd - haveUsd;
    const cap = policy.maxOrderFractionOfSleeve * sleeveUsd;
    if (delta > 0) {
      const spent = orders.filter(o => o.side === 'buy').reduce((t, o) => t + o.notionalUsd, 0);
      const posAfterCap = sleeveCapUsd - shadowPosUsd - spent; // never exceed the portfolio-fraction cap
      delta = Math.min(delta, cap, (Math.min(s.shadowCashUsd, usdAvail) - spent * (1 + policy.takerFee)) / (1 + policy.takerFee), posAfterCap);
    }
    if (Math.abs(delta) < policy.minOrderUsd) continue;
    if (s.ordersToday + orders.length >= policy.maxOrdersPerDay) break;
    const side = delta > 0 ? 'buy' : 'sell';
    const units = side === 'sell' ? Math.min(s.shadowUnits[a], -delta / quotes[a].bid) : delta / quotes[a].ask;
    const decisionKey = { day, a, side, posture, stopped: s.stopped, units: +units.toFixed(8) };
    orders.push({ book: EXECUTOR_BOOKS[a], asset: a, side, type: 'market',
      major: +units.toFixed(8), notionalUsd: r2(side === 'buy' ? delta : units * quotes[a].bid),
      clientOrderId: 'shadow-' + sha(decisionKey).slice(0, 24), reason: s.stopped ? 'account_stop' : posture });
  }
  // In DRY_RUN the "fill" is assumed at the executable side so the sleeve evolves like the real one would.
  for (const o of orders) {
    s.shadowUnits[o.asset] = Math.max(0, s.shadowUnits[o.asset] + (o.side === 'buy' ? o.major : -o.major));
    s.shadowCashUsd += o.side === 'buy' ? -o.notionalUsd * (1 + policy.takerFee) : o.notionalUsd * (1 - policy.takerFee);
  }
  s.shadowCashUsd = Math.max(0, s.shadowCashUsd);
  s.ordersToday += orders.length; s.plannedOrders += orders.length;
  return { state: s, report: { ...base, action: orders.length ? 'WOULD_SEND' : 'NO_CHANGE', why: s.stopped ? s.stopReason : null,
    orders, cashShortfall, sleeve: { capUsd: r2(sleeveCapUsd), valueUsd: r2(sleeveUsd), shadowCashUsd: r2(s.shadowCashUsd), peakUsd: r2(s.sleevePeakUsd), drawdownPct: r2(sleeveDdPct),
      portfolioUsd: r2(portfolioUsd), maxPortfolioFraction: policy.maxPortfolioFraction },
    shadowUnits: s.shadowUnits, stopped: s.stopped } };
}
