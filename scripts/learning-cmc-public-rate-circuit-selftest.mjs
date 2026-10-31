import assert from 'node:assert/strict';
import {decideCmcPublicProbe,CMC_PUBLIC_RATE_POLICY} from '../src/learning/cmc-public-rate-circuit.mjs';
const base=Date.parse('2026-10-27T00:00:00Z');
const row=(hours,error,attempted=true)=>({
 generated_at:new Date(base+hours*3600000).toISOString(),
 payload:{quote_provenance:{
  public_fallback_attempted:attempted,
  public_fallback_error_class:error
 }}
});
const prior=[row(0,'cmc_public_http_429'),row(1,'cmc_public_http_429')];
assert.equal(CMC_PUBLIC_RATE_POLICY.paid_calls_permitted,0);
assert.equal(decideCmcPublicProbe(prior,{now:new Date(base+1.5*3600000)}).attempt,true,
 'default flag disabled cannot change production request pattern');
const state=decideCmcPublicProbe(prior,{enabled:true,now:new Date(base+1.5*3600000)});
assert.equal(state.attempt,false);
assert.equal(state.reason,'recent_429_cooldown');
assert.equal(state.observed_429,2);
assert.ok(state.cooldown_hours>0);
assert.equal(decideCmcPublicProbe(prior,{enabled:true,now:new Date(base+4.1*3600000)}).attempt,true);
assert.equal(decideCmcPublicProbe([row(0,'cmc_public_http_429')],{
 enabled:true,now:new Date(base+0.5*3600000)}).attempt,true);
assert.equal(decideCmcPublicProbe([row(0,'cmc_public_http_429',false),row(1,'cmc_public_http_429')],{
 enabled:true,now:new Date(base+1.5*3600000)}).attempt,true,
 'skipped calls must not count as 429 failures');
assert.equal(decideCmcPublicProbe([row(-12,'cmc_public_http_429'),row(-9,'cmc_public_http_429')],{
 enabled:true,now:new Date(base)}).attempt,true,'stale historical errors must expire');
assert.equal(decideCmcPublicProbe([row(0,'cmc_public_http_429'),row(1,null),row(2,'cmc_public_http_429')],{
 enabled:true,now:new Date(base+2.5*3600000)}).attempt,false,
 'rate limits must be throttled even with intervening successes');
assert.equal(decideCmcPublicProbe([row(0,'cmc_public_http_429'),row(1,'cmc_public_http_429')],{
 enabled:true,now:new Date(base+20*3600000)}).attempt,true,
 'never disable fallback forever');
// Regression from production: a 429 from t=0 falls outside the rolling
// 6-hour lookback at t=7, but a new 429 at t=5.5 must still cause a 3h pause.
const latePair=[row(0,'cmc_public_http_429'),row(5.5,'cmc_public_http_429')];
const between=decideCmcPublicProbe(latePair,{
  enabled:true,now:new Date(base+7*3600000)
});
assert.equal(between.attempt,false,'do not reopen REST early when first 429 ages out');
assert.equal(between.reason,'recent_429_cooldown');
assert.ok(between.cooldown_hours>0);
assert.equal(decideCmcPublicProbe(latePair,{
  enabled:true,now:new Date(base+8.6*3600000)
}).attempt,true,'after the final 429 + 3h permit one recovery probe');
assert.equal(decideCmcPublicProbe([row(0,'cmc_public_http_429'),row(6.5,'cmc_public_http_429')],{
 enabled:true,now:new Date(base+7*3600000)
}).attempt,true,'failures separated by >6h do not form a cluster');
console.log('learning-cmc-public-rate-circuit-selftest: ok');
