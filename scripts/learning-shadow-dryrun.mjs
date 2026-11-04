import { spawnSync } from 'node:child_process';
import { createLearningStore } from '../src/learning/storage.mjs';

const store = createLearningStore();
const now = new Date();
const t0 = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
const t1 = now.toISOString();
const suffix = now.getTime();

function snapshot(generatedAt, btcPrice, materialEvent) {
  return {
    snapshot_version: '0.6.2',
    generated_at: generatedAt,
    assets: ['BTC'],
    quotes: {
      structuredContent: {
        headers: ['symbol','price','percent_change_24h'],
        rows: [['BTC', btcPrice, -2.5]]
      }
    },
    microstructure: {
      assets: {
        BTC: {
          scores: {
            trap_risk_0_100: 40,
            spot_confirmation_0_100: 75,
            persistent_wall_pressure_minus100_to100: 20,
            microstructure_confidence_0_100: 85
          },
          execution_context_gate: 'NORMAL_REVIEW'
        }
      }
    },
    defi_fundamentals: { assets: {} },
    dry_run: true,
    material_event: materialEvent
  };
}

function runStep(name, args, extraEnv = {}) {
  const run = spawnSync('npm', args, {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv }
  });
  if (run.status !== 0) {
    throw new Error(`${name}_failed:${String(run.stderr || run.stdout || '').slice(-2000)}`);
  }
  return String(run.stdout || '').trim();
}

try {
  const baseline = await store.saveSnapshot(snapshot(t0, 80000, null), {
    source: 'sprint5-dryrun',
    materialEvent: { material: false, reasons: ['dryrun_baseline'], per_asset: {} }
  });
  const event = {
    material: true,
    reasons: ['BTC:spot_delta_25'],
    per_asset: { BTC: { material: true, reasons: ['spot_delta_25'] } },
    previous_generated_at: t0,
    current_generated_at: t1,
    policy: 'sprint5_dryrun'
  };
  const current = await store.saveSnapshot(snapshot(t1, 79000, event), {
    source: 'sprint5-dryrun',
    materialEvent: event
  });

  const existingLedger = await store.ledgerEvents();
  if (!existingLedger.length) {
    await store.appendLedgerEvent({
      event_key: `dryrun-seed-usd-${suffix}`,
      occurred_at: t0,
      event_type: 'seed',
      symbol: 'USD',
      quantity_delta: 0,
      cash_delta_usd: 3000,
      reference_price_usd: 1,
      fee_usd: 0,
      metadata: { sprint5_dryrun: true }
    });
    await store.appendLedgerEvent({
      event_key: `dryrun-seed-btc-${suffix}`,
      occurred_at: t0,
      event_type: 'seed',
      symbol: 'BTC',
      quantity_delta: 0.0875,
      cash_delta_usd: 0,
      reference_price_usd: 80000,
      fee_usd: 0,
      metadata: { sprint5_dryrun: true }
    });
  }

  runStep('portfolio_mark_before_reasoning', ['run','learning:portfolio:mark']);

  const queued = await store.enqueueDecisionReview({
    snapshotId: current.id,
    queueKey: `sprint5-dryrun:${current.id}`,
    priority: 100,
    materialEvent: event
  });
  if (!queued) throw new Error('dryrun_queue_insert_failed');

  const reasonerOutput = runStep('reasoner', ['run','learning:reasoner'], {
    LEARNING_REASONING_ENABLED: 'true',
    LEARNING_REASONING_PROVIDER: 'mock',
    LEARNING_REASONING_MAX_ITEMS: '1',
    LEARNING_REASONING_MAX_EVENT_AGE_HOURS: '24'
  });

  runStep('paper_fill', ['run','learning:paper:fill']);
  runStep('portfolio_mark_after_reasoning', ['run','learning:portfolio:mark']);
  runStep('watchdog', ['run','learning:watchdog']);
  const reportOutput = runStep('report', ['run','learning:report'], { LEARNING_REPORT_HOURS: '24' });

  const queueRows = await store.listDecisionQueue({ limit: 1000 });
  const processed = queueRows.find(x => Number(x.id) === Number(queued.id));
  if (!processed || processed.status !== 'processed') throw new Error('dryrun_queue_not_processed');

  const decisions = await store.listDecisions({ from: t0, limit: 1000 });
  const dryDecision = decisions.find(x => String(x.decision_key || '').startsWith(`AIQ${queued.id}-`));
  if (!dryDecision) throw new Error('dryrun_reasoning_decision_missing');
  if (dryDecision.action !== 'HOLD') throw new Error('mock_dryrun_must_produce_hold');

  const orders = await store.paperOrdersForDecision(dryDecision.id);
  if (orders.length !== 0) throw new Error('hold_dryrun_must_not_create_paper_order');

  console.log(JSON.stringify({
    ok: true,
    baseline_snapshot_id: baseline.id,
    event_snapshot_id: current.id,
    queue_id: queued.id,
    decision_id: dryDecision.id,
    action: dryDecision.action,
    paper_orders: orders.length,
    reasoner_output_tail: reasonerOutput.slice(-1000),
    report_output_tail: reportOutput.slice(-1000),
    execution_enabled: false
  }, null, 2));
} finally {
  await store.close();
}
