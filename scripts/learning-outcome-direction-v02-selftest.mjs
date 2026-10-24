import assert from 'node:assert/strict';
import { summarizeDirectionalCohorts } from '../src/learning/outcome-direction-v02.mjs';

const diagnostic = summarizeDirectionalCohorts([
  { snapshot_id: '1', research_candidate: true, assets: { BTC: { available: true, return_pct: 2 }, ADA: { available: true, return_pct: -4 } } },
  { snapshot_id: '2', research_candidate: true, assets: { BTC: { available: true, return_pct: -1 } } },
  { snapshot_id: '3', research_candidate: false, assets: { BTC: { available: true, return_pct: -3 }, ADA: { available: false, reason: 'quote_missing' } } },
  { snapshot_id: '4', research_candidate: false, assets: { BTC: { available: true, return_pct: 1 } } }
]);
assert.equal(diagnostic.cohorts.research_candidate.assets.BTC.n, 2);
assert.equal(diagnostic.cohorts.research_candidate.assets.BTC.mean_signed_return_pct, 0.5);
assert.equal(diagnostic.cohorts.research_candidate.assets.BTC.positive_rate_pct, 50);
assert.equal(diagnostic.cohorts.research_candidate.assets.ADA.mean_signed_return_pct, -4);
assert.equal(diagnostic.cohorts.filtered_context.assets.BTC.mean_signed_return_pct, -1);
assert.equal(diagnostic.cohorts.filtered_context.assets.ADA, undefined);
assert.equal(diagnostic.execution_enabled, false);
assert.equal(summarizeDirectionalCohorts().cohorts.research_candidate.assets.BTC, undefined);
console.log('learning-outcome-direction-v02-selftest: ok');
