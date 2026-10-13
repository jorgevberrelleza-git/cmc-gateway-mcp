import assert from 'node:assert/strict';
import { extractUsdPrices } from '../src/learning/features.mjs';
import { buildDecisionQueueItem, shouldEscalateQueueItem } from '../src/learning/decision-queue.mjs';
import { createSeedLedgerEvents, paperOrderToLedgerEvent, replayLedger, markLedgerState } from '../src/learning/portfolio-ledger.mjs';
import { valueHodlBenchmark, buildPortfolioBenchmark } from '../src/learning/benchmark.mjs';
import { analyzeDecisionDrift } from '../src/learning/drift-watchdog.mjs';
import { scoreDecisionQuality } from '../src/learning/decision-quality.mjs';
import { buildLearningReport } from '../src/learning/report.mjs';

const snapshot = {
  snapshot_version: '0.6.2',
  generated_at: '2026-10-13T00:00:00Z',
  assets: ['BTC','AAVE'],
  quotes: {
    structuredContent: {
      headers: ['symbol','price'],
      rows: [['BTC', 80000], ['AAVE', 160]]
    }
  }
};
assert.deepEqual(extractUsdPrices(snapshot), { BTC: 80000, AAVE: 160 });

const v3Snapshot = {
  snapshot_version: '0.6.2',
  generated_at: '2026-10-13T00:00:00Z',
  assets: ['BTC','AAVE'],
  quotes: {
    structuredContent: {
      data: [
        { id: 1, symbol: 'BTC', quote: [{ symbol: 'USD', price: 80123, percent_change_24h: 1.2 }] },
        { id: 7278, symbol: 'AAVE', quote: [{ symbol: 'USD', price: 161.5, percent_change_24h: -0.8 }] }
      ]
    }
  }
};
assert.deepEqual(extractUsdPrices(v3Snapshot), { BTC: 80123, AAVE: 161.5 });

const v3MapSnapshot = {
  ...v3Snapshot,
  quotes: {
    structuredContent: {
      data: {
        '1': { id: 1, symbol: 'BTC', quote: [{ symbol: 'USD', price: 80200 }] },
        '7278': { id: 7278, symbol: 'AAVE', quote: [{ symbol: 'USD', price: 162 }] }
      }
    }
  }
};
assert.deepEqual(extractUsdPrices(v3MapSnapshot), { BTC: 80200, AAVE: 162 });

const v3DeepWrappedSnapshot = {
  snapshot_version: '0.6.2',
  generated_at: '2026-10-13T00:00:00Z',
  assets: ['BTC','AAVE'],
  cmc_ids: { BTC: '1', AAVE: '7278' },
  quotes: {
    structuredContent: {
      payload: {
        result: {
          items: {
            '1': { id: 1, name: 'Bitcoin', symbol: 'BTC', quote: { USD: { price: 80300, percent_change_24h: 0.5 } } },
            '7278': { id: 7278, name: 'Aave', symbol: 'AAVE', quote: { USD: { price: 163, percent_change_24h: -0.3 } } }
          }
        }
      }
    }
  }
};
assert.deepEqual(extractUsdPrices(v3DeepWrappedSnapshot), { BTC: 80300, AAVE: 163 });

const materialEvent = {
  material: true,
  reasons: ['BTC:price_move_3.20pct', 'BTC:gate_NORMAL_REVIEW_to_BLOCK_NEW_ENTRY'],
  per_asset: {}
};
const queueItem = buildDecisionQueueItem({ id: 42 }, materialEvent);
assert.equal(queueItem.snapshot_id, 42);
assert.equal(queueItem.status, 'pending');
assert.equal(shouldEscalateQueueItem(queueItem), true);
assert.equal(buildDecisionQueueItem({ id: 42 }, { material: false, reasons: [] }), null);

const seed = createSeedLedgerEvents({
  occurred_at: '2026-10-13T00:00:00Z',
  cash_usd: 1000,
  positions: { BTC: 0.01 },
  prices: { BTC: 80000 }
});
let state = replayLedger(seed);
assert.equal(state.cash_usd, 1000);
assert.equal(state.positions.BTC, 0.01);

const buyEvent = paperOrderToLedgerEvent({
  id: 7,
  decision_id: 3,
  symbol: 'AAVE',
  side: 'buy',
  quantity: 1,
  reference_price_usd: 160,
  estimated_fee_usd: 0.16,
  estimated_slippage_bps: 10
}, { occurred_at: '2026-10-13T01:00:00Z' });
state = replayLedger([...seed, buyEvent]);
assert.equal(state.positions.AAVE, 1);
assert.ok(state.cash_usd < 840);

const marked = markLedgerState(state, { BTC: 82000, AAVE: 170 });
assert.ok(marked.total_value_usd > 1800);

const hodlInitial = valueHodlBenchmark({ cash_usd: 1000, positions: { BTC: 0.01 } }, { BTC: 80000 });
const hodlNow = valueHodlBenchmark({ cash_usd: 1000, positions: { BTC: 0.01 } }, { BTC: 82000 });
const benchmark = buildPortfolioBenchmark({
  initial_value_usd: hodlInitial,
  shadow_value_usd: marked.total_value_usd,
  hodl_value_usd: hodlNow,
  peak_shadow_value_usd: 1900
});
assert.ok(Number.isFinite(benchmark.alpha_vs_hodl_pct));
assert.ok(benchmark.drawdown_pct <= 0);

const drift = analyzeDecisionDrift([
  { decision_key: 'D1', asset: 'AAVE', action: 'BUY', created_at: '2026-10-13T00:00:00Z' },
  { decision_key: 'D2', asset: 'AAVE', action: 'REDUCE', created_at: '2026-10-13T04:00:00Z' }
]);
assert.equal(drift.reversal_count, 1);
assert.ok(drift.events.some(x => x.event_type === 'rapid_direction_reversal'));

const quality = scoreDecisionQuality({
  action: 'BUY',
  validation_ok: true,
  evidence_families: ['structure','macro','flow'],
  reward_risk: 3,
  macro_context_valid: true,
  data_confidence: 80
});
assert.ok(quality.score_0_100 >= 80);

const report = buildLearningReport({
  from: '2026-10-13T00:00:00Z',
  to: '2026-10-14T00:00:00Z',
  snapshots: [{ material_event: { material: true } }, { material_event: { material: false } }],
  queue: [{ status: 'pending', priority: 80 }],
  decisions: [{ action: 'HOLD' }, { action: 'BUY' }],
  outcomes: [{ alpha_vs_hold_pct: 1.2 }, { alpha_vs_hold_pct: -0.2 }],
  portfolioMarks: [{ marked_at: '2026-10-13T12:00:00Z', total_value_usd: 2000, shadow_return_pct: 2, hodl_return_pct: 1, alpha_vs_hodl_pct: 1, drawdown_pct: -0.5 }],
  watchdogEvents: [{ severity: 'warning' }]
});
assert.equal(report.snapshots.material, 1);
assert.equal(report.decision_queue.high_priority_pending, 1);
assert.equal(report.decisions.non_hold, 1);
assert.equal(report.execution_enabled, false);

console.log('learning-sprint3-selftest: ok');
