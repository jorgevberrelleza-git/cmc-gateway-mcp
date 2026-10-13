import { validateShadowRuntimeConfig } from '../src/learning/runtime-config.mjs';
import { buildRuntimeHealth } from '../src/learning/runtime-telemetry.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

const config = validateShadowRuntimeConfig(process.env);
const store = createLearningStore();

try {
  const [latestSnapshot, marks, queue, reasoningRuns, cycles, ledger] = await Promise.all([
    store.latestSnapshot(),
    store.recentPortfolioMarks(1),
    store.listDecisionQueue({ limit: 1000 }),
    store.listReasoningRuns({ limit: 500 }),
    store.recentRuntimeCycles(20),
    store.ledgerEvents()
  ]);
  const health = buildRuntimeHealth({
    latestSnapshot,
    latestPortfolioMark: marks[0] || null,
    queue,
    reasoningRuns,
    runtimeCycles: cycles
  });
  const migrations = await store.pool.query(
    'select name, sha256, applied_at from learning_schema_migrations order by name asc'
  );
  const paperExecutionFlags = await store.pool.query(
    'select count(*)::bigint as count from learning_runtime_cycles where execution_enabled = true'
  );

  const blockers = [];
  if (!config.ready_for_shadow) blockers.push(...config.errors.map(x => `config:${x}`));
  if (!health.healthy) blockers.push(...health.blockers.map(x => `health:${x}`));
  if (!ledger.length) blockers.push('portfolio_ledger_not_seeded');
  if (migrations.rows.length < 2) blockers.push('expected_migrations_not_applied');
  if (Number(paperExecutionFlags.rows[0]?.count || 0) > 0) blockers.push('unexpected_execution_enabled_telemetry');

  const result = {
    ready_for_shadow_go_live: blockers.length === 0,
    blockers,
    warnings: config.warnings,
    config_fingerprint: config.config_fingerprint,
    health,
    database: {
      migrations_applied: migrations.rows.map(x => x.name),
      ledger_events: ledger.length
    },
    manual_gates_remaining: [
      'verify_hosting_backup_and_restore_capability',
      'review_current_vendor_api_cost_rates',
      'explicit_user_approval_before_any_Render_change'
    ],
    real_money_ready: false,
    execution_enabled: false
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ready_for_shadow_go_live) process.exitCode = 2;
} finally {
  await store.close();
}
