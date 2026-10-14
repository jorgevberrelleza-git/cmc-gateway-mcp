import assert from 'node:assert/strict';
import { assessEventQuality } from '../src/learning/event-quality-v02.mjs';
import { assessDataConsistency } from '../src/learning/data-consistency.mjs';
import { evaluateNewsCatalystGate } from '../src/learning/news-catalyst-gate.mjs';
import { evaluateShadowV02 } from '../src/learning/shadow-v02-evaluator.mjs';

const lowSignal = assessEventQuality({
  material: true,
  reasons: ['BTC:wall_delta_-80']
});
assert.equal(lowSignal.material_v01, true);
assert.equal(lowSignal.research_candidate, false);
assert.equal(lowSignal.low_signal_context_only, true);

const multiFamily = assessEventQuality({
  material: true,
  reasons: ['BTC:price_move_-2.50pct','BTC:spot_delta_-31','BTC:gate_WAIT_to_BLOCK']
});
assert.equal(multiFamily.research_candidate, true);
assert.ok(multiFamily.independent_family_count >= 3);

const cleanSnapshot = {
  snapshot_version: '0.6.2',
  generated_at: '2026-10-14T01:52:36.337Z',
  assets: ['BTC'],
  market: {
    global: { content: [{ type: 'text', text: JSON.stringify({
      market_size: { total_crypto_market_cap_usd: { percent_change: { '7d': '-3.95%' } } },
      liquidity: { volume24h: { total: { current: '200 B' }, spot: { current: '100 B', percent_change: { '24h': '+10%' } } } },
      leverage: { open_interest: { total: { current: '400 B', percent_change: { '24h': '+6%' } } } },
      sentiment: { fear_greed: { current: { index: 54 } } }
    }) }] },
    derivatives: { content: [{ type: 'text', text: JSON.stringify({ totalOpenInterest: { current: '405 B', percentage_change_24h: '+6.5%' } }) }] },
    technicals: { content: [] },
    narratives: { content: [] },
    events: { content: [{ type: 'text', text: JSON.stringify({ upcomingEventNews: { headers: [], rows: [] } }) }] }
  },
  quotes: { content: [{ type: 'text', text: JSON.stringify({
    headers: ['symbol','last_updated_time'],
    rows: [['BTC','2026-10-14T01:51:00.000Z']]
  }) }] },
  microstructure: { assets: {} }
};

const consistency = assessDataConsistency(cleanSnapshot);
assert.equal(consistency.block_count, 0);
assert.equal(consistency.warning_count, 0);

const catalyst = evaluateNewsCatalystGate(cleanSnapshot, { proposedAction: 'BUY' });
assert.equal(catalyst.position_change_allowed, false);
assert.equal(catalyst.external_calls_made, 0);

const evaluated = evaluateShadowV02({
  snapshot: cleanSnapshot,
  materialEvent: {
    material: true,
    reasons: ['BTC:price_move_-2.50pct','BTC:spot_delta_-31','BTC:gate_WAIT_to_BLOCK']
  }
});
assert.equal(evaluated.research_required, true);
assert.equal(evaluated.exposure_change_eligible, false);
assert.equal(evaluated.shadow_action, 'HOLD_WAIT');
assert.equal(evaluated.external_calls_made, 0);
assert.equal(evaluated.paid_ai_calls_made, 0);
assert.equal(evaluated.execution_enabled, false);

console.log('learning-v02-selftest: ok');
