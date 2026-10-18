import { createLearningStore } from '../src/learning/storage.mjs';
import { GEO_SOURCES, fetchGeoSource, buildGeoRiskSummary } from '../src/learning/geo-intelligence.mjs';

const now = new Date();
const responses = await Promise.all(GEO_SOURCES.map(async source => {
  try { return await fetchGeoSource(source,{now}); }
  catch(error) { return {source_id:source.id,ok:false,events:[],error:String(error?.message||error).slice(0,120)}; }
}));
const store = createLearningStore();
let inserted=0;
const windowStart = new Date(now.getTime()-72*3600000).toISOString();
const status = responses.map(({source_id,ok,error})=>({source_id,ok,error:error||null}));
try {
  for (const response of responses) for (const event of response.events) {
    const r=await store.pool.query(`insert into learning_geo_events
      (event_key,source_id,article_url,title,published_at,topic,severity,publisher_validated,metadata,execution_enabled)
      values ($1,$2,$3,$4,$5,$6,$7,true,$8::jsonb,false)
      on conflict(event_key) do nothing returning id`,[
      event.event_key,event.source_id,event.article_url,event.title,event.published_at,
      event.topic,event.severity,JSON.stringify({source_name:event.source_name,confidence:event.confidence})
    ]);
    inserted+=r.rowCount;
  }
  const history=await store.pool.query(
    `select source_id, article_url, title, published_at, topic, severity
       from learning_geo_events
       where published_at >= $1 and published_at <= $2
       order by published_at desc limit 25`,
    [windowStart,now.toISOString()]
  );
  const recent=history.rows;
  console.log('GEO_COMPACT_SUMMARY='+JSON.stringify({
    ok:true,
    contract_version:'shadow_geo_v0.1_scan',
    checked_at:now.toISOString(),
    source_status:status,
    new_events:inserted,
    recent_count:recent.length,
    risk_summary:buildGeoRiskSummary(recent,{sourceStatus:status}),
    events:recent.slice(0,8),
    source_policy:'official_metadata_only_not_verified_event_causality',
    external_calls_made:responses.length,
    paid_ai_calls_made:0,
    execution_enabled:false
  }));
} finally { await store.close(); }
