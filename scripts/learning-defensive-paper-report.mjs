import {createLearningStore} from '../src/learning/storage.mjs';
import {evaluateDefensivePortfolio} from '../src/learning/defensive-paper-sim.mjs';
const store=createLearningStore();
try{
 const now=new Date();
 const hours=Math.min(24*21,Math.max(24*5,Number(process.env.LEARNING_DEFENSIVE_REPORT_HOURS||336)));
 const from=new Date(+now-hours*3600000);
 const raw=await store.snapshotsBetween(from.toISOString(),now.toISOString(),5000);
 const report=evaluateDefensivePortfolio(raw,{now});
 const compact=Object.fromEntries(Object.entries(report.scenarios).map(([mode,x])=>[
  mode,{
    initial_usd:x.initial_usd,final_usd:x.final_usd,net_return_pct:x.net_return_pct,
    alpha_vs_hodl_pp:x.alpha_vs_hodl_pp,trades:x.trades,
    estimated_costs_usd:x.estimated_costs_usd,oos_sample_sufficient:x.oos_sample_sufficient,
    assets:Object.fromEntries(Object.entries(x.per_asset).map(([asset,y])=>[
      asset,{observations:y.observations,net_return_pct:y.net_return_pct,
        max_drawdown_pct:y.max_drawdown_pct,trades:y.trades,status:y.status,
        unavailable_signal_windows:y.unavailable_signal_windows,
        missing_microstructure_windows:y.missing_microstructure_windows,
        fundamental_veto_observed_windows:y.fundamental_veto_observed_windows}
    ]))
  }
 ]));
 console.log('SHADOW_DEFENSIVE_RESEARCH='+JSON.stringify({
   version:report.contract_version,snapshot_count:report.sample_snapshots,
   oos_raw_snapshots:report.oos_raw_snapshots,oos_start:report.oos_start,
   scenarios:compact,evidence_gate:report.evidence_gate,
   evaluation_kind:report.evaluation_kind,statistically_actionable:false,forward_test_needed:true,
   no_lookahead:report.no_lookahead_signal_and_execution_separated,
   execution_enabled:false,paid_ai_calls_made:0,external_calls_made:0
 }));
}finally{await store.close();}
