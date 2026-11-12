import {createLearningStore} from '../src/learning/storage.mjs';
import {evaluateForwardRules,FORWARD_RULES_V03} from '../src/learning/prospective-rules-v03.mjs';
// This sidecar only reads already-saved observations and appends one unique
// diagnostic evaluation. Never inserts a decision, paper order, or ledger event.
const store=createLearningStore();
try{
 const rows=await store.recentSnapshots(2);
 const currentRow=rows[0],previousRow=rows[1]||null;
 if(!currentRow)throw Error('forward_rules_no_snapshot');
 const result=evaluateForwardRules({currentRow,previousRow,now:new Date()});
 const stored=await store.saveShadowV2Evaluation({
  strategy_version:FORWARD_RULES_V03.version,
  snapshot_id:currentRow.id,
  generated_at:currentRow.generated_at,
  regime:{research_only:true,classification:'UNVERIFIED_MACRO',frozen_policy:FORWARD_RULES_V03,
    evaluated_at:result.evaluated_at,confirmation_gap_minutes:result.confirmation_gap_minutes},
  consistency:{forward_research:true,source_checks:true,execution_enabled:false},
  assets:result.assets,
  external_research_trigger:{required:false,execute_external_calls:false,
    no_position_change:true,report:'prospective_evidence_tape',
    report_version:result.strategy_version}
 });
 console.log('SHADOW_RULES_FORWARD='+JSON.stringify({
  ok:true,snapshot_id:currentRow.id,policy:result.strategy_version,
  evaluated_at:result.evaluated_at,persisted:stored!=null,
  duplicate:stored==null,
  confirmation_gap_minutes:result.confirmation_gap_minutes,
  research_signals:Object.fromEntries(Object.entries(result.assets).map(([a,v])=>[a,{
    signal:v.research_signal,blocker:v.blocker,
    risk_families:v.risk_families,recovery_families:v.recovery_families,
    venue_verified:v.venue_verified,source_quality_passed:v.source_quality_passed,
    quote_source:v.quote_source,position_change_allowed:false
  }])),
  guards:result.guardrails,
  real_money_ready:false,execution_enabled:false
 }));
}finally{await store.close();}
