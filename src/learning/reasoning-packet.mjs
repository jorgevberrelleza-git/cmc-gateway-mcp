import { extractLearningFeatures } from './features.mjs';
import { persistenceObservationsFromSnapshots } from './evidence.mjs';
import { evaluateDefensivePersistence } from './persistence.mjs';

function compactDecision(row = {}) {
  return {
    decision_key: row.decision_key ?? null,
    asset: row.asset ?? null,
    action: row.action ?? row.decision_type ?? null,
    status: row.status ?? null,
    created_at: row.created_at ?? null,
    thesis: row.thesis ?? null
  };
}

function compactWatchdog(row = {}) {
  return {
    detected_at: row.detected_at ?? null,
    asset: row.asset ?? null,
    event_type: row.event_type ?? null,
    severity: row.severity ?? null,
    details: row.details ?? null
  };
}

export function buildReasoningPacket({
  queueItem,
  snapshotRow,
  recentSnapshots = [],
  latestPortfolioMark = null,
  recentDecisions = [],
  watchdogEvents = []
} = {}) {
  if (!queueItem?.id) throw new Error('queue_item_required');
  if (!snapshotRow?.id) throw new Error('snapshot_row_required');

  const current = extractLearningFeatures(snapshotRow.payload || {});
  const materialAssets = [...new Set((queueItem.material_event?.reasons || [])
    .map(x => String(x).split(':')[0].toUpperCase())
    .filter(Boolean))];

  const persistence = {};
  for (const asset of materialAssets) {
    const observations = persistenceObservationsFromSnapshots(recentSnapshots, asset);
    persistence[asset] = evaluateDefensivePersistence(observations);
  }

  return {
    contract_version: 'reasoning_packet_v0.1',
    queue: {
      id: queueItem.id,
      queue_key: queueItem.queue_key,
      priority: Number(queueItem.priority),
      created_at: queueItem.created_at,
      material_event: queueItem.material_event
    },
    market: {
      current_snapshot_id: snapshotRow.id,
      generated_at: snapshotRow.generated_at,
      snapshot_version: snapshotRow.snapshot_version,
      current_features: current,
      recent_observations: recentSnapshots.slice(-8).map(row => ({
        snapshot_id: row.id,
        generated_at: row.generated_at,
        material_event: row.material_event,
        features: extractLearningFeatures(row.payload || {})
      }))
    },
    portfolio: latestPortfolioMark ? {
      marked_at: latestPortfolioMark.marked_at,
      total_value_usd: Number(latestPortfolioMark.total_value_usd),
      cash_usd: Number(latestPortfolioMark.cash_usd),
      positions: latestPortfolioMark.positions,
      shadow_return_pct: Number(latestPortfolioMark.shadow_return_pct),
      hodl_return_pct: Number(latestPortfolioMark.hodl_return_pct),
      alpha_vs_hodl_pct: Number(latestPortfolioMark.alpha_vs_hodl_pct),
      drawdown_pct: Number(latestPortfolioMark.drawdown_pct)
    } : null,
    recent_decisions: recentDecisions.slice(-12).map(compactDecision),
    watchdog: watchdogEvents.slice(-12).map(compactWatchdog),
    deterministic_persistence_by_asset: persistence,
    policy: {
      objective: 'maximize_expected_compound_growth_subject_to_drawdown_and_risk_of_ruin_constraints',
      shadow_only: true,
      execution_enabled: false,
      price_decline_alone_cannot_force_usd: true,
      buy_requires_three_independent_evidence_families: true,
      buy_min_reward_risk: 2,
      defensive_change_requires_persistence: true,
      macro_regime_gate_required_for_position_change: true,
      missing_or_unverified_context_should_bias_to_hold: true
    }
  };
}
