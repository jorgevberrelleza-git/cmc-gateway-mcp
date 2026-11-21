// Shadow v0.2: classify v0.1 material events by independent evidence families.
// This does not change v0.1 thresholds and never creates a trade signal.

function familyForReason(reason = '') {
  const r = String(reason);
  if (r.includes(':price_move_')) return 'price';
  if (r.includes(':trap_delta_')) return 'trap';
  if (r.includes(':spot_delta_')) return 'spot';
  if (r.includes(':wall_delta_')) return 'wall';
  if (r.includes(':fundamental_quality_delta_')) return 'fundamental';
  if (r.includes(':gate_')) return 'gate';
  return 'other';
}

export function assessEventQuality(materialEvent = {}) {
  const reasons = Array.isArray(materialEvent?.reasons) ? materialEvent.reasons : [];
  const families = [...new Set(reasons.map(familyForReason).filter(Boolean))];
  const meaningful = families.filter(x => x !== 'other');
  const has = name => meaningful.includes(name);

  // v0.2 treats wall/trap/gate-only changes as context, not escalation.
  // Stronger escalation requires cross-family confirmation.
  let score = 0;
  score += has('price') ? 30 : 0;
  score += has('spot') ? 20 : 0;
  score += has('fundamental') ? 20 : 0;
  score += has('trap') ? 10 : 0;
  score += has('wall') ? 8 : 0;
  score += has('gate') ? 7 : 0;
  score += Math.min(15, Math.max(0, meaningful.length - 1) * 5);
  score = Math.min(100, score);

  const independentConfirmation =
    (has('price') && meaningful.length >= 2) ||
    meaningful.length >= 3 ||
    (has('fundamental') && (has('spot') || has('price')));

  const researchCandidate = materialEvent?.material === true
    && independentConfirmation
    && score >= 45;

  return {
    contract_version: 'event_quality_v0.2',
    material_v01: materialEvent?.material === true,
    reasons,
    evidence_families: meaningful,
    independent_family_count: meaningful.length,
    quality_score_0_100: score,
    research_candidate: researchCandidate,
    low_signal_context_only: materialEvent?.material === true && !researchCandidate,
    policy: 'cross_family_confirmation_without_rethresholding_v01',
    execution_enabled: false
  };
}
