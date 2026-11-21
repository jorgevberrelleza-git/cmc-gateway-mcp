import assert from 'node:assert/strict';
import { evaluateDefensivePersistence } from '../src/learning/persistence.mjs';
import { validateShadowDecision } from '../src/learning/decision.mjs';
import { calculatePaperBuySize, calculateRewardRisk } from '../src/learning/sizing.mjs';
import { dueHorizons, evaluateSpotDecisionOutcome } from '../src/learning/outcome-evaluator.mjs';
import { validateMacroContext } from '../src/learning/macro-contract.mjs';

const oneObservation = evaluateDefensivePersistence([
  { observed_at: '2026-10-13T00:00:00Z', evidence_families: ['structure', 'relative_strength'] }
]);
assert.equal(oneObservation.confirmed, false);

const structureOnlyRepeated = evaluateDefensivePersistence([
  { observed_at: '2026-10-13T00:00:00Z', evidence_families: ['structure'] },
  { observed_at: '2026-10-13T06:00:00Z', evidence_families: ['structure'] }
]);
assert.equal(structureOnlyRepeated.confirmed, false, 'price/structure alone must never satisfy defensive persistence');

const persistent = evaluateDefensivePersistence([
  { observed_at: '2026-10-13T00:00:00Z', evidence_families: ['structure', 'relative_strength', 'fundamentals'] },
  { observed_at: '2026-10-13T06:00:00Z', evidence_families: ['structure', 'relative_strength'] }
]);
assert.equal(persistent.confirmed, true);
assert.deepEqual(persistent.common_families.sort(), ['relative_strength', 'structure']);

const stalePersistence = evaluateDefensivePersistence([
  { observed_at: '2026-10-13T00:00:00Z', evidence_families: ['structure', 'relative_strength'] },
  { observed_at: '2026-10-14T00:30:00Z', evidence_families: ['structure', 'relative_strength'] }
]);
assert.equal(stalePersistence.confirmed, false, 'widely separated stale observations must not confirm by default');

const dailyClose = evaluateDefensivePersistence([
  { observed_at: '2026-10-13T06:00:00Z', evidence_families: ['structure', 'relative_strength'] }
], { daily_close_confirmed: true });
assert.equal(dailyClose.confirmed, true);

const defensiveRejected = validateShadowDecision({
  asset: 'AAVE',
  action: 'REDUCE',
  evidence_families: ['structure', 'relative_strength'],
  persistence: { confirmed: false },
  thesis: { reason: 'single observation only' },
  macro_context: { regime: 'neutral' },
  execution_enabled: false
});
assert.equal(defensiveRejected.ok, false);
assert.ok(defensiveRejected.errors.includes('defensive_change_requires_persistence_confirmation'));

const priceDropOnly = validateShadowDecision({
  asset: 'AAVE',
  action: 'MOVE_TO_USD',
  evidence_families: ['structure'],
  persistence: { confirmed: true },
  thesis: { reason: 'price broke support' },
  macro_context: { regime: 'neutral' },
  execution_enabled: false
});
assert.equal(priceDropOnly.ok, false, 'price/structure alone must never force USD');
assert.ok(priceDropOnly.errors.includes('defensive_change_requires_two_independent_evidence_families'));
assert.ok(priceDropOnly.errors.includes('price_or_structure_break_alone_cannot_force_usd'));

const defensiveAccepted = validateShadowDecision({
  asset: 'AAVE',
  action: 'REDUCE',
  evidence_families: ['structure', 'relative_strength'],
  persistence: persistent,
  thesis: { reason: 'persistent deterioration' },
  macro_context: { regime: 'adverse' },
  execution_enabled: false
});
assert.equal(defensiveAccepted.ok, true);

const fundamentalsOnlyBuy = validateShadowDecision({
  asset: 'AAVE',
  action: 'BUY',
  evidence_families: ['fundamentals'],
  reward_risk: 3,
  persistence: { confirmed: true },
  thesis: { reason: 'fundamentals improved' },
  macro_context: { regime: 'favorable' },
  execution_enabled: false
});
assert.equal(fundamentalsOnlyBuy.ok, false);
assert.ok(fundamentalsOnlyBuy.errors.includes('buy_requires_three_independent_evidence_families'));
assert.ok(fundamentalsOnlyBuy.errors.includes('defi_fundamentals_cannot_create_buy_signal'));

const weakRewardRiskBuy = validateShadowDecision({
  asset: 'BTC',
  action: 'BUY',
  evidence_families: ['structure', 'macro', 'flow'],
  reward_risk: 1.5,
  thesis: { reason: 'setup exists but reward/risk is insufficient' },
  macro_context: { regime: 'favorable' },
  execution_enabled: false
});
assert.equal(weakRewardRiskBuy.ok, false);
assert.ok(weakRewardRiskBuy.errors.includes('buy_requires_reward_risk_at_least_2'));

const executionAttempt = validateShadowDecision({
  asset: 'BTC',
  action: 'HOLD',
  evidence_families: [],
  thesis: { reason: 'test' },
  macro_context: { regime: 'neutral' },
  execution_enabled: true
});
assert.equal(executionAttempt.ok, false);
assert.ok(executionAttempt.errors.includes('shadow_engine_cannot_enable_execution'));

const rr = calculateRewardRisk({ entry_price: 100, invalidation_price: 90, target_price: 125 });
assert.equal(rr, 2.5);

const size = calculatePaperBuySize({
  portfolio_value_usd: 10000,
  available_cash_usd: 2000,
  entry_price_usd: 100,
  invalidation_price_usd: 90,
  current_position_usd: 0,
  risk_pct: 0.01,
  max_position_pct: 0.20,
  max_new_exposure_pct: 0.10,
  fee_rate: 0.001,
  slippage_bps: 10
});
assert.ok(size.notional_usd <= 1000.000001);
assert.equal(size.execution_enabled, false);

const outcome = evaluateSpotDecisionOutcome({
  action: 'BUY',
  reference_price_usd: 100,
  current_price_usd: 110,
  notional_usd: 1000,
  estimated_fee_usd: 1,
  estimated_slippage_usd: 1
});
assert.ok(outcome.strategy_return_pct > 9.7 && outcome.strategy_return_pct < 10);

const due = dueHorizons('2026-10-01T00:00:00Z', [], new Date('2026-10-02T01:00:00Z'));
assert.deepEqual(due, ['4h', '24h']);

const macro = validateMacroContext({
  regime: 'neutral',
  liquidity: 'stable',
  shock_risk: 'medium',
  observed_at: '2026-10-13T05:00:00Z',
  evidence: ['USD/yields mixed', 'crypto spot stabilizing']
});
assert.equal(macro.ok, true);

console.log('learning-sprint2-selftest: ok');
