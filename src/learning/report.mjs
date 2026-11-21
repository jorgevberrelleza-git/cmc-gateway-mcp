export function buildLearningReport({
  from,
  to,
  snapshots = [],
  queue = [],
  decisions = [],
  outcomes = [],
  portfolioMarks = [],
  watchdogEvents = []
} = {}) {
  const materialSnapshots = snapshots.filter(x => x?.material_event?.material === true);
  const pending = queue.filter(x => x.status === 'pending');
  const latestMark = portfolioMarks[0] || null;
  const outcomeAlpha = outcomes.map(x => Number(x.alpha_vs_hold_pct)).filter(Number.isFinite);
  const avgAlpha = outcomeAlpha.length ? outcomeAlpha.reduce((a,b)=>a+b,0) / outcomeAlpha.length : null;

  return {
    period: { from: from ?? null, to: to ?? null },
    snapshots: {
      total: snapshots.length,
      material: materialSnapshots.length,
      non_material: snapshots.length - materialSnapshots.length
    },
    decision_queue: {
      total: queue.length,
      pending: pending.length,
      high_priority_pending: pending.filter(x => Number(x.priority) >= 70).length
    },
    decisions: {
      total: decisions.length,
      non_hold: decisions.filter(x => String(x.action || x.decision_type).toUpperCase() !== 'HOLD').length
    },
    outcomes: {
      total: outcomes.length,
      average_alpha_vs_hold_pct: avgAlpha
    },
    portfolio: latestMark ? {
      marked_at: latestMark.marked_at,
      total_value_usd: Number(latestMark.total_value_usd),
      shadow_return_pct: Number(latestMark.shadow_return_pct),
      hodl_return_pct: Number(latestMark.hodl_return_pct),
      alpha_vs_hodl_pct: Number(latestMark.alpha_vs_hodl_pct),
      drawdown_pct: Number(latestMark.drawdown_pct)
    } : null,
    watchdog: {
      total: watchdogEvents.length,
      warnings: watchdogEvents.filter(x => x.severity === 'warning').length,
      critical: watchdogEvents.filter(x => x.severity === 'critical').length
    },
    execution_enabled: false
  };
}
