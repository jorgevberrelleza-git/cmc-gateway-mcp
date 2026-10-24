function actionDirection(action) {
  const a = String(action || '').toUpperCase();
  if (a === 'BUY') return 1;
  if (['REDUCE', 'SELL', 'MOVE_TO_USD'].includes(a)) return -1;
  return 0;
}

function hours(a, b) {
  const x = Date.parse(a), y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.abs(y - x) / 3_600_000;
}

export function analyzeDecisionDrift(decisions = [], {
  reversal_window_hours = 24,
  max_non_hold_per_24h = 3
} = {}) {
  const ordered = [...decisions]
    .filter(x => x?.created_at && x?.asset)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  const events = [];
  const byAsset = new Map();
  for (const d of ordered) {
    const asset = String(d.asset).toUpperCase();
    if (!byAsset.has(asset)) byAsset.set(asset, []);
    byAsset.get(asset).push(d);
  }

  for (const [asset, rows] of byAsset.entries()) {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1], curr = rows[i];
      const gap = hours(prev.created_at, curr.created_at);
      const prevDir = actionDirection(prev.action || prev.decision_type);
      const currDir = actionDirection(curr.action || curr.decision_type);
      if (gap != null && gap <= reversal_window_hours && prevDir !== 0 && currDir !== 0 && prevDir !== currDir) {
        events.push({
          asset,
          event_type: 'rapid_direction_reversal',
          severity: gap <= 6 ? 'warning' : 'info',
          details: {
            previous_action: prev.action || prev.decision_type,
            current_action: curr.action || curr.decision_type,
            hours_between: gap,
            previous_decision_key: prev.decision_key,
            current_decision_key: curr.decision_key
          }
        });
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const start = Date.parse(rows[i].created_at);
      const windowRows = rows.filter(r => {
        const t = Date.parse(r.created_at);
        return t >= start && t <= start + 24 * 3_600_000 && actionDirection(r.action || r.decision_type) !== 0;
      });
      if (windowRows.length > max_non_hold_per_24h) {
        events.push({
          asset,
          event_type: 'excessive_action_frequency',
          severity: 'warning',
          details: {
            non_hold_actions_24h: windowRows.length,
            threshold: max_non_hold_per_24h,
            window_start: rows[i].created_at
          }
        });
        break;
      }
    }
  }

  const reversalCount = events.filter(x => x.event_type === 'rapid_direction_reversal').length;
  return {
    ok: events.every(x => x.severity !== 'critical'),
    event_count: events.length,
    reversal_count: reversalCount,
    warning_count: events.filter(x => x.severity === 'warning').length,
    events
  };
}
