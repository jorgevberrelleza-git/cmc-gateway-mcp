// Durable order journal on Postgres (table shadow_order_journal, migration 006).
// Implements the interface required by bitso-trade-client.mjs:
//   appendIfAbsent(id, meta) -> true only if this call inserted the row (atomic via PRIMARY KEY)
//   markUnknown(id), unresolvedCount()
// Reconciliation (LIVE): listUnresolved(), markReconciled(id, result)
// `mode` separates REHEARSAL rows (dry-run, never sent) from LIVE rows, so
// rehearsal history can never block or unblock live trading.
export function makePgOrderJournal(db, { mode, snapshotId = null }) {
  if (mode !== 'REHEARSAL' && mode !== 'LIVE') throw new Error('journal:bad_mode');
  const initialState = mode === 'REHEARSAL' ? 'REHEARSED' : 'PLANNED';
  return {
    mode,
    async appendIfAbsent(originId, meta) {
      const r = await db.query(
        `insert into shadow_order_journal (origin_id, mode, state, book, side, major, price, notional_usd, reason, snapshot_id, details)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         on conflict (origin_id) do nothing returning origin_id`,
        [originId, mode, initialState, meta.book, meta.side, meta.major, meta.price,
          meta.notionalUsd ?? (Number(meta.major) * Number(meta.price)), meta.reason ?? null, snapshotId,
          JSON.stringify(meta.details || {})]);
      return r.rowCount === 1;
    },
    async markUnknown(originId) {
      await db.query(`update shadow_order_journal set state='UNKNOWN', updated_at=now() where origin_id=$1 and mode=$2`, [originId, mode]);
    },
    async unresolvedCount() {
      const r = await db.query(`select count(*)::int as n from shadow_order_journal where mode=$1 and state='UNKNOWN'`, [mode]);
      return r.rows[0]?.n ?? 0;
    },
    /** Orders that may have reached Bitso and still need a final verdict. */
    async listUnresolved(limit = 50) {
      const r = await db.query(
        `select origin_id, book, side, major, price, state, created_at from shadow_order_journal
         where mode=$1 and state in ('SENT','UNKNOWN') order by created_at asc limit $2`, [mode, limit]);
      return r.rows.map(x => ({ originId: x.origin_id, book: x.book, side: x.side, major: Number(x.major),
        price: Number(x.price), state: x.state, createdAt: x.created_at }));
    },
    /**
     * Store a reconciliation verdict. PENDING keeps the current state; a HALT
     * anomaly keeps the row unresolved (UNKNOWN) so the client refuses new orders.
     */
    async markReconciled(originId, res) {
      if (res.state === 'PENDING') return false;
      const state = res.action === 'HALT' ? 'UNKNOWN' : res.state;
      if (!['FILLED', 'PARTIAL', 'REJECTED', 'UNKNOWN'].includes(state)) throw new Error('journal:bad_reconcile_state');
      const details = { reconcile: { filledMajor: res.filledMajor, avgPrice: res.avgPrice, feesUsd: res.feesUsd,
        venueStatus: res.venueStatus, anomalies: res.anomalies, at: new Date().toISOString() } };
      const r = await db.query(
        `update shadow_order_journal set state=$3, details = details || $4::jsonb, updated_at=now()
         where origin_id=$1 and mode=$2 and state in ('SENT','UNKNOWN')`,
        [originId, mode, state, JSON.stringify(details)]);
      return r.rowCount === 1;
    }
  };
}
