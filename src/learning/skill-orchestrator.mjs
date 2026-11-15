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
export const INDEPENDENT_QUOTE_SKILL=Object.freeze({
  id:'shadow_independent_quote_quality',kind:'local-evidence-skill',
  paid_api_key_required:false,execution_enabled:false
});
const safe=(x)=>Number.isFinite(Number(x))?Number(x):null;
export function planShadowSkillWork(snapshotRows=[],{now=new Date(),enablePaid=false}={}){
  const chronological=(Array.isArray(snapshotRows)?snapshotRows:[])
    .filter(x=>x?.payload && Number.isFinite(Date.parse(x.generated_at)))
    .sort((a,b)=>Date.parse(a.generated_at)-Date.parse(b.generated_at));
  const latest=chronological.at(-1)||null;
  const nowMs=+new Date(now);
  const recent=chronological.filter(r=>Date.parse(r.generated_at)>nowMs-24*3600000&&Date.parse(r.generated_at)<=nowMs);
  const previous24h=chronological.filter(r=>Date.parse(r.generated_at)>nowMs-48*3600000&&Date.parse(r.generated_at)<=nowMs-24*3600000);
  const attempts=recent.filter(r=>r.payload?.quote_provenance?.mcp_probe_attempted!==false);
  const primaryFailures=attempts.filter(r=>r.payload?.quote_provenance?.mcp_failure_class);
  const backupUsage=recent.filter(r=>r.payload?.quote_provenance?.source==='coinpaprika_public');
  // Observability only: a REST HTTP 429 must never be counted as healthy CMC coverage.
  const cmcRest429=recent.filter(r=>r.payload?.quote_provenance?.public_fallback_error_class==='cmc_public_http_429');
  const cmcRestAttempts=recent.filter(r=>r.payload?.quote_provenance?.public_fallback_attempted===true);
  const cmcRestSuccess=recent.filter(r=>r.payload?.quote_provenance?.source==='cmc_public_v3_keyless');
  const independentAttempts=recent.filter(r=>r.payload?.quote_provenance?.coinpaprika_primary_attempted===true);
  const independentSuccess=independentAttempts.filter(r=>
    r.payload?.quote_provenance?.source==='coinpaprika_public'&&
    r.payload?.quote_provenance?.routing_policy?.primary_succeeded===true);
  const independentFailures=independentAttempts.filter(r=>r.payload?.quote_provenance?.coinpaprika_primary_error_class);
  const cmcEmergencyFailovers=independentAttempts.filter(r=>
    ['cmc_mcp','cmc_public_v3_keyless'].includes(r.payload?.quote_provenance?.source));
  const previous429=previous24h.filter(r=>r.payload?.quote_provenance?.public_fallback_error_class==='cmc_public_http_429');
  const previousRestAttempts=previous24h.filter(r=>r.payload?.quote_provenance?.public_fallback_attempted===true);
  const rate429=cmcRestAttempts.length?Number((100*cmcRest429.length/cmcRestAttempts.length).toFixed(1)):null;
  const previousRate429=previousRestAttempts.length?Number((100*previous429.length/previousRestAttempts.length).toFixed(1)):null;
  // Observational spike only: requires two sufficiently sampled windows.
  // This never changes the CMC request schedule, source routing, or risk parameters.
  const rateLimitSpike=recent.length>=12&&previous24h.length>=12
    &&cmcRestAttempts.length>=12&&previousRestAttempts.length>=12
    &&cmcRest429.length>=4&&rate429>=20&&rate429>=previousRate429+10;
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
  if(independentAttempts.length){
    const successRate=Number((100*independentSuccess.length/independentAttempts.length).toFixed(1));
    priorities.push({
      id:'independent_quote_quality',
      priority:independentAttempts.length>=12&&successRate<90?125:94,
      workflow:'shadow_independent_quote_quality',
      action:'audit_primary_quote_success_and_Bitso_comparability; block_all_unverified_assets',
      primary_attempts:independentAttempts.length,
      primary_success_runs:independentSuccess.length,
      primary_success_rate_pct:successRate,
      primary_failure_runs:independentFailures.length,
      cmc_emergency_failovers:cmcEmergencyFailovers.length,
      aave_venue_verified:venueCoverage.AAVE,
      status:'automatic_offline_evidence_quality_audit'
    });
  }
  if(primaryFailures.length>=3){
    priorities.push({id:'provider_recovery',priority:100,
      workflow:'cmc_crypto_data',
      action:'recheck_mcp_only_on_circuit_recovery_probe; preserve_existing_cmc_rest_and_paprika_routes',
      observed_failures:primaryFailures.length,
      status:'automatic_safe_source_selection'});
  }
  if(cmcRest429.length>0){
    priorities.push({id:'cmc_rest_rate_limit_audit',priority:rateLimitSpike?120:cmcRest429.length>=2?110:88,
      workflow:'cmc_crypto_data',
      action:'audit_observed_429_frequency_and_existing_fallback_only; no_extra_retries_or_new_paid_api_calls',
      observed_http_429_runs:cmcRest429.length,
      observed_http_429_rate_pct:rate429,
      previous_24h_http_429_runs:previous429.length,
      previous_24h_http_429_rate_pct:previousRate429,
      rate_limit_spike:rateLimitSpike,
      status:rateLimitSpike?'research_only_spike_detected_no_source_policy_change':'research_only_no_rate_limit_policy_change'});
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
    local_skill_catalog:[INDEPENDENT_QUOTE_SKILL],
    sample:{snapshots:chronological.length,recent_24h:recent.length,
      primary_mcp_failures:primaryFailures.length,primary_attempts:attempts.length,
      coinpaprika_fallback_runs:backupUsage.length,cmc_public_http_429_runs:cmcRest429.length,
      cmc_rest_attempt_runs:cmcRestAttempts.length,cmc_rest_success_runs:cmcRestSuccess.length,
      cmc_public_http_429_rate_pct:rate429,
      cmc_public_http_429_previous_24h_runs:previous429.length,
      cmc_public_http_429_previous_24h_rate_pct:previousRate429,
      cmc_rest_rate_limit_spike:rateLimitSpike,
      independent_primary_attempts:independentAttempts.length,
      independent_primary_success_runs:independentSuccess.length,
      independent_primary_failure_runs:independentFailures.length,
      cmc_emergency_failover_runs:cmcEmergencyFailovers.length,
      material_events:material.length,
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
    note:'Independent quote-quality skill runs locally using recorded source provenance. CMC marketplace skills remain optional guidance and are not invoked automatically; no new paid APIs, trades or macro inference.'
  };
}
