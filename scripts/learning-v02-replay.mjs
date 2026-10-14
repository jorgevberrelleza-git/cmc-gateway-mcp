import { createLearningStore } from '../src/learning/storage.mjs';
import { detectMaterialEvent } from '../src/learning/event-detector.mjs';
import { evaluateShadowV02 } from '../src/learning/shadow-v02-evaluator.mjs';

const hours = Math.max(2, Math.min(24 * 14, Number(process.env.LEARNING_V02_REPLAY_HOURS || 48)));
const to = new Date();
const from = new Date(to.getTime() - hours * 3600000);
const store = createLearningStore();

try {
  const snapshots = await store.snapshotsBetween(from.toISOString(), to.toISOString(), 5000);
  const rows = [];
  const regimeCounts = {};
  let v01Material = 0;
  let v02ResearchCandidates = 0;
  let v02FilteredContext = 0;
  let consistencyBlocks = 0;
  let consistencyWarnings = 0;

  for (let i = 1; i < snapshots.length; i += 1) {
    const previous = snapshots[i - 1];
    const current = snapshots[i];
    const event = detectMaterialEvent(previous.payload, current.payload);
    const evaluation = evaluateShadowV02({ snapshot: current.payload, materialEvent: event });

    if (event.material) v01Material += 1;
    if (evaluation.event_quality.research_candidate) v02ResearchCandidates += 1;
    if (evaluation.event_quality.low_signal_context_only) v02FilteredContext += 1;
    consistencyBlocks += Number(evaluation.regime_evidence.data_consistency.block_count || 0);
    consistencyWarnings += Number(evaluation.regime_evidence.data_consistency.warning_count || 0);

    const regime = evaluation.regime_evidence.crypto_regime.classification || 'unknown';
    regimeCounts[regime] = (regimeCounts[regime] || 0) + 1;

    rows.push({
      snapshot_id: current.id,
      generated_at: current.generated_at,
      v01_material: event.material,
      v01_reason_count: event.reasons.length,
      v02_quality_score: evaluation.event_quality.quality_score_0_100,
      v02_evidence_families: evaluation.event_quality.evidence_families,
      v02_research_candidate: evaluation.event_quality.research_candidate,
      v02_action: evaluation.shadow_action,
      crypto_regime: regime,
      consistency_confidence: evaluation.regime_evidence.data_consistency.confidence_0_100,
      catalyst_risk: evaluation.regime_evidence.news_catalyst_gate.near_term_catalyst_risk
    });
  }

  const comparable = Math.max(0, snapshots.length - 1);
  console.log(JSON.stringify({
    ok: true,
    contract_version: 'shadow_v0.2_replay_report',
    period: { from: from.toISOString(), to: to.toISOString(), hours },
    snapshots: snapshots.length,
    comparable_transitions: comparable,
    v01_material_events: v01Material,
    v01_material_rate_pct: comparable ? Number((100 * v01Material / comparable).toFixed(2)) : null,
    v02_research_candidates: v02ResearchCandidates,
    v02_research_candidate_rate_pct: comparable ? Number((100 * v02ResearchCandidates / comparable).toFixed(2)) : null,
    v02_filtered_low_signal_context: v02FilteredContext,
    data_consistency: { block_count_total: consistencyBlocks, warning_count_total: consistencyWarnings },
    crypto_regime_counts: regimeCounts,
    rows,
    external_calls_made: 0,
    paid_ai_calls_made: 0,
    execution_enabled: false
  }, null, 2));
} finally {
  await store.close();
}
