import assert from 'node:assert/strict';
import { evaluateEventOutcomeV02, summarizeOutcomeCohorts } from '../src/learning/outcome-validation-v02.mjs';
import { buildSelectiveResearchRequest, attestResearchBundle } from '../src/learning/research-gate-v02.mjs';

const snap = price => ({
  quotes: { content: [{ type: 'text', text: JSON.stringify({ headers:['symbol','price'], rows:[['BTC',price]] }) }] }
});
const out = evaluateEventOutcomeV02({
  eventSnapshot: snap(100),
  laterSnapshot: snap(102),
  materialEvent: { reasons:['BTC:spot_delta_30'] }
});
assert.equal(out.assets.BTC.return_pct, 2);
assert.equal(out.directional_move_ge_2pct, true);

const summary = summarizeOutcomeCohorts([
  { research_candidate:true, max_abs_return_pct:2.2 },
  { research_candidate:false, max_abs_return_pct:0.4 }
]);
assert.equal(summary.research_candidate.move_ge_2pct_rate, 100);
assert.equal(summary.filtered_context.move_ge_1pct_rate, 0);

const req = buildSelectiveResearchRequest({
  evaluation: { event_quality:{research_candidate:true}, regime_evidence:{news_catalyst_gate:{near_term_catalyst_risk:'unknown'}} },
  assets:['btc']
});
assert.equal(req.research_required, true);
assert.equal(req.budget_policy.paid_ai_default, false);

const att = attestResearchBundle({
  fetched_at:'2026-10-14T10:00:00Z',
  verified_by:'authoritative_fetch',
  provider_attested:true,
  sources:[
    {url:'https://www.federalreserve.gov/a',kind:'central_bank',fetched_ok:true},
    {url:'https://www.sec.gov/b',kind:'regulator',fetched_ok:true}
  ]
},{referenceTime:'2026-10-14T11:00:00Z'});
assert.equal(att.attested, true);
assert.equal(att.exposure_change_allowed, true);

console.log('learning-v02-ab-selftest: ok');
