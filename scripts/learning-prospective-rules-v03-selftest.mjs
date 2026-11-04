import assert from 'node:assert/strict';
import {evaluateForwardRules,FORWARD_RULES_V03} from '../src/learning/prospective-rules-v03.mjs';
const base=Date.parse('2026-10-27T14:00:00Z');
const at=i=>new Date(base+i*3600000).toISOString();
function snap(i,{spot=20,trap=80,confidence=80,day=-4,week=-6,
  source='coinpaprika_public',venue=true,adaVenue=true,aaveVenue=false,
  confirm='contradicts',quality=8,price=100}={}){
 const assets=['BTC','ADA','AAVE'];
 const micro=Object.fromEntries(assets.map(a=>[a,{available:a==='AAVE'?aaveVenue:true,
  venue_price_check:{available:a==='AAVE'?aaveVenue:(a==='ADA'?adaVenue:venue),material_mismatch:false},
  scores:{spot_confirmation_0_100:spot,trap_risk_0_100:trap,
   microstructure_confidence_0_100:confidence}}]));
 const payload={generated_at:at(i),assets,
  quote_provenance:{source},
  quotes:{structuredContent:{headers:['symbol','price','quote_symbol','percent_change_24h','percent_change_7d'],rows:assets.map(a=>[a,price,'USD',day,week])}},
  microstructure:{assets:micro},defi_fundamentals:{assets:{
   AAVE:{evaluation:{confirmation:confirm,fundamental_quality_0_100:quality}}
  }}};
 return {id:String(i+1),generated_at:at(i),payload};
}
const r=e=>evaluateForwardRules({previousRow:snap(0),currentRow:snap(1),now:new Date(at(1)),...e});
const strong=r();
assert.equal(strong.strategy_version,FORWARD_RULES_V03.version);
assert.equal(strong.assets.BTC.research_signal,'PAPER_REDUCE_REVIEW');
assert.equal(strong.assets.BTC.action,'HOLD');
assert.equal(strong.assets.BTC.position_change_allowed,false);
assert.equal(strong.assets.BTC.risk_families.length,2);
assert.equal(strong.assets.AAVE.research_signal,'RISK_RESEARCH_VENUE_BLOCKED');
assert.equal(strong.assets.AAVE.risk_families.length,3);
assert.equal(strong.assets.AAVE.venue_verified,false);
assert.equal(strong.guardrails.orders_created,0);
assert.equal(strong.guardrails.portfolio_ledger_modified,false);
assert.equal(strong.execution_enabled,false);
const firstOnly=evaluateForwardRules({currentRow:snap(1),now:new Date(at(1))});
assert.equal(firstOnly.assets.BTC.research_signal,'RISK_WATCH_UNCONFIRMED');
assert.equal(firstOnly.assets.BTC.action,'HOLD');
const late=evaluateForwardRules({previousRow:snap(0),currentRow:snap(1),
 now:new Date(base+4*3600000)});
assert.equal(late.assets.BTC.source_quality_passed,false);
assert.equal(late.assets.BTC.research_signal,'HOLD_RESEARCH');
const future=evaluateForwardRules({previousRow:snap(1),currentRow:snap(0),now:new Date(at(1))});
assert.equal(future.confirmation_gap_valid,false);
assert.equal(future.assets.BTC.research_signal,'RISK_WATCH_UNCONFIRMED');
const source=r({currentRow:snap(1,{source:'unknown_url'})});
assert.equal(source.assets.BTC.research_signal,'HOLD_RESEARCH');
assert.equal(source.assets.BTC.source_quality_passed,false);
const noPrice=r({currentRow:snap(1,{price:0})});
assert.equal(noPrice.assets.BTC.research_signal,'HOLD_RESEARCH');
const noMicro=r({currentRow:snap(1,{spot:null,trap:null})});
assert.equal(noMicro.assets.BTC.risk_families.length,1);
assert.equal(noMicro.assets.BTC.research_signal,'HOLD_RESEARCH');
const single=r({currentRow:snap(1,{day:3,week:-6})});
assert.equal(single.assets.BTC.risk_families.length,1);
assert.equal(single.assets.BTC.research_signal,'HOLD_RESEARCH');
const recovery=r({previousRow:snap(0,{spot:85,trap:15,day:4,week:3,confirm:'confirms',quality:90}),
 currentRow:snap(1,{spot:85,trap:15,day:4,week:3,confirm:'confirms',quality:90})});
assert.equal(recovery.assets.BTC.research_signal,'RECOVERY_WATCH_MACRO_UNVERIFIED');
assert.equal(recovery.assets.BTC.action,'HOLD');
assert.equal(recovery.assets.AAVE.research_signal,'RECOVERY_WATCH_VENUE_BLOCKED');
assert.equal(recovery.guardrails.paid_ai_calls_made,0);
// A future observation is not an input; a separate future row cannot
// influence an immutable decision already emitted for previous and current.
const event=JSON.stringify(r({previousRow:snap(0),currentRow:snap(1)}));
const after=snap(2,{day:30,week:50,spot:95,trap:0});
assert.equal(event,JSON.stringify(r({previousRow:snap(0),currentRow:snap(1)})));
assert.notEqual(after.payload.quotes.structuredContent.rows[0][3],-4);
console.log('learning-prospective-rules-v03-selftest: ok');
