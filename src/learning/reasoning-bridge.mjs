import { validateShadowDecision } from './decision.mjs';
import { validateMacroContext } from './macro-contract.mjs';
import { calculatePaperBuySize, calculatePaperReductionSize, calculateRewardRisk } from './sizing.mjs';
import { scoreDecisionQuality } from './decision-quality.mjs';

const DEFENSIVE = new Set(['REDUCE','SELL','MOVE_TO_USD']);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function freshnessHours(observedAt, referenceAt) {
  const a = Date.parse(observedAt);
  const b = Date.parse(referenceAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.abs(b - a) / 3_600_000;
}

function currentAsset(packet, asset) {
  return packet?.market?.current_features?.assets?.[String(asset || '').toUpperCase()] || null;
}

function portfolioPosition(packet, asset) {
  return packet?.portfolio?.positions?.[String(asset || '').toUpperCase()] || null;
}

export function validateReasoningProposal(proposal = {}, packet = {}, {
  maxMacroAgeHours = 12
} = {}) {
  const asset = String(proposal.asset || '').toUpperCase();
  const action = String(proposal.action || '').toUpperCase();
  const errors = [];
  const assetData = currentAsset(packet, asset);
  if (!assetData) errors.push('asset_not_in_current_snapshot');

  if (proposal.kill_switch === true) errors.push('ai_cannot_activate_kill_switch');

  const macroRaw = proposal.macro_context || {};
  const verificationStatus = String(macroRaw.verification_status || 'insufficient').toLowerCase();
  const sources = Array.isArray(macroRaw.sources) ? macroRaw.sources : [];
  const validSourceUrls = sources.filter(x => {
    try {
      const url = new URL(String(x?.url || ''));
      return ['http:', 'https:'].includes(url.protocol);
    } catch {
      return false;
    }
  });
  const highQualitySources = validSourceUrls.filter(x => ['primary','reuters'].includes(String(x?.kind || '').toLowerCase()));
  const macro = validateMacroContext(macroRaw);
  const macroAge = freshnessHours(macroRaw.observed_at, packet?.market?.generated_at);
  const positionChanging = action !== 'HOLD';

  if (verificationStatus === 'verified') {
    if (!macro.ok) errors.push(...macro.errors.map(x => `macro:${x}`));
    if (macroAge == null || macroAge > maxMacroAgeHours) errors.push('macro_context_stale_or_unanchored');
  } else if (positionChanging) {
    errors.push('macro_context_not_verified_for_position_change');
  }

  if (positionChanging) {
    if (validSourceUrls.length < 2) errors.push('position_change_requires_two_macro_sources');
    if (highQualitySources.length < 1) errors.push('position_change_requires_primary_or_reuters_macro_source');
  }

  let deterministicRewardRisk = num(proposal.reward_risk);
  const currentPrice = num(assetData?.price_usd);
  if (action === 'BUY') {
    const invalidation = num(proposal.invalidation_price_usd);
    const target = num(proposal.target_price_usd);
    if (currentPrice == null || invalidation == null || target == null) {
      errors.push('buy_requires_current_price_invalidation_and_target');
    } else {
      if (invalidation >= currentPrice) errors.push('buy_invalidation_must_be_below_entry');
      if (target <= currentPrice) errors.push('buy_target_must_be_above_entry');
      if (invalidation < currentPrice && target > currentPrice) {
        try {
          deterministicRewardRisk = calculateRewardRisk({
            entry_price: currentPrice,
            invalidation_price: invalidation,
            target_price: target
          });
        } catch {
          errors.push('buy_reward_risk_inputs_invalid');
        }
      }
    }
  }

  const persistence = packet?.deterministic_persistence_by_asset?.[asset] || {
    confirmed: false,
    mode: 'insufficient',
    observation_count: 0,
    common_families: [],
    reason: 'no_deterministic_persistence'
  };

  const contract = validateShadowDecision({
    ...proposal,
    asset,
    action,
    reward_risk: deterministicRewardRisk,
    persistence,
    kill_switch: false,
    execution_enabled: false
  });
  errors.push(...contract.errors);

  if (DEFENSIVE.has(action) && persistence.confirmed !== true) {
    errors.push('deterministic_persistence_not_confirmed');
  }

  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    normalized: {
      ...contract.normalized,
      asset,
      action,
      reward_risk: deterministicRewardRisk,
      persistence,
      macro_context: verificationStatus === 'verified' ? macro.normalized : {
        regime: macroRaw.regime ?? 'unknown',
        liquidity: macroRaw.liquidity ?? 'unknown',
        shock_risk: macroRaw.shock_risk ?? 'unknown',
        observed_at: macroRaw.observed_at ?? null,
        evidence: Array.isArray(macroRaw.evidence) ? macroRaw.evidence : [],
        source_quality: macroRaw.source_quality || 'unavailable',
        verification_status: verificationStatus,
        sources
      },
      execution_enabled: false,
      kill_switch: false
    },
    macro_validation: {
      ok: verificationStatus === 'verified' && macro.ok && macroAge != null && macroAge <= maxMacroAgeHours,
      verification_status: verificationStatus,
      errors: macro.errors,
      age_hours: macroAge,
      valid_source_count: validSourceUrls.length,
      high_quality_source_count: highQualitySources.length
    }
  };
}

export function buildDeterministicPaperOrder(proposal, validation, packet, {
  maxRiskPct = 0.01,
  defaultRiskPct = 0.005,
  maxPositionPct = 0.20,
  maxNewExposurePct = 0.10,
  feeRate = 0.001,
  slippageBps = 10
} = {}) {
  if (!validation?.ok) return { ok: false, errors: ['proposal_not_validated'], order: null };
  const action = validation.normalized.action;
  if (action === 'HOLD') return { ok: true, errors: [], order: null };
  if (!packet?.portfolio) return { ok: false, errors: ['portfolio_mark_required_for_actionable_decision'], order: null };

  const asset = validation.normalized.asset;
  const price = num(currentAsset(packet, asset)?.price_usd);
  if (price == null || price <= 0) return { ok: false, errors: ['current_price_required_for_paper_order'], order: null };

  if (action === 'BUY') {
    const invalidation = num(proposal.invalidation_price_usd);
    const target = num(proposal.target_price_usd);
    const requestedRisk = num(proposal.risk_pct);
    const riskPct = Math.min(maxRiskPct, Math.max(0, requestedRisk ?? defaultRiskPct));
    const pos = portfolioPosition(packet, asset);
    const currentPositionUsd = num(pos?.value_usd) ?? 0;

    let order;
    try {
      order = calculatePaperBuySize({
        portfolio_value_usd: Number(packet.portfolio.total_value_usd),
        available_cash_usd: Number(packet.portfolio.cash_usd),
        entry_price_usd: price,
        invalidation_price_usd: invalidation,
        current_position_usd: currentPositionUsd,
        risk_pct: riskPct,
        max_position_pct: maxPositionPct,
        max_new_exposure_pct: maxNewExposurePct,
        fee_rate: feeRate,
        slippage_bps: slippageBps
      });
    } catch (error) {
      return { ok: false, errors: [error?.message || 'buy_sizing_failed'], order: null };
    }
    if (!Number.isFinite(order.notional_usd) || order.notional_usd <= 0) {
      return { ok: false, errors: ['sizing_produced_zero_notional'], order: null };
    }
    return {
      ok: true,
      errors: [],
      order: {
        ...order,
        symbol: asset,
        target_price_usd: target,
        action_context: action
      }
    };
  }

  const pos = portfolioPosition(packet, asset);
  const currentQuantity = num(pos?.quantity);
  if (currentQuantity == null || currentQuantity <= 0) {
    return { ok: false, errors: ['defensive_action_requires_existing_shadow_position'], order: null };
  }

  let reductionPct = action === 'REDUCE' ? num(proposal.reduction_pct) : 1;
  if (reductionPct == null || reductionPct <= 0) reductionPct = 0.10;
  reductionPct = Math.min(1, reductionPct);

  try {
    const order = calculatePaperReductionSize({
      current_quantity: currentQuantity,
      reference_price_usd: price,
      reduction_pct: reductionPct,
      fee_rate: feeRate,
      slippage_bps: slippageBps
    });
    return {
      ok: true,
      errors: [],
      order: { ...order, symbol: asset, action_context: action }
    };
  } catch (error) {
    return { ok: false, errors: [error?.message || 'defensive_sizing_failed'], order: null };
  }
}

export function assessReasoningProposal(proposal, packet, options = {}) {
  const validation = validateReasoningProposal(proposal, packet, options);
  const paper = buildDeterministicPaperOrder(proposal, validation, packet, options);
  const accepted = validation.ok && paper.ok;

  const quality = scoreDecisionQuality({
    action: validation.normalized?.action || proposal?.action,
    validation_ok: accepted,
    evidence_families: validation.normalized?.evidence_families || proposal?.evidence_families,
    reward_risk: validation.normalized?.reward_risk,
    persistence: validation.normalized?.persistence,
    macro_context_valid: validation.macro_validation?.ok === true,
    source_conflict: proposal?.source_conflict === true,
    data_confidence: proposal?.data_confidence
  });

  return {
    accepted,
    validation,
    paper_order: paper.order,
    errors: [...new Set([...(validation.errors || []), ...(paper.errors || [])])],
    quality
  };
}
