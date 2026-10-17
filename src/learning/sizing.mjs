function positive(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be > 0`);
  return n;
}

function clamp01(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export function calculateRewardRisk({ entry_price, invalidation_price, target_price }) {
  const entry = positive(entry_price, 'entry_price');
  const invalidation = positive(invalidation_price, 'invalidation_price');
  const target = positive(target_price, 'target_price');
  const risk = Math.abs(entry - invalidation);
  if (risk === 0) return null;
  return Math.abs(target - entry) / risk;
}

export function calculatePaperBuySize(input = {}) {
  const portfolioValue = positive(input.portfolio_value_usd, 'portfolio_value_usd');
  const availableCash = Math.max(0, Number(input.available_cash_usd) || 0);
  const entry = positive(input.entry_price_usd, 'entry_price_usd');
  const invalidation = positive(input.invalidation_price_usd, 'invalidation_price_usd');
  const currentPosition = Math.max(0, Number(input.current_position_usd) || 0);

  const riskPct = clamp01(input.risk_pct, 0.005);
  const maxPositionPct = clamp01(input.max_position_pct, 0.20);
  const maxNewExposurePct = clamp01(input.max_new_exposure_pct, 0.10);
  const feeRate = clamp01(input.fee_rate, 0.001);
  const slippageBps = Math.max(0, Number(input.slippage_bps) || 0);

  const stopDistanceUsd = Math.abs(entry - invalidation);
  if (stopDistanceUsd === 0) throw new Error('invalidation_price_usd must differ from entry_price_usd');

  const riskBudgetUsd = portfolioValue * riskPct;
  const quantityByRisk = riskBudgetUsd / stopDistanceUsd;
  const notionalByRisk = quantityByRisk * entry;
  const maxPositionNotional = Math.max(0, portfolioValue * maxPositionPct - currentPosition);
  const maxNewExposure = portfolioValue * maxNewExposurePct;

  const notionalUsd = Math.max(0, Math.min(
    notionalByRisk,
    availableCash,
    maxPositionNotional,
    maxNewExposure
  ));
  const quantity = notionalUsd / entry;
  const estimatedFeeUsd = notionalUsd * feeRate;
  const estimatedSlippageUsd = notionalUsd * (slippageBps / 10_000);

  return {
    side: 'buy',
    quantity,
    notional_usd: notionalUsd,
    reference_price_usd: entry,
    invalidation_price_usd: invalidation,
    risk_budget_usd: riskBudgetUsd,
    estimated_fee_usd: estimatedFeeUsd,
    estimated_slippage_bps: slippageBps,
    estimated_slippage_usd: estimatedSlippageUsd,
    binding_constraint:
      notionalUsd === availableCash ? 'available_cash' :
      notionalUsd === maxPositionNotional ? 'max_position' :
      notionalUsd === maxNewExposure ? 'max_new_exposure' :
      'risk_budget',
    state: 'proposed',
    execution_enabled: false
  };
}

export function calculatePaperReductionSize(input = {}) {
  const currentQuantity = positive(input.current_quantity, 'current_quantity');
  const referencePrice = positive(input.reference_price_usd, 'reference_price_usd');
  const reductionPct = clamp01(input.reduction_pct, 0.10);
  const feeRate = clamp01(input.fee_rate, 0.001);
  const slippageBps = Math.max(0, Number(input.slippage_bps) || 0);

  const quantity = currentQuantity * reductionPct;
  const notionalUsd = quantity * referencePrice;
  return {
    side: 'sell',
    quantity,
    notional_usd: notionalUsd,
    reference_price_usd: referencePrice,
    estimated_fee_usd: notionalUsd * feeRate,
    estimated_slippage_bps: slippageBps,
    estimated_slippage_usd: notionalUsd * (slippageBps / 10_000),
    state: 'proposed',
    execution_enabled: false
  };
}
