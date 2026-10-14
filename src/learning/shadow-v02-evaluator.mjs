import { buildRegimeEvidencePacket } from './regime-evidence.mjs';
import { assessEventQuality } from './event-quality-v02.mjs';

export function evaluateShadowV02({ snapshot = {}, materialEvent = {}, verifiedResearch = null } = {}) {
  const eventQuality = assessEventQuality(materialEvent);
  const regime = buildRegimeEvidencePacket(snapshot, {
    referenceTime: snapshot?.generated_at,
    verifiedResearch
  });

  const consistency = regime.data_consistency;
  const catalyst = regime.news_catalyst_gate;
  const nearTermCatalyst = catalyst?.near_term_catalyst_risk === 'elevated_unverified';
  const researchRequired = eventQuality.research_candidate || nearTermCatalyst;

  const blockers = [];
  if (consistency?.position_change_allowed !== true) blockers.push('data_consistency_not_clean');
  if (regime?.decision_gate?.eligible_for_exposure_change !== true) blockers.push('macro_regime_not_attested');
  if (verifiedResearch == null && researchRequired) blockers.push('authoritative_catalyst_research_not_attested');

  return {
    contract_version: 'shadow_v0.2_evaluation',
    generated_at: snapshot?.generated_at ?? null,
    event_quality: eventQuality,
    regime_evidence: regime,
    research_required: researchRequired,
    shared_research_cache_key: researchRequired
      ? ['v02', snapshot?.generated_at || 'unknown', ...eventQuality.evidence_families].join(':')
      : null,
    exposure_change_eligible: blockers.length === 0,
    blockers,
    shadow_action: blockers.length ? 'HOLD_WAIT' : 'ELIGIBLE_FOR_REASONED_REVIEW',
    external_calls_made: 0,
    paid_ai_calls_made: 0,
    execution_enabled: false
  };
}
