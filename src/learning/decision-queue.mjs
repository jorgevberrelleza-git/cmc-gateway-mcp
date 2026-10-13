function severityScore(materialEvent = {}) {
  let score = 50;
  for (const reason of materialEvent.reasons || []) {
    const text = String(reason);
    if (text.includes('gate_')) score += 10;
    if (text.includes('trap_delta_')) score += 8;
    if (text.includes('fundamental_quality_delta_')) score += 8;
    const price = text.match(/price_move_(-?\d+(?:\.\d+)?)pct/);
    if (price) score += Math.min(20, Math.abs(Number(price[1])) * 2);
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function buildDecisionQueueItem(snapshotRow, materialEvent) {
  if (!snapshotRow?.id) throw new Error('snapshot_id_required');
  if (!materialEvent?.material) return null;
  const queueKey = `snapshot:${snapshotRow.id}:material`;
  return {
    snapshot_id: snapshotRow.id,
    queue_key: queueKey,
    priority: severityScore(materialEvent),
    status: 'pending',
    material_event: materialEvent
  };
}

export function shouldEscalateQueueItem(item = {}) {
  if (item.status !== 'pending') return false;
  return Number(item.priority || 0) >= 70;
}
