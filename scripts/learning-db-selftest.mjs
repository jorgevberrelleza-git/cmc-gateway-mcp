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

  const byId = await store.getSnapshotById(savedSnapshot.id);
  assert.equal(Number(byId.id), Number(savedSnapshot.id));

  const nearest = await store.nearestSnapshot(snapshot.generated_at, 60 * 60 * 1000);
  assert.equal(Number(nearest.id), Number(savedSnapshot.id));

  const queued = await store.enqueueDecisionReview({
    snapshotId: savedSnapshot.id,
    queueKey: `db-selftest:${savedSnapshot.id}`,
    priority: 75,
    materialEvent: { material: true, reasons: ['BTC:price_move_3.00pct'] }
  });
  assert.equal(queued.status, 'pending');

  const claimed = await store.claimNextDecisionQueue(3);
  assert.equal(Number(claimed.id), Number(queued.id));
  assert.equal(claimed.status, 'processing');
  assert.equal(Number(claimed.attempt_count), 1);

  const reasoningRun = await store.startReasoningRun({
    queueId: claimed.id,
    provider: 'mock',
    model: 'mock',
    requestPacket: { queue_id: claimed.id, execution_enabled: false }
  });
  assert.equal(reasoningRun.status, 'started');

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

  const sameDecision = await store.getDecisionByKey(`DBTEST-${savedSnapshot.id}`);
  assert.equal(Number(sameDecision.id), Number(decision.id));

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

  const duplicateOrder = await store.savePaperOrder({
    decisionId: decision.id,
    symbol: 'BTC',
    side: 'buy',
    quantity: 0.002,
    notionalUsd: 160,
    referencePriceUsd: 80000
  });
  assert.equal(duplicateOrder, undefined);

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

  const pointInTimeMark = await store.portfolioMarkAtOrBefore(snapshot.generated_at);
  assert.equal(Number(pointInTimeMark.id), Number(mark.id));

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

  const finishedRun = await store.finishReasoningRun(reasoningRun.id, {
    status: 'completed',
    responsePayload: { output: { proposals: [{ asset: 'BTC', action: 'HOLD' }] } },
    validationSummary: [{ accepted: true }],
    acceptedDecisionIds: [decision.id],
    rejectedProposals: [],
    usage: { input_tokens: 10, output_tokens: 5 }
  });
  assert.equal(finishedRun.status, 'completed');

  const runs = await store.listReasoningRuns({ limit: 10 });
  assert.ok(runs.some(x => Number(x.id) === Number(reasoningRun.id)));

  const done = await store.finishQueueItem(claimed.id, { status: 'processed', decisionId: decision.id });
  assert.equal(done.status, 'processed');

  const filteredDecisions = await store.listDecisions({
    from: new Date(Date.parse(snapshot.generated_at) - 60_000).toISOString(),
    to: new Date(Date.parse(snapshot.generated_at) + 60_000).toISOString(),
    limit: 20
  });
  assert.ok(filteredDecisions.some(x => Number(x.id) === Number(decision.id)));

  const filteredWatchdog = await store.listWatchdogEvents({
    from: new Date(Date.parse(snapshot.generated_at) - 60_000).toISOString(),
    to: new Date(Date.parse(snapshot.generated_at) + 60_000).toISOString(),
    limit: 20
  });
  assert.ok(filteredWatchdog.some(x => Number(x.id) === Number(watchdog.id)));

  const cycleKey = `db-selftest-cycle-${savedSnapshot.id}`;
  const runtimeCycle = await store.saveRuntimeCycle({
    cycleKey,
    startedAt: snapshot.generated_at,
    completedAt: new Date(Date.parse(snapshot.generated_at) + 1000).toISOString(),
    status: 'success',
    durationMs: 1000,
    steps: [{ name: 'selftest', ok: true, duration_ms: 1000 }],
    configFingerprint: 'db-selftest'
  });
  assert.ok(runtimeCycle.id);
  assert.equal(runtimeCycle.execution_enabled, false);

  const cycles = await store.recentRuntimeCycles(10);
  assert.ok(cycles.some(x => x.cycle_key === cycleKey));

  // Regression guard for Postgres $1 placeholders in shadow-v2-bootstrap.
  const noFilterEvaluations = await store.listShadowV2Evaluations({ limit: 1 });
  assert.ok(Array.isArray(noFilterEvaluations));
  const filteredEvaluations = await store.listShadowV2Evaluations({
    from: new Date(Date.parse(snapshot.generated_at) - 60_000).toISOString(),
    to: new Date(Date.parse(snapshot.generated_at) + 60_000).toISOString(),
    limit: 2
  });
  assert.ok(Array.isArray(filteredEvaluations));


  // GEO v0.2 integration: migrations, on-conflict dedupe, no trade execution.
  const geoKey = `geo-db-selftest-${savedSnapshot.id}`;
  const geoEvent = await store.pool.query(
    `insert into learning_geo_events
      (event_key,source_id,article_url,title,published_at,topic,severity,execution_enabled)
     values($1,'fed_monetary','https://www.federalreserve.gov/test','Test macro statement',$2,'monetary_policy','low',false)
     on conflict(event_key) do nothing returning event_key`,
    [geoKey,snapshot.generated_at]
  );
  assert.equal(geoEvent.rowCount,1);
  // Regression: low-severity official documents remain eligible for a
  // bounded quality audit when no high/medium events are pending.
  const geoDocumentAuditCandidate=await store.pool.query(
    `select event_key from learning_geo_events
     where document_status='not_checked'
       and severity in ('high','medium','low')
       and first_seen_at >= $1
     order by case severity when 'high' then 0 when 'medium' then 1 else 2 end,
              first_seen_at desc limit 2`,
    [new Date(Date.parse(snapshot.generated_at)-4*86400000).toISOString()]
  );
  assert.ok(geoDocumentAuditCandidate.rows.some(x=>x.event_key===geoKey));
  const geoCalendar=await store.pool.query(
    `insert into learning_geo_calendar(event_key,source_id,title,scheduled_at,category,execution_enabled)
     values($1,'bls_releases','Test scheduled CPI',$2,'us_cpi',false) returning event_key`,
    [geoKey,snapshot.generated_at]
  );
  assert.equal(geoCalendar.rowCount,1);
  const geoOutcome=await store.pool.query(
    `insert into learning_geo_market_outcomes
      (event_key,asset,horizon,baseline_snapshot_id,later_snapshot_id,baseline_at,later_at,signed_return_pct,abs_return_pct,execution_enabled)
     values($1,'BTC','1h',$2,$2,$3,$3,0,0,false) returning execution_enabled`,
    [geoKey,savedSnapshot.id,snapshot.generated_at]
  );
  assert.equal(geoOutcome.rows[0].execution_enabled,false);
  const geoDuplicate=await store.pool.query(
    `insert into learning_geo_market_outcomes
      (event_key,asset,horizon,baseline_snapshot_id,later_snapshot_id,baseline_at,later_at,signed_return_pct,abs_return_pct,execution_enabled)
     values($1,'BTC','1h',$2,$2,$3,$3,0,0,false) on conflict do nothing returning event_key`,
    [geoKey,savedSnapshot.id,snapshot.generated_at]
  );
  assert.equal(geoDuplicate.rowCount,0);

  const stats = await store.databaseStats();
  assert.ok(stats.tables.learning_snapshots >= 1);
  assert.ok(stats.tables.learning_runtime_cycles >= 1);
  assert.ok(stats.database_bytes > 0);

  const queued2 = await store.enqueueDecisionReview({
    snapshotId: savedSnapshot.id,
    queueKey: `db-selftest-release:${savedSnapshot.id}`,
    priority: 74,
    materialEvent: { material: true, reasons: ['BTC:spot_delta_25'] }
  });
  assert.equal(queued2.status, 'pending');
  const claimed2 = await store.claimNextDecisionQueue(3);
  assert.equal(Number(claimed2.id), Number(queued2.id));
  assert.equal(Number(claimed2.attempt_count), 1);
  const released = await store.releaseQueueItem(claimed2.id, { errorMessage: 'transient_test' });
  assert.equal(released.status, 'pending');

  console.log('learning-db-selftest: ok');
} finally {
  await store.close();
}
