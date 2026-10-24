import {assessEventQuality} from './event-quality-v02.mjs';
import {evaluateWalkforward} from './walkforward-v01.mjs';

// Audited local adoption of CMC marketplace workflows. No third-party code is
// executed, no API credentials are exfiltrated, and this module makes zero
// remote calls or financial decisions.
export const CMC_SKILL_CATALOG=Object.freeze([
  {id:'cmc_crypto_data',source:'https://coinmarketcap.com/api/documentation/ai-agent-hub/skills/cmc-api-crypto',kind:'api-guidance',needs_cmc_pro_key:true},
  {id:'cmc_market_context',source:'https://coinmarketcap.com/api/documentation/ai-agent-hub/skills/cmc-api-market',kind:'api-guidance',needs_cmc_pro_key:true},
  {id:'cmc_crypto_research',source:'https://coinmarketcap.com/api/documentation/ai-agent-hub/skills/crypto-research',kind:'mcp-guidance',needs_working_mcp:true}
]);
const safe=(x)=>Number.isFinite(Number(x))?Number(x):null;
export function planShadowSkillWork(snapshotRows=[],{now=new Date(),enablePaid=false}={}){
  const chronological=(Array.isArray(snapshotRows)?snapshotRows:[])
    .filter(x=>x?.payload && Number.isFinite(Date.parse(x.generated_at)))
    .sort((a,b)=>Date.parse(a.generated_at)-Date.parse(b.generated_at));
  const latest=chronological.at(-1)||null;
  const recent=chronological.filter(r=>Date.parse(r.generated_at)>+new Date(now)-24*3600000);
  const attempts=recent.filter(r=>r.payload?.quote_provenance?.mcp_probe_attempted!==false);
  const primaryFailures=attempts.filter(r=>r.payload?.quote_provenance?.mcp_failure_class);
  const backupUsage=recent.filter(r=>r.payload?.quote_provenance?.source==='coinpaprika_public');
  const material=recent.filter(r=>r.material_event?.material===true);
  const candidates=material.filter(r=>assessEventQuality(r.material_event).research_candidate);
  const context=material.length-candidates.length;
  const latestRegime=latest?.payload?.market?.global||null;
  const macroVerified=latest?.payload?.regime?.macro_gate?.primary_source_verified===true;
  const latestVenue=latest?.payload?.microstructure?.assets||{};
  const venueCoverage=Object.fromEntries(['BTC','ADA','AAVE'].map(asset=>[
    asset,latestVenue?.[asset]?.venue_price_check?.available===true
  ]));
  const signed=evaluateWalkforward(chronological,{now});
  const sample=Object.fromEntries(Object.entries(signed.assets).map(([asset,item])=>[
    asset,{oos_comparable:item.test.comparable_windows,
      oos_long_hypotheses:item.test.long_hypotheses,
      reasons:item.test.reason_counts,
      mean_excess_vs_hodl_pp:item.test.mean_excess_vs_hodl_pp}
  ]));
  const priorities=[];
  if(primaryFailures.length>=3){
    priorities.push({id:'provider_recovery',priority:100,
      workflow:'cmc_crypto_data',
      action:'recheck_mcp_only_on_circuit_recovery_probe; preserve_existing_cmc_rest_and_paprika_routes',
      observed_failures:primaryFailures.length,
      status:'automatic_safe_source_selection'});
  }
  if(!macroVerified){
    priorities.push({id:'macro_attestation',priority:90,
      workflow:'cmc_market_context',
      action:'compare_existing_GEO_primary_sources_to_reported_event_before_any_risk_on_change',
      status:'research_only_no_pro_market_api_without_separate_key'});
  }
  if(!venueCoverage.AAVE){
    priorities.push({id:'aave_venue_evidence',priority:85,
      workflow:'cmc_crypto_research',
      action:'audit_AAVE_Bitso_pair_and_liquidity_before_claiming_executability',
      status:'research_only'});
  }
  if(Object.values(sample).some(x=>x.oos_comparable<20||x.oos_long_hypotheses<10)){
    priorities.push({id:'walkforward_coverage',priority:75,
      workflow:'cmc_crypto_data',
      action:'accumulate_fresh_4h_labels; analyze_missing_reasons_without_tuning_on_test',
      status:'automatic_offline_validation'});
  }
  if(material.length){
    priorities.push({id:'research_noise_qa',priority:65,
      workflow:'cmc_crypto_research',
      action:'audit_retained_critical_events_and_outcomes_before_modifying_queue_thresholds',
      material_events:material.length,
      high_evidence:candidates.length,
      context_only:context,
      status:'automatic_offline_validation'});
  }
  priorities.sort((a,b)=>b.priority-a.priority);
  return {
    contract_version:'shadow_cmc_marketplace_orchestrator_v0.1',
    now:new Date(now).toISOString(),
    source_catalog:CMC_SKILL_CATALOG.map(x=>({id:x.id,kind:x.kind,needs_cmc_pro_key:!!x.needs_cmc_pro_key,needs_working_mcp:!!x.needs_working_mcp})),
    sample:{snapshots:chronological.length,recent_24h:recent.length,
      primary_mcp_failures:primaryFailures.length,primary_attempts:attempts.length,
      coinpaprika_fallback_runs:backupUsage.length,material_events:material.length,
      high_evidence_research_events:candidates.length,context_only:context,
      venue_comparison_available:venueCoverage,walkforward:sample},
    highest_priority:priorities[0]||null,
    next_workflows:priorities.slice(0,5),
    authenticated_CMC_Pro_API_requests_authorized:false,
    external_calls_made:0,
    paid_ai_calls_made:0,
    automatic_real_money_orders_allowed:false,
    enablePaid_ignored:true,
    execution_enabled:false,
    note:'Read-only research planner: external API skills require their own credentials/entitlements; never treat MCP key as Pro REST key.'
  };
}
