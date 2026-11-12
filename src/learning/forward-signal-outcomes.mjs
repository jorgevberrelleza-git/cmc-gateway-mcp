// Offline, deterministic forward-signal scoring. Never alters an order or portfolio.
const num=x=>typeof x==='number'&&Number.isFinite(x)&&x>0?x:null;
const date=x=>{const n=Date.parse(x||'');return Number.isFinite(n)?n:null;};
const round=x=>Number.isFinite(x)?Number(x.toFixed(4)):null;
const types=new Set(['PAPER_REDUCE_REVIEW','RISK_WATCH_UNCONFIRMED','RISK_RESEARCH_VENUE_BLOCKED','RECOVERY_WATCH_UNCONFIRMED','RECOVERY_WATCH_MACRO_UNVERIFIED','RECOVERY_WATCH_VENUE_BLOCKED','HOLD_RESEARCH']);
export const OUTCOME_HORIZONS=Object.freeze([24,72]);
export function evaluateForwardSignalOutcome({signal,observations=[],horizonHours=24,asOf=new Date(),toleranceMinutes=90,assumedRoundtripCostBps=70}={}){
 if(!OUTCOME_HORIZONS.includes(horizonHours))throw Error('unsupported_horizon');
 const at=date(asOf instanceof Date?asOf.toISOString():asOf);
 const start=date(signal?.observed_at),asset=String(signal?.asset||'').toUpperCase();
 const type=signal?.research_signal;
 const base=num(signal?.price_usd);
 const common={asset,signal:type??null,horizon_hours:horizonHours,
   execution_enabled:false,real_orders_created:0,
   interpretation:'hypothetical_research_not_execution'};
 if(!['BTC','ADA','AAVE'].includes(asset)||!types.has(type)||!base||start===null||at===null||start>at)
   return {...common,status:'INVALID_SIGNAL',reason:'invalid_ex_ante_signal'};
 if(signal?.persisted_before_outcome!==true)
   return {...common,status:'UNATTESTED',reason:'no_ex_ante_persistence_attestation'};
 if(type==='RISK_RESEARCH_VENUE_BLOCKED'||type==='RECOVERY_WATCH_VENUE_BLOCKED'||signal?.venue_verified===false)
   return {...common,status:'BLOCKED',reason:'venue_not_verified'};
 const due=start+horizonHours*3600000;
 if(at<due)return {...common,status:'PENDING',reason:'horizon_not_mature'};
 const tol=Math.max(0,Math.min(toleranceMinutes,120))*60000;
 const matches=(Array.isArray(observations)?observations:[])
   .filter(x=>x?.asset===asset && num(x?.price_usd)!=null)
   .map(x=>({...x,ms:date(x?.observed_at)}))
   .filter(x=>x.ms!==null&&x.ms>=due&&x.ms<=due+tol&&x.ms<=at)
   .sort((a,b)=>a.ms-b.ms);
 const first=matches[0];
 if(!first)return {...common,status:'MISSING',reason:'no_attested_price_at_or_after_horizon'};
 const ret=(first.price_usd/base-1)*100;
 const directional=type.startsWith('PAPER_REDUCE')||type.startsWith('RISK_')?'risk':
   type.startsWith('RECOVERY_')?'recovery':'neutral';
 // Net counterfactual, not a tradable P&L. Risk signals assume an illustrative
 // 50% reduction and one complete round-trip charged on the reduced notional.
 const reduction=directional==='risk'?.5:0;
 const avoidedLossPp=directional==='risk'?-ret*reduction:0;
 const hypotheticalCostPp=reduction*assumedRoundtripCostBps/100;
 const alpha=directional==='risk'?avoidedLossPp-hypotheticalCostPp:null;
 const correct=directional==='risk'?ret<0:directional==='recovery'?ret>0:null;
 return {...common,status:'MATURED',start_at:new Date(start).toISOString(),
  assessed_price_at:new Date(first.ms).toISOString(),price_start_usd:base,
  price_end_usd:first.price_usd,underlying_return_pct:round(ret),
  direction:directional,correct_direction:correct,
  hypothetical_50pct_reduction_alpha_pp:round(alpha),
  hypothetical_roundtrip_cost_bps:assumedRoundtripCostBps,
  venue_verified:signal?.venue_verified===true,
  independent_market_data_attested:first?.source_attested===true,
  actionable:false};
}
export function summarizeForwardSignalOutcomes(results=[]){
 const mature=results.filter(x=>x.status==='MATURED'&&x.independent_market_data_attested);
 const directional=mature.filter(x=>typeof x.correct_direction==='boolean');
 const risks=mature.filter(x=>x.direction==='risk'&&x.hypothetical_50pct_reduction_alpha_pp!=null);
 return {total:results.length,matured_attested:mature.length,pending:results.filter(x=>x.status==='PENDING').length,
  blocked:results.filter(x=>x.status==='BLOCKED').length,unattested:results.filter(x=>x.status==='UNATTESTED').length,
  directional_sample:directional.length,directional_hit_rate_pct:directional.length?round(100*directional.filter(x=>x.correct_direction).length/directional.length):null,
  risk_signal_count:risks.length,mean_hypothetical_risk_alpha_pp:risks.length?round(risks.reduce((s,x)=>s+x.hypothetical_50pct_reduction_alpha_pp,0)/risks.length):null,
  statistically_actionable:false,execution_enabled:false};
}
