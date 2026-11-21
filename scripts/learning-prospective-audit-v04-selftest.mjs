import assert from 'node:assert/strict';
import { issueProspectiveForecast,settleProspectiveForecast,FORECAST_VERSION } from '../src/learning/prospective-forecast-v04.mjs';
import { summarizeProspectiveScores } from '../src/learning/prospective-audit-v04.mjs';

const base=Date.parse('2026-11-19T02:00:00Z');
const time=m=>new Date(base+m*60000).toISOString();
function row(m,price=100){
  const assets=['BTC','ADA','AAVE'];
  return {id:String(m+900),generated_at:time(m),
    payload:{generated_at:time(m),assets,quote_provenance:{source:'coinpaprika_public'},
      quotes:{structuredContent:{
        headers:['symbol','price','quote_symbol','percent_change_24h','percent_change_7d'],
        rows:assets.map(a=>[a,price,'USD',-4,-6])}},
      microstructure:{assets:Object.fromEntries(assets.map(a=>[a,{
        available:true,venue_price_check:{available:true,material_mismatch:false},
        scores:{spot_confirmation_0_100:20,trap_risk_0_100:80}
      }]))},
      defi_fundamentals:{assets:{AAVE:{evaluation:{
        confirmation:'contradicts',fundamental_quality_0_100:8
      }}}}
    }
  };
}
const prior=row(0),current=row(60);
current.payload.microstructure.assets.ADA.scores={};
const issuedAt=new Date(time(65));
const forecast=issueProspectiveForecast({currentRow:current,previousRow:prior,now:issuedAt});
assert.equal(forecast.assets.BTC.horizons['24h'].direction,'DOWN');
assert.equal(forecast.assets.ADA.horizons['24h'].direction,'ABSTAIN');
const due=Date.parse(forecast.assets.BTC.horizons['24h'].dueAt);
const afterOneHour=new Date(due+60*60000);
const outcome=row((+afterOneHour-base)/60000,90);
const score={
  strategy_version:'shadow_prospective_score_v0.4_24h',
  snapshot_id:current.id,
  generated_at:new Date(due+4*3600000).toISOString(),
  regime:{dueAt:new Date(due).toISOString(),commitmentHash:forecast.commitmentHash},
  asset_assessments:{scores:{
    BTC:settleProspectiveForecast({forecast,asset:'BTC',horizon:'24h',observedRow:outcome,now:afterOneHour}),
    ADA:settleProspectiveForecast({forecast,asset:'ADA',horizon:'24h',observedRow:outcome,now:afterOneHour}),
    AAVE:settleProspectiveForecast({forecast,asset:'AAVE',horizon:'24h',now:new Date(due+4*3600000)})
  }}
};
assert.equal(score.asset_assessments.scores.BTC.hit,true);
assert.equal(score.asset_assessments.scores.ADA.status,'ABSTAINED');
assert.equal(score.asset_assessments.scores.AAVE.status,'DATA_GAP_UNSCORED');
const forecastRow={
  snapshot_id:current.id,strategy_version:FORECAST_VERSION,
  asset_assessments:{forecast}
};
const data={forecastRows:[forecastRow],scoreRows:[score],now:new Date(due+4*3600000)};
const report=summarizeProspectiveScores(data);
const h=report.horizons['24h'];
assert.equal(report.verifiedForecasts,1);
assert.equal(report.settledHorizons,1);
assert.equal(report.rejectedOrUnverifiableRecords,0);
assert.deepEqual([h.total,h.scored,h.correct,h.incorrect,h.abstained,h.dataGaps],[3,1,1,0,1,1]);
assert.equal(h.accuracyPct,100);
assert.equal(h.coveragePct,33.33);
assert.equal(h.naiveAlwaysDownPct,100);
assert.equal(h.naiveAlwaysUpPct,0);
assert.equal(h.sampleSufficient,false);
assert.equal(report.latest.length,3);
assert.equal(report.realOrders,0);
assert.equal(report.executionEnabled,false);
assert.equal(report.policyPromoted,false);
// Score integrity: inconsistent realized outcome MUST be rejected rather than
// changing the model's accuracy. No silent exclusion of losses.
const tampered=structuredClone(score);
tampered.asset_assessments.scores.BTC.hit=false;
const test=summarizeProspectiveScores({...data,scoreRows:[tampered]});
assert.equal(test.rejectedOrUnverifiableRecords,1);
assert.equal(test.horizons['24h'].scored,0);
assert.equal(test.horizons['24h'].accuracyPct,null);
// A fabricated return, early outcome or changed forecast also fails closed.
const future=structuredClone(score);
future.asset_assessments.scores.BTC.observedAt=time(2);
assert.equal(summarizeProspectiveScores({...data,scoreRows:[future]}).rejectedOrUnverifiableRecords,1);
const badForecast=structuredClone(forecastRow);
badForecast.asset_assessments.forecast.assets.BTC.horizons['24h'].direction='UP';
const fraud=summarizeProspectiveScores({...data,forecastRows:[badForecast]});
assert.ok(fraud.rejectedOrUnverifiableRecords>=1);
assert.equal(fraud.verifiedForecasts,0);
// Duplicate scores cannot inflate accuracy.
const duplicated=summarizeProspectiveScores({...data,scoreRows:[score,score]});
assert.equal(duplicated.settledHorizons,1);
assert.equal(duplicated.rejectedOrUnverifiableRecords,1);
assert.equal(duplicated.horizons['24h'].scored,1);
const none=summarizeProspectiveScores({now:issuedAt});
assert.equal(none.horizons['24h'].accuracyPct,null);
assert.equal(none.horizons['24h'].sampleSufficient,false);
console.log('SHADOW_PROSPECTIVE_AUDIT_SELFTEST='+JSON.stringify({
  ok:true,first24h:{scored:h.scored,correct:h.correct,abstained:h.abstained,gaps:h.dataGaps},
  denominatorHonest:true,naiveBenchmarkSameCases:true,
  invalidScoresRejected:true,forecastTamperRejected:true,
  duplicateScoresRejected:true,realOrders:0,policyPromoted:false
}));
