// SHADOW AUTONOMY CONTROL PLANE v0.5.
// Pure, deterministic, read-only committee integrating actual saved research
// signals and quality gates. It cannot issue a buy/sell order, change a paper
// portfolio, call an AI provider, access Bitso, or promote historical policies.
// UNKNOWN means NOT VERIFIED, never "safe".
import crypto from 'node:crypto';
import { evaluateShadowV2 } from './shadow-v2.mjs';
import { evaluateForwardRules } from './prospective-rules-v03.mjs';
import { priceFromSnapshot, FORECAST_VERSION, HORIZONS } from './prospective-forecast-v04.mjs';

export const AUTONOMY_CONTROL_VERSION='shadow_autonomy_control_v0.5';
export const SUPPORTED_ASSETS=Object.freeze(['BTC','ADA','AAVE']);
const stable = x => Array.isArray(x) ? x.map(stable) :
  x && typeof x==='object' && !(x instanceof Date)
    ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])]))
    : x;
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const parseTs=x=>{const n=Date.parse(x||'');return Number.isFinite(n)?n:null;};
const finiteNumber=x=>{
  if(typeof x==='number')return Number.isFinite(x)?x:null;
  // node-postgres returns SQL NUMERIC / DECIMAL values as strings by default.
  // Accept only strictly numeric finite strings; never infer missing values.
  if(typeof x==='string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(x.trim())){
    const n=Number(x.trim());return Number.isFinite(n)?n:null;
  }
  return null;
};
const unique=xs=>[...new Set(xs)];
const fail=m=>{throw Error('autonomy_control:'+m);};

function validateInputs({currentRow,previousRow,nowMs}) {
  if(!currentRow?.id||!currentRow?.payload)fail('missing_snapshot');
  const stamps=[parseTs(currentRow.generated_at),parseTs(currentRow.payload.generated_at)];
  if(stamps.some(x=>x==null))fail('snapshot_timestamp_missing');
  if(stamps.some(x=>x>nowMs))fail('future_snapshot');
  if(previousRow) {
    const earlier=[parseTs(previousRow.generated_at),parseTs(previousRow.payload?.generated_at)];
    if(earlier.some(x=>x==null)||earlier.some(x=>x>nowMs))fail('invalid_previous_snapshot');
    if(Math.max(...earlier)>=Math.max(...stamps))fail('snapshot_out_of_order');
  }
  return Math.max(...stamps);
}
function scorecard(scoreRows=[],nowMs) {
  const map=Object.fromEntries(HORIZONS.map(h=>[h.id,{
    evaluated:0,correct:0,incorrect:0,abstained:0,dataGaps:0,accuracyPct:null,
    coveragePct:null
  }]));
  for(const row of scoreRows) {
    if(!row?.strategy_version?.startsWith('shadow_prospective_score_v0.4_'))continue;
    const horizon=row.strategy_version.slice('shadow_prospective_score_v0.4_'.length);
    const bucket=map[horizon];
    if(!bucket)continue;
    const issued=parseTs(row.regime?.dueAt);
    const saved=parseTs(row.generated_at);
    if(saved==null||saved>nowMs||issued==null||issued>saved)continue;
    for(const a of SUPPORTED_ASSETS) {
      const s=row.asset_assessments?.scores?.[a];
      if(!s || s.horizon!==horizon)continue;
      if(s.status==='SCORED' && typeof s.hit==='boolean') {
        bucket.evaluated++;
        if(s.hit)bucket.correct++;else bucket.incorrect++;
      }else if(s.status==='ABSTAINED')bucket.abstained++;
      else if(s.status==='DATA_GAP_UNSCORED')bucket.dataGaps++;
    }
  }
  for(const item of Object.values(map)) {
    const possible=item.evaluated+item.abstained+item.dataGaps;
    if(item.evaluated)item.accuracyPct=Number((100*item.correct/item.evaluated).toFixed(2));
    if(possible)item.coveragePct=Number((100*item.evaluated/possible).toFixed(2));
  }
  return map;
}
function forecastReceipt(forecast,nowMs) {
  if(forecast?.version!==FORECAST_VERSION)return {available:false,integrity:false,reason:'no_forward_forecast'};
  const {commitmentHash,...core}=forecast;
  if(typeof commitmentHash!=='string'||commitmentHash!==digest(core))
    return {available:false,integrity:false,reason:'forecast_hash_mismatch'};
  const issued=parseTs(forecast.issuedAt);
  if(issued==null||issued>nowMs)return {available:false,integrity:false,reason:'future_forecast_issuance'};
  if(nowMs-issued>48*3600000)return {available:false,integrity:true,reason:'forecast_stale'};
  return {
    available:true,integrity:true,reason:null,
    issuedAt:forecast.issuedAt,commitmentHash,
    ageHours:Number(((nowMs-issued)/3600000).toFixed(2)),
    calibratedProbabilities:forecast.probabilitiesCalibrated===true
  };
}
function recentHealth(cycles=[],nowMs) {
  const rows=cycles.filter(x=>parseTs(x.started_at)!=null &&
    parseTs(x.started_at)<=nowMs).sort((a,b)=>parseTs(b.started_at)-parseTs(a.started_at));
  const first=rows[0];
  const lastAge=first?Number(((nowMs-parseTs(first.started_at))/60000).toFixed(1)):null;
  // The existing hourly job may still be running during evaluation; a
  // successful completed prior run is acceptable, but stale/failed is not.
  const good=rows.filter(x=>x.status==='success');
  return {
    recentCycles:rows.length,
    successfulCycles:good.length,
    latestStatus:first?.status||'UNAVAILABLE',
    latestStartedAt:first?.started_at||null,
    latestAgeMinutes:lastAge,
    stable:rows.length>=3 && good.length>=3 && lastAge!=null&&lastAge<=150 &&
      rows.slice(0,3).every(x=>x.status==='success')
  };
}

export function buildAutonomyControl({
  currentRow,previousRow=null,now=new Date(),
  prospectiveForecast=null,prospectiveScoreRows=[],
  latestPortfolioMark=null,recentRuntimeCycles=[],
  independentMarketImpactEvidence=null,
  brokerExecutionAttestation=null,operationalIncidentAttestation=null,
  portfolioReconciliation=null,prospectiveNetAlphaAttestation=null
}={}) {
  const at=+new Date(now);
  if(!Number.isFinite(at))fail('invalid_now');
  const snapshotEffectiveAt=validateInputs({currentRow,previousRow,nowMs:at});
  const v2=evaluateShadowV2({snapshotRow:currentRow,recentSnapshots:previousRow?[previousRow]:[]});
  const forward=evaluateForwardRules({currentRow,previousRow,now:new Date(at)});
  const forecasts=forecastReceipt(prospectiveForecast,at);
  const score=scorecard(prospectiveScoreRows,at);
  const health=recentHealth(recentRuntimeCycles,at);
  const overallData=v2.consistency && !v2.consistency.blocking &&
    v2.consistency.score_0_100>=90;
  const ageMinutes=Number(((at-snapshotEffectiveAt)/60000).toFixed(1));
  const dataFresh=ageMinutes>=0&&ageMinutes<=110;
  const mark=latestPortfolioMark||null;
  const markAge=mark?parseTs(mark.marked_at):null;
  const portfolioPaper={
    source:'SHADOW_MOCK_ONLY_NOT_BITSO',
    verifiedRealHoldings:false,
    latestUsd:finiteNumber(mark?.total_value_usd),
    alphaVsHodlPct:finiteNumber(mark?.alpha_vs_hodl_pct),
    mockDrawdownPct:finiteNumber(mark?.drawdown_pct),
    markAgeHours:markAge!=null?Number(((at-markAge)/3600000).toFixed(2)):null,
    alphaProven:false
  };
  const attestations={
    independentMacro:independentMarketImpactEvidence===true,
    executionVenue:brokerExecutionAttestation===true,
    liveOperationalRisk:operationalIncidentAttestation===true,
    realPortfolioReconciled:portfolioReconciliation===true,
    verifiedForwardAlpha:prospectiveNetAlphaAttestation===true
  };
  // Deliberately no interface allowing a boolean "green light" to authorize
  // real-money orders: attestation presence only helps prioritize R&D.
  const assets={};
  for(const asset of SUPPORTED_ASSETS) {
    const q=priceFromSnapshot(currentRow,asset,{now:at});
    const signal=forward.assets?.[asset]||{};
    const posture=v2.assets?.[asset]||{};
    const blocks=[];
    if(!dataFresh||!overallData||!q.valid||signal.source_quality_passed!==true)
      blocks.push('QUOTE_DATA_UNVERIFIED');
    if(signal.venue_verified!==true)blocks.push('BITSO_VENUE_OR_PRICE_CHECK_UNVERIFIED');
    if(signal.macro_primary_verified!==true)blocks.push('MACRO_IMPACT_UNVERIFIED');
    if(!attestations.liveOperationalRisk)blocks.push('OPERATIONAL_INCIDENT_FEED_NOT_ATTESTED');
    if(!forecasts.available)blocks.push('PROSPECTIVE_FORECAST_NOT_VERIFIED_OR_TOO_OLD');
    if(!attestations.realPortfolioReconciled)blocks.push('REAL_BALANCES_NOT_RECONCILED');
    if(!attestations.verifiedForwardAlpha)blocks.push('NET_FORWARD_EDGE_NOT_PROVEN');
    if(!attestations.executionVenue)blocks.push('BROKER_ORDER_EXECUTION_NOT_CERTIFIED');
    const risk=unique([...(signal.risk_families||[]),...(posture.blockers||[])]);
    let research='OBSERVE';
    if(blocks.includes('QUOTE_DATA_UNVERIFIED'))research='DATA_BLOCKED';
    else if(risk.length>=2 || signal.research_signal==='PAPER_REDUCE_REVIEW' ||
      signal.research_signal==='RISK_RESEARCH_VENUE_BLOCKED')research='DEFENSIVE_REVIEW';
    else if(risk.length)research='RISK_MONITOR';
    else if(signal.research_signal?.includes('RECOVERY'))research='RECOVERY_RESEARCH';
    const f=prospectiveForecast?.assets?.[asset];
    const forecastsForAsset=Object.fromEntries(HORIZONS.map(h=>[h.id,{
      direction:forecasts.available?f?.horizons?.[h.id]?.direction||'UNKNOWN':'UNAVAILABLE',
      dueAt:forecasts.available?f?.horizons?.[h.id]?.dueAt||null:null
    }]));
    assets[asset]={
      researchPosture:research,
      shadowV2Posture:posture.posture||'UNKNOWN',
      forwardResearchSignal:signal.research_signal||'UNKNOWN',
      riskFamilies:risk,
      source:signal.quote_source||q.source||null,
      sourceQualityPassed:signal.source_quality_passed===true&&q.valid,
      venueVerified:signal.venue_verified===true,
      evidenceGaps:unique(blocks),
      quoteUsd:q.valid?q.priceUsd:null,
      forecast:forecastsForAsset,
      recommendedTrade:'NONE',
      allowedPositionChange:false
    };
  }
  const blockers=unique(SUPPORTED_ASSETS.flatMap(a=>assets[a].evidenceGaps));
  if(!health.stable)blockers.push('RUNTIME_STABILITY_NOT_SUFFICIENTLY_VERIFIED');
  if(!forecasts.calibratedProbabilities)blockers.push('FORECAST_PROBABILITIES_NOT_CALIBRATED');
  if(score['24h'].evaluated<30)blockers.push('INSUFFICIENT_INDEPENDENT_PROSPECTIVE_SAMPLES');
  if(portfolioPaper.alphaVsHodlPct==null||portfolioPaper.alphaVsHodlPct<=0)
    blockers.push('NO_DEMONSTRATED_PAPER_ALPHA_VS_HOLD');
  blockers.push('BROKER_KEYS_AND_LIVE_ORDER_ROUTER_INTENTIONALLY_ABSENT');
  const capabilityRegistry={
    sourceQuotes:'CONNECTED_LIVE',
    microstructure:'CONNECTED_PARTIALLY',
    coreShadowV2:'CONNECTED_RESEARCH_ONLY',
    forwardResearchRulesV03:'CONNECTED_RESEARCH_ONLY',
    dailyForecastV04:forecasts.available?'CONNECTED_WITH_VALID_FORECAST':'CONNECTED_PENDING_VALID_FORECAST',
    forecastScoring:'CONNECTED_MATURITIES_ONLY',
    geoOfficialFeeds:'SEPARATE_SCANNER_NO_CONFIRMED_MARKET_IMPACT_ATTESTATION',
    skillResearchOrchestrator:'SEPARATE_DAILY_RESEARCH_NO_POLICY_PROMOTION',
    historicalTimeMachine:'OFFLINE_VALIDATION_ONLY',
    regimeClassifier:'OFFLINE_VALIDATION_ONLY',
    groqCanary:'SYNTHETIC_TEST_ONLY',
    bitsoOrderRouter:'NOT_CONNECTED',
    operationalBankExchangeIncidentGuard:'PLANNED_NOT_ATTESTED'
  };
  const priorities=[
    {id:'PROSPECTIVE_SCORECARD',mode:'AUTOMATIC_RESEARCH',reason:score['24h'].evaluated<30?'need_independent_matured_forecasts':'continue_stratified_accuracy_validation'},
    {id:'AAVE_EXECUTION_VENUE',mode:'REQUIRES_VENUE_EVIDENCE',reason:assets.AAVE.venueVerified?'verified_today':'missing_venue_comparability'},
    {id:'MACRO_IMPACT_ATTESTATION',mode:'RESEARCH_REQUIRED',reason:'official_feed_metadata_not_market_causality'},
    {id:'OPERATIONAL_COUNTERPARTY_SECURITY',mode:'RESEARCH_REQUIRED',reason:'incident_feed_not_connected'},
    {id:'PAPER_COST_REALISM',mode:'RESEARCH_REQUIRED',reason:'Bitso_spreads_fees_partial_fills_and_balance_reconciliation_missing'},
    {id:'TIME_MACHINE_PROSPECTIVE_PROMOTION',mode:'MANUAL_REVIEW_ONLY',reason:'historical_winners_fail_robustness_and_forward_alpha_gate'}
  ];
  const report={
    version:AUTONOMY_CONTROL_VERSION,
    generatedAt:new Date(at).toISOString(),
    snapshotId:String(currentRow.id),
    snapshotAsOf:new Date(snapshotEffectiveAt).toISOString(),
    snapshotAgeMinutes:ageMinutes,
    dataConsistencyScore:v2.consistency?.score_0_100??null,
    dataFresh,overallDataQualityPassed:Boolean(overallData),
    runtime:health,
    forecastReceipt:forecasts,
    prospectiveScorecard:score,
    simulatedPortfolio:portfolioPaper,
    externalAttestations:attestations,
    capabilities:capabilityRegistry,
    assets,
    blockers,
    priorities,
    autonomousResearchReady:dataFresh&&overallData&&health.stable,
    realMoneyReady:false,
    executionEnabled:false,
    orderRouterConnected:false,
    positionChangesAllowed:false,
    authorizedTradeCount:0,
    realOrdersCreated:0,
    policyPromotionAllowed:false,
    riskBudgetSuggestionOnly:{
      maxLossPerTradePct:0.5,maxDailyPortfolioLossPct:2,maxPortfolioDrawdownPct:10,
      maxSingleAssetWeightPct:20,killSwitch:'MUST_BE_TESTED_BEFORE_ANY_FUNDING',
      status:'PROPOSED_NOT_IMPLEMENTED_OR_CERTIFIED'
    },
    statement:'Research-only; no proven net alpha, no Bitso execution, no investment authorization.'
  };
  report.auditHash=digest(report);
  return report;
}
