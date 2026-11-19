import assert from 'node:assert/strict';
import { issueProspectiveForecast } from '../src/learning/prospective-forecast-v04.mjs';
import { buildAutonomyControl, AUTONOMY_CONTROL_VERSION, SUPPORTED_ASSETS } from '../src/learning/autonomy-control-v05.mjs';

const start=Date.parse('2026-11-19T00:00:00Z');
const at=m=>new Date(start+m*60000).toISOString();
function snap(min,{source='coinpaprika_public',day=-4,week=-6,
  spot=20,trap=80,aaveVenue=false,price=100}={}){
  const symbols=['BTC','ADA','AAVE'];
  return {id:String(min+900),generated_at:at(min),material_event:{material:false,reasons:[]},
    payload:{
      generated_at:at(min),assets:symbols,quote_provenance:{source},
      quotes:{structuredContent:{
        headers:['symbol','price','quote_symbol','percent_change_24h','percent_change_7d'],
        rows:symbols.map(symbol=>[symbol,price,'USD',day,week])
      }},
      microstructure:{assets:Object.fromEntries(symbols.map(symbol=>[
        symbol,{
          available:symbol==='AAVE'?aaveVenue:true,
          venue_price_check:{available:symbol==='AAVE'?aaveVenue:true,material_mismatch:false},
          scores:{spot_confirmation_0_100:spot,trap_risk_0_100:trap,
            microstructure_confidence_0_100:80},
          data_quality:{confidence_0_100:80}
        }
      ]))},
      defi_fundamentals:{assets:{AAVE:{
        evaluation:{confirmation:'contradicts',fundamental_quality_0_100:8}
      }}}
    }
  };
}
const previous=snap(0),current=snap(60),now=new Date(at(100));
const forecast=issueProspectiveForecast({
  currentRow:current,previousRow:previous,now:new Date(at(65))
});
const cycles=[70,40,10, -20].map((min,i)=>({
  status:'success',started_at:at(min),completed_at:at(min+1)
}));
const mark={marked_at:at(62),total_value_usd:10300,
  alpha_vs_hodl_pct:2.5,drawdown_pct:-7.5};
const data={currentRow:current,previousRow:previous,now,
  prospectiveForecast:forecast,latestPortfolioMark:mark,recentRuntimeCycles:cycles};
const a=buildAutonomyControl(data);
assert.equal(a.version,AUTONOMY_CONTROL_VERSION);
assert.equal(a.autonomousResearchReady,true);
assert.equal(a.forecastReceipt.available,true);
assert.equal(a.forecastReceipt.integrity,true);
assert.equal(a.runtime.stable,true);
assert.equal(a.overallDataQualityPassed,true);
assert.equal(a.externalAttestations.realPortfolioReconciled,false);
assert.equal(a.realMoneyReady,false);
assert.equal(a.executionEnabled,false);
assert.equal(a.orderRouterConnected,false);
assert.equal(a.policyPromotionAllowed,false);
assert.equal(a.realOrdersCreated,0);
assert.equal(a.simulatedPortfolio.source,'SHADOW_MOCK_ONLY_NOT_BITSO');
assert.equal(a.simulatedPortfolio.alphaProven,false);
// PostgreSQL NUMERIC columns arrive as text; zero is VALID observed alpha,
 // but it is not positive proof of edge.
const pgNumericMark={
  ...mark,total_value_usd:'10300.00',
  alpha_vs_hodl_pct:'0.0000',drawdown_pct:'-7.50'
};
const pgResult=buildAutonomyControl({...data,latestPortfolioMark:pgNumericMark});
assert.equal(pgResult.simulatedPortfolio.latestUsd,10300);
assert.equal(pgResult.simulatedPortfolio.alphaVsHodlPct,0);
assert.equal(pgResult.simulatedPortfolio.mockDrawdownPct,-7.5);
assert.equal(pgResult.simulatedPortfolio.alphaProven,false);
assert.ok(pgResult.blockers.includes('NO_DEMONSTRATED_PAPER_ALPHA_VS_HOLD'));
assert.equal(a.assets.AAVE.venueVerified,false);
assert.equal(a.assets.AAVE.allowedPositionChange,false);
assert.equal(a.capabilities.historicalTimeMachine,'OFFLINE_VALIDATION_ONLY');
assert.equal(a.capabilities.groqCanary,'SYNTHETIC_TEST_ONLY');
assert.ok(a.blockers.includes('BITSO_VENUE_OR_PRICE_CHECK_UNVERIFIED'));
assert.ok(a.blockers.includes('NET_FORWARD_EDGE_NOT_PROVEN'));
assert.ok(a.blockers.includes('BROKER_KEYS_AND_LIVE_ORDER_ROUTER_INTENTIONALLY_ABSENT'));
assert.ok(a.assets.BTC.riskFamilies.length>=1);
assert.deepEqual(Object.keys(a.assets).sort(),SUPPORTED_ASSETS.slice().sort());
assert.equal(a.auditHash,buildAutonomyControl(data).auditHash);

// Even if all external attestations are set to true, no route to live trading.
const forgedGreen=buildAutonomyControl({...data,
  independentMarketImpactEvidence:true,
  brokerExecutionAttestation:true,operationalIncidentAttestation:true,
  portfolioReconciliation:true,prospectiveNetAlphaAttestation:true
});
assert.equal(forgedGreen.realMoneyReady,false);
assert.equal(forgedGreen.executionEnabled,false);
assert.equal(forgedGreen.realOrdersCreated,0);
assert.ok(forgedGreen.blockers.includes('BROKER_KEYS_AND_LIVE_ORDER_ROUTER_INTENTIONALLY_ABSENT'));

// Tampered forecast, future snapshot and reverse ordering fail closed.
const tampered=structuredClone(forecast);
tampered.assets.BTC.horizons['24h'].direction='UP';
const bad=buildAutonomyControl({...data,prospectiveForecast:tampered});
assert.equal(bad.forecastReceipt.integrity,false);
assert.equal(bad.assets.BTC.forecast['24h'].direction,'UNAVAILABLE');
assert.ok(bad.blockers.includes('PROSPECTIVE_FORECAST_NOT_VERIFIED_OR_TOO_OLD'));
const f=structuredClone(current);f.payload.generated_at=at(101);
assert.throws(()=>buildAutonomyControl({...data,currentRow:f}),/future_snapshot/);
assert.throws(()=>buildAutonomyControl({...data,previousRow:current,currentRow:previous}),/snapshot_out_of_order/);
const stale=buildAutonomyControl({...data,now:new Date(at(500))});
assert.equal(stale.autonomousResearchReady,false);
assert.equal(stale.assets.BTC.researchPosture,'DATA_BLOCKED');
assert.equal(stale.realMoneyReady,false);
const noForecast=buildAutonomyControl({...data,prospectiveForecast:null});
assert.equal(noForecast.forecastReceipt.available,false);
assert.equal(noForecast.assets.BTC.forecast['24h'].direction,'UNAVAILABLE');
assert.equal(noForecast.realMoneyReady,false);
const noMarket=snap(60,{source:'injected_unknown_provider'});
const blocked=buildAutonomyControl({...data,currentRow:noMarket});
assert.equal(blocked.assets.BTC.sourceQualityPassed,false);
assert.equal(blocked.assets.BTC.researchPosture,'DATA_BLOCKED');
assert.equal(blocked.realMoneyReady,false);
const unhealthy=buildAutonomyControl({...data,recentRuntimeCycles:[]});
assert.equal(unhealthy.runtime.stable,false);
assert.ok(unhealthy.blockers.includes('RUNTIME_STABILITY_NOT_SUFFICIENTLY_VERIFIED'));

console.log('SHADOW_AUTONOMY_CONTROL_V05_SELFTEST='+JSON.stringify({
  ok:true,assets:SUPPORTED_ASSETS.length,prospectiveForecastIntegrity:true,
  frozenReadOnlyRiskRouting:true,staleAndFutureFailClosed:true,
  fakeExternalAttestationsCannotUnlockExecution:true,
  unverifiedAaveVenueBlocked:true,
  noExternalBrokerOrders:true,policyPromotion:false,
  executionEnabled:false,realOrders:0
}));
