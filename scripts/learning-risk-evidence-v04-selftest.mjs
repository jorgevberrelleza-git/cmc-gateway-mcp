import assert from 'node:assert/strict';
import {classifyRiskEvidence, RISK_EVIDENCE_V04} from '../src/learning/risk-evidence-v04.mjs';

const at = '2026-10-29T23:00:00.000Z';
const item = (family, overrides = {}) => ({
  family, direction: 'risk', verified: true,
  source: 'saved_snapshot', observed_at: '2026-10-29T22:00:00.000Z',
  ...overrides
});
const evaluate = (asset, evidence) =>
  classifyRiskEvidence({asset, snapshotId: 'snapshot-100', asOf: at, evidence});

const two = evaluate('BTC', [
  item('structure'), item('structure', {source: 'another_price_indicator'}),
  item('microstructure'), item('portfolio'), item('macro', {primary_source: false})
]);
assert.deepEqual(two.risk_families, ['structure', 'microstructure']);
assert.equal(two.independent_risk_family_count, 2);
assert.deepEqual(two.rejected_evidence.map(x => x.reason), [
  'duplicate_family', 'non_directional_or_unknown_family', 'macro_primary_source_required'
]);
assert.equal(two.state_transition_allowed, false);
assert.equal(two.paper_fill_allowed, false);
assert.equal(two.position_change_allowed, false);
assert.equal(two.orders_created, 0);
assert.equal(two.execution_enabled, false);

const future = evaluate('ADA', [
  item('structure', {observed_at: '2026-10-30T00:00:00Z'}),
  item('microstructure', {observed_at: 'bad'}),
  item('macro', {primary_source: true, source: 'Federal Reserve'}),
  item('structure', {verified: false})
]);
assert.deepEqual(future.risk_families, ['macro']);
assert.equal(future.rejected_evidence.length, 3);
assert.equal(evaluate('BTC', [item('fundamentals')]).independent_risk_family_count, 0);
assert.deepEqual(evaluate('AAVE', [item('fundamentals')]).risk_families, ['fundamentals']);
assert.equal(evaluate('AAVE', [item('microstructure', {source: ''})]).independent_risk_family_count, 0);
assert.throws(() => evaluate('ETH', []), /unsupported_asset/);
assert.throws(() => classifyRiskEvidence({asset: 'BTC', snapshotId: '1', asOf: 'bad'}), /valid_as_of_required/);
assert.throws(() => classifyRiskEvidence({asset: 'BTC', snapshotId: '1', asOf: at, evidence: {}}), /evidence_must_be_array/);
assert.equal(RISK_EVIDENCE_V04.execution_enabled, false);
console.log('risk-evidence-v04 selftest passed: independent families, macro provenance, no lookahead, no execution');
