import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {buildAutonomyControl} from '../src/learning/autonomy-control-v05.mjs';
import {issueProspectiveForecast} from '../src/learning/prospective-forecast-v04.mjs';
import {initialPaperState,runAgentPaperCycle,verifyControl,PAPER_BROKER_VERSION} from '../src/learning/agent-broker-paper-v06.mjs';

const base=Date.parse('2026-11-19T00:00:00Z');
const iso=t=>new Date(base+t*60000).toISOString();
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?
 Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
function snap(t,{price=100,day=3,week=5,spot=80,trap=15,source='coinpaprika_public',venue=true}={}){
 const assets=['BTC','ADA','AAVE'];
 return {id:String(t+100),generated_at:iso(t),material_event:{reasons:[]},
  payload:{generated_at:iso(t),assets,quote_provenance:{source},
   quotes:{structuredContent:{headers:['symbol','price','quote_symbol','percent_change_24h','percent_change_7d'],
     rows:assets.map(a=>[a,price,'USD',day,week])}},
   microstructure:{assets:Object.fromEntries(assets.map(a=>[a,{
     available:a!=='AAVE'&&venue,
     venue_price_check:{available:a!=='AAVE'&&venue,material_mismatch:false},
     data_quality:{confidence_0_100:80},
     scores:{spot_confirmation_0_100:spot,trap_risk_0_100:trap,
       microstructure_confidence_0_100:80}
   }]))},
   defi_fundamentals:{assets:{AAVE:{evaluation:{confirmation:'neutral',fundamental_quality_0_100:75}}}}
  }};
}
const s0=snap(0),s60=snap(60),s120=snap(120),s180=snap(180);
const forecast=issueProspectiveForecast({currentRow:s60,previousRow:s0,now:new Date(iso(62))});
function control(current,previous,t,overrides={}) {
  const runtime=[t-1,t-20,t-40,t-60].map(started=>({
    started_at:iso(started),status:'success'
  }));
  const x=buildAutonomyControl({currentRow:current,previousRow:previous,
    now:new Date(iso(t)),prospectiveForecast:forecast,recentRuntimeCycles:runtime,
    latestPortfolioMark:{marked_at:iso(t-1),total_value_usd:'10000',alpha_vs_hodl_pct:'0',
      drawdown_pct:'0'}});
  if(overrides.asset){
    Object.assign(x.assets[overrides.asset],overrides.patch);
  }
  const {auditHash,...core}=x;
  x.auditHash=hash(core);
  return x;
}
const c65=control(s60,s0,65);
assert.equal(verifyControl(c65),true);
const initial=initialPaperState({atTime:c65.generatedAt});
assert.equal(initial.cashUsd,10000);
assert.equal(initial.realOrders,0);
assert.equal(c65.realMoneyReady,false);
const baseline=runAgentPaperCycle({control:c65,currentRow:s60,now:new Date(iso(66))});
assert.ok(['LIQUIDITY','PAPER_RESEARCH_ACTIVE'].includes(baseline.globalMode||baseline.status));
assert.equal(baseline.realOrdersCreated,0);
assert.equal(baseline.brokerApiCalls,0);
assert.equal(baseline.fills.length,0);
assert.equal(baseline.paperAccount.cashUsd,10000);

// Build a paper-only bullish signal. Even if forecast is uncalibrated and macro
// unverified, this is RESEARCH SIMULATION ONLY; live trading stays impossible.
const growth=control(s60,s0,65,{
 asset:'BTC',patch:{researchPosture:'RECOVERY_RESEARCH',
  forwardResearchSignal:'RECOVERY_WATCH_MACRO_UNVERIFIED',
  venueVerified:true,riskFamilies:[],sourceQualityPassed:true,
  forecast:{'24h':{direction:'UP'},'72h':{direction:'UP'},'168h':{direction:'UP'}}}
});
const paperEntry=runAgentPaperCycle({control:growth,currentRow:s60,now:new Date(iso(66))});
assert.equal(paperEntry.globalMode,'OPERATE_PAPER');
assert.equal(paperEntry.submittedPaperIntents.length,1);
assert.equal(paperEntry.submittedPaperIntents[0].asset,'BTC');
assert.equal(paperEntry.submittedPaperIntents[0].action,'BUY_PAPER');
assert.equal(paperEntry.fills.length,0,'NO fill at same snapshot');
const c125=control(s120,s60,125);
const next=runAgentPaperCycle({control:c125,currentRow:s120,previousState:paperEntry.state,now:new Date(iso(126))});
assert.equal(next.fills.length,1);
assert.equal(next.fills[0].side,'BUY');
assert.equal(next.fills[0].executionVenue,'USD_PROXY_RESEARCH_ONLY');
assert.ok(Date.parse(next.fills[0].filledAt)>Date.parse(next.fills[0].issuedAt));
assert.ok(next.paperAccount.cashUsd<=9500);
assert.ok(next.paperAccount.cashUsd>=next.paperAccount.equityUsd*0.4);
assert.ok(next.paperAccount.positions.BTC>0);
assert.ok(next.paperAccount.paidFeesUsd>0);
assert.equal(next.realOrdersCreated,0);
assert.equal(next.brokerApiCalls,0);
const repeat=runAgentPaperCycle({control:c125,currentRow:s120,previousState:next.state,now:new Date(iso(128))});
assert.equal(repeat.status,'DUPLICATE_NO_CHANGE');
assert.equal(repeat.fills.length,0);

// Defensive mode: reduce a PERSISTING simulated BTC position, with NEXT quote.
const paperHolding=initialPaperState({atTime:c65.generatedAt});
paperHolding.cashUsd=8000;paperHolding.positions.BTC=20;paperHolding.latestEquityUsd=10000;
const down=control(s60,s0,65,{
 asset:'BTC',patch:{researchPosture:'DEFENSIVE_REVIEW',
   riskFamilies:['microstructure','structure'],
   sourceQualityPassed:true,venueVerified:true}
});
const issuedSell=runAgentPaperCycle({control:down,currentRow:s60,previousState:paperHolding,now:new Date(iso(66))});
assert.equal(issuedSell.globalMode,'DEFENSIVE');
assert.equal(issuedSell.submittedPaperIntents[0].action,'SELL_PAPER');
assert.equal(issuedSell.submittedPaperIntents[0].units,5);
const completedSell=runAgentPaperCycle({control:c125,currentRow:s120,previousState:issuedSell.state,now:new Date(iso(126))});
assert.equal(completedSell.fills[0].side,'SELL');
assert.equal(completedSell.paperAccount.positions.BTC,15);
assert.ok(completedSell.paperAccount.cashUsd>8000);

// Unexpected shock invokes HALT, cancels unfilled intentions; never liquidates
// in crisis when quotes are stale, altered or incident status is unknown.
const shock=snap(120,{price:70});
const shockControl=control(shock,s60,125);
const stop=runAgentPaperCycle({control:shockControl,currentRow:shock,
 previousState:issuedSell.state,now:new Date(iso(126))});
assert.equal(stop.status,'HALT');
assert.equal(stop.globalMode,'HALT');
assert.equal(stop.paperAccount.outstandingPaperOrders,0);
assert.equal(stop.fills.length,0,'unsettled previous orders MUST NOT fill on shock');
assert.ok(stop.globalStopReasons.includes('daily_loss_limit'));
const incident=runAgentPaperCycle({control:c125,currentRow:s120,
 previousState:paperEntry.state,now:new Date(iso(126)),incidentState:'INCIDENT_VERIFIED'});
assert.equal(incident.status,'HALT');
assert.equal(incident.fills.length,0);
const altered=structuredClone(growth);altered.assets.BTC.researchPosture='OPERATE_PAPER';
assert.throws(()=>runAgentPaperCycle({control:altered,currentRow:s60}),/unverified_control_audit/);
assert.throws(()=>runAgentPaperCycle({control:growth,currentRow:s120}),/control_snapshot_mismatch/);
const wrongPolicy={...growth,realMoneyReady:true};
assert.equal(verifyControl(wrongPolicy),false);
const unreal=runAgentPaperCycle({control:c125,currentRow:s120,
 previousState:paperEntry.state,now:new Date(iso(400))});
assert.equal(unreal.status,'HALT');
assert.equal(unreal.fills.length,0);
assert.ok(unreal.globalStopReasons.includes('stale_snapshot'));

console.log('SHADOW_AGENT_PAPER_V06_SELFTEST='+JSON.stringify({
 ok:true,version:PAPER_BROKER_VERSION,
 modes:['HALT','DEFENSIVE','LIQUIDITY','OPERATE_PAPER'],
 buyIntentNextBarFilled:true,sellIntentNextBarFilled:true,
 spreadFeesSlippageApplied:true,duplicateProtected:true,
 incidentAndDrawdownKillSwitch:true,corruptControlRejected:true,
 disabledRealOrders:true,brokerApiCalls:0,realOrders:0
}));
