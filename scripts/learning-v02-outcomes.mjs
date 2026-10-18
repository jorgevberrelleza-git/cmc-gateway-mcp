import { createLearningStore } from '../src/learning/storage.mjs';
import { detectMaterialEvent } from '../src/learning/event-detector.mjs';
import { assessEventQuality } from '../src/learning/event-quality-v02.mjs';
import { V02_OUTCOME_HORIZONS_MS, evaluateEventOutcomeV02, summarizeOutcomeCohorts } from '../src/learning/outcome-validation-v02.mjs';

const hours = Math.max(24, Math.min(24 * 14, Number(process.env.LEARNING_V02_OUTCOME_HOURS || 96)));
const now = new Date();
const from = new Date(now.getTime() - hours * 3600000);
const store = createLearningStore();

try {
  const snapshots = await store.snapshotsBetween(from.toISOString(), now.toISOString(), 5000);
  const report = {};
  for (const horizon of Object.keys(V02_OUTCOME_HORIZONS_MS)) report[horizon] = [];

  for (let i = 1; i < snapshots.length; i += 1) {
    const previous = snapshots[i - 1], current = snapshots[i];
    const event = detectMaterialEvent(previous.payload, current.payload);
    if (!event.material) continue;
    const eventQuality = assessEventQuality(event);

    for (const [horizon, ms] of Object.entries(V02_OUTCOME_HORIZONS_MS)) {
      const target = new Date(Date.parse(current.generated_at) + ms);
      if (target > now) continue;
      const later = await store.nearestSnapshot(target.toISOString(), Math.min(ms / 2, 90 * 60 * 1000));
      if (!later) continue;
      const outcome = evaluateEventOutcomeV02({
        eventSnapshot: current.payload,
        laterSnapshot: later.payload,
        materialEvent: event
      });
      report[horizon].push({
        snapshot_id: current.id,
        generated_at: current.generated_at,
        later_snapshot_id: later.id,
        research_candidate: eventQuality.research_candidate,
        quality_score: eventQuality.quality_score_0_100,
        max_abs_return_pct: outcome.max_abs_return_pct,
        assets: outcome.assets
      });
    }
  }

  const summary = Object.fromEntries(Object.entries(report).map(([h, rows]) => [h, summarizeOutcomeCohorts(rows)]));
  const coverage = Object.fromEntries(Object.entries(report).map(([h, rows]) => {
    const withPrice = rows.filter(r => Number.isFinite(r.max_abs_return_pct)).length;
    return [h, {
      total_events: rows.length,
      events_with_price: withPrice,
      price_coverage_pct: rows.length ? Number((100 * withPrice / rows.length).toFixed(2)) : null
    }];
  }));

  console.log(JSON.stringify({
    ok: true,
    contract_version: 'shadow_v0.2_outcome_validation_report',
    period: { from: from.toISOString(), to: now.toISOString(), hours },
    summary,
    rows: report,
    external_calls_made: 0,
    paid_ai_calls_made: 0,
    execution_enabled: false
  }, null, 2));

  const compact = {
    ok: true,
    contract_version: 'shadow_v0.2_outcome_compact_v1',
    period_hours: hours,
    coverage,
    horizons: summary,
    external_calls_made: 0,
    paid_ai_calls_made: 0,
    execution_enabled: false
  };
  console.log('V02_COMPACT_SUMMARY=' + JSON.stringify(compact));
} finally {
  await store.close();
}
