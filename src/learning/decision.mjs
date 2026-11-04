const ACTIONS = new Set(['HOLD', 'BUY', 'REDUCE', 'SELL', 'MOVE_TO_USD']);
const EVIDENCE_FAMILIES = new Set([
  'structure',
  'relative_strength',
  'fundamentals',
  'macro',
  'microstructure',
  'portfolio_risk',
  'catalyst',
  'flow',
  'venue'
]);

function finite(v) {
  return Number.isFinite(Number(v)) ? Number(v) : null;
}

function distinctEvidence(input) {
  return [...new Set((Array.isArray(input) ? input : [])
    .map(x => String(x || '').trim().toLowerCase())
    .filter(x => EVIDENCE_FAMILIES.has(x)))];
}

export function validateShadowDecision(input = {}) {
  const action = String(input.action || '').trim().toUpperCase();
  const evidenceFamilies = distinctEvidence(input.evidence_families);
  const rewardRisk = finite(input.reward_risk);
  const persistence = input.persistence || {};
  const killSwitch = input.kill_switch === true;
  const errors = [];

  if (!ACTIONS.has(action)) errors.push('invalid_action');
  if (!input.asset || !String(input.asset).trim()) errors.push('asset_required');
  if (!input.thesis || typeof input.thesis !== 'object') errors.push('thesis_required');
  if (!input.macro_context || typeof input.macro_context !== 'object') errors.push('macro_context_required');
  if (input.execution_enabled === true) errors.push('shadow_engine_cannot_enable_execution');

  if (action === 'BUY') {
    if (evidenceFamilies.length < 3) errors.push('buy_requires_three_independent_evidence_families');
    if (rewardRisk == null || rewardRisk < 2) errors.push('buy_requires_reward_risk_at_least_2');
    if (evidenceFamilies.length === 1 && evidenceFamilies[0] === 'fundamentals') {
      errors.push('defi_fundamentals_cannot_create_buy_signal');
    }
  }

  if (['REDUCE', 'SELL', 'MOVE_TO_USD'].includes(action) && !killSwitch) {
    if (evidenceFamilies.length < 2) errors.push('defensive_change_requires_two_independent_evidence_families');
    if (persistence.confirmed !== true) errors.push('defensive_change_requires_persistence_confirmation');
    if (evidenceFamilies.length === 1 && evidenceFamilies[0] === 'structure') {
      errors.push('price_or_structure_break_alone_cannot_force_usd');
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      ...input,
      action,
      asset: String(input.asset || '').trim().toUpperCase(),
      evidence_families: evidenceFamilies,
      reward_risk: rewardRisk,
      execution_enabled: false,
      mode: 'shadow_only'
    }
  };
}

export const SHADOW_ACTIONS = Object.freeze([...ACTIONS]);
export const SHADOW_EVIDENCE_FAMILIES = Object.freeze([...EVIDENCE_FAMILIES]);
