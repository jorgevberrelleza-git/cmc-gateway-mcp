import { createLearningStore } from '../src/learning/storage.mjs';

const store = createLearningStore();
try {
  const stats = await store.databaseStats();
  const retentionDays = Math.max(30, Number(process.env.LEARNING_SNAPSHOT_RETENTION_DAYS || 365));
  const oldest = stats.oldest_snapshot ? Date.parse(stats.oldest_snapshot) : null;
  const newest = stats.newest_snapshot ? Date.parse(stats.newest_snapshot) : null;
  const spanDays = oldest && newest && newest > oldest ? (newest - oldest) / 86_400_000 : null;
  const snapshots = Number(stats.tables.learning_snapshots || 0);
  const snapshotsPerDay = spanDays && spanDays > 0 ? snapshots / spanDays : null;

  console.log(JSON.stringify({
    ok: true,
    database_bytes: stats.database_bytes,
    database_megabytes: Number((stats.database_bytes / 1024 / 1024).toFixed(2)),
    tables: stats.tables,
    oldest_snapshot: stats.oldest_snapshot,
    newest_snapshot: stats.newest_snapshot,
    observed_span_days: spanDays == null ? null : Number(spanDays.toFixed(2)),
    observed_snapshots_per_day: snapshotsPerDay == null ? null : Number(snapshotsPerDay.toFixed(2)),
    policy: {
      snapshot_retention_days: retentionDays,
      delete_automatically: false,
      decisions_retained_indefinitely: true,
      outcomes_retained_indefinitely: true,
      reasoning_audit_retained_indefinitely: true
    },
    note: 'report_only_no_rows_are_deleted'
  }, null, 2));
} finally {
  await store.close();
}
