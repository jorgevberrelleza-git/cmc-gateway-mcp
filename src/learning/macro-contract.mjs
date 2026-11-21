const REGIMES = new Set(['favorable', 'neutral', 'adverse']);
const LIQUIDITY = new Set(['expanding', 'stable', 'contracting']);
const SHOCK = new Set(['low', 'medium', 'high']);

export function validateMacroContext(input = {}) {
  const errors = [];
  const regime = String(input.regime || '').toLowerCase();
  const liquidity = String(input.liquidity || '').toLowerCase();
  const shockRisk = String(input.shock_risk || '').toLowerCase();
  const evidence = Array.isArray(input.evidence) ? input.evidence.filter(Boolean) : [];

  if (!REGIMES.has(regime)) errors.push('invalid_macro_regime');
  if (!LIQUIDITY.has(liquidity)) errors.push('invalid_liquidity_regime');
  if (!SHOCK.has(shockRisk)) errors.push('invalid_shock_risk');
  if (!input.observed_at || !Number.isFinite(Date.parse(input.observed_at))) errors.push('observed_at_required');
  if (evidence.length < 2) errors.push('macro_context_requires_at_least_two_evidence_items');

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      regime,
      liquidity,
      shock_risk: shockRisk,
      observed_at: input.observed_at ?? null,
      evidence,
      source_quality: input.source_quality || 'mixed'
    }
  };
}
