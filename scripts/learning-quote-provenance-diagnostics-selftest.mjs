import assert from 'node:assert/strict';
import {diagnoseVenueBasis,diagnoseSnapshotVenues} from '../src/learning/quote-provenance-diagnostics.mjs';
const ts='2026-11-08T16:00:00Z';
const check=(bps,expectedBlocked)=>{
 const result=diagnoseVenueBasis({asset:'ADA',venue:{
  available:true,cmc_usd_price:100,bitso_mid:100*(1+bps/10000),
  material_mismatch:Math.abs(bps)>=100,quote_source:'coinpaprika_public'
 },minorCurrency:'usd',quoteObservedAt:ts,venueObservedAt:ts,observedAt:ts});
 assert.equal(result.basis_bps,bps);
 assert.equal(result.material_mismatch,expectedBlocked);
 assert.equal(result.comparison_trustworthy,!expectedBlocked);
 assert.equal(result.position_change_allowed,false);
 assert.equal(result.root_cause_confirmed,false);
};
for(const bps of [252.44,419.06,59.01])check(bps,bps>=100);
const missingTimes=diagnoseVenueBasis({asset:'ADA',venue:{
 available:true,cmc_usd_price:100,bitso_mid:100.5,material_mismatch:false
},minorCurrency:'usd'});
assert(missingTimes.reasons.includes('quote_timestamps_not_attested'));
assert(missingTimes.reasons.includes('provider_mismatch_flag_disagrees'));
assert.equal(missingTimes.comparison_trustworthy,false);
const stablecoin=diagnoseVenueBasis({asset:'BTC',venue:{
 available:true,cmc_usd_price:100,bitso_mid:100.1,material_mismatch:false
},minorCurrency:'usdt',quoteObservedAt:ts,venueObservedAt:ts});
assert(stablecoin.reasons.includes('stablecoin_depeg_not_ruled_out'));
const stale=diagnoseVenueBasis({asset:'BTC',venue:{
 available:true,cmc_usd_price:100,bitso_mid:100,material_mismatch:false
},minorCurrency:'usd',quoteObservedAt:ts,venueObservedAt:'2026-11-08T16:02:00Z'});
assert(stale.reasons.includes('quote_observation_gap_over_60s'));
const absent=diagnoseSnapshotVenues({generated_at:ts,microstructure:{assets:{AAVE:{available:false}}}});
assert.equal(absent.AAVE.comparison_trustworthy,false);
assert(absent.AAVE.reasons.includes('venue_comparison_unavailable'));
assert.equal(absent.AAVE.position_change_allowed,false);
assert.throws(()=>diagnoseVenueBasis({asset:'ETH'}),/unsupported_asset/);
console.log('quote-provenance-diagnostics-selftest: ok; 252.44/419.06/59.01 bps reproducible; fail-closed');
