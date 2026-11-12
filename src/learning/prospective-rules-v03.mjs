import {extractLearningFeatures} from './features.mjs';
import {evaluateDataConsistency} from './data-consistency.mjs';
// Frozen, read-only prospective research rules. This engine has no network,
// account, order, or portfolio-ledger access. Change thresholds by a new version,
// never fit them against its own future/OOS observations.
export const FORWARD_RULES_V03=Object.freeze({
 version:'shadow_rules_v0.3_research',
 assets:['BTC','ADA','AAVE'],
 min_consistency:90,
 max_snapshot_age_minutes:110,
 min_confirmation_gap_minutes:45,
 max_confirmation_gap_minutes:150,
 minimum_independent_evidence_families:2,
 microstructure_min_confidence:55,
 defensive_spot_max:35,
 defensive_trap_min:65,
 structure_drop_24h_pct:-2,
 structure_drop_7d_pct:-3,
 recovery_spot_min:70,
 recovery_trap_max:30,
 recovery_min_confidence:65,
 structure_recovery_24h_pct:2,
 structure_recovery_7d_pct:0,
 aave_fundamental_veto_max:25,
 aave_fundamental_confirm_min:65,
 allowed_quote_sources:['cmc_mcp','cmc_public_v3_keyless','coinpaprika_public'],
 external_calls_made:0,paid_ai_calls_made:0,execution_enabled:false
});
const n=v=>{
 if(v==null||typeof v==='boolean'||typeof v==='object')return null;
 const x=Number(v);return Number.isFinite(x)?x:null;
};
const ts=v=>{const x=Date.parse(v||'');return Number.isFinite(x)?x:null;};
const unique=v=>[...new Set(v)];
function snapshotAssessment(row,asset,policy,nowMs){
 const snap=row?.payload||null;
 const observed=ts(row?.generated_at||snap?.generated_at);
 const empty={asset,as_of:row?.generated_at||null,source:null,valid:false,
   reasons:[],risk_families:[],recovery_families:[],venue_verified:false,
   macro_primary_verified:false};
 if(!snap||observed==null||observed>nowMs||nowMs-observed>policy.max_snapshot_age_minutes*60000)
   return {...empty,reasons:['stale_missing_or_future_snapshot']};
 const source=String(snap?.quote_provenance?.source||'');
 const consistency=evaluateDataConsistency(snap);
 const f=extractLearningFeatures(snap).assets?.[asset]||null;
 const reasons=[];
 if(!policy.allowed_quote_sources.includes(source))reasons.push('unverified_quote_provenance');
 if(!(n(f?.price_usd)>0))reasons.push('missing_valid_usd_quote');
 if(consistency.blocking||consistency.score_0_100<policy.min_consistency||
    (consistency.asset_blocks?.[asset]||[]).length)reasons.push('consistency_gate');
 const v=snap?.microstructure?.assets?.[asset];
 const venue=v?.venue_price_check;
 const venueVerified=v?.available===true&&venue?.available===true&&
    venue?.material_mismatch===false;
 if(!venueVerified)reasons.push('venue_not_verified');
 const microConfidence=n(f?.microstructure_confidence),spot=n(f?.spot_confirmation),
   trap=n(f?.trap_risk),day=n(f?.pct_24h),week=n(f?.pct_7d);
 const fundamentals=n(f?.fundamental_quality),confirmation=f?.fundamental_confirmation;
 const risk=[],recovery=[];
 if(microConfidence!=null && microConfidence>=policy.microstructure_min_confidence &&
    ((spot!=null&&spot<=policy.defensive_spot_max)||
     (trap!=null&&trap>=policy.defensive_trap_min)))
   risk.push('microstructure');
 if(day!=null&&week!=null&&day<=policy.structure_drop_24h_pct&&
    week<=policy.structure_drop_7d_pct)risk.push('structure');
 if(asset==='AAVE'&&confirmation==='contradicts'&&fundamentals!=null&&
    fundamentals<=policy.aave_fundamental_veto_max)risk.push('fundamentals');
 if(microConfidence!=null&&microConfidence>=policy.recovery_min_confidence&&
    spot!=null&&spot>=policy.recovery_spot_min&&trap!=null&&trap<=policy.recovery_trap_max)
   recovery.push('microstructure');
 if(day!=null&&week!=null&&day>=policy.structure_recovery_24h_pct&&
    week>=policy.structure_recovery_7d_pct)recovery.push('structure');
 if(asset==='AAVE'&&confirmation==='confirms'&&fundamentals!=null&&
    fundamentals>=policy.aave_fundamental_confirm_min)recovery.push('fundamentals');
 // Venue quality is an execution prerequisite, not an independent directional
 // signal. AAVE missing venue must never be paper-filled as if Bitso traded it.
 const valid=reasons.filter(x=>x!=='venue_not_verified').length===0;
 return {...empty,as_of:new Date(observed).toISOString(),source,
   valid,reasons,venue_verified:venueVerified,
   risk_families:unique(risk),recovery_families:unique(recovery),
   macro_primary_verified:false,price_usd:n(f?.price_usd),
   // Do not turn unavailable macro/event evidence into approval.
   macro_evidence_gate:'primary_macro_attestation_unavailable'};
}
export function evaluateForwardRules({currentRow,previousRow=null,now=new Date(),
 policy=FORWARD_RULES_V03}={}){
 const at=+new Date(now);
 if(!Number.isFinite(at))throw Error('invalid_evaluation_time');
 if(!currentRow?.id)throw Error('current_snapshot_id_required');
 const latestTs=ts(currentRow.generated_at||currentRow.payload?.generated_at);
 const beforeTs=ts(previousRow?.generated_at||previousRow?.payload?.generated_at);
 const gap=latestTs!=null&&beforeTs!=null?(latestTs-beforeTs)/60000:null;
 const confirmationGapValid=gap!=null&&gap>=policy.min_confirmation_gap_minutes&&
   gap<=policy.max_confirmation_gap_minutes;
 const assets={};
 for(const asset of policy.assets){
  const cur=snapshotAssessment(currentRow,asset,policy,at);
  // Assess prior snapshot at its own observation time, not today's time:
  // it must be past information, not rejected merely due to aging.
  const prev=previousRow?snapshotAssessment(previousRow,asset,policy,beforeTs):null;
  const riskConfirmed=cur.valid&&prev?.valid===true&&confirmationGapValid&&
    cur.risk_families.filter(x=>prev.risk_families.includes(x)).length>=
      policy.minimum_independent_evidence_families;
  const recoveryConfirmed=cur.valid&&prev?.valid===true&&confirmationGapValid&&
    cur.recovery_families.filter(x=>prev.recovery_families.includes(x)).length>=
      policy.minimum_independent_evidence_families;
  let signal='HOLD_RESEARCH',blocker=null;
  if(!cur.valid)blocker='source_or_quote_quality';
  else if(!confirmationGapValid)blocker='insufficient_snapshot_persistence';
  if(cur.valid && riskConfirmed){
   if(cur.venue_verified&&prev.venue_verified)signal='PAPER_REDUCE_REVIEW';
   else {signal='RISK_RESEARCH_VENUE_BLOCKED';blocker='venue_not_verified';}
  }else if(cur.valid&&recoveryConfirmed){
   // Even if the price and venue appear favorable, no BUY is authorized
   // without verified macro attestation and executable sizing.
   signal=cur.venue_verified&&prev.venue_verified?
     'RECOVERY_WATCH_MACRO_UNVERIFIED':'RECOVERY_WATCH_VENUE_BLOCKED';
   blocker=cur.venue_verified?'macro_not_primary_verified':'venue_not_verified';
  }else if(cur.valid && cur.risk_families.length>=
      policy.minimum_independent_evidence_families)signal='RISK_WATCH_UNCONFIRMED';
  else if(cur.valid && cur.recovery_families.length>=
      policy.minimum_independent_evidence_families)signal='RECOVERY_WATCH_UNCONFIRMED';
  assets[asset]={
    action:'HOLD',research_signal:signal,blocker,venue_verified:cur.venue_verified,
    quote_source:cur.source,quote_price_usd:cur.price_usd||null,
    risk_families:cur.risk_families,recovery_families:cur.recovery_families,
    prior_risk_families:prev?.risk_families||[],
    prior_recovery_families:prev?.recovery_families||[],
    source_quality_passed:cur.valid,
    consistency_reasons:cur.reasons,
    persistence_confirmed:Boolean(riskConfirmed||recoveryConfirmed),
    macro_primary_verified:false,position_change_allowed:false,
    order_proposal_allowed:false,execution_enabled:false
  };
 }
 return {
  strategy_version:policy.version,
  snapshot_id:currentRow.id,
  generated_at:currentRow.generated_at,
  observed_at:currentRow.generated_at,
  evaluated_at:new Date(at).toISOString(),
  confirmation_gap_minutes:gap,
  confirmation_gap_valid:confirmationGapValid,
  assets,
  frozen_policy:policy,
  evaluation_kind:'prospective_research_from_saved_observations',
  guardrails:{orders_created:0,portfolio_ledger_modified:false,
    paid_ai_calls_made:0,external_calls_made:0,execution_enabled:false},
  execution_enabled:false
 };
}
