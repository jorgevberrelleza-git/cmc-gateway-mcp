// One daily immutable forecast + delayed, horizon-bound scoring.
// Reuses Shadow's append-only research table. Does not touch orders, accounts,
// paper portfolios, model weights, paid APIs, or historical replay paths.
import { createLearningStore } from '../src/learning/storage.mjs';
import { summarizeProspectiveScores } from '../src/learning/prospective-audit-v04.mjs';
import {
  FORECAST_VERSION,HORIZONS,ASSETS,issueProspectiveForecast,
  settleProspectiveForecast,priceFromSnapshot
} from '../src/learning/prospective-forecast-v04.mjs';

const store=createLearningStore();
const now=new Date();
const at=+now;
const dayStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
const lookback=new Date(at-10*86_400_000);
const scoreVersion=h=>'shadow_prospective_score_v0.4_'+h.id;
let created=false,duplicate=false,forecast=null;
const stats={due:0,scored:0,abstained:0,missing:0,immature:0};
let audit=null;
let assessments={};
try {
  const recentEval=await store.listShadowV2Evaluations({from:lookback.toISOString(),to:now.toISOString(),limit:5000});
  const existingToday=recentEval.find(x=>x.strategy_version===FORECAST_VERSION &&
    Date.parse(x.generated_at)>=+dayStart);
  const existingScores=new Set(recentEval.filter(x=>HORIZONS.some(h=>x.strategy_version===scoreVersion(h)))
    .map(x=>String(x.snapshot_id)+'|'+x.strategy_version));
  if(existingToday){
    duplicate=true;
    forecast=existingToday.asset_assessments?.forecast||null;
  }else{
    const rows=await store.recentSnapshots(2);
    if(!rows.length)throw Error('prospective_no_observation');
    forecast=issueProspectiveForecast({currentRow:rows[0],previousRow:rows[1]||null,now});
    const saved=await store.saveShadowV2Evaluation({
      strategy_version:FORECAST_VERSION,
      snapshot_id:rows[0].id,
      generated_at:forecast.issuedAt,
      regime:{model:'frozen_heuristic_no_probabilities',policyVersion:FORECAST_VERSION,
        issuedAt:forecast.issuedAt,commitmentHash:forecast.commitmentHash,
        allowPositionChanges:false},
      consistency:{prospective:true,sourceValidatedBeforeIssuance:true,unseenFuture:true},
      assets:{forecast},
      external_research_trigger:{required:false,reason:'observe_only',ordersCreated:0}
    });
    created=Boolean(saved);
    duplicate=!saved;
  }
  const savedScoreRows=recentEval.filter(x=>x.strategy_version?.startsWith('shadow_prospective_score_v0.4_'));
  const candidates=recentEval.filter(x=>x.strategy_version===FORECAST_VERSION)
    .sort((a,b)=>Date.parse(a.generated_at)-Date.parse(b.generated_at));
  // If this run created today's forecast, include it: no need to backfill past data.
  if(created)candidates.push({strategy_version:FORECAST_VERSION,snapshot_id:forecast.snapshotId,asset_assessments:{forecast}});
  for(const row of candidates){
    const f=row.asset_assessments?.forecast;
    if(!f || f.version!==FORECAST_VERSION)continue;
    for(const h of HORIZONS){
      const key=String(row.snapshot_id)+'|'+scoreVersion(h);
      if(existingScores.has(key))continue;
      const due=Date.parse(f.issuedAt)+h.ms;
      if(at<due){stats.immature++;continue;}
      stats.due++;
      const cutoff=Math.min(at,due+3*3_600_000);
      const future=await store.snapshotsBetween(new Date(due).toISOString(),new Date(cutoff).toISOString(),100);
      // Predetermined choice: first valid post-target quote for each asset,
      // within a three-hour tolerance; never select based on favorable return.
      const outcomes={};
      let wait=false;
      for(const asset of ASSETS){
        const found=future.find(v=>{const rowMs=Date.parse(v.generated_at);const nestedMs=Date.parse(v.payload?.generated_at||'');
          return priceFromSnapshot(v,asset,{now:Math.max(rowMs,Number.isFinite(nestedMs)?nestedMs:rowMs),maxAgeMs:1}).valid;
        })||null;
        const result=settleProspectiveForecast({
          forecast:f,asset,horizon:h.id,observedRow:found,now
        });
        if(result==null){wait=true;break;}
        outcomes[asset]=result;
      }
      if(wait)continue;
      const persisted=await store.saveShadowV2Evaluation({
        strategy_version:scoreVersion(h),
        snapshot_id:row.snapshot_id,
        generated_at:now.toISOString(),
        regime:{kind:'precommitted_horizon_score',dueAt:new Date(due).toISOString(),
          commitmentHash:f.commitmentHash,forecastVersion:FORECAST_VERSION,
          scoredAt:now.toISOString()},
        consistency:{outcomesOnlyAfterDue:true,priceWindowHours:3,version:FORECAST_VERSION},
        assets:{scores:outcomes},
        external_research_trigger:{required:false,ordersCreated:0}
      });
      if(persisted){
        savedScoreRows.push(persisted);
        existingScores.add(key);
        for(const outcome of Object.values(outcomes)){
          if(outcome.status==='SCORED')stats.scored++;
          else if(outcome.status==='ABSTAINED')stats.abstained++;
          else stats.missing++;
        }
      }
    }
  }
  audit=summarizeProspectiveScores({
    forecastRows:candidates,scoreRows:savedScoreRows,now,recentLimit:9
  });
  assessments=forecast?.assets||{};
  const summarized=Object.fromEntries(ASSETS.map(asset=>{
    const a=assessments[asset]||{};
    return [asset,{
      referenceUsd:a.referenceUsd||null,
      sourceQualityPassed:a.sourceQualityPassed===true,
      source:a.source||null,
      venueVerified:a.venueVerified===true,
      signalSource:a.signalSource||null,
      forecast:Object.fromEntries(HORIZONS.map(h=>[h.id,{
        direction:a.horizons?.[h.id]?.direction||'UNAVAILABLE',
        score:a.horizons?.[h.id]?.score??null,
        dueAt:a.horizons?.[h.id]?.dueAt||null
      }]))
    }];
  }));
  console.log('SHADOW_PROSPECTIVE_V04='+JSON.stringify({
    ok:true,created,duplicate,forecastIssuedAt:forecast?.issuedAt||null,
    commitmentHash:forecast?.commitmentHash||null,
    assets:summarized,outcomes:stats,cumulativeAudit:audit,calibratedProbabilities:false,
    dataGapExclusionsRequired:true,investmentAdvice:false,
    paidAiCalls:0,externalMarketCalls:0,realOrders:0,executionEnabled:false
  }));
}finally{await store.close();}
