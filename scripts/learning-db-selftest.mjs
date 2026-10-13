import assert from 'node:assert/strict';
import { createLearningStore } from '../src/learning/storage.mjs';

const store = createLearningStore();

try {
  const snapshot = {
    snapshot_version: '0.6.2',
    generated_at: new Date().toISOString(),
    assets: ['BTC'],
    quotes: {
      structuredContent: {
        headers: ['symbol','price'],
        rows: [['BTC', 80000]]
      }
    }
  };

  const savedSnapshot = await store.saveSnapshot(snapshot, {
    source: 'db-selftest',
    materialEvent: { material: true, reasons: ['BTC:price_move_3.00pct'] }
  });
  assert.ok(savedSnapshot.id);

  const nearest = await store.nearestSnapshot(snapshot.generated_at, 60 * 60 * 1000);
  assert.equal(Number(nearest.id), Number(savedSnapshot.id));

  const queued = await store.enqueueDecisionReview({
    snapshotId: savedSnapshot.id,
    queueKey: `db-selftest:${savedSnapshot.id}`,
    priority: 75,
    materialEvent: { material: true, reasons: ['BTC:price_move_3.00pct'] }
  });
  assert.equal(queued.status, 'pending');

  const decision = await store.saveDecision({
    decisionKey: `DBTEST-${savedSnapshot.id}`,
    snapshotId: savedSnapshot.id,
    asset: 'BTC',
    action: 'HOLD',
    decisionType: 'HOLD',
    thesis: { reason: 'integration test' },
    riskContext: { execution_enabled: false },
    portfolioContext: { mode: 'shadow' }
  });
  assert.ok(decision.id);

  const order = await store.savePaperOrder({
    decisionId: decision.id,
    symbol: 'BTC',
    side: 'buy',
    quantity: 0.001,
    notionalUsd: 80,
    referencePriceUsd: 80000,
    estimatedFeeUsd: 0.08,
    estimatedSlippageBps: 5
  });
  assert.ok(order.id);

  const unledgered = await store.unledgeredPaperOrders();
  assert.ok(unledgered.some(x => Number(x.id) === Number(order.id)));

  const seedLedger = await store.appendLedgerEvent({
    event_key: 'db-selftest-seed-usd',
    occurred_at: snapshot.generated_at,
    event_type: 'seed',
    symbol: 'USD',
    quantity_delta: 0,
    cash_delta_usd: 1000,
    reference_price_usd: 1,
    fee_usd: 0,
    metadata: { test: true }
  });
  assert.ok(seedLedger.id);

  const mark = await store.savePortfolioMark({
    marked_at: snapshot.generated_at,
    snapshot_id: savedSnapshot.id,
    total_value_usd: 1000,
    cash_usd: 1000,
    positions: {},
    prices: { BTC: 80000 },
    shadow_return_pct: 0,
    hodl_value_usd: 1000,
    hodl_return_pct: 0,
    usd_value_usd: 1000,
    alpha_vs_hodl_pct: 0,
    drawdown_pct: 0,
    metadata: { test: true }
  });
  assert.ok(mark.id);

  const candidates = await store.outcomeCandidates();
  const candidate = candidates.find(x => Number(x.id) === Number(decision.id));
  assert.ok(candidate);
  assert.equal(candidate.decision_snapshot_payload.snapshot_version, '0.6.2');

  const outcome = await store.saveOutcome({
    decisionId: decision.id,
    paperOrderId: order.id,
    markSnapshotId: savedSnapshot.id,
    horizon: '4h',
    targetTime: snapshot.generated_at,
    assetReturnPct: 1,
    strategyReturnPct: 1,
    holdReturnPct: 1,
    usdReturnPct: 0,
    alphaVsHoldPct: 0,
    notes: { test: true }
  });
  assert.ok(outcome.id);

  const watchdog = await store.saveWatchdogEvent({
    detected_at: snapshot.generated_at,
    asset: 'BTC',
    event_type: 'db_selftest',
    severity: 'info',
    details: { test: true }
  });
  assert.ok(watchdog.id);

  const done = await store.finishQueueItem(queued.id, { status: 'processed', decisionId: decision.id });
  assert.equal(done.status, 'processed');

  console.log('learning-db-selftest: ok');
} finally {
  await store.close();
}
