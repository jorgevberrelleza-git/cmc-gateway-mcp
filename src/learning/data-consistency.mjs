import { extractLearningFeatures } from './features.mjs';

function parseToolPayload(block) {
  if (block == null) return null;
  if (block?.structuredContent != null) return block.structuredContent;
  if (block?.content_json != null) return block.content_json;
  for (const item of block?.content || []) {
    if (item?.type !== 'text' || typeof item.text !== 'string') continue;
    try { return JSON.parse(item.text); } catch {}
  }
  return block && typeof block === 'object' && !Array.isArray(block) ? block : null;
}

function n(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace(/,/g, '').replace(/%/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function minutesBetween(a, b) {
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.abs(y - x) / 60_000;
}

export function evaluateDataConsistency(snapshot = {}, {
  max_market_age_minutes = 15,
  block_market_age_minutes = 60,
  oi_change_warning_pp = 8,
  oi_change_block_pp = 25
} = {}) {
  const warnings = [];
  const conflicts = [];
  const assetBlocks = {};
  let score = 100;

  const marketGlobal = parseToolPayload(snapshot?.market?.global) || {};
  const marketDerivatives = parseToolPayload(snapshot?.market?.derivatives) || {};
  const features = extractLearningFeatures(snapshot);

  const marketAge = minutesBetween(snapshot?.generated_at, snapshot?.market?.generated_at);
  if (marketAge != null && marketAge > max_market_age_minutes) {
    warnings.push({ type: 'market_context_stale', age_minutes: Number(marketAge.toFixed(2)) });
    score -= marketAge > block_market_age_minutes ? 30 : 10;
  }

  const oiGlobal = n(marketGlobal?.leverage?.open_interest?.total?.percent_change?.['24h']);
  const oiSpecialized = n(marketDerivatives?.totalOpenInterest?.percentage_change_24h);
  if (oiGlobal != null && oiSpecialized != null) {
    const delta = Math.abs(oiGlobal - oiSpecialized);
    if (delta >= oi_change_warning_pp) {
      const severity = delta >= oi_change_block_pp ? 'high' : 'medium';
      conflicts.push({
        type: 'open_interest_24h_scope_conflict',
        severity,
        global_pct: oiGlobal,
        derivatives_pct: oiSpecialized,
        delta_pp: Number(delta.toFixed(2)),
        note: 'May reflect different scopes/windows; do not choose one silently.'
      });
      score -= severity === 'high' ? 20 : 8;
    }
  }

  for (const [asset, values] of Object.entries(features.assets || {})) {
    const reasons = [];
    if (!Number.isFinite(Number(values?.price_usd)) || Number(values.price_usd) <= 0) {
      reasons.push('missing_positive_usd_price');
    }

    const venue = snapshot?.microstructure?.assets?.[asset]?.venue_price_check;
    if (venue?.material_mismatch === true) reasons.push('material_venue_price_mismatch');
    if (micro?.available === true && venue?.available === false) reasons.push('venue_price_comparison_unavailable');

    const micro = snapshot?.microstructure?.assets?.[asset];
    if (micro?.available === true && Number(micro?.data_quality?.confidence_0_100) < 40) {
      reasons.push('low_microstructure_data_quality');
    }

    if (reasons.length) {
      assetBlocks[asset] = reasons;
      score -= Math.min(20, reasons.length * 8);
    }
  }

  const defi = snapshot?.defi_fundamentals;
  if (defi?.available === true) {
    for (const [asset, values] of Object.entries(defi.assets || {})) {
      const coverage = values?.coverage;
      if (coverage && Number(coverage.successful_metric_families) < Number(coverage.requested_metric_families)) {
        warnings.push({
          type: 'partial_defi_coverage',
          asset,
          successful: Number(coverage.successful_metric_families),
          requested: Number(coverage.requested_metric_families)
        });
        score -= 3;
      }
    }
  }

  score = Math.max(0, Math.min(100, score));
  const staleBlocking = marketAge != null && marketAge > block_market_age_minutes;
  const highConflictBlocking = conflicts.some(x => x.severity === 'high');
  const blocking = staleBlocking || highConflictBlocking || Object.keys(assetBlocks).length > 0;

  return {
    contract_version: 'data_consistency_v0.2',
    score_0_100: score,
    blocking,
    market_age_minutes: marketAge == null ? null : Number(marketAge.toFixed(2)),
    conflicts,
    warnings,
    asset_blocks: assetBlocks,
    policy: {
      conflicts_reduce_confidence_not_choose_source_silently: true,
      missing_data_must_not_be_inferred: true,
      venue_mismatch_can_block_asset_action: true
    }
  };
}
