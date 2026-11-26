import {extractLearningFeatures} from './features.mjs';
import {evaluateForwardSignalOutcome,OUTCOME_HORIZONS} from './forward-signal-outcomes.mjs';

// Skill feedback is evidence processing, NOT a generative trading agent.
// Only persisted, pre-declared v0.3 evaluations can be scored. No network, secrets,
// execution, simulated fills, policy tuning or portfolio-ledger modifications.
const VALID_SOURCES=new Set(['cmc_mcp','cmc_public_v3_keyless','coinpaprika_public']);
const ASSETS=['BTC','ADA','AAVE'];
const parseTime=x=>{const t=Date.parse(x||'');return Number.isFinite(t)?t:null;};
const rounded=x=>Number.isFinite(x)?Number(x.toFixed(4)):null;

export function evaluateDailySkillFeedback({snapshots=[],evaluations=[],now=new Date(),maxEvents=90}={}){
 const at=+new Date(now);
 if(!Number.isFinite(at))throw Error('skill_feedback_invalid_now');
 const prices=Object.fromEntries(ASSETS.map(a=>[a,[]]));
 const sorted=(Array.isArray(snapshots)?snapshots:[])
   .filter(row=>row?.payload&&parseTime(row.generated_at)!=null&&parseTime(row.generated_at)<=at)
   .sort((a,b)=>parseTime(a.generated_at)-parseTime(b.generated_at));
 const sourceCoverage={};
 for(const row of sorted){
   const origin=String(row.payload?.quote_provenance?.source||'');
   sourceCoverage[origin||'unknown']=(sourceCoverage[origin||'unknown']||0)+1;
   if(!VALID_SOURCES.has(origin))continue;
   const f=extractLearningFeatures(row.payload).assets||{};
   for(const asset of ASSETS){
     const price=f[asset]?.price_usd;
     if(typeof price!=='number'||!Number.isFinite(price)||price<=0)continue;
     prices[asset].push({asset,price_usd:price,
       observed_at:new Date(parseTime(row.generated_at)).toISOString(),
       source_attested:false, // Provider quote timestamp & independent venue remain unverified
       source:origin});
   }
 }
 const candidateRows=(Array.isArray(evaluations)?evaluations:[])
   .filter(row=>row?.strategy_version==='shadow_rules_v0.3_research'
      && parseTime(row.generated_at)!=null&&parseTime(row.generated_at)<=at)
   .sort((a,b)=>parseTime(a.generated_at)-parseTime(b.generated_at));
 const selected=[];
 const lastByAssetDirection=new Map();
 let nonHoldSeen=0,duplicateWindow=0,badSourceSignals=0;
 for(const row of candidateRows){
   for(const asset of ASSETS){
     const a=row.asset_assessments?.[asset];
     if(!a || a.research_signal==='HOLD_RESEARCH')continue;
     nonHoldSeen++;
     if(a.source_quality_passed!==true||!VALID_SOURCES.has(a.quote_source)){
       badSourceSignals++;continue;
     }
     const family=String(a.research_signal||'').startsWith('RECOVERY_')?'recovery':'risk';
     const anchor=parseTime(row.generated_at);
     const key=asset+':'+family;
     // Non-overlap prevents counting the same persistent warning every hour.
     if(lastByAssetDirection.has(key)&&anchor-lastByAssetDirection.get(key)<24*3600000){
       duplicateWindow++;continue;
     }
     if(selected.length>=maxEvents)continue;
     lastByAssetDirection.set(key,anchor);
     const created=parseTime(row.created_at);
     const exAnte=created!=null && created>=anchor-60000
       && created<=anchor+15*60000 && created<=at;
     selected.push({asset,signal:a.research_signal,at:new Date(anchor).toISOString(),
       created_at:created==null?null:new Date(created).toISOString(),
       persisted_before_outcome:exAnte,venue_verified:a.venue_verified===true,
       price_usd:a.quote_price_usd,source:a.quote_source});
   }
 }
 const horizons={};
 for(const hours of OUTCOME_HORIZONS){
   const results=selected.map(s=>evaluateForwardSignalOutcome({
     signal:{asset:s.asset,research_signal:s.signal,observed_at:s.at,
       persisted_before_outcome:s.persisted_before_outcome,
       venue_verified:s.venue_verified,price_usd:s.price_usd},
     observations:prices[s.asset],horizonHours:hours,asOf:new Date(at)
   }));
   const mature=results.filter(r=>r.status==='MATURED');
   const directional=mature.filter(r=>typeof r.correct_direction==='boolean');
   const risk=mature.filter(r=>r.direction==='risk'&&r.hypothetical_50pct_reduction_alpha_pp!=null);
   horizons[String(hours)+'h']={
     evaluated_events:results.length,
     pending:results.filter(r=>r.status==='PENDING').length,
     venue_blocked:results.filter(r=>r.status==='BLOCKED').length,
     ex_ante_unattested:results.filter(r=>r.status==='UNATTESTED').length,
     missing_future_quote:results.filter(r=>r.status==='MISSING').length,
     invalid_signal:results.filter(r=>r.status==='INVALID_SIGNAL').length,
     matured_observational:mature.length,
     independently_attested:0,
     directionally_scored_observational:directional.length,
     observational_hit_rate_pct:directional.length?
       rounded(100*directional.filter(r=>r.correct_direction).length/directional.length):null,
     illustrative_risk_reduction_alpha_pp:risk.length?
       rounded(risk.reduce((s,r)=>s+r.hypothetical_50pct_reduction_alpha_pp,0)/risk.length):null,
     interpret_as:'unverified_research_only_no_real_alpha'
   };
 }
 return {
   contract_version:'shadow_skill_feedback_v0.1',
   evaluated_at:new Date(at).toISOString(),
   action_executed:'evaluate_persisted_forward_signals_24h_72h',
   research_evaluations_scanned:candidateRows.length,
   non_hold_alerts_seen:nonHoldSeen,
   nonoverlapping_alerts:selected.length,
   overlapping_alerts_excluded:duplicateWindow,
   source_quality_signals_excluded:badSourceSignals,
   provenance_attested_events:selected.filter(x=>x.persisted_before_outcome).length,
   source_coverage:sourceCoverage,
   horizons,
   blocked_capabilities:[
     'no_independently_time_attested_venue_quotes',
     'no_automatic_trades_or_policy_updates',
     'no_claim_of_predictive_edge'
   ],
   improvement_gate:'MORE_PROSPECTIVE_ATTESTED_EVIDENCE_REQUIRED',
   paid_ai_calls_made:0,external_calls_made:0,
   orders_created:0,portfolio_ledger_modified:false,
   execution_enabled:false
 };
}
