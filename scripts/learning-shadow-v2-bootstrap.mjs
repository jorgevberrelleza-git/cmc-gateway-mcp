import { createLearningStore } from '../src/learning/storage.mjs';
import { evaluateShadowV2 } from '../src/learning/shadow-v2.mjs';

const store = createLearningStore();
const hours = Math.max(1, Math.min(24 * 30, Number(process.env.LEARNING_V2_REPLAY_HOURS || 72)));

try {
  const existing = await store.listShadowV2Evaluations({ limit: 1 });
  if (existing.length) {
    console.log(JSON.stringify({
      ok: true,
      bootstrapped: false,
      reason: 'v02_evaluations_already_initialized',
      execution_enabled: false
    }));
  } else {
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3_600_000);
    const rows = await store.snapshotsBetween(from.toISOString(), to.toISOString(), 5000);
    let saved = 0;
    let triggers = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const recent = rows.slice(Math.max(0, i - 7), i + 1);
      const evaluation = evaluateShadowV2({ snapshotRow: row, recentSnapshots: recent });
      if (await store.saveShadowV2Evaluation(evaluation)) saved += 1;
      if (evaluation.external_research_trigger.required) triggers += 1;
    }
    console.log(JSON.stringify({
      ok: true,
      bootstrapped: true,
      replay_hours: hours,
      snapshots_considered: rows.length,
      evaluations_saved: saved,
      external_research_triggers: triggers,
      external_calls_executed: 0,
      execution_enabled: false
    }));
  }
} finally {
  await store.close();
}
