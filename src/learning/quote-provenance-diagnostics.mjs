// Read-only, secret-free diagnostic: NEVER a trade or data-quality authorization.
const finite=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const round=x=>Math.round(x*100)/100;
const stamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
export function diagnoseVenueBasis({asset,venue,quoteObservedAt=null,venueObservedAt=null,observedAt=null,minorCurrency=null,thresholdBps=100}={}){
 const symbol=String(asset||'').toUpperCase();
 if(!['BTC','ADA','AAVE'].includes(symbol))throw new Error('unsupported_asset');
 const base=finite(venue?.cmc_usd_price),mid=finite(venue?.bitso_mid);
 const currency=typeof minorCurrency==='string'?minorCurrency.toLowerCase():null;
 const source=typeof venue?.quote_source==='string'?venue.quote_source.slice(0,64):null;
 const qt=stamp(quoteObservedAt),vt=stamp(venueObservedAt),at=stamp(observedAt);
 const reasons=[];
 if(!venue||venue.available!==true)reasons.push('venue_comparison_unavailable');
 if(base===null||base<=0||mid===null||mid<=0)reasons.push('missing_positive_comparable_prices');
 if(currency===null)reasons.push('quote_currency_not_attested');
 else if(!['usd','usdt','usdc'].includes(currency))reasons.push('non_usd_currency_requires_fx');
 else if(currency!=='usd')reasons.push('stablecoin_depeg_not_ruled_out');
 if(!qt||!vt)reasons.push('quote_timestamps_not_attested');
 if(qt&&vt&&Math.abs(Date.parse(qt)-Date.parse(vt))>60000)reasons.push('quote_observation_gap_over_60s');
 if(at&&((qt&&Date.parse(qt)>Date.parse(at))||(vt&&Date.parse(vt)>Date.parse(at))))reasons.push('future_quote_timestamp');
 const basis=base!==null&&base>0&&mid!==null&&mid>0?round((mid/base-1)*10000):null;
 if(basis!==null&&Math.abs(basis)>=thresholdBps)reasons.push('material_quote_divergence');
 const providerFlag=venue?.material_mismatch;
 if(basis!==null&&typeof providerFlag==='boolean'&&(Math.abs(basis)>=thresholdBps)!==providerFlag)reasons.push('provider_mismatch_flag_disagrees');
 const trustworthy=venue?.available===true&&basis!==null&&reasons.length===0;
 return {
  diagnostic_version:'quote_provenance_v0.1',asset:symbol,source,
  quote_currency:currency,quote_observed_at:qt,venue_observed_at:vt,
  quote_usd_price:base,venue_mid:mid,basis_bps:basis,
  threshold_bps:thresholdBps,material_mismatch:basis===null?null:Math.abs(basis)>=thresholdBps,
  reasons:[...new Set(reasons)],comparison_trustworthy:trustworthy,
  root_cause_confirmed:false,position_change_allowed:false,execution_enabled:false
 };
}
export function diagnoseSnapshotVenues(snapshot={}){
 const out={};
 for(const asset of ['BTC','ADA','AAVE']){
  const m=snapshot?.microstructure?.assets?.[asset];
  const v=m?.venue_price_check;
  if(m||v)out[asset]=diagnoseVenueBasis({
   asset,venue:v,minorCurrency:m?.minor_currency,
   // Do not substitute snapshot time for separately attested quote times.
   quoteObservedAt:v?.quote_observed_at,venueObservedAt:v?.venue_observed_at,
   observedAt:snapshot?.generated_at
  });
 }
 return out;
}
