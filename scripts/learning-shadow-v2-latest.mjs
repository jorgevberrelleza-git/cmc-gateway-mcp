import { createLearningStore } from '../src/learning/storage.mjs';
import { evaluateShadowV2 } from '../src/learning/shadow-v2.mjs';

const store = createLearningStore();

try {
  const latest = await store.latestSnapshot();
  if (!latest) throw new Error('no_snapshot_available_for_v02');

  const recentDesc = await store.recentSnapshots(8);
  const recent = [...recentDesc].reverse().filter(x => Date.parse(x.generated_at) <= Date.parse(latest.generated_at));
  const evaluation = evaluateShadowV2({ snapshotRow: latest, recentSnapshots: recent });
  const saved = await store.saveShadowV2Evaluation(evaluation);

  console.log(JSON.stringify({
    ok: true,
    snapshot_id: latest.id,
    saved: Boolean(saved),
    strategy_version: evaluation.strategy_version,
    regime: evaluation.regime.crypto_regime,
    consistency_score: evaluation.consistency.score_0_100,
    consistency_blocking: evaluation.consistency.blocking,
    asset_postures: Object.fromEntries(Object.entries(evaluation.assets).map(([k,v]) => [k, v.posture])),
    external_research_trigger: evaluation.external_research_trigger,
    execution_enabled: false
  }));
} finally {
  await store.close();
}
