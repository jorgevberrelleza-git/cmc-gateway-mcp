import { analyzeDecisionDrift } from '../src/learning/drift-watchdog.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

const store = createLearningStore();
try {
  const decisions = await store.listDecisions({ limit: Number(process.env.LEARNING_WATCHDOG_DECISION_LIMIT || 500) });
  const result = analyzeDecisionDrift(decisions, {
    reversal_window_hours: Number(process.env.LEARNING_REVERSAL_WINDOW_HOURS || 24),
    max_non_hold_per_24h: Number(process.env.LEARNING_MAX_NON_HOLD_PER_24H || 3)
  });

  let inserted = 0;
  for (const event of result.events) {
    const saved = await store.saveWatchdogEvent({
      ...event,
      detected_at: new Date().toISOString()
    });
    if (saved) inserted += 1;
  }

  console.log(JSON.stringify({
    ok: result.ok,
    decisions_analyzed: decisions.length,
    detected_events: result.event_count,
    inserted_events: inserted,
    reversal_count: result.reversal_count,
    warning_count: result.warning_count,
    execution_enabled: false
  }));
} finally {
  await store.close();
}
