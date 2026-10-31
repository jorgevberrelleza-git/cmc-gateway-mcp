function pctChange(start, end) {
  const a = Number(start), b = Number(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / a) * 100;
}

export function valueHodlBenchmark(seed = {}, prices = {}) {
  const cash = Number(seed.cash_usd || 0);
  let positionsValue = 0;
  for (const [symbol, quantity] of Object.entries(seed.positions || {})) {
    const price = Number(prices?.[String(symbol).toUpperCase()]);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`missing_hodl_price:${symbol}`);
    positionsValue += Number(quantity || 0) * price;
  }
  return cash + positionsValue;
}

export function buildPortfolioBenchmark({
  initial_value_usd,
  shadow_value_usd,
  hodl_value_usd,
  peak_shadow_value_usd = null
} = {}) {
  const initial = Number(initial_value_usd);
  const shadow = Number(shadow_value_usd);
  const hodl = Number(hodl_value_usd);
  if (![initial, shadow, hodl].every(Number.isFinite) || initial <= 0) throw new Error('valid benchmark values required');

  const shadowReturn = pctChange(initial, shadow);
  const hodlReturn = pctChange(initial, hodl);
  const peak = Number.isFinite(Number(peak_shadow_value_usd)) ? Number(peak_shadow_value_usd) : Math.max(initial, shadow);
  const drawdown = peak > 0 ? ((shadow - peak) / peak) * 100 : null;

  return {
    initial_value_usd: initial,
    shadow_value_usd: shadow,
    shadow_return_pct: shadowReturn,
    hodl_value_usd: hodl,
    hodl_return_pct: hodlReturn,
    usd_value_usd: initial,
    usd_return_pct: 0,
    alpha_vs_hodl_pct: shadowReturn - hodlReturn,
    alpha_vs_usd_pct: shadowReturn,
    peak_shadow_value_usd: peak,
    drawdown_pct: drawdown
  };
}
