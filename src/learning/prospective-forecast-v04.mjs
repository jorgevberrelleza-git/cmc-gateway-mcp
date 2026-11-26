// Shadow Prospective v0.4: deterministic, precommitted market hypotheses.
// Pure functions: no network, database, broker, AI, orders or mutable portfolio.
// Every forecast is issued AFTER the source observation and scored only AFTER its target.
import crypto from 'node:crypto';
import { extractLearningFeatures } from './features.mjs';
import { evaluateDataConsistency } from './data-consistency.mjs';
import { evaluateForwardRules, FORWARD_RULES_V03 } from './prospective-rules-v03.mjs';

export const FORECAST_VERSION = 'shadow_prospective_v0.4';
export const ASSETS = Object.freeze(['BTC','ADA','AAVE']);
export const HORIZONS = Object.freeze([
  Object.freeze({ id:'24h', ms:86_400_000, neutralBandPct:1.5 }),
  Object.freeze({ id:'72h', ms:259_200_000, neutralBandPct:2.5 }),
  Object.freeze({ id:'168h', ms:604_800_000, neutralBandPct:4.0 })
]);
const SOURCES = new Set(FORWARD_RULES_V03.allowed_quote_sources);
const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x==='object' && !(x instanceof Date) ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])) : x;
const sha = obj => crypto.createHash('sha256').update(JSON.stringify(stable(obj))).digest('hex');
const num = v => { if (v==null || typeof v==='boolean'||typeof v==='object')return null;const n=Number(v);return Number.isFinite(n)?n:null; };
const fail = m => { throw new Error('shadow_prospective:' + m); };
const iso = v => { const x=Date.parse(v); return Number.isFinite(x)?x:null; };
const rounded = x => Number(x.toFixed(6));

export function priceFromSnapshot(row,asset,{now, maxAgeMs=110*60_000}={}) {
  const observed=iso(row?.generated_at),embedded=iso(row?.payload?.generated_at);
  const cutoff = now instanceof Date?+now:Number(now);
  if(!Number.isFinite(cutoff) || !Number.isFinite(observed))return {valid:false,why:'bad_observation_time'};
  // Snapshot row and nested payload timestamps may differ slightly after persistence.
  // Use the LATER of both as the only defensible observation time; do not backdate.
  const asOf=Math.max(observed,embedded??observed);
  if(asOf>cutoff)return {valid:false,why:'future_embedded_or_snapshot'};
  if(cutoff-asOf>maxAgeMs)return {valid:false,why:'stale_quote'};
  const source=String(row?.payload?.quote_provenance?.source||'');
  if(!SOURCES.has(source))return {valid:false,why:'unverified_quote_source'};
  const consistency=evaluateDataConsistency(row.payload);
  if(consistency.blocking || consistency.score_0_100<90 || consistency.asset_blocks?.[asset]?.length)
    return {valid:false,why:'quote_consistency_block'};
  const f=extractLearningFeatures(row.payload).assets?.[asset];
  const price=num(f?.price_usd);
  if(!(price>0))return {valid:false,why:'price_missing'};
  return {valid:true,priceUsd:price,source,observedAt:new Date(asOf).toISOString(),
    pct24h:num(f?.pct_24h),pct7d:num(f?.pct_7d),
    spot:num(f?.spot_confirmation),trap:num(f?.trap_risk),
    fundamentalQuality:num(f?.fundamental_quality),fundamentalConfirmation:f?.fundamental_confirmation||null};
}
function signed(value, threshold) { return value==null?null:value>=threshold?1:value<=-threshold?-1:0; }
function marketHypothesis(features,forward,asset,h) {
  const daily=signed(features.pct24h,2);
  const weekly=signed(features.pct7d,4);
  if(daily==null || weekly==null)return {direction:'ABSTAIN',score:null,reason:'incomplete_momentum'};
  let micro=null;
  if(features.spot!=null && features.trap!=null){
    micro=features.spot>=70&&features.trap<=30?1:features.spot<=35||features.trap>=65?-1:0;
  }
  if(micro==null)return {direction:'ABSTAIN',score:null,reason:'microstructure_unavailable'};
  const fundamentals=asset==='AAVE' && features.fundamentalConfirmation==='contradicts' &&
    features.fundamentalQuality!=null&&features.fundamentalQuality<=25 ? -1:0;
  const reasons=['momentum_24h:'+daily,'momentum_7d:'+weekly,'microstructure:'+micro];
  if(fundamentals)reasons.push('aave_fundamental_caution');
  // Frozen directional hypotheses. The numbers are heuristic votes, NOT
  // calibrated probabilities, expected returns, or real position sizes.
  const score=h.id==='24h' ? 2*daily+weekly+micro+fundamentals :
    h.id==='72h' ? daily+2*weekly+micro+fundamentals : 3*weekly+micro+fundamentals;
  const direction=score>=3?'UP':score<=-3?'DOWN':
    daily===0 && weekly===0 && micro===0?'FLAT':'ABSTAIN';
  return {direction,score,reason:direction==='ABSTAIN'?'mixed_market_signals':'frozen_evidence_votes',
    evidence:reasons,
    supportiveSignal:forward?.research_signal||'UNKNOWN',
    tradeable:false,probabilityCalibrated:false};
}
export function issueProspectiveForecast({currentRow,previousRow=null,now=new Date()}={}) {
  if(!currentRow?.id)fail('snapshot_required');
  const nowMs=+new Date(now);
  if(!Number.isFinite(nowMs))fail('invalid_issuance_time');
  const observed=iso(currentRow.generated_at);
  if(observed==null || observed>nowMs)fail('source_from_future');
  const embedded=iso(currentRow.payload?.generated_at);
  if(embedded!=null && embedded>nowMs)fail('embedded_data_from_future');
  const verdict=evaluateForwardRules({currentRow,previousRow,now:new Date(nowMs)});
  const assets={};
  for(const asset of ASSETS) {
    const q=priceFromSnapshot(currentRow,asset,{now:nowMs});
    const forward=verdict.assets?.[asset];
    const horizons={};
    for(const h of HORIZONS){
      const estimate=q.valid?marketHypothesis(q,forward,asset,h):
        {direction:'ABSTAIN',score:null,reason:q.why,evidence:[],tradeable:false,probabilityCalibrated:false};
      horizons[h.id]={
        ...estimate,neutralBandPct:h.neutralBandPct,
        dueAt:new Date(nowMs+h.ms).toISOString()
      };
    }
    assets[asset]={
      sourceQualityPassed:q.valid,whyNot:q.valid?null:q.why,
      source:q.source||null,
      observationAt:q.observedAt||currentRow.generated_at,
      referenceUsd:q.valid?q.priceUsd:null,
      signalSource:forward?.research_signal||'UNAVAILABLE',
      venueVerified:forward?.venue_verified===true,
      macroVerified:false,
      horizons
    };
  }
  const forecast={
    version:FORECAST_VERSION,kind:'PROSPECTIVE_PREDICTION_PRECOMMITTED',
    snapshotId:currentRow.id,observedAt:currentRow.generated_at,
    issuedAt:new Date(nowMs).toISOString(),forecastDayUtc:new Date(nowMs).toISOString().slice(0,10),
    policyFrozen:true,probabilitiesCalibrated:false,
    assets,allowedPositionChange:false,realOrders:0,executionEnabled:false,
    warning:'Uncalibrated directional hypotheses only, NOT buy/sell orders or forecast profitability. Count abstentions.'
  };
  forecast.commitmentHash=sha(forecast);
  return forecast;
}

export function settleProspectiveForecast({forecast,asset,horizon,observedRow=null,now=new Date(),maxOutcomeLagMs=3*3_600_000}={}) {
  if(!forecast || forecast.version!==FORECAST_VERSION)fail('forecast_version_mismatch');
  const {commitmentHash,...core}=forecast;
  if(sha(core)!==commitmentHash)fail('forecast_commitment_tampered');
  if(!ASSETS.includes(asset))fail('unsupported_asset');
  const h=HORIZONS.find(x=>x.id===horizon);
  if(!h)fail('unsupported_horizon');
  const issued=iso(forecast.issuedAt),due=issued+h.ms,nowMs=+new Date(now);
  if(!Number.isFinite(nowMs) || nowMs<due)fail('not_matured');
  const intended=forecast.assets?.[asset]?.horizons?.[h.id];
  if(!intended || iso(intended.dueAt)!==due)fail('tampered_due_time');
  const p=forecast.assets[asset]?.referenceUsd;
  let observed=null;
  if(observedRow) {
    const rowMs=iso(observedRow.generated_at);
    const embeddedMs=iso(observedRow.payload?.generated_at);
    if(rowMs==null)fail('invalid_outcome_timestamp');
    const effectiveMs=Math.max(rowMs,embeddedMs??rowMs);
    if(effectiveMs<due||effectiveMs>due+maxOutcomeLagMs||effectiveMs>nowMs)fail('invalid_outcome_timestamp');
    observed=priceFromSnapshot(observedRow,asset,{now:effectiveMs,maxAgeMs:1});
  }
  if(!observed?.valid && nowMs<due+maxOutcomeLagMs)return null;
  if(!observed?.valid || !(p>0)) {
    return {asset,horizon,status:'DATA_GAP_UNSCORED',why:observed?.why||'no_valid_future_quote',
      predicted:intended.direction,hit:null,actualReturnPct:null,
      issuedAt:forecast.issuedAt,dueAt:intended.dueAt,commitmentHash,
      scoredAt:new Date(nowMs).toISOString(),realOrders:0,executionEnabled:false};
  }
  const actualReturnPct=rounded((observed.priceUsd/p-1)*100);
  const actualDirection=actualReturnPct>h.neutralBandPct?'UP':
    actualReturnPct<-h.neutralBandPct?'DOWN':'FLAT';
  const predicted=intended.direction;
  return {
    asset,horizon,status:predicted==='ABSTAIN'?'ABSTAINED':'SCORED',
    predicted,actualDirection,hit:predicted==='ABSTAIN'?null:predicted===actualDirection,
    actualReturnPct,referenceUsd:p,outcomeUsd:observed.priceUsd,
    bandPct:h.neutralBandPct,source:observed.source,
    issuedAt:forecast.issuedAt,dueAt:intended.dueAt,
    observedAt:observed.observedAt,commitmentHash,
    scoredAt:new Date(nowMs).toISOString(),realOrders:0,executionEnabled:false
  };
}
