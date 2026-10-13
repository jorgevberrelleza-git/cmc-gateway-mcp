const DEFENSIVE = new Set(['REDUCE','SELL','MOVE_TO_USD']);

export function scoreDecisionQuality({
  action,
  validation_ok = false,
  evidence_families = [],
  reward_risk = null,
  persistence = null,
  macro_context_valid = false,
  source_conflict = false,
  data_confidence = null
} = {}) {
  const normalizedAction = String(action || '').toUpperCase();
  const families = [...new Set((Array.isArray(evidence_families) ? evidence_families : []).map(x => String(x).toLowerCase()))];
  let score = 0;
  const components = {};

  components.contract = validation_ok ? 20 : 0;
  score += components.contract;

  components.evidence = Math.min(30, families.length * 10);
  score += components.evidence;

  if (normalizedAction === 'BUY') {
    const rr = Number(reward_risk);
    components.setup = Number.isFinite(rr) && rr >= 2 ? Math.min(20, 10 + (rr - 2) * 5) : 0;
  } else if (DEFENSIVE.has(normalizedAction)) {
    components.setup = persistence?.confirmed === true ? 20 : 0;
  } else {
    components.setup = 15;
  }
  score += components.setup;

  components.macro = macro_context_valid ? 10 : 0;
  score += components.macro;

  const confidence = Number(data_confidence);
  components.data = Number.isFinite(confidence) ? Math.max(0, Math.min(10, confidence / 10)) : 5;
  score += components.data;

  components.source_conflict_penalty = source_conflict ? -15 : 0;
  score += components.source_conflict_penalty;

  const bounded = Math.max(0, Math.min(100, Number(score.toFixed(1))));
  return {
    score_0_100: bounded,
    classification: bounded >= 80 ? 'strong_process'
      : bounded >= 65 ? 'acceptable_process'
      : bounded >= 50 ? 'weak_process'
      : 'insufficient_process',
    components,
    methodology: 'process_quality_v0.1_not_return_prediction'
  };
}
