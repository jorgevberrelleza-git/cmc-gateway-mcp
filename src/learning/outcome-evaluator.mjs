export const OUTCOME_HORIZONS_MS = Object.freeze({
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
});

function finite(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be finite`);
  return n;
}

export function dueHorizons(createdAt, alreadyEvaluated = [], now = new Date()) {
  const created = Date.parse(createdAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(created) || !Number.isFinite(current)) return [];
  const done = new Set(alreadyEvaluated);
  return Object.entries(OUTCOME_HORIZONS_MS)
    .filter(([h, ms]) => !done.has(h) && current >= created + ms)
    .map(([h]) => h);
}

export function evaluateSpotDecisionOutcome({
  action,
  reference_price_usd,
  current_price_usd,
  estimated_fee_usd = 0,
  estimated_slippage_usd = 0,
  notional_usd = 0
} = {}) {
  const ref = finite(reference_price_usd, 'reference_price_usd');
  const current = finite(current_price_usd, 'current_price_usd');
  if (ref <= 0 || current <= 0) throw new Error('prices must be > 0');

  const assetReturnPct = ((current - ref) / ref) * 100;
  const costUsd = Math.max(0, Number(estimated_fee_usd) || 0) + Math.max(0, Number(estimated_slippage_usd) || 0);
  const notional = Math.max(0, Number(notional_usd) || 0);
  const costPct = notional > 0 ? (costUsd / notional) * 100 : 0;
  const normalizedAction = String(action || '').toUpperCase();

  let strategyReturnPct;
  if (normalizedAction === 'BUY') strategyReturnPct = assetReturnPct - costPct;
  else if (['REDUCE', 'SELL', 'MOVE_TO_USD'].includes(normalizedAction)) strategyReturnPct = -costPct;
  else if (normalizedAction === 'HOLD') strategyReturnPct = assetReturnPct;
  else throw new Error('unsupported action');

  return {
    action: normalizedAction,
    asset_return_pct: assetReturnPct,
    strategy_return_pct: strategyReturnPct,
    hold_return_pct: assetReturnPct,
    usd_return_pct: 0,
    alpha_vs_hold_pct: strategyReturnPct - assetReturnPct,
    estimated_cost_pct: costPct
  };
}
