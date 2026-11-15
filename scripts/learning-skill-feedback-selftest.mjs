import assert from 'node:assert/strict';
import {evaluateDailySkillFeedback as run} from '../src/learning/skill-feedback-v01.mjs';
const t=(h)=>new Date(Date.parse('2026-11-10T00:00:00Z')+h*3600000).toISOString();
function snap(h,btc=100,aave=50,ada=.3){
 return {generated_at:t(h),payload:{generated_at:t(h),assets:['BTC','ADA','AAVE'],
  quote_provenance:{source:'coinpaprika_public'},
  quotes:{structuredContent:{headers:['symbol','price','quote_symbol'],
   rows:[['BTC',btc,'USD'],['ADA',ada,'USD'],['AAVE',aave,'USD']]}}}};
}
function evalAt(h,asset,signal,{venue=true,createdOffsetMin=1,source='coinpaprika_public',price=100}={}){
 return {strategy_version:'shadow_rules_v0.3_research',generated_at:t(h),
  created_at:new Date(Date.parse(t(h))+createdOffsetMin*60000).toISOString(),
  asset_assessments:{[asset]:{research_signal:signal,quote_price_usd:price,
   venue_verified:venue,source_quality_passed:true,quote_source:source}}};
}
const btc=evalAt(0,'BTC','PAPER_REDUCE_REVIEW');
const overlapping=evalAt(1,'BTC','PAPER_REDUCE_REVIEW');
const aave=evalAt(0,'AAVE','RISK_RESEARCH_VENUE_BLOCKED',{venue:false,price:50});
const badSource=evalAt(0,'ADA','RISK_WATCH_UNCONFIRMED',{source:'unknown',price:.3});
const obs=[snap(0),snap(24,90),snap(72,85),snap(90,88)];
const out=run({snapshots:obs,evaluations:[btc,overlapping,aave,badSource],
 now:new Date(t(90))});
assert.equal(out.action_executed,'evaluate_persisted_forward_signals_24h_72h');
assert.equal(out.non_hold_alerts_seen,4);
assert.equal(out.nonoverlapping_alerts,2);
assert.equal(out.overlapping_alerts_excluded,1);
assert.equal(out.source_quality_signals_excluded,1);
assert.equal(out.horizons['24h'].matured_observational,1);
assert.equal(out.horizons['24h'].venue_blocked,1);
assert.equal(out.horizons['24h'].observational_hit_rate_pct,100);
assert.equal(out.horizons['24h'].illustrative_risk_reduction_alpha_pp,4.65);
assert.equal(out.horizons['72h'].matured_observational,1);
assert.equal(out.horizons['72h'].illustrative_risk_reduction_alpha_pp,7.15);
assert.equal(out.horizons['24h'].independently_attested,0);
assert.equal(out.orders_created,0);
assert.equal(out.execution_enabled,false);
assert.equal(out.external_calls_made,0);
assert.equal(out.paid_ai_calls_made,0);
// Fail closed when a "historical" signal was actually inserted after the 15-min attestation window.
const fake=run({snapshots:obs,evaluations:[evalAt(0,'BTC','PAPER_REDUCE_REVIEW',{createdOffsetMin:180})],
 now:new Date(t(90))});
assert.equal(fake.provenance_attested_events,0);
assert.equal(fake.horizons['24h'].ex_ante_unattested,1);
assert.equal(fake.horizons['24h'].matured_observational,0);
// Fail closed on missing post-horizon observation (do not use a pre-horizon price).
const empty=run({snapshots:[snap(0),snap(22,80)],evaluations:[btc],now:new Date(t(90))});
assert.equal(empty.horizons['24h'].missing_future_quote,1);
// Strict boundary: no future prices used before horizon matures.
const pending=run({snapshots:[...obs,snap(200,1)],evaluations:[btc],now:new Date(t(23))});
assert.equal(pending.horizons['24h'].pending,1);
assert.equal(pending.horizons['24h'].matured_observational,0);
// No fabricated source-level attestation.
assert.equal(run({snapshots:[],evaluations:[btc],now:new Date(t(90))}).horizons['24h'].matured_observational,0);
console.log('skill-feedback-v01-selftest: ok');