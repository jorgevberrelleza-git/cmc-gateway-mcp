import assert from 'node:assert/strict';
import { buildReasoningPacket } from '../src/learning/reasoning-packet.mjs';
import { buildOpenAIRequest, createReasoningProvider } from '../src/learning/reasoning-provider.mjs';
import { validateReasoningProposal, assessReasoningProposal } from '../src/learning/reasoning-bridge.mjs';

function snapshotRow(id, generatedAt, price, materialEvent) {
  return {
    id,
    generated_at: generatedAt,
    snapshot_version: '0.6.2',
    material_event: materialEvent,
    payload: {
      snapshot_version: '0.6.2',
      generated_at: generatedAt,
      assets: ['BTC'],
      quotes: {
        structuredContent: {
          headers: ['symbol','price','percent_change_24h'],
          rows: [['BTC', price, -3]]
        }
      },
      microstructure: {
        assets: {
          BTC: {
            scores: {
              trap_risk_0_100: 40,
              spot_confirmation_0_100: 70,
              persistent_wall_pressure_minus100_to100: 20,
              microstructure_confidence_0_100: 80
            },
            execution_context_gate: 'NORMAL_REVIEW'
          }
        }
      },
      defi_fundamentals: { assets: {} }
    }
  };
}

const e1 = { material: true, reasons: ['BTC:price_move_-3.00pct','BTC:spot_delta_-25'], per_asset: {} };
const e2 = { material: true, reasons: ['BTC:price_move_-2.50pct','BTC:spot_delta_-20'], per_asset: {} };
const s1 = snapshotRow(1, '2026-10-13T00:00:00Z', 80000, e1);
const s2 = snapshotRow(2, '2026-10-13T06:00:00Z', 78000, e2);

const packet = buildReasoningPacket({
  queueItem: { id: 9, queue_key: 'snapshot:2:material', priority: 80, created_at: '2026-10-13T06:00:00Z', material_event: e2 },
  snapshotRow: s2,
  recentSnapshots: [s1, s2],
  latestPortfolioMark: {
    marked_at: '2026-10-13T06:00:00Z',
    total_value_usd: 10000,
    cash_usd: 3000,
    positions: { BTC: { quantity: 0.0875, price_usd: 80000, value_usd: 7000 } },
    shadow_return_pct: 0,
    hodl_return_pct: 0,
    alpha_vs_hodl_pct: 0,
    drawdown_pct: 0
  },
  recentDecisions: [],
  watchdogEvents: []
});
assert.equal(packet.policy.execution_enabled, false);
assert.equal(packet.deterministic_persistence_by_asset.BTC.confirmed, true);

const request = buildOpenAIRequest(packet, { model: 'test-model', enableWebSearch: true });
assert.equal(request.store, false);
assert.equal(request.model, 'test-model');
assert.equal(request.text.format.type, 'json_schema');
assert.equal(request.tools[0].type, 'web_search');

const baseMacro = {
  regime: 'adverse',
  liquidity: 'contracting',
  shock_risk: 'medium',
  observed_at: '2026-10-13T06:00:00Z',
  evidence: ['rates and USD unfavorable', 'risk assets weak'],
  source_quality: 'primary_reuters'
};

const aiKillSwitch = validateReasoningProposal({
  asset: 'BTC',
  action: 'MOVE_TO_USD',
  thesis: { reason: 'AI asks to bypass risk', confirmations: [], invalidations: [] },
  evidence_families: ['structure','microstructure'],
  reward_risk: null,
  entry_price_usd: null,
  invalidation_price_usd: null,
  target_price_usd: null,
  reduction_pct: 1,
  risk_pct: null,
  macro_context: baseMacro,
  data_confidence: 80,
  source_conflict: false,
  kill_switch: true
}, packet);
assert.equal(aiKillSwitch.ok, false);
assert.ok(aiKillSwitch.errors.includes('ai_cannot_activate_kill_switch'));

const validDefensive = assessReasoningProposal({
  asset: 'BTC',
  action: 'REDUCE',
  thesis: { reason: 'persistent multi-family deterioration', confirmations: ['two observations'], invalidations: ['spot recovery'] },
  evidence_families: ['structure','microstructure','macro'],
  reward_risk: null,
  entry_price_usd: null,
  invalidation_price_usd: null,
  target_price_usd: null,
  reduction_pct: 0.25,
  risk_pct: null,
  macro_context: baseMacro,
  data_confidence: 85,
  source_conflict: false,
  kill_switch: false
}, packet);
assert.equal(validDefensive.accepted, true);
assert.equal(validDefensive.paper_order.side, 'sell');
assert.ok(validDefensive.paper_order.quantity > 0);

const structureOnlyPacket = buildReasoningPacket({
  queueItem: {
    id: 10,
    queue_key: 'snapshot:4:material',
    priority: 70,
    created_at: '2026-10-13T06:00:00Z',
    material_event: { material: true, reasons: ['BTC:price_move_-3.00pct'], per_asset: {} }
  },
  snapshotRow: snapshotRow(4, '2026-10-13T06:00:00Z', 78000, { material: true, reasons: ['BTC:price_move_-3.00pct'], per_asset: {} }),
  recentSnapshots: [
    snapshotRow(3, '2026-10-13T00:00:00Z', 80000, { material: true, reasons: ['BTC:price_move_-3.00pct'], per_asset: {} }),
    snapshotRow(4, '2026-10-13T06:00:00Z', 78000, { material: true, reasons: ['BTC:price_move_-3.00pct'], per_asset: {} })
  ],
  latestPortfolioMark: packet.portfolio
});
const usdOnPriceOnly = assessReasoningProposal({
  asset: 'BTC',
  action: 'MOVE_TO_USD',
  thesis: { reason: 'price fell twice', confirmations: [], invalidations: [] },
  evidence_families: ['structure'],
  reward_risk: null,
  entry_price_usd: null,
  invalidation_price_usd: null,
  target_price_usd: null,
  reduction_pct: 1,
  risk_pct: null,
  macro_context: baseMacro,
  data_confidence: 80,
  source_conflict: false,
  kill_switch: false
}, structureOnlyPacket);
assert.equal(usdOnPriceOnly.accepted, false);
assert.ok(usdOnPriceOnly.errors.includes('defensive_change_requires_two_independent_evidence_families'));
assert.ok(usdOnPriceOnly.errors.includes('deterministic_persistence_not_confirmed'));

const buyPacket = {
  ...packet,
  portfolio: {
    ...packet.portfolio,
    cash_usd: 6000,
    positions: {}
  }
};
const buy = assessReasoningProposal({
  asset: 'BTC',
  action: 'BUY',
  thesis: { reason: 'multi-family setup', confirmations: ['spot','macro','structure'], invalidations: ['break below 74000'] },
  evidence_families: ['structure','macro','flow'],
  reward_risk: 99,
  entry_price_usd: 78000,
  invalidation_price_usd: 74000,
  target_price_usd: 90000,
  reduction_pct: null,
  risk_pct: 0.02,
  macro_context: { ...baseMacro, regime: 'favorable', liquidity: 'expanding', shock_risk: 'low' },
  data_confidence: 90,
  source_conflict: false,
  kill_switch: false
}, buyPacket, { maxRiskPct: 0.01 });
assert.equal(buy.accepted, true);
assert.equal(Number(buy.validation.normalized.reward_risk.toFixed(2)), 3);
assert.ok(buy.paper_order.risk_budget_usd <= 100.000001);

const staleMacro = validateReasoningProposal({
  asset: 'BTC',
  action: 'HOLD',
  thesis: { reason: 'stale macro test', confirmations: [], invalidations: [] },
  evidence_families: [],
  reward_risk: null,
  entry_price_usd: null,
  invalidation_price_usd: null,
  target_price_usd: null,
  reduction_pct: null,
  risk_pct: null,
  macro_context: { ...baseMacro, observed_at: '2026-10-11T06:00:00Z' },
  data_confidence: 50,
  source_conflict: false,
  kill_switch: false
}, packet);
assert.equal(staleMacro.ok, false);
assert.ok(staleMacro.errors.includes('macro_context_stale_or_unanchored'));

const mock = createReasoningProvider({ provider: 'mock' });
const mocked = await mock.reason(packet);
assert.equal(mocked.output.proposals[0].action, 'HOLD');

console.log('learning-sprint4-selftest: ok');
