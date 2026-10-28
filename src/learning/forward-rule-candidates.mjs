import {extractLearningFeatures} from './features.mjs';
import {evaluateDataConsistency} from './data-consistency.mjs';

// V0.1 policy is FROZEN for forward research, independent from all live/paper
// ledgers. Numbers are hypotheses, not optimized using historical OOS outcomes.
export const POLICY=Object.freeze({
  min_signal_confidence:55, bad_spot_below:35,bad_trap_at_least:65,
  good_spot_at_least:65,good_trap_at_most:35,
  aave_fundamental_veto_at_most:25,
  reentry_requires_consecutive_observations:2,
  reduce_requires_consecutive_observations:2,
  minimum_observation_gap_minutes:55,
  minimum_rebalance_gap_hours:12,
  max_portfolio_new_exposure_pct:0.10,
  max_single_asset_weight_pct:0.25,
  risk_per_trade_pct:0.005,
  minimum_reward_risk:2,
  execution_enabled:false,
  real_orders_permitted:false
});
function n(x){if(x==null||typeof x==='boolean')return null;const v=Number(x);return Number.isFinite(v)?v:null;}
function base(snapshot,asset){
 const f=extractLearningFeatures(snapshot).assets?.[asset];
 if(!f||n(f.price_usd)==null||n(f.price_usd)<=0)return {state:'NO_DATA',why:'missing_price'};
 const q=evaluateDataConsistency(snapshot);
 if(q.blocking||q.asset_blocks?.[asset]?.length)return {state:'NO_DATA',why:'data_consistency_block'};
 const m=snapshot?.microstructure?.assets?.[asset];
 if(m?.available===true&&m?.venue_price_check?.available!==true)return {state:'NO_DATA',why:'venue_not_verified'};
 const spot=n(f.spot_confirmation),trap=n(f.trap_risk),conf=n(f.microstructure_confidence);
 if(conf==null||conf<POLICY.min_signal_confidence||spot==null||trap==null)
   return {state:'NO_DATA',why:'insufficient_microstructure'};
 const veto=asset==='AAVE'&&f.fundamental_confirmation==='contradicts'&&
   n(f.fundamental_quality)!=null&&n(f.fundamental_quality)<=POLICY.aave_fundamental_veto_at_most;
 if(veto)return {state:'DEFENSIVE_WATCH',why:'aave_fundamental_veto'};
 if(f.execution_gate==='BLOCK_NEW_ENTRY_UNTIL_CLEANER_DATA'||spot<POLICY.bad_spot_below||trap>=POLICY.bad_trap_at_least)
   return {state:'DEFENSIVE_WATCH',why:'risk_deterioration'};
 if(spot>=POLICY.good_spot_at_least&&trap<=POLICY.good_trap_at_most)
   return {state:'REENTRY_WATCH',why:'spot_trap_alignment'};
 return {state:'HOLD',why:'mixed_evidence'};
}
export function assessRuleCandidate(snapshots=[],asset='BTC'){
 const symbol=String(asset).toUpperCase();
 if(!['BTC','ADA','AAVE'].includes(symbol))return {action:'HOLD',why:'unsupported_asset',execution_enabled:false};
 const rows=(Array.isArray(snapshots)?snapshots:[])
   .filter(x=>x?.payload && Number.isFinite(Date.parse(x.generated_at)))
   .sort((a,b)=>Date.parse(b.generated_at)-Date.parse(a.generated_at));
 const newest=rows[0],prev=rows[1];
 if(!newest)return {action:'HOLD',why:'no_snapshot',execution_enabled:false};
 const current=base(newest.payload,symbol);
 if(current.state==='NO_DATA')return {action:'HOLD',why:current.why,execution_enabled:false};
 if(current.state==='HOLD')return {action:'HOLD',why:'mixed_evidence',execution_enabled:false};
 const need=current.state==='DEFENSIVE_WATCH'?
   POLICY.reduce_requires_consecutive_observations:POLICY.reentry_requires_consecutive_observations;
 const prior=prev?base(prev.payload,symbol):null;
 const elapsed=prev?(Date.parse(newest.generated_at)-Date.parse(prev.generated_at))/60000:null;
 if(need>1 && (!prior||prior.state!==current.state||elapsed<POLICY.minimum_observation_gap_minutes))
   return {action:'HOLD',why:'persistence_not_confirmed',watch:current.state,execution_enabled:false};
 // These are RESEARCH CANDIDATES only. Reentry is not executable until
 // a separate macro/venue/size/reward-risk decision contract is verified.
 return {action:current.state==='DEFENSIVE_WATCH'?'RESEARCH_REDUCE':'RESEARCH_REENTRY',
   why:current.why,evidence:['microstructure','persistence'],
   macro_verified:false,venue_executable:false,
   position_change_allowed:false,execution_enabled:false};
}
