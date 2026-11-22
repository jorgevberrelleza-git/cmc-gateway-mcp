// Durable order journal on Postgres (table shadow_order_journal, migration 006).
// Implements the interface required by bitso-trade-client.mjs:
//   appendIfAbsent(id, meta) -> true only if this call inserted the row (atomic via PRIMARY KEY)
//   markUnknown(id), unresolvedCount()
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
    }
  };
}
