import { assessEventQuality } from './event-quality-v02.mjs';

// Filters ONLY mock/research queue noise; raw material events are still saved.
// No exchange orders or paid external research are authorized by this module.
export function classifyResearchQueueEvent(materialEvent = {}, {enabled=false} = {}) {
  const quality = assessEventQuality(materialEvent);
  const reasons = Array.isArray(materialEvent?.reasons) ? materialEvent.reasons.map(String) : [];
  const priorityOverrides = reasons.filter(reason =>
    /:price_move_-?\d+(?:\.\d+)?pct/i.test(reason) ||
    /:fundamental_quality_delta_-?\d+/i.test(reason) ||
    /:gate_[^:]*_to_BLOCK_NEW_ENTRY/i.test(reason) ||
    /:gate_[^:]*_to_[^:]*BLOCK/i.test(reason)
  );
  const unknown = reasons.some(x => !/:(price_move_|trap_delta_|spot_delta_|wall_delta_|fundamental_quality_delta_|gate_)/.test(x));
  const queue = materialEvent?.material === true &&
    (!enabled || quality.research_candidate || priorityOverrides.length > 0 || unknown);
  return {
    version:'research_queue_noise_gate_v0.1',
    enabled:enabled===true,
    should_queue:queue,
    raw_material:materialEvent?.material===true,
    priority_override:priorityOverrides.length>0 || unknown,
    override_reasons:priorityOverrides,
    unknown_reason_preserved:unknown,
    quality_score_0_100:quality.quality_score_0_100,
    evidence_families:quality.evidence_families,
    reason:!materialEvent?.material?'not_material'
      :!enabled?'gate_disabled'
      :queue?'research_candidate_or_critical_override'
      :'context_only_no_independent_confirmation',
    stores_raw_material_event:true,
    execution_enabled:false
  };
}
