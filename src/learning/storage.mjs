import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

function j(value) {
  return JSON.stringify(value ?? {});
}

export function createLearningStore({ connectionString = process.env.DATABASE_URL } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is required for persistent learning storage');
  const pool = new Pool({ connectionString, ssl: process.env.PGSSL === 'disable' ? false : undefined });

  async function saveSnapshot(snapshot, { source = 'scheduler', materialEvent = null } = {}) {
    const raw = JSON.stringify(snapshot);
    const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
    const generatedAt = snapshot?.generated_at || new Date().toISOString();
    const result = await pool.query(
      `insert into learning_snapshots (generated_at, snapshot_version, source, sha256, payload, material_event)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
       on conflict (sha256) do update set material_event = coalesce(excluded.material_event, learning_snapshots.material_event)
       returning id, sha256, generated_at, payload, material_event`,
      [generatedAt, snapshot?.snapshot_version ?? null, source, sha256, raw, materialEvent ? JSON.stringify(materialEvent) : null]
    );
    return result.rows[0];
  }

  async function latestSnapshot() {
    const result = await pool.query(
      `select id, generated_at, snapshot_version, source, sha256, payload, material_event
       from learning_snapshots order by generated_at desc limit 1`
    );
    return result.rows[0] ?? null;
  }

  async function getSnapshotById(id) {
    const result = await pool.query(
      `select id, generated_at, snapshot_version, source, sha256, payload, material_event
       from learning_snapshots where id = $1 limit 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async function recentSnapshots(limit = 3) {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 3));
    const result = await pool.query(
      `select id, generated_at, snapshot_version, source, sha256, payload, material_event
       from learning_snapshots order by generated_at desc limit $1`,
      [safeLimit]
    );
    return result.rows;
  }

  async function snapshotsBetween(from, to, limit = 1000) {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 1000));
    const result = await pool.query(
      `select id, generated_at, snapshot_version, source, sha256, payload, material_event
       from learning_snapshots
       where generated_at >= $1 and generated_at <= $2
       order by generated_at asc
       limit $3`,
      [from, to, safeLimit]
    );
    return result.rows;
  }

  async function nearestSnapshot(targetTime, toleranceMs) {
    const tolerance = Math.max(60_000, Number(toleranceMs) || 3_600_000);
    const half = Math.round(tolerance / 2);
    const result = await pool.query(
      `select id, generated_at, snapshot_version, source, sha256, payload, material_event
       from learning_snapshots
       where generated_at between ($1::timestamptz - ($2::bigint * interval '1 millisecond'))
                              and ($1::timestamptz + ($2::bigint * interval '1 millisecond'))
       order by abs(extract(epoch from (generated_at - $1::timestamptz))) asc
       limit 1`,
      [targetTime, half]
    );
    return result.rows[0] ?? null;
  }

  async function saveDecision({
    decisionKey,
    snapshotId,
    asset = null,
    action = null,
    decisionType,
    thesis,
    riskContext,
    portfolioContext,
    status = 'shadow'
  }) {
    const result = await pool.query(
      `insert into learning_decisions
        (decision_key, snapshot_id, asset, action, decision_type, status, thesis, risk_context, portfolio_context)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
       on conflict (decision_key) do nothing
       returning id, decision_key, snapshot_id, asset, action, decision_type, status, created_at`,
      [
        decisionKey,
        snapshotId,
        asset ? String(asset).toUpperCase() : null,
        action ? String(action).toUpperCase() : null,
        decisionType,
        status,
        j(thesis),
        j(riskContext),
        j(portfolioContext)
      ]
    );
    return result.rows[0] ?? null;
  }

  async function listDecisions({ from = null, to = null, limit = 1000 } = {}) {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 1000));
    const clauses = [];
    const args = [];
    if (from) { args.push(from); clauses.push(`created_at >= $${args.length}`); }
    if (to) { args.push(to); clauses.push(`created_at <= $${args.length}`); }
    args.push(safeLimit);
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const result = await pool.query(
      `select * from learning_decisions ${where} order by created_at asc limit $${args.length}`,
      args
    );
    return result.rows;
  }

  async function getDecisionByKey(decisionKey) {
    const result = await pool.query(
      `select * from learning_decisions where decision_key = $1 limit 1`,
      [decisionKey]
    );
    return result.rows[0] ?? null;
  }

  async function savePaperOrder({
    decisionId,
    symbol,
    side,
    quantity = null,
    notionalUsd = null,
    referencePriceUsd = null,
    invalidationPriceUsd = null,
    targetPriceUsd = null,
    estimatedFeeUsd = null,
    estimatedSlippageBps = null,
    state = 'proposed'
  }) {
    const result = await pool.query(
      `insert into learning_paper_orders
        (decision_id, symbol, side, quantity, notional_usd, reference_price_usd,
         invalidation_price_usd, target_price_usd, estimated_fee_usd, estimated_slippage_bps, state)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       on conflict (decision_id, symbol) do nothing
       returning *`,
      [
        decisionId, String(symbol || '').toUpperCase(), side, quantity, notionalUsd, referencePriceUsd,
        invalidationPriceUsd, targetPriceUsd, estimatedFeeUsd, estimatedSlippageBps, state
      ]
    );
    return result.rows[0];
  }

  async function paperOrdersForDecision(decisionId) {
    const result = await pool.query(
      `select * from learning_paper_orders where decision_id = $1 order by id asc`,
      [decisionId]
    );
    return result.rows;
  }

  async function unledgeredPaperOrders(limit = 200) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    const result = await pool.query(
      `select po.*
       from learning_paper_orders po
       left join learning_portfolio_ledger l on l.paper_order_id = po.id
       where l.id is null and po.state = 'proposed'
       order by po.created_at asc, po.id asc
       limit $1`,
      [safeLimit]
    );
    return result.rows;
  }

  async function setPaperOrderState(id, state) {
    const result = await pool.query(
      `update learning_paper_orders set state = $2 where id = $1 returning *`,
      [id, state]
    );
    return result.rows[0] ?? null;
  }

  async function enqueueDecisionReview({ snapshotId, queueKey, priority = 50, materialEvent }) {
    const result = await pool.query(
      `insert into learning_decision_queue (snapshot_id, queue_key, priority, material_event)
       values ($1,$2,$3,$4::jsonb)
       on conflict (queue_key) do nothing
       returning *`,
      [snapshotId, queueKey, priority, j(materialEvent)]
    );
    return result.rows[0] ?? null;
  }

  async function listDecisionQueue({ status = null, limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    const result = status
      ? await pool.query(
          `select * from learning_decision_queue where status = $1 order by priority desc, created_at asc limit $2`,
          [status, safeLimit]
        )
      : await pool.query(
          `select * from learning_decision_queue order by created_at asc limit $1`,
          [safeLimit]
        );
    return result.rows;
  }

  async function claimNextDecisionQueue(maxAttempts = 3) {
    const attempts = Math.max(1, Math.min(20, Number(maxAttempts) || 3));
    const client = await pool.connect();
    try {
      await client.query('begin');
      const picked = await client.query(
        `select *
         from learning_decision_queue
         where status = 'pending'
           and attempt_count < $1
         order by priority desc, created_at asc
         for update skip locked
         limit 1`,
        [attempts]
      );
      const row = picked.rows[0];
      if (!row) {
        await client.query('commit');
        return null;
      }
      const updated = await client.query(
        `update learning_decision_queue
         set status = 'processing',
             claimed_at = now(),
             last_attempt_at = now(),
             attempt_count = attempt_count + 1,
             error_message = null
         where id = $1
         returning *`,
        [row.id]
      );
      await client.query('commit');
      return updated.rows[0] ?? null;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function releaseQueueItem(id, { errorMessage = null } = {}) {
    const result = await pool.query(
      `update learning_decision_queue
       set status = 'pending', claimed_at = null, error_message = $2
       where id = $1 and status = 'processing'
       returning *`,
      [id, errorMessage]
    );
    return result.rows[0] ?? null;
  }

  async function requeueStaleDecisionQueue(staleMinutes = 30) {
    const minutes = Math.max(5, Math.min(1440, Number(staleMinutes) || 30));
    const result = await pool.query(
      `update learning_decision_queue
       set status = 'pending',
           claimed_at = null,
           error_message = coalesce(error_message, 'stale_processing_requeued')
       where status = 'processing'
         and claimed_at < now() - ($1::int * interval '1 minute')
       returning id`,
      [minutes]
    );
    return result.rows.map(x => x.id);
  }

  async function finishQueueItem(id, { status = 'processed', decisionId = null, errorMessage = null } = {}) {
    if (!['processed','skipped','error'].includes(status)) throw new Error('invalid_queue_finish_status');
    const result = await pool.query(
      `update learning_decision_queue
       set status = $2,
           processed_at = now(),
           decision_id = coalesce($3, decision_id),
           error_message = $4
       where id = $1
       returning *`,
      [id, status, decisionId, errorMessage]
    );
    return result.rows[0] ?? null;
  }

  async function appendLedgerEvent(event) {
    const result = await pool.query(
      `insert into learning_portfolio_ledger
        (event_key, occurred_at, event_type, decision_id, paper_order_id, symbol,
         quantity_delta, cash_delta_usd, reference_price_usd, fee_usd, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
       on conflict (event_key) do nothing
       returning *`,
      [
        event.event_key, event.occurred_at, event.event_type, event.decision_id ?? null,
        event.paper_order_id ?? null, event.symbol ?? null, event.quantity_delta ?? 0,
        event.cash_delta_usd ?? 0, event.reference_price_usd ?? null, event.fee_usd ?? 0,
        j(event.metadata)
      ]
    );
    return result.rows[0] ?? null;
  }

  async function ledgerEvents() {
    const result = await pool.query(
      `select * from learning_portfolio_ledger order by occurred_at asc, id asc`
    );
    return result.rows;
  }

  async function savePortfolioMark(mark) {
    const result = await pool.query(
      `insert into learning_portfolio_marks
        (marked_at, snapshot_id, total_value_usd, cash_usd, positions, prices,
         shadow_return_pct, hodl_value_usd, hodl_return_pct, usd_value_usd,
         alpha_vs_hodl_pct, drawdown_pct, metadata)
       values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13::jsonb)
       on conflict (marked_at, snapshot_id) do nothing
       returning *`,
      [
        mark.marked_at, mark.snapshot_id ?? null, mark.total_value_usd, mark.cash_usd,
        j(mark.positions), j(mark.prices), mark.shadow_return_pct ?? null,
        mark.hodl_value_usd ?? null, mark.hodl_return_pct ?? null, mark.usd_value_usd ?? null,
        mark.alpha_vs_hodl_pct ?? null, mark.drawdown_pct ?? null, j(mark.metadata)
      ]
    );
    return result.rows[0] ?? null;
  }

  async function recentPortfolioMarks(limit = 100) {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 100));
    const result = await pool.query(
      `select * from learning_portfolio_marks order by marked_at desc limit $1`,
      [safeLimit]
    );
    return result.rows;
  }

  async function portfolioMarkAtOrBefore(timestamp) {
    const result = await pool.query(
      `select * from learning_portfolio_marks
       where marked_at <= $1
       order by marked_at desc
       limit 1`,
      [timestamp]
    );
    return result.rows[0] ?? null;
  }

  async function evaluatedHorizons(decisionId) {
    const result = await pool.query(
      `select horizon from learning_outcomes where decision_id = $1 order by evaluated_at asc`,
      [decisionId]
    );
    return result.rows.map(x => x.horizon);
  }

  async function outcomeCandidates(limit = 200) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
    const result = await pool.query(
      `select d.*, po.id as paper_order_id, po.symbol as order_symbol, po.side as order_side,
              po.quantity, po.notional_usd, po.reference_price_usd, po.estimated_fee_usd,
              po.estimated_slippage_bps, s.generated_at as snapshot_generated_at, s.payload as decision_snapshot_payload
       from learning_decisions d
       join learning_snapshots s on s.id = d.snapshot_id
       left join lateral (
         select * from learning_paper_orders p
         where p.decision_id = d.id
         order by p.id asc
         limit 1
       ) po on true
       order by d.created_at asc
       limit $1`,
      [safeLimit]
    );
    return result.rows;
  }

  async function saveOutcome({
    decisionId,
    paperOrderId = null,
    markSnapshotId = null,
    horizon,
    targetTime = null,
    evaluatedAt = new Date().toISOString(),
    assetReturnPct = null,
    strategyReturnPct = null,
    holdReturnPct = null,
    usdReturnPct = 0,
    alphaVsHoldPct = null,
    portfolioReturnPct = null,
    maxAdverseExcursionPct = null,
    maxFavorableExcursionPct = null,
    notes = {}
  }) {
    const result = await pool.query(
      `insert into learning_outcomes
        (decision_id, paper_order_id, mark_snapshot_id, horizon, target_time, evaluated_at,
         asset_return_pct, strategy_return_pct, hold_return_pct, usd_return_pct,
         alpha_vs_hold_pct, portfolio_return_pct, max_adverse_excursion_pct,
         max_favorable_excursion_pct, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
       on conflict (decision_id, horizon) do nothing
       returning *`,
      [
        decisionId, paperOrderId, markSnapshotId, horizon, targetTime, evaluatedAt,
        assetReturnPct, strategyReturnPct, holdReturnPct, usdReturnPct,
        alphaVsHoldPct, portfolioReturnPct, maxAdverseExcursionPct,
        maxFavorableExcursionPct, j(notes)
      ]
    );
    return result.rows[0] ?? null;
  }

  async function listOutcomes({ from = null, to = null, limit = 5000 } = {}) {
    const safeLimit = Math.max(1, Math.min(10000, Number(limit) || 5000));
    const clauses = [];
    const args = [];
    if (from) { args.push(from); clauses.push(`evaluated_at >= $${args.length}`); }
    if (to) { args.push(to); clauses.push(`evaluated_at <= $${args.length}`); }
    args.push(safeLimit);
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const result = await pool.query(
      `select * from learning_outcomes ${where} order by evaluated_at asc limit $${args.length}`,
      args
    );
    return result.rows;
  }

  async function saveWatchdogEvent(event) {
    const raw = JSON.stringify({
      asset: event.asset ?? null,
      event_type: event.event_type,
      details: event.details ?? {}
    });
    const fingerprint = event.fingerprint || crypto.createHash('sha256').update(raw).digest('hex');
    const result = await pool.query(
      `insert into learning_watchdog_events
        (detected_at, asset, event_type, severity, details, fingerprint)
       values ($1,$2,$3,$4,$5::jsonb,$6)
       on conflict (fingerprint) do nothing
       returning *`,
      [
        event.detected_at || new Date().toISOString(), event.asset ?? null,
        event.event_type, event.severity, j(event.details), fingerprint
      ]
    );
    return result.rows[0] ?? null;
  }

  async function listWatchdogEvents({ from = null, to = null, limit = 1000 } = {}) {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 1000));
    const clauses = [];
    const args = [];
    if (from) { args.push(from); clauses.push(`detected_at >= $${args.length}`); }
    if (to) { args.push(to); clauses.push(`detected_at <= $${args.length}`); }
    args.push(safeLimit);
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const result = await pool.query(
      `select * from learning_watchdog_events ${where} order by detected_at asc limit $${args.length}`,
      args
    );
    return result.rows;
  }

  async function startReasoningRun({ queueId, provider, model = null, requestPacket }) {
    const result = await pool.query(
      `insert into learning_reasoning_runs
        (queue_id, provider, model, status, request_packet)
       values ($1,$2,$3,'started',$4::jsonb)
       returning *`,
      [queueId, provider, model, j(requestPacket)]
    );
    return result.rows[0];
  }

  async function finishReasoningRun(id, {
    status,
    responsePayload = null,
    validationSummary = null,
    acceptedDecisionIds = [],
    rejectedProposals = [],
    usage = null,
    errorMessage = null
  } = {}) {
    if (!['completed','rejected','error','skipped'].includes(status)) throw new Error('invalid_reasoning_run_status');
    const result = await pool.query(
      `update learning_reasoning_runs
       set status = $2,
           response_payload = $3::jsonb,
           validation_summary = $4::jsonb,
           accepted_decision_ids = $5::jsonb,
           rejected_proposals = $6::jsonb,
           usage = $7::jsonb,
           error_message = $8,
           completed_at = now()
       where id = $1
       returning *`,
      [
        id, status,
        responsePayload == null ? null : j(responsePayload),
        validationSummary == null ? null : j(validationSummary),
        j(acceptedDecisionIds),
        j(rejectedProposals),
        usage == null ? null : j(usage),
        errorMessage
      ]
    );
    return result.rows[0] ?? null;
  }

  async function listReasoningRuns({ limit = 100 } = {}) {
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    const result = await pool.query(
      `select * from learning_reasoning_runs order by started_at desc limit $1`,
      [safeLimit]
    );
    return result.rows;
  }

  async function reasoningRunsBetween(from, to, limit = 10000) {
    const safeLimit = Math.max(1, Math.min(50000, Number(limit) || 10000));
    const result = await pool.query(
      `select * from learning_reasoning_runs
       where started_at >= $1 and started_at < $2
       order by started_at asc
       limit $3`,
      [from, to, safeLimit]
    );
    return result.rows;
  }

  async function saveShadowV2Evaluation(evaluation) {
    const result = await pool.query(
      `insert into learning_shadow_v2_evaluations
        (snapshot_id, generated_at, strategy_version, regime, consistency,
         asset_assessments, external_research_trigger, execution_enabled)
       values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,false)
       on conflict (snapshot_id, strategy_version) do nothing
       returning *`,
      [
        evaluation.snapshot_id,
        evaluation.generated_at,
        evaluation.strategy_version || 'shadow_v0.2',
        j(evaluation.regime),
        j(evaluation.consistency),
        j(evaluation.assets),
        j(evaluation.external_research_trigger)
      ]
    );
    return result.rows[0] ?? null;
  }

  async function listShadowV2Evaluations({ from = null, to = null, limit = 5000 } = {}) {
    const safeLimit = Math.max(1, Math.min(10000, Number(limit) || 5000));
    const clauses = [];
    const args = [];
    if (from) { args.push(from); clauses.push(`generated_at >= $${args.length}`); }
    if (to) { args.push(to); clauses.push(`generated_at <= $${args.length}`); }
    args.push(safeLimit);
    const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
    const result = await pool.query(
      `select * from learning_shadow_v2_evaluations ${where}
       order by generated_at asc limit $${args.length}`,
      args
    );
    return result.rows;
  }

  async function saveRuntimeCycle({
    cycleKey,
    startedAt,
    completedAt,
    status,
    durationMs,
    steps,
    configFingerprint = null
  }) {
    if (!['success','partial','error'].includes(status)) throw new Error('invalid_runtime_cycle_status');
    const result = await pool.query(
      `insert into learning_runtime_cycles
        (cycle_key, started_at, completed_at, status, duration_ms, steps, config_fingerprint, execution_enabled)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,false)
       on conflict (cycle_key) do nothing
       returning *`,
      [cycleKey, startedAt, completedAt, status, durationMs, j(steps), configFingerprint]
    );
    return result.rows[0] ?? null;
  }

  async function recentRuntimeCycles(limit = 100) {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 100));
    const result = await pool.query(
      `select * from learning_runtime_cycles order by started_at desc limit $1`,
      [safeLimit]
    );
    return result.rows;
  }

  async function databaseStats() {
    const counts = await pool.query(`
      select 'learning_snapshots' as table_name, count(*)::bigint as row_count from learning_snapshots
      union all select 'learning_decisions', count(*)::bigint from learning_decisions
      union all select 'learning_decision_queue', count(*)::bigint from learning_decision_queue
      union all select 'learning_paper_orders', count(*)::bigint from learning_paper_orders
      union all select 'learning_outcomes', count(*)::bigint from learning_outcomes
      union all select 'learning_portfolio_ledger', count(*)::bigint from learning_portfolio_ledger
      union all select 'learning_portfolio_marks', count(*)::bigint from learning_portfolio_marks
      union all select 'learning_watchdog_events', count(*)::bigint from learning_watchdog_events
      union all select 'learning_reasoning_runs', count(*)::bigint from learning_reasoning_runs
      union all select 'learning_runtime_cycles', count(*)::bigint from learning_runtime_cycles
      union all select 'learning_shadow_v2_evaluations', count(*)::bigint from learning_shadow_v2_evaluations
    `);
    const size = await pool.query(`
      select pg_database_size(current_database())::bigint as database_bytes,
             min(generated_at) as oldest_snapshot,
             max(generated_at) as newest_snapshot
      from learning_snapshots
    `);
    return {
      tables: Object.fromEntries(counts.rows.map(x => [x.table_name, Number(x.row_count)])),
      database_bytes: Number(size.rows[0]?.database_bytes || 0),
      oldest_snapshot: size.rows[0]?.oldest_snapshot ?? null,
      newest_snapshot: size.rows[0]?.newest_snapshot ?? null
    };
  }

  async function close() { await pool.end(); }

  return {
    pool,
    saveSnapshot,
    latestSnapshot,
    getSnapshotById,
    recentSnapshots,
    snapshotsBetween,
    nearestSnapshot,
    saveDecision,
    listDecisions,
    getDecisionByKey,
    savePaperOrder,
    paperOrdersForDecision,
    unledgeredPaperOrders,
    setPaperOrderState,
    enqueueDecisionReview,
    listDecisionQueue,
    claimNextDecisionQueue,
    releaseQueueItem,
    requeueStaleDecisionQueue,
    finishQueueItem,
    appendLedgerEvent,
    ledgerEvents,
    savePortfolioMark,
    recentPortfolioMarks,
    portfolioMarkAtOrBefore,
    evaluatedHorizons,
    outcomeCandidates,
    saveOutcome,
    listOutcomes,
    saveWatchdogEvent,
    listWatchdogEvents,
    startReasoningRun,
    finishReasoningRun,
    listReasoningRuns,
    reasoningRunsBetween,
    saveShadowV2Evaluation,
    listShadowV2Evaluations,
    saveRuntimeCycle,
    recentRuntimeCycles,
    databaseStats,
    close
  };
}
