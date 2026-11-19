import assert from 'node:assert/strict';
import {
  ASSETS,HORIZONS,FORECAST_VERSION,issueProspectiveForecast,
  settleProspectiveForecast,priceFromSnapshot
} from '../src/learning/prospective-forecast-v04.mjs';

const base=Date.parse('2026-11-19T04:00:00Z'),at=minutes=>new Date(base+minutes*60000).toISOString();
function snap(minutes,{spot=20,trap=80,confidence=80,day=-4,week=-6,
  source='coinpaprika_public',venue=true,aaveVenue=false,
  confirm='contradicts',quality=8,price=100}={}) {
  const assets=['BTC','ADA','AAVE'];
  const micro=Object.fromEntries(assets.map(asset=>[asset,{
    available:asset==='AAVE'?aaveVenue:true,
    venue_price_check:{available:asset==='AAVE'?aaveVenue:venue,material_mismatch:false},
    scores:{spot_confirmation_0_100:spot,trap_risk_0_100:trap,
      microstructure_confidence_0_100:confidence}
  }]));
  const generated=at(minutes);
  return {
    id:String(minutes+1000),generated_at:generated,
    payload:{
      generated_at:generated,assets,quote_provenance:{source},
      quotes:{structuredContent:{
        headers:['symbol','price','quote_symbol','percent_change_24h','percent_change_7d'],
        rows:assets.map(asset=>[asset,price,'USD',day,week])
      }},
      microstructure:{assets:micro},
      defi_fundamentals:{assets:{
        AAVE:{evaluation:{confirmation:confirm,fundamental_quality_0_100:quality}}
      }}
    }
  };
}
const issuedAt=new Date(at(65));
const past=snap(0),current=snap(60);
const f=issueProspectiveForecast({previousRow:past,currentRow:current,now:issuedAt});
assert.equal(f.version,FORECAST_VERSION);
assert.equal(f.issuedAt,at(65));
assert.equal(f.observedAt,at(60));
assert.equal(f.assets.BTC.horizons['24h'].direction,'DOWN');
assert.equal(f.assets.ADA.horizons['72h'].direction,'DOWN');
assert.equal(f.assets.AAVE.venueVerified,false);
assert.equal(f.assets.AAVE.horizons['24h'].direction,'DOWN'); // hypothesis, NOT an order
assert.equal(f.allowedPositionChange,false);
assert.equal(f.executionEnabled,false);
assert.equal(f.realOrders,0);
assert.equal(f.probabilitiesCalibrated,false);
const nestedLater=snap(60);
nestedLater.payload.generated_at=at(61);
const driftSafe=issueProspectiveForecast({previousRow:past,currentRow:nestedLater,now:issuedAt});
assert.equal(driftSafe.assets.BTC.observationAt,at(61));
assert.equal(driftSafe.assets.BTC.sourceQualityPassed,true);
assert.equal(driftSafe.assets.BTC.horizons['24h'].direction,'DOWN');
assert.ok(/^[a-f0-9]{64}$/.test(f.commitmentHash));
assert.equal(HORIZONS.length,3);
assert.equal(ASSETS.length,3);

// Previously issued forecast cannot read future changed snapshots.
const future=snap(500,{price:230,day:50,week:70,spot:95,trap:0});
assert.deepEqual(issueProspectiveForecast({previousRow:past,currentRow:current,now:issuedAt}),f);
assert.notDeepEqual(future.payload.quotes,current.payload.quotes);
const {commitmentHash,...obj}=f;
// jsonb key reordering must NOT invalidate a frozen commitment.
const canonical=JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(f).reverse())));
assert.equal(canonical.commitmentHash,f.commitmentHash);
const matured=new Date(+issuedAt+HORIZONS[0].ms+60*60000);
const outcome=snap((+matured-base)/60000,{price:90});
const graded=settleProspectiveForecast({
  forecast:canonical,asset:'BTC',horizon:'24h',observedRow:outcome,now:matured
});
assert.equal(graded.status,'SCORED');
assert.equal(graded.predicted,'DOWN');
assert.equal(graded.actualDirection,'DOWN');
assert.equal(graded.hit,true);
assert.ok(graded.actualReturnPct < -1.5);
assert.equal(graded.executionEnabled,false);
const outcomeNestedFuture=snap((+matured-base)/60000,{price:90});
outcomeNestedFuture.payload.generated_at=new Date(+issuedAt+HORIZONS[0].ms+4*3600000).toISOString();
assert.throws(()=>settleProspectiveForecast({
  forecast:f,asset:'BTC',horizon:'24h',observedRow:outcomeNestedFuture,now:new Date(+issuedAt+HORIZONS[0].ms+5*3600000)
}),/invalid_outcome_timestamp/);
const misses=settleProspectiveForecast({
  forecast:f,asset:'BTC',horizon:'24h',
  observedRow:snap((+matured-base)/60000,{price:120}),
  now:matured
});
assert.equal(misses.hit,false);
assert.throws(()=>settleProspectiveForecast({forecast:f,asset:'BTC',horizon:'168h',now:matured}),/not_matured/);
assert.throws(()=>settleProspectiveForecast({forecast:f,asset:'BTC',horizon:'24h',
  observedRow:snap(20),now:matured}),/invalid_outcome_timestamp/);
const tampered=structuredClone(f);tampered.assets.BTC.horizons['24h'].direction='UP';
assert.throws(()=>settleProspectiveForecast({
  forecast:tampered,asset:'BTC',horizon:'24h',observedRow:outcome,now:matured
}),/commitment_tampered/);
assert.throws(()=>issueProspectiveForecast({currentRow:snap(70),now:issuedAt}),/source_from_future/);
const embeddedFuture=snap(60);embeddedFuture.payload.generated_at=at(70);
assert.throws(()=>issueProspectiveForecast({
  currentRow:embeddedFuture,now:issuedAt
}),/embedded_data_from_future/);
const unverified=issueProspectiveForecast({
  currentRow:snap(60,{source:'unknown_source'}),now:issuedAt
});
assert.equal(unverified.assets.BTC.horizons['24h'].direction,'ABSTAIN');
assert.equal(unverified.assets.BTC.sourceQualityPassed,false);
assert.equal(priceFromSnapshot(snap(60), 'BTC',{now:new Date(at(60))}).valid,true);
const tooOld=issueProspectiveForecast({
  currentRow:past,now:new Date(at(200))
});
assert.equal(tooOld.assets.BTC.horizons['24h'].direction,'ABSTAIN');
const none=settleProspectiveForecast({
  forecast:f,asset:'BTC',horizon:'24h',now:new Date(+issuedAt+HORIZONS[0].ms+60*60000)
});
assert.equal(none,null);
const missing=settleProspectiveForecast({
  forecast:f,asset:'BTC',horizon:'24h',now:new Date(+issuedAt+HORIZONS[0].ms+4*3600000)
});
assert.equal(missing.status,'DATA_GAP_UNSCORED');
assert.equal(missing.hit,null);

console.log('SHADOW_PROSPECTIVE_V04_SELFTEST='+JSON.stringify({
  ok:true,assets:ASSETS.length,horizons:HORIZONS.map(x=>x.id),
  forecastDirection:f.assets.BTC.horizons['24h'].direction,
  futureLeakRejected:true,immutableCommitment:true,jsonbCanonicalHash:true,
  outcomeAfterTarget:true,missedDataNotCherryPicked:true,
  abstentionSupported:true,tradeOrders:0,executionEnabled:false
}));
