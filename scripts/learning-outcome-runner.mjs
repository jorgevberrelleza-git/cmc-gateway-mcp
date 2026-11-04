import { dueHorizons, OUTCOME_HORIZONS_MS, evaluateSpotDecisionOutcome } from '../src/learning/outcome-evaluator.mjs';
import { extractUsdPrices } from '../src/learning/features.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

const TOLERANCE_MS = Object.freeze({
  '4h': 2 * 60 * 60 * 1000,
  '24h': 4 * 60 * 60 * 1000,
  '7d': 12 * 60 * 60 * 1000,
  '30d': 24 * 60 * 60 * 1000
});

const store = createLearningStore();
const now = new Date();

try {
  const candidates = await store.outcomeCandidates(Number(process.env.LEARNING_OUTCOME_LIMIT || 200));
  const summary = { candidates: candidates.length, evaluated: 0, waiting_for_mark: 0, skipped: 0, errors: [] };

  for (const row of candidates) {
    try {
      const evaluated = await store.evaluatedHorizons(row.id);
      const due = dueHorizons(row.created_at, evaluated, now);
      if (!due.length) continue;

      const asset = String(row.asset || row.order_symbol || '').toUpperCase();
      const action = String(row.action || row.decision_type || '').toUpperCase();
      const decisionPrices = extractUsdPrices(row.decision_snapshot_payload || {});
      const referencePrice = Number(row.reference_price_usd) || Number(decisionPrices[asset]);
      if (!asset || !Number.isFinite(referencePrice) || referencePrice <= 0) {
        summary.skipped += due.length;
        continue;
      }

      for (const horizon of due) {
        const targetMs = Date.parse(row.created_at) + OUTCOME_HORIZONS_MS[horizon];
        const targetTime = new Date(targetMs).toISOString();
        const mark = await store.nearestSnapshot(targetTime, TOLERANCE_MS[horizon]);
        if (!mark) {
          summary.waiting_for_mark += 1;
          continue;
        }
        const currentPrice = Number(extractUsdPrices(mark.payload || {})[asset]);
        if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
          summary.waiting_for_mark += 1;
          continue;
        }

        const notional = Number(row.notional_usd) || 0;
        const slippageUsd = notional * Math.max(0, Number(row.estimated_slippage_bps) || 0) / 10_000;
        const outcome = evaluateSpotDecisionOutcome({
          action,
          reference_price_usd: referencePrice,
          current_price_usd: currentPrice,
          estimated_fee_usd: Number(row.estimated_fee_usd) || 0,
          estimated_slippage_usd: slippageUsd,
          notional_usd: notional
        });

        const saved = await store.saveOutcome({
          decisionId: row.id,
          paperOrderId: row.paper_order_id ?? null,
          markSnapshotId: mark.id,
          horizon,
          targetTime,
          evaluatedAt: now.toISOString(),
          assetReturnPct: outcome.asset_return_pct,
          strategyReturnPct: outcome.strategy_return_pct,
          holdReturnPct: outcome.hold_return_pct,
          usdReturnPct: outcome.usd_return_pct,
          alphaVsHoldPct: outcome.alpha_vs_hold_pct,
          notes: {
            reference_price_usd: referencePrice,
            mark_price_usd: currentPrice,
            mark_generated_at: mark.generated_at,
            estimated_cost_pct: outcome.estimated_cost_pct,
            evaluator: 'spot_decision_v0.1',
            portfolio_effect_measured_separately: true
          }
        });
        if (saved) summary.evaluated += 1;
      }
    } catch (error) {
      summary.errors.push({ decision_id: row.id, error: error?.message || String(error) });
    }
  }

  console.log(JSON.stringify({ ok: summary.errors.length === 0, ...summary, execution_enabled: false }));
} finally {
  await store.close();
}
