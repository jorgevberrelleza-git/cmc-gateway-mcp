import assert from 'node:assert/strict';
import {decideCmcMcpProbe} from '../src/learning/cmc-mcp-circuit.mjs';
import {planShadowSkillWork} from '../src/learning/skill-orchestrator.mjs';
function r(hr,provenance,mat=null){
 const t=new Date(Date.parse('2026-10-22T00:00:00Z')+hr*3600000).toISOString();
 return {generated_at:t,payload:{
   generated_at:t,assets:['BTC','ADA','AAVE'],
   quote_provenance:provenance,
   quotes:{structuredContent:{headers:['symbol','price','quote_symbol'],rows:[['BTC',82000,'USD'],['ADA',0.2,'USD'],['AAVE',150,'USD']]}},
   microstructure:{assets:{BTC:{available:true,venue_price_check:{available:true}},ADA:{available:true,venue_price_check:{available:true}},AAVE:{available:false}}}
 },material_event:mat};
}
const fail={source:'coinpaprika_public',mcp_probe_attempted:true,mcp_failure_class:'unclassified_upstream_error'};
const failureHistory=[r(0,fail),r(1,fail),r(2,fail)];
let policy=decideCmcMcpProbe(failureHistory,{now:new Date('2026-10-22T02:10:00Z')});
assert.equal(policy.attempt,false);
assert.equal(policy.reason,'recent_upstream_failures');
assert.equal(policy.cooldown_hours>0,true);
assert.equal(decideCmcMcpProbe(failureHistory,{now:new Date('2026-10-22T08:00:00Z')}).attempt,true);
assert.equal(decideCmcMcpProbe(failureHistory,{now:new Date('2026-10-22T02:10:00Z'),enabled:false}).attempt,true);
const skipped=r(3,{source:'coinpaprika_public',mcp_probe_attempted:false,mcp_failure_class:'circuit_open'});
assert.equal(decideCmcMcpProbe([...failureHistory,skipped],{now:new Date('2026-10-22T04:00:00Z')}).attempt,false);
const healthy=r(3,{source:'cmc_mcp',mcp_probe_attempted:true,mcp_failure_class:null});
assert.equal(decideCmcMcpProbe([...failureHistory,healthy],{now:new Date('2026-10-22T04:00:00Z')}).attempt,true);

const report=planShadowSkillWork([
 ...failureHistory,r(3,fail,{material:true,reasons:['BTC:price_move_4.2pct']})
],{now:new Date('2026-10-22T04:00:00Z')});
assert.equal(report.contract_version,'shadow_cmc_marketplace_orchestrator_v0.1');
assert.equal(report.highest_priority.id,'provider_recovery');
assert.equal(report.sample.primary_mcp_failures,4);
assert.equal(report.sample.venue_comparison_available.BTC,true);
assert.equal(report.sample.venue_comparison_available.AAVE,false);
assert.equal(report.authenticated_CMC_Pro_API_requests_authorized,false);
assert.equal(report.external_calls_made,0);
assert.equal(report.paid_ai_calls_made,0);
assert.equal(report.execution_enabled,false);
assert.equal(report.automatic_real_money_orders_allowed,false);
assert.ok(report.next_workflows.find(x=>x.id==='macro_attestation'));
console.log('learning-skills-selftest: ok');
