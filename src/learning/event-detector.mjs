import { extractLearningFeatures } from './features.mjs';

export const DEFAULT_EVENT_THRESHOLDS = Object.freeze({
  price_move_pct: 2.0,
  trap_delta: 20,
  spot_delta: 20,
  wall_delta: 40,
  fundamental_quality_delta: 20,
  gate_change: true
});

function pctMove(prev, curr) {
  if (!Number.isFinite(prev) || !Number.isFinite(curr) || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function numericDelta(prev, curr) {
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return null;
  return curr - prev;
}

export function detectMaterialEvent(previousSnapshot, currentSnapshot, thresholds = {}) {
  const t = { ...DEFAULT_EVENT_THRESHOLDS, ...thresholds };
  const previous = extractLearningFeatures(previousSnapshot || {});
  const current = extractLearningFeatures(currentSnapshot || {});
  const symbols = [...new Set([...Object.keys(previous.assets), ...Object.keys(current.assets)])];
  const reasons = [];
  const perAsset = {};

  for (const symbol of symbols) {
    const p = previous.assets[symbol] || {};
    const c = current.assets[symbol] || {};
    const priceMove = pctMove(p.price_usd, c.price_usd);
    const trapDelta = numericDelta(p.trap_risk, c.trap_risk);
    const spotDelta = numericDelta(p.spot_confirmation, c.spot_confirmation);
    const wallDelta = numericDelta(p.persistent_wall_pressure, c.persistent_wall_pressure);
    const fundamentalDelta = numericDelta(p.fundamental_quality, c.fundamental_quality);
    const assetReasons = [];

    if (priceMove !== null && Math.abs(priceMove) >= t.price_move_pct) assetReasons.push(`price_move_${priceMove.toFixed(2)}pct`);
    if (trapDelta !== null && Math.abs(trapDelta) >= t.trap_delta) assetReasons.push(`trap_delta_${trapDelta.toFixed(0)}`);
    if (spotDelta !== null && Math.abs(spotDelta) >= t.spot_delta) assetReasons.push(`spot_delta_${spotDelta.toFixed(0)}`);
    if (wallDelta !== null && Math.abs(wallDelta) >= t.wall_delta) assetReasons.push(`wall_delta_${wallDelta.toFixed(0)}`);
    if (fundamentalDelta !== null && Math.abs(fundamentalDelta) >= t.fundamental_quality_delta) assetReasons.push(`fundamental_quality_delta_${fundamentalDelta.toFixed(0)}`);
    if (t.gate_change && p.execution_gate && c.execution_gate && p.execution_gate !== c.execution_gate) {
      assetReasons.push(`gate_${p.execution_gate}_to_${c.execution_gate}`);
    }

    perAsset[symbol] = {
      price_move_pct: priceMove,
      trap_delta: trapDelta,
      spot_delta: spotDelta,
      wall_delta: wallDelta,
      fundamental_quality_delta: fundamentalDelta,
      previous_gate: p.execution_gate ?? null,
      current_gate: c.execution_gate ?? null,
      material: assetReasons.length > 0,
      reasons: assetReasons
    };

    for (const reason of assetReasons) reasons.push(`${symbol}:${reason}`);
  }

  return {
    material: reasons.length > 0,
    reasons,
    per_asset: perAsset,
    previous_generated_at: previous.generated_at,
    current_generated_at: current.generated_at,
    policy: 'deterministic_alpha_v0.1'
  };
}
