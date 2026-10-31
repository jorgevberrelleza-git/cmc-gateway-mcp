import { createLearningStore } from '../src/learning/storage.mjs';
import { evaluateShadowV2 } from '../src/learning/shadow-v2.mjs';

const store = createLearningStore();
const hours = Math.max(1, Math.min(24 * 30, Number(process.env.LEARNING_V2_REPLAY_HOURS || 72)));
const to = new Date();
const from = new Date(to.getTime() - hours * 3_600_000);

try {
  const rows = await store.snapshotsBetween(from.toISOString(), to.toISOString(), 5000);
  const summary = {
    strategy_version: 'shadow_v0.2',
    from: from.toISOString(),
    to: to.toISOString(),
    snapshots: rows.length,
    saved: 0,
    material: 0,
    external_research_triggers: 0,
    consistency_blocking: 0,
    postures: {},
    execution_enabled: false
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const recent = rows.slice(Math.max(0, i - 7), i + 1);
    const evaluation = evaluateShadowV2({ snapshotRow: row, recentSnapshots: recent });
    const saved = await store.saveShadowV2Evaluation(evaluation);
    if (saved) summary.saved += 1;
    if (row.material_event?.material === true) summary.material += 1;
    if (evaluation.external_research_trigger.required) summary.external_research_triggers += 1;
    if (evaluation.consistency.blocking) summary.consistency_blocking += 1;

    for (const item of Object.values(evaluation.assets)) {
      summary.postures[item.posture] = (summary.postures[item.posture] || 0) + 1;
    }
  }

  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
} finally {
  await store.close();
}
