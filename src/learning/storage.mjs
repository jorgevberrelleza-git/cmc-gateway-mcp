import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;

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
       returning id, sha256, generated_at`,
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

  async function recentSnapshots(limit = 3) {
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 3));
    const result = await pool.query(
      `select id, generated_at, snapshot_version, source, sha256, payload, material_event
       from learning_snapshots order by generated_at desc limit $1`,
      [safeLimit]
    );
    return result.rows;
  }

  async function saveDecision({
    decisionKey,
    snapshotId,
    decisionType,
    thesis,
    riskContext,
    portfolioContext,
    status = 'shadow'
  }) {
    const result = await pool.query(
      `insert into learning_decisions
        (decision_key, snapshot_id, decision_type, status, thesis, risk_context, portfolio_context)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
       on conflict (decision_key) do nothing
       returning id, decision_key, snapshot_id, decision_type, status, created_at`,
      [
        decisionKey,
        snapshotId,
        decisionType,
        status,
        JSON.stringify(thesis || {}),
        JSON.stringify(riskContext || {}),
        JSON.stringify(portfolioContext || {})
      ]
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
       returning *`,
      [
        decisionId, symbol, side, quantity, notionalUsd, referencePriceUsd,
        invalidationPriceUsd, targetPriceUsd, estimatedFeeUsd, estimatedSlippageBps, state
      ]
    );
    return result.rows[0];
  }

  async function evaluatedHorizons(decisionId) {
    const result = await pool.query(
      `select horizon from learning_outcomes where decision_id = $1 order by evaluated_at asc`,
      [decisionId]
    );
    return result.rows.map(x => x.horizon);
  }

  async function saveOutcome({
    decisionId,
    horizon,
    evaluatedAt = new Date().toISOString(),
    portfolioReturnPct = null,
    holdReturnPct = null,
    usdReturnPct = 0,
    maxAdverseExcursionPct = null,
    maxFavorableExcursionPct = null,
    notes = {}
  }) {
    const result = await pool.query(
      `insert into learning_outcomes
        (decision_id, horizon, evaluated_at, portfolio_return_pct, hold_return_pct, usd_return_pct,
         max_adverse_excursion_pct, max_favorable_excursion_pct, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       on conflict (decision_id, horizon) do nothing
       returning *`,
      [
        decisionId, horizon, evaluatedAt, portfolioReturnPct, holdReturnPct, usdReturnPct,
        maxAdverseExcursionPct, maxFavorableExcursionPct, JSON.stringify(notes || {})
      ]
    );
    return result.rows[0] ?? null;
  }

  async function close() { await pool.end(); }

  return {
    pool,
    saveSnapshot,
    latestSnapshot,
    recentSnapshots,
    saveDecision,
    savePaperOrder,
    evaluatedHorizons,
    saveOutcome,
    close
  };
}
