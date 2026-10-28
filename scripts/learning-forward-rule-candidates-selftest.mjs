import assert from 'node:assert/strict';
import {POLICY,assessRuleCandidate} from '../src/learning/forward-rule-candidates.mjs';
const stamp=i=>new Date(Date.parse('2026-10-27T00:00:00Z')+3600000*i).toISOString();
function snap(i,{spot=25,trap=80,conf=90,fund='confirms',quality=80,venue=true,asset='BTC'}={}){
 const at=stamp(i);
 return {generated_at:at,payload:{generated_at:at,assets:[asset],
 quotes:{structuredContent:{headers:['symbol','price','quote_symbol'],rows:[[asset,100,'USD']]}},
 microstructure:{assets:{[asset]:{available:true,venue_price_check:{available:venue,material_mismatch:false},scores:{
 spot_confirmation_0_100:spot,trap_risk_0_100:trap,microstructure_confidence_0_100:conf
 }}}},
 defi_fundamentals:{assets:{AAVE:{evaluation:{confirmation:fund,fundamental_quality_0_100:quality}}}}
 }};
}
assert.equal(POLICY.execution_enabled,false);
assert.equal(POLICY.real_orders_permitted,false);
assert.equal(assessRuleCandidate([]).action,'HOLD');
assert.equal(assessRuleCandidate([snap(0)]).why,'persistence_not_confirmed');
const red=assessRuleCandidate([snap(0),snap(1)]);
assert.equal(red.action,'RESEARCH_REDUCE');
assert.equal(red.position_change_allowed,false);
assert.equal(red.macro_verified,false);
assert.equal(assessRuleCandidate([snap(0),snap(1,{spot:80,trap:10})]).action,'HOLD');
const good=assessRuleCandidate([snap(0,{spot:75,trap:20}),snap(1,{spot:75,trap:20})]);
assert.equal(good.action,'RESEARCH_REENTRY');
assert.equal(good.venue_executable,false);
assert.equal(assessRuleCandidate([snap(0),snap(1,{conf:null})]).action,'HOLD');
assert.equal(assessRuleCandidate([snap(0),snap(1,{venue:false})]).action,'HOLD');
const av=assessRuleCandidate([snap(0,{asset:'AAVE',fund:'contradicts',quality:8}),
 snap(1,{asset:'AAVE',fund:'contradicts',quality:8})],'AAVE');
assert.equal(av.action,'RESEARCH_REDUCE');
assert.equal(av.position_change_allowed,false);
assert.equal(assessRuleCandidate([snap(0)],'UNKNOWN').action,'HOLD');
console.log('forward-rule-candidates-selftest: ok');
