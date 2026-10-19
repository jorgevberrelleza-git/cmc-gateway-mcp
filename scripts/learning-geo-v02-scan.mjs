import { createLearningStore } from '../src/learning/storage.mjs';
import { GEO_SOURCES } from '../src/learning/geo-intelligence.mjs';
import {
  GEO_V02_CALENDAR_SOURCES,fetchGeoCalendar,attestGeoDocument,
  calculateGeoObservedOutcomes,summarizeGeoOutcomes
} from '../src/learning/geo-v02.mjs';

const now=new Date();
const store=createLearningStore();
const sourceStatus=[];
let changedCalendar=0,documentChecks=0,newOutcomes=0;
const allowedHosts=Object.fromEntries(GEO_SOURCES.map(x=>[x.id,x.hostname]));
try {
  // All fetch sources are hardcoded official domains; independent errors cannot block the core cron.
  const calendars=await Promise.all(GEO_V02_CALENDAR_SOURCES.map(async source=>{
    try {
      const result=await fetchGeoCalendar(source,{now});
      if(!result.events.length)throw new Error('geo_calendar_no_parseable_future_events');
      sourceStatus.push({source_id:source.id,ok:true,events:result.events.length});
      return result.events;
    }catch(error){
      sourceStatus.push({source_id:source.id,ok:false,events:0,error:String(error?.message||error).slice(0,130)});
      return [];
    }
  }));
  for(const event of calendars.flat()){
    const result=await store.pool.query(
      `insert into learning_geo_calendar(event_key,source_id,title,scheduled_at,category,event_url,metadata,execution_enabled)
       values($1,$2,$3,$4,$5,$6,$7::jsonb,false)
       on conflict(event_key) do update
         set title=excluded.title,scheduled_at=excluded.scheduled_at,
             event_url=excluded.event_url,last_seen_at=now(),metadata=excluded.metadata
       returning event_key`,
      [event.event_key,event.source_id,event.title,event.scheduled_at,event.category,event.event_url,
       JSON.stringify({time_precision:event.time_precision,source_type:'official_calendar'})]
    );
    changedCalendar+=result.rowCount;
  }

  // Verify same-publisher document text/title only. NEVER interpret publisher provenance as market impact.
  const outstanding=await store.pool.query(
    `select event_key,source_id,article_url,title from learning_geo_events
     where document_status='not_checked' and severity in ('high','medium')
       and first_seen_at >= $1
     order by first_seen_at desc limit 2`,
     [new Date(now.getTime()-4*86400000).toISOString()]
  );
  const checks=await Promise.all(outstanding.rows.map(async event=>({event,attestation:await attestGeoDocument(event,{allowedHosts})})));
  for(const {event,attestation} of checks){
    await store.pool.query(
      `update learning_geo_events
       set document_status=$2,document_checked_at=$3,document_evidence=$4::jsonb
       where event_key=$1 and document_status='not_checked'`,
      [event.event_key,attestation.status,now.toISOString(),JSON.stringify(attestation.evidence)]
    );
    documentChecks++;
  }

  // First-seen timestamps avoid hindsight. Use next available snapshot, never a pre-announcement price.
  const historicFrom=new Date(now.getTime()-7*86400000).toISOString();
  const events=await store.pool.query(
    `select event_key,first_seen_at from learning_geo_events
     where first_seen_at >= $1 and first_seen_at <= $2
     order by first_seen_at asc limit 300`,[historicFrom,now.toISOString()]
  );
  const snapshots=await store.snapshotsBetween(historicFrom,now.toISOString(),5000);
  const observations=calculateGeoObservedOutcomes(events.rows,snapshots,{now});
  for(const r of observations){
    const saved=await store.pool.query(
      `insert into learning_geo_market_outcomes
      (event_key,asset,horizon,baseline_snapshot_id,later_snapshot_id,baseline_at,later_at,signed_return_pct,abs_return_pct,execution_enabled)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
      on conflict(event_key,asset,horizon) do nothing returning event_key`,
      [r.event_key,r.asset,r.horizon,r.baseline_snapshot_id,r.later_snapshot_id,
      r.baseline_at,r.later_at,r.signed_return_pct,r.abs_return_pct]
    );
    newOutcomes+=saved.rowCount;
  }

  const recorded=await store.pool.query(
    `select asset,horizon,signed_return_pct from learning_geo_market_outcomes
     where recorded_at >= $1 order by recorded_at desc limit 1000`,[historicFrom]
  );
  const upcoming=await store.pool.query(
    `select source_id,title,scheduled_at,category,metadata->>'time_precision' as time_precision
     from learning_geo_calendar
     where scheduled_at > $1 and scheduled_at <= $2
     order by scheduled_at asc limit 10`,
    [now.toISOString(),new Date(now.getTime()+45*86400000).toISOString()]
  );
  const documentSummary=await store.pool.query(
    `select document_status,count(*)::integer as n from learning_geo_events
     where first_seen_at >= $1 group by document_status order by document_status`,[historicFrom]
  );
  const ok=sourceStatus.some(s=>s.ok);
  console.log('GEO_V02_SUMMARY='+JSON.stringify({
    contract_version:'shadow_geo_v0.2',
    ok,
    checked_at:now.toISOString(),
    calendar_ingestion:sourceStatus.every(s=>s.ok)?'complete':ok?'partial':'unavailable',
    sources:sourceStatus,
    calendar_rows_processed:changedCalendar,
    upcoming:upcoming.rows,
    documents_checked_this_cycle:documentChecks,
    document_status_counts:documentSummary.rows,
    observations_new:newOutcomes,
    observed_study:summarizeGeoOutcomes(recorded.rows),
    interpretation:'first_seen_only; observations not causal, predictive, or tradable',
    paid_ai_calls_made:0,
    execution_enabled:false,
    authorizes_position_change:false
  }));
  if(!ok)process.exitCode=1;
} finally {
  await store.close();
}
