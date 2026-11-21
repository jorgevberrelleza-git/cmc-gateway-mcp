// Shadow v0.4 prospective audit. RESEARCH ONLY. No policy changes.
// Cross-check saved scores against the ORIGINAL hashed, precommitted prediction.
// Counts misses, abstentions and unscorable observations; benchmarks evaluated
// on exactly the same matured directional cases, never on selected winners.
import crypto from 'node:crypto';
import { ASSETS,HORIZONS,FORECAST_VERSION } from './prospective-forecast-v04.mjs';

const canon=x=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(canon(x))).digest('hex');
const ts=x=>{const v=Date.parse(x||'');return Number.isFinite(v)?v:null;};
const round=x=>Number(x.toFixed(2));
const SIDES=['UP','DOWN','FLAT'];
function verifiedForecast(f,nowMs){
  if(f?.version!==FORECAST_VERSION||typeof f.commitmentHash!=='string')return false;
  const {commitmentHash,...rest}=f;
  const t=ts(f.issuedAt);
  return t!=null&&t<=nowMs&&sha(rest)===commitmentHash&&f.executionEnabled===false&&f.realOrders===0;
}
export function summarizeProspectiveScores({
  forecastRows=[],scoreRows=[],now=new Date(),recentLimit=12
}={}){
  const nowMs=+new Date(now);
  if(!Number.isFinite(nowMs))throw Error('prospective_audit:invalid_now');
  const forecasts=new Map(),horizonIds=new Map(HORIZONS.map(h=>[h.id,h]));
  let rejected=0;
  for(const row of forecastRows){
    if(row?.strategy_version!==FORECAST_VERSION)continue;
    const f=row.asset_assessments?.forecast;
    if(!verifiedForecast(f,nowMs)||String(f.snapshotId)!==String(row.snapshot_id)){rejected++;continue;}
    forecasts.set(String(row.snapshot_id),f);
  }
  const totals=Object.fromEntries(HORIZONS.map(h=>[h.id,{
    total:0,scored:0,correct:0,incorrect:0,abstained:0,dataGaps:0,
    accuracyPct:null,coveragePct:null,naiveAlwaysUpPct:null,
    naiveAlwaysDownPct:null,naiveAlwaysFlatPct:null,
    sampleSufficient:false,alwaysUpHits:0,alwaysDownHits:0,alwaysFlatHits:0
  }]));
  const latest=[],seen=new Set();
  for(const row of scoreRows){
    const m=String(row?.strategy_version||'').match(/^shadow_prospective_score_v0\.4_(24h|72h|168h)$/);
    if(!m)continue;
    const horizon=m[1],h=horizonIds.get(horizon),issuedForecast=forecasts.get(String(row.snapshot_id));
    if(!issuedForecast){rejected++;continue;}
    const due=ts(issuedForecast.issuedAt)+h.ms,scored=ts(row.generated_at);
    const snapshotKey=String(row.snapshot_id)+'|'+horizon;
    if(seen.has(snapshotKey)||due>nowMs||scored==null||scored<due||scored>nowMs||
      ts(row.regime?.dueAt)!==due||
      row.regime?.commitmentHash!==issuedForecast.commitmentHash){rejected++;continue;}
    const outcomes=row.asset_assessments?.scores||{};
    // Verify ALL asset outcomes atomically: a bad asset must not be silently skipped.
    let valid=true;
    for(const asset of ASSETS){
      const s=outcomes[asset],orig=issuedForecast.assets?.[asset]?.horizons?.[horizon];
      if(!s||!orig||s.asset!==asset||s.horizon!==horizon||
        s.predicted!==orig.direction||s.commitmentHash!==issuedForecast.commitmentHash||
        ts(s.dueAt)!==due||!['SCORED','ABSTAINED','DATA_GAP_UNSCORED'].includes(s.status)){
        valid=false;break;
      }
      if(s.status==='DATA_GAP_UNSCORED'){
        if(s.hit!==null||s.actualReturnPct!==null){valid=false;break;}
        continue;
      }
      const observed=ts(s.observedAt);
      const p=issuedForecast.assets?.[asset]?.referenceUsd,q=s.outcomeUsd;
      if(observed==null||observed<due||observed>due+3*3600000||observed>scored||
        typeof p!=='number'||p<=0||typeof q!=='number'||q<=0||
        typeof s.actualReturnPct!=='number'||!Number.isFinite(s.actualReturnPct)||
        Math.abs(((q/p-1)*100)-s.actualReturnPct)>0.00002){
        valid=false;break;
      }
      const actual=s.actualReturnPct>h.neutralBandPct?'UP':
        s.actualReturnPct<-h.neutralBandPct?'DOWN':'FLAT';
      if(actual!==s.actualDirection){valid=false;break;}
      if(s.status==='SCORED' && (!SIDES.includes(s.predicted)||s.hit!==(s.predicted===actual))){
        valid=false;break;
      }
      if(s.status==='ABSTAINED' && (s.predicted!=='ABSTAIN'||s.hit!==null)){
        valid=false;break;
      }
    }
    if(!valid){rejected++;continue;}
    seen.add(snapshotKey);
    const t=totals[horizon];
    for(const asset of ASSETS){
      const s=outcomes[asset];
      t.total++;
      if(s.status==='DATA_GAP_UNSCORED')t.dataGaps++;
      else if(s.status==='ABSTAINED')t.abstained++;
      else{
        t.scored++;if(s.hit)t.correct++;else t.incorrect++;
        if(s.actualDirection==='UP')t.alwaysUpHits++;
        if(s.actualDirection==='DOWN')t.alwaysDownHits++;
        if(s.actualDirection==='FLAT')t.alwaysFlatHits++;
      }
      latest.push({
        asset,horizon,forecastIssuedAt:issuedForecast.issuedAt,dueAt:s.dueAt,
        status:s.status,predicted:s.predicted,
        actualDirection:s.actualDirection||null,hit:s.hit,
        actualReturnPct:s.actualReturnPct,source:s.source||null
      });
    }
  }
  for(const t of Object.values(totals)){
    if(t.scored>0){
      t.accuracyPct=round(100*t.correct/t.scored);
      t.naiveAlwaysUpPct=round(100*t.alwaysUpHits/t.scored);
      t.naiveAlwaysDownPct=round(100*t.alwaysDownHits/t.scored);
      t.naiveAlwaysFlatPct=round(100*t.alwaysFlatHits/t.scored);
    }
    if(t.total>0)t.coveragePct=round(100*t.scored/t.total);
    // Thirty valid calls is ONLY a reporting floor, NOT independent alpha proof.
    t.sampleSufficient=t.scored>=30;
    delete t.alwaysUpHits;delete t.alwaysDownHits;delete t.alwaysFlatHits;
  }
  latest.sort((a,b)=>b.dueAt.localeCompare(a.dueAt)||a.asset.localeCompare(b.asset));
  return {
    version:'shadow_prospective_audit_v0.4',
    reportAt:new Date(nowMs).toISOString(),
    verifiedForecasts:forecasts.size,
    settledHorizons:seen.size,
    rejectedOrUnverifiableRecords:rejected,
    horizons:totals,
    latest:latest.slice(0,Math.max(0,Math.min(30,recentLimit))),
    caveats:[
      'Small samples cannot establish predictive skill or expected profitability',
      'Naive benchmarks use SAME scored cases; correlated assets/horizons are NOT independent',
      'Unscored gaps and abstentions count in coverage, never as correct',
      'USD market observations are not Bitso-executable prices'
    ],
    realOrders:0,executionEnabled:false,policyPromoted:false
  };
}
