import { extractLearningFeatures } from './features.mjs';
import { evaluateDataConsistency } from './data-consistency.mjs';

// Fixed, preregistered 4h observational rules. Never fit thresholds to outcomes.
// Separate long/flat *hypothesis* from the real Shadow HOLD / macro gates.
export const WALKFORWARD_RULES=Object.freeze({
  horizon_hours:4,
  min_horizon_gap_hours:4,
  max_label_delay_minutes:75,
  cost_roundtrip_bps:40,
  missing_spread_assumed_bps:30,
  train_fraction:0.6,
  minimum_test_windows:20,
  minimum_test_trades:10,
  assets:['BTC','ADA','AAVE'],
  execution_enabled:false
});
const round=(v,d=4)=>v==null||!Number.isFinite(v)?null:Number(v.toFixed(d));
// null and undefined are missing evidence, never an observed zero.
function indicator(v){if(v==null||typeof v==='boolean')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function price(v){const n=indicator(v);return n!=null&&n>0?n:null;}
function parseTime(x){const t=Date.parse(x);return Number.isFinite(t)?t:null;}
export function predeclaredHypothesis(snapshot={},symbol='BTC'){
  const asset=String(symbol).toUpperCase();
  const f=extractLearningFeatures(snapshot).assets[asset];
  if(!f||!price(f.price_usd))return {signal:'NO_DATA',why:'missing_price'};
  const c=evaluateDataConsistency(snapshot);
  if(c.blocking || c.asset_blocks?.[asset]?.length)return {signal:'NO_DATA',why:'data_consistency_blocking'};
  const validVenue=snapshot?.microstructure?.assets?.[asset]?.venue_price_check;
  const hasVenue=snapshot?.microstructure?.assets?.[asset]?.available===true;
  if(hasVenue && validVenue?.available!==true)return {signal:'NO_DATA',why:'venue_unchecked'};
  if(f.execution_gate==='BLOCK_NEW_ENTRY_UNTIL_CLEANER_DATA')return {signal:'FLAT',why:'microstructure_gate'};
  if(asset==='AAVE' && (f.fundamental_confirmation!=='confirms'||indicator(f.fundamental_quality)<65))
    return {signal:'FLAT',why:'fundamental_not_confirmed'};
  // Missing metrics cannot be silently converted to zeros: distinguish
  // unavailable research evidence from a genuinely weak observed setup.
  const spot=indicator(f.spot_confirmation),trap=indicator(f.trap_risk),confidence=indicator(f.microstructure_confidence);
  if(spot==null||trap==null||confidence==null)
    return {signal:'NO_DATA',why:'insufficient_microstructure'};
  if(spot>=65 && trap<=35 && confidence>=55)
    return {signal:'LONG_HYPOTHESIS',why:'strong_spot_low_trap'};
  return {signal:'FLAT',why:'no_three_factor_alignment'};
}
function roundTripCost(snapshot={},asset,rule=WALKFORWARD_RULES){
 const depth=snapshot?.microstructure?.assets?.[asset]?.order_book;
 const spread=indicator(depth?.spread_bps);
 const spreadVal=Number.isFinite(spread)&&spread>=0 ? Math.min(spread,150) : rule.missing_spread_assumed_bps;
 return (rule.cost_roundtrip_bps+spreadVal)/100; // bps -> percent
}
function stat(rows=[]){
 // NO_DATA is not a flat/cash trading decision. Exclude it from any
 // strategy-v-HODL performance comparison, while reporting coverage.
 const eligible=rows.filter(x=>x.signal!=='NO_DATA');
 const avg=key=>eligible.length ? round(eligible.reduce((sum,x)=>sum+x[key],0)/eligible.length) : null;
 const trades=eligible.filter(x=>x.signal==='LONG_HYPOTHESIS');
 const reason_counts=Object.fromEntries([...new Set(rows.map(r=>r.why||'unknown'))].sort()
   .map(why=>[why,rows.filter(r=>(r.why||'unknown')===why).length]));
 const wins=trades.filter(x=>x.net_trade_return_pct>0).length;
 const n=trades.length, z=1.96;
 const p=n?wins/n:0, denom=1+z*z/(n||1);
 const lower=n?((p+z*z/(2*n)-z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/denom)*100:null;
 const upper=n?((p+z*z/(2*n)+z*Math.sqrt((p*(1-p)+z*z/(4*n))/n))/denom)*100:null;
 return {
   windows:rows.length,
   comparable_windows:eligible.length,
   excluded_no_data_windows:rows.length-eligible.length,
   reason_counts,
   long_hypotheses:n, flat_or_missing:eligible.length-n,
   mean_signal_strategy_return_pct:avg('strategy_return_pct'),
   mean_hodl_same_windows_pct:avg('hold_return_pct'),
   mean_excess_vs_hodl_pp:avg('excess_vs_hodl_pp'),
   wins_after_estimated_costs:wins,
   positive_long_rate_pct:n?round(100*wins/n,2):null,
   positive_long_rate_wilson_95_pct:n?[round(lower,2),round(upper,2)]:null,
   cost_model:'40bps_roundtrip_fee_and_slippage_plus_observed_spread_or_30bps_fallback',
   excludes_unusable_signals_from_return_comparison:true,
   compounding_simulated:false
 };
}
export function evaluateWalkforward(snapshots=[],{
  rules=WALKFORWARD_RULES, now=new Date()
}={}){
 const cutoff=+now;
 const sorted=(Array.isArray(snapshots)?snapshots:[])
   .filter(x=>x?.payload&&parseTime(x.generated_at)!=null)
   .filter(x=>parseTime(x.generated_at)<=cutoff)
   .sort((a,b)=>parseTime(a.generated_at)-parseTime(b.generated_at));
 const horizonMs=rules.horizon_hours*3600000;
 const gapMs=rules.min_horizon_gap_hours*3600000;
 const lateMs=rules.max_label_delay_minutes*60000;
 const perAsset=Object.fromEntries(rules.assets.map(s=>[s,[]]));
 let anchors=0,missingLater=0,lastAnchor=-Infinity;
 for(let i=0;i<sorted.length;i++){
  const row=sorted[i];const at=parseTime(row.generated_at);
  if(at<lastAnchor+gapMs)continue; // non-overlapping labels, even across assets
  const target=at+horizonMs;
  if(target+lateMs>cutoff)continue; // outcome not known at report time
  lastAnchor=at;anchors++;
  const later=sorted.find(x=>{const t=parseTime(x.generated_at);return t>=target&&t<=target+lateMs;});
  if(!later){missingLater++;continue;}
  const beforeFeatures=extractLearningFeatures(row.payload);
  const afterFeatures=extractLearningFeatures(later.payload);
  for(const asset of rules.assets){
   const p0=price(beforeFeatures.assets?.[asset]?.price_usd),p1=price(afterFeatures.assets?.[asset]?.price_usd);
   if(!p0||!p1)continue;
   const h=predeclaredHypothesis(row.payload,asset);
   const gross=(p1/p0-1)*100;
   const cost=h.signal==='LONG_HYPOTHESIS'?roundTripCost(row.payload,asset,rules):0;
   const net=h.signal==='LONG_HYPOTHESIS'?gross-cost:0;
   perAsset[asset].push({
     time:row.generated_at,
     signal:h.signal,
     why:h.why,
     hold_return_pct:gross,
     net_trade_return_pct:h.signal==='LONG_HYPOTHESIS'?net:0,
     strategy_return_pct:net,
     excess_vs_hodl_pp:net-gross,
     quote_source:row.payload?.quote_provenance?.source||'unclassified'
   });
  }
 }
 const assets={};
 for(const [asset,rows] of Object.entries(perAsset)){
   const trainSplit=Math.floor(rows.length*rules.train_fraction);
   const train=rows.slice(0,trainSplit);
   // purge test windows that overlap the last training entry horizon
   const lastTrain=train.length?parseTime(train.at(-1).time):-Infinity;
   const test=rows.slice(trainSplit).filter(r=>parseTime(r.time)>=lastTrain+horizonMs);
   const testSummary=stat(test);
   assets[asset]={
     total_labeled_windows:rows.length,
     train:stat(train),
     test:testSummary,
     first_test_at:test[0]?.time||null,
     last_test_at:test.at(-1)?.time||null,
     statistically_actionable:false,
     reasons:[
       'fixed_rules_no_fitted_model',
       ...(testSummary.comparable_windows<rules.minimum_test_windows?['insufficient_oos_windows']:[]),
       ...(testSummary.long_hypotheses<rules.minimum_test_trades?['insufficient_oos_hypotheses']:[]),
       'no_verified_macro_catalyst_gate',
       'not_compounded_and_not_a_live_paper_portfolio',
       'nonrandom_observational_windows_and_regime_dependence'
     ]
   };
 }
 return {
  contract_version:'shadow_walkforward_predeclared_v0.2_diagnostics',
  start:sorted[0]?.generated_at||null,
  through:sorted.at(-1)?.generated_at||null,
  snapshots:sorted.length,nonoverlapping_anchors:anchors,
  missing_later_windows:missingLater,
  rule:rules,
  assets,
  evidence_gate:'RESEARCH_ONLY_NOT_READY_FOR_TRADING',
  no_lookahead:true,thresholds_optimized_on_test:false,
  position_change_allowed:false,external_calls_made:0,paid_ai_calls_made:0,execution_enabled:false
 };
}
