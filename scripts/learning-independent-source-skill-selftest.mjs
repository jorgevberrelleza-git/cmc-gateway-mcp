import assert from 'node:assert/strict';
import {planShadowSkillWork} from '../src/learning/skill-orchestrator.mjs';
const start=Date.parse('2026-11-12T00:00:00Z');
function snap(h,{primaryOK=true}={}){
 const t=new Date(start+h*3600000).toISOString();
 return {generated_at:t,material_event:{material:false,reasons:[]},payload:{
  generated_at:t,assets:['BTC','AAVE','ADA'],
  quote_provenance:{
    source:primaryOK?'coinpaprika_public':'cmc_public_v3_keyless',
    coinpaprika_primary_attempted:true,
    coinpaprika_primary_error_class:primaryOK?null:'paprika_http_503',
    routing_policy:{mode:'paprika_first',primary_succeeded:primaryOK}
  },
  quotes:{structuredContent:{headers:['symbol','price','quote_symbol'],rows:[
    ['BTC',65000-h*2,'USD'],['AAVE',75,'USD'],['ADA',.25,'USD']
  ]}},
  microstructure:{assets:{BTC:{venue_price_check:{available:true}},
    ADA:{venue_price_check:{available:true}},AAVE:{venue_price_check:{available:false}}}}
 }};
}
const now=new Date(start+23*3600000+60000);
const all=Array.from({length:24},(_,h)=>snap(h));
const report=planShadowSkillWork(all,{now});
assert.equal(report.sample.independent_primary_attempts,24);
assert.equal(report.sample.independent_primary_success_runs,24);
assert.equal(report.sample.independent_primary_failure_runs,0);
assert.equal(report.sample.cmc_emergency_failover_runs,0);
assert.equal(report.sample.primary_mcp_failures,0);
assert.ok(report.local_skill_catalog.some(x=>x.id==='shadow_independent_quote_quality'));
const quality=report.next_workflows.find(x=>x.id==='independent_quote_quality');
assert.ok(quality);
assert.equal(quality.primary_success_rate_pct,100);
assert.equal(quality.aave_venue_verified,false);
assert.equal(report.execution_enabled,false);
assert.equal(report.paid_ai_calls_made,0);
const degraded=planShadowSkillWork(all.map((x,i)=>i<4?snap(i,{primaryOK:false}):x),{now});
const priority=degraded.highest_priority;
assert.equal(priority.id,'independent_quote_quality');
assert.equal(priority.primary_failure_runs,4);
assert.equal(priority.cmc_emergency_failovers,4);
assert.equal(priority.priority,125);
assert.equal(degraded.external_calls_made,0);
console.log('independent-source-skill-selftest: ok');