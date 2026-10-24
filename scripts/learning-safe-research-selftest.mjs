import assert from 'node:assert/strict';
import {classifyResearchQueueEvent} from '../src/learning/research-queue-gate.mjs';
import {predeclaredHypothesis,evaluateWalkforward} from '../src/learning/walkforward-v01.mjs';
import {summarizeCmcThrownError} from '../src/cmc-public-quotes.mjs';

function event(...reasons){return {material:true,reasons};}
const weak=event('BTC:wall_delta_40','BTC:trap_delta_22');
const strong=event('BTC:spot_delta_30','BTC:wall_delta_-70','BTC:trap_delta_25');
assert.equal(classifyResearchQueueEvent(weak,{enabled:false}).should_queue,true);
assert.equal(classifyResearchQueueEvent(weak,{enabled:true}).should_queue,false);
assert.equal(classifyResearchQueueEvent(strong,{enabled:true}).should_queue,true);
assert.equal(classifyResearchQueueEvent(event('BTC:price_move_-3.15pct'),{enabled:true}).should_queue,true);
assert.equal(classifyResearchQueueEvent(event('AAVE:fundamental_quality_delta_-27'),{enabled:true}).should_queue,true);
assert.equal(classifyResearchQueueEvent(event('BTC:gate_NORMAL_to_BLOCK_NEW_ENTRY_UNTIL_CLEANER_DATA'),{enabled:true}).should_queue,true);
assert.equal(classifyResearchQueueEvent(event('BTC:unknown_critical'),{enabled:true}).should_queue,true);
assert.equal(classifyResearchQueueEvent({material:false,reasons:[]},{enabled:true}).should_queue,false);
const err=summarizeCmcThrownError({name:'McpError',code:1008,message:'Rate limit key=SECRET_TOKEN 1008'});
assert.equal(err.category,'rate_limited');
assert.equal(err.numeric_code,1008);
assert.ok(!JSON.stringify(err).includes('SECRET_TOKEN'));

function snap(at,px,spot=70,trap=20,{blocked=false,source='coinpaprika_public'}={}){
 const assets=['BTC','ADA','AAVE'];
 const micro={BTC:{available:true,venue_price_check:{available:true,material_mismatch:false},scores:{
  spot_confirmation_0_100:spot,trap_risk_0_100:trap,microstructure_confidence_0_100:90
 }},ADA:{available:false},AAVE:{available:false}};
 return {generated_at:new Date(at).toISOString(),payload:{
  generated_at:new Date(at).toISOString(),assets,
  quotes:{structuredContent:{headers:['symbol','price','quote_symbol'],rows:[
   ['BTC',px,'USD'],['ADA',0.2,'USD'],['AAVE',150,'USD']
  ]}},
  microstructure:{assets:micro},quote_provenance:{source}
 }};
}
const base=Date.parse('2026-10-01T00:00:00Z');
const rows=Array.from({length:36},(_,i)=>snap(base+i*4*3600000,100*(1+i*0.01)));
const first=evaluateWalkforward(rows,{now:new Date(base+36*4*3600000+3600000)});
assert.equal(first.no_lookahead,true);
assert.equal(first.assets.BTC.test.statistically_actionable,undefined);
assert.equal(first.assets.BTC.statistically_actionable,false);
assert.ok(first.assets.BTC.train.long_hypotheses>0);
assert.ok(first.assets.BTC.test.long_hypotheses>0);
assert.ok(first.assets.BTC.test.mean_signal_strategy_return_pct<first.assets.BTC.test.mean_hodl_same_windows_pct,
  'transaction costs must reduce performance on identical long windows');
assert.equal(predeclaredHypothesis(rows[0].payload,'BTC').signal,'LONG_HYPOTHESIS');
const modified=rows.map((r,i)=>i===2?snap(base+i*4*3600000,9000):r);
assert.equal(predeclaredHypothesis(modified[0].payload,'BTC').signal,
  predeclaredHypothesis(rows[0].payload,'BTC').signal,'future price cannot change t0 signal');
const stale=evaluateWalkforward(rows,{now:new Date(base+8*4*3600000)});
assert.ok(stale.snapshots<first.snapshots);
assert.equal(stale.position_change_allowed,false);
assert.equal(first.execution_enabled,false);
// A missing spot observation is unknown, not observed 0 and not a cash signal.
// It must not contaminate the OOS return comparison.
const missingMicro = snap(base,100,null,20).payload;
assert.deepEqual(predeclaredHypothesis(missingMicro,'BTC'),{
  signal:'NO_DATA',why:'insufficient_microstructure'
});
const rowsWithGap=rows.map((r,i)=>i===24?snap(base+i*4*3600000,100*(1+i*0.01),null,20):r);
const gaps=evaluateWalkforward(rowsWithGap,{now:new Date(base+36*4*3600000+3600000)});
assert.ok(gaps.assets.BTC.test.excluded_no_data_windows>=1);
assert.ok(gaps.assets.BTC.test.reason_counts.insufficient_microstructure>=1);
assert.equal(gaps.assets.BTC.test.comparable_windows+gaps.assets.BTC.test.excluded_no_data_windows,
  gaps.assets.BTC.test.windows);
assert.ok(Math.abs(first.assets.BTC.test.mean_excess_vs_hodl_pp+0.7)<0.0001,
  'missing spread must invoke the full 30bps fallback, not be mistaken for spread=0');
assert.equal(first.assets.BTC.test.excluded_no_data_windows,0);

console.log('learning-safe-research-selftest: ok');
