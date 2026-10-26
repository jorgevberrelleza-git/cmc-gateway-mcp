import assert from 'node:assert/strict';
import {targetDefensiveExposure,simulateDefensiveAsset,evaluateDefensivePortfolio} from '../src/learning/defensive-paper-sim.mjs';
const at=i=>new Date(Date.parse('2026-10-01T00:00:00Z')+4*3600000*i).toISOString();
function snap(i,p,{spot=25,trap=85,confidence=90,gate='BLOCK_NEW_ENTRY_UNTIL_CLEANER_DATA',fund='contradicts'}={}){
 const assets=['BTC','ADA','AAVE'];
 const q=assets.map(x=>[x,p,'USD']);
 const m=Object.fromEntries(assets.map(asset=>[asset,{
   available:true,venue_price_check:{available:true,material_mismatch:false},
   scores:{spot_confirmation_0_100:spot,trap_risk_0_100:trap,microstructure_confidence_0_100:confidence},
   execution_context_gate:gate
 }]));
 return {generated_at:at(i),payload:{generated_at:at(i),assets,
   quotes:{structuredContent:{headers:['symbol','price','quote_symbol'],rows:q}},
   microstructure:{assets:m},
   defi_fundamentals:{assets:{AAVE:{evaluation:{
      confirmation:fund,fundamental_quality_0_100:fund==='contradicts'?8:80
   }}}}
 }};
}
const rows=Array.from({length:60},(_,i)=>snap(i,100-i));
assert.equal(targetDefensiveExposure(rows[0].payload,'BTC','partial'),0.5);
assert.equal(targetDefensiveExposure(rows[0].payload,'AAVE','dynamic'),0.25);
assert.equal(targetDefensiveExposure(rows[0].payload,'BTC','cash'),0);
const hold=simulateDefensiveAsset(rows,'BTC','hodl');
const partial=simulateDefensiveAsset(rows,'BTC','partial');
const dynamic=simulateDefensiveAsset(rows,'BTC','dynamic');
const cash=simulateDefensiveAsset(rows,'BTC','cash');
assert.equal(hold.trades,0);
assert.equal(cash.trades,0);
assert.equal(cash.final_value_usd,1000);
assert.ok(partial.trades>=1 && dynamic.trades>=1);
assert.ok(partial.net_return_pct>hold.net_return_pct,'defensive strategy should reduce losses in monotonic decline');
assert.ok(partial.max_drawdown_pct>hold.max_drawdown_pct);
assert.ok(partial.estimated_total_cost_usd>0);
assert.ok(partial.trades < 20, 'hysteresis avoids oscillating');
assert.ok(partial.trade_log.every(x=>Date.parse(x.executed_at)>Date.parse(x.signal_at)));
assert.ok(partial.final_cash_usd>=0);
const changed=rows.map((r,i)=>i===2?snap(i,100000):r);
assert.deepEqual(simulateDefensiveAsset(changed,'BTC','partial').trade_log[0],
  partial.trade_log[0],'future t+2 price cannot change t+1 fill');
const missing=rows.map((r,i)=>i===4?snap(i,96,{spot:null,trap:null,confidence:null}):r);
assert.equal(targetDefensiveExposure(missing[4].payload,'BTC','partial'),null);
assert.ok(simulateDefensiveAsset(missing,'BTC','partial').final_value_usd>0);
const flat=Array.from({length:24},(_,i)=>snap(i,100,{spot:70,trap:10,gate:'NORMAL_REVIEW',fund:'confirms'}));
assert.equal(simulateDefensiveAsset(flat,'BTC','partial').trades,0,
  'do not trade if healthy and already fully invested');
const report=evaluateDefensivePortfolio(rows);
assert.equal(report.scenarios.hodl.initial_usd,3000);
assert.equal(report.scenarios.partial.initial_usd,3000);
assert.equal(report.scenarios.dynamic.initial_usd,3000);
assert.equal(report.scenarios.cash.initial_usd,3000);
assert.ok(report.scenarios.partial.alpha_vs_hodl_pp>0);
assert.equal(report.no_lookahead_signal_and_execution_separated,true);
assert.equal(report.execution_enabled,false);
assert.equal(report.external_calls_made,0);
assert.equal(report.paid_ai_calls_made,0);
assert.equal(report.scenarios.dynamic.oos_sample_sufficient,false,
  'OOS evidence must be insufficient at <20 four-hour observations');
console.log('learning-defensive-paper-selftest: ok');
