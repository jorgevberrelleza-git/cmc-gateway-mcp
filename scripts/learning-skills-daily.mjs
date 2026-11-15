import {createLearningStore} from '../src/learning/storage.mjs';
import {planShadowSkillWork} from '../src/learning/skill-orchestrator.mjs';
import {evaluateDailySkillFeedback} from '../src/learning/skill-feedback-v01.mjs';

// Daily skill cycle: classify source failures AND execute an offline,
// prospective-evidence evaluation. Data comes exclusively from the existing
// Shadow database; no new network research, paid models, orders or policy edits.
const store=createLearningStore();
try{
 const now=new Date();
 const recent=await store.recentSnapshots(120);
 const plan=planShadowSkillWork(recent,{now});
 const from=new Date(+now-5*86400000).toISOString();
 const snapshotTape=await store.snapshotsBetween(from,now.toISOString(),500);
 const evaluations=await store.listShadowV2Evaluations({from,to:now.toISOString(),limit:500});
 const feedback=evaluateDailySkillFeedback({snapshots:snapshotTape,evaluations,now});
 const executed=[
   {workflow:'cmc_crypto_data',action:'audit_429_and_fallback_coverage',status:'completed_offline',
    http429_attempts:plan.sample.cmc_public_http_429_runs,
    rest_attempts:plan.sample.cmc_rest_attempt_runs,
    used_paprika:plan.sample.coinpaprika_fallback_runs},
   {workflow:'cmc_crypto_research',action:'score_ex_ante_signals_at_24h_72h',
    status:'completed_offline',scored_events:feedback.nonoverlapping_alerts,
    independently_attested:0},
   {workflow:'cmc_market_context',action:'verify_macro_primary_attestation',
    status:'blocked_unverified',reason:'macro_primary_source_evidence_not_yet_joined_to_signal_tape'}
 ];
 console.log('SHADOW_SKILLS_DAILY='+JSON.stringify({
   ...plan,feedback_loop:feedback,
   executed_offline_workflows:executed,
   external_marketplace_skills_invoked:0,
   skills_integration_status:'local_guidance_applied_offline_not_remote_skills',
   no_trades:true,execution_enabled:false
 }));
}finally{await store.close();}
