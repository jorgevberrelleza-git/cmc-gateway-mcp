import crypto from 'node:crypto';
import { extractUsdPrices } from './features.mjs';

export const GEO_V02_CALENDAR_SOURCES = Object.freeze([
  {id:'bls_releases',name:'US Bureau of Labor Statistics',url:'https://www.bls.gov/schedule/news_release/bls.ics',hostname:'www.bls.gov',format:'ics'},
  {id:'fed_fomc_calendar',name:'Federal Reserve FOMC calendar',url:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',hostname:'www.federalreserve.gov',format:'html'}
]);
const MONTHS={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
export const GEO_V02_HORIZONS=Object.freeze({'1h':3600000,'4h':14400000,'12h':43200000,'24h':86400000});
export const GEO_V02_ASSETS=Object.freeze(['BTC','ADA','AAVE']);

function keyOf(sourceId,identity){return crypto.createHash('sha256').update('calendar|'+sourceId+'|'+identity).digest('hex');}
function textOnly(v){return String(v??'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/\s+/g,' ').trim();}
function decodeICSText(value){return String(value||'').replace(/\\n/gi,' ').replace(/\\,/g,',').replace(/\\;/g,';').replace(/\\\\/g,'\\').slice(0,240).trim();}
function localPartsInZone(epoch,zone){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(epoch);
 return Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
}
function parseICSDate(raw,params=''){
 const m=/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(raw);
 if(!m||!m[4])return null; // All-day dates are not precise publication times.
 const [y,mo,d,h,min,sec]=m.slice(1,7).map(Number);
 if(mo<1||mo>12||d<1||d>31||h>23||min>59||sec>59)return null;
 const utc=Date.UTC(y,mo-1,d,h,min,sec||0);
 const checked=new Date(utc);
 if(checked.getUTCFullYear()!==y||checked.getUTCMonth()+1!==mo||checked.getUTCDate()!==d)return null;
 if(m[7]==='Z')return new Date(utc).toISOString();
 // BLS publishes in US Eastern time. Reject unexpected foreign timezones.
 const tz=/TZID=(?:["']?)([^;:"']+)/i.exec(params)?.[1]?.toLowerCase()||'';
 if(tz && !/(america\/new_york|us\/eastern|eastern standard time|eastern)/.test(tz))return null;
 let guess=utc;
 for(let i=0;i<3;i++){
   const p=localPartsInZone(guess,'America/New_York');
   const observed=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
   guess+=utc-observed;
 }
 const p=localPartsInZone(guess,'America/New_York');
 if(p.year!==y||p.month!==mo||p.day!==d||p.hour!==h||p.minute!==min)return null;
 return new Date(guess).toISOString();
}
function calendarTopic(title){
 const t=title.toLowerCase();
 if(/consumer price index|\bcpi\b/.test(t))return 'us_cpi';
 if(/employment situation|nonfarm payroll/.test(t))return 'us_jobs';
 if(/producer price index|\bppi\b/.test(t))return 'us_ppi';
 if(/job openings|jolts/.test(t))return 'us_jolts';
 if(/employment cost index/.test(t))return 'us_eci';
 return null;
}

export function parseBLSCalendar(ics,{now=new Date(),lookaheadDays=45}={}){
 if(typeof ics!=='string'||ics.length>600000||!ics.includes('BEGIN:VCALENDAR'))throw new Error('geo_calendar_invalid_ics');
 const unfolded=ics.replace(/\r?\n[ \t]/g,'');
 const events=[...unfolded.matchAll(/BEGIN:VEVENT\s*\r?\n([\s\S]*?)END:VEVENT/gi)];
 const out=[],seen=new Set();
 for(const [,block]of events.slice(0,500)){
   const fields=block.split(/\r?\n/);
   const summary=fields.find(x=>x.startsWith('SUMMARY:'))?.slice(8);
   const dt=fields.find(x=>/^DTSTART(?:;[^:]*)?:/i.test(x));
   if(!summary||!dt)continue;
   const title=decodeICSText(summary);
   const category=calendarTopic(title);
   if(!category)continue;
   const at=dt.indexOf(':');
   const scheduledAt=parseICSDate(dt.slice(at+1).trim(),dt.slice(0,at));
   const time=Date.parse(scheduledAt||'');
   if(!Number.isFinite(time)||time<Date.parse(now)-3600000||time>Date.parse(now)+lookaheadDays*86400000)continue;
   const uid=fields.find(x=>x.startsWith('UID:'))?.slice(4)?.trim();
   const identity=uid||category+'|'+scheduledAt;
   const key=keyOf('bls_releases',identity);
   if(seen.has(key))continue;seen.add(key);
   out.push({event_key:key,source_id:'bls_releases',title:title.slice(0,240),category,scheduled_at:scheduledAt,event_url:'https://www.bls.gov/schedule/news_release/',time_precision:'exact_official_calendar',execution_enabled:false});
 }
 return out.sort((a,b)=>a.scheduled_at.localeCompare(b.scheduled_at)).slice(0,75);
}

export function parseFomcCalendar(html,{now=new Date(),lookaheadDays=120}={}){
 if(typeof html!=='string'||html.length>600000||!html.toLowerCase().includes('fomc'))throw new Error('geo_fomc_invalid_html');
 const text=textOnly(html),currentYear=new Date(now).getUTCFullYear();
 const out=[],seen=new Set();
 for(const year of [currentYear,currentYear+1]){
   const sectionStart=text.search(new RegExp('\\b'+year+' FOMC Meetings\\b','i'));
   if(sectionStart<0)continue;
   let section=text.slice(sectionStart+String(year).length+14,sectionStart+6500);
   const other=/\b20\d\d FOMC Meetings\b/ig;
   const next=other.exec(section);
   if(next)section=section.slice(0,next.index);
   const matches=section.matchAll(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\*?/gi);
   for(const m of matches){
     const mon=MONTHS[m[1].toLowerCase()],end=Number(m[3]);
     const day=new Date(Date.UTC(year,mon-1,end));
     if(day.getUTCMonth()+1!==mon)continue;
     const stamp=day.getTime(),remaining=stamp-Date.parse(now);
     if(remaining< -86400000||remaining>lookaheadDays*86400000)continue;
     const key=keyOf('fed_fomc_calendar',String(year)+'-'+String(mon).padStart(2,'0')+'-'+String(end).padStart(2,'0'));
     if(seen.has(key))continue;seen.add(key);
     out.push({event_key:key,source_id:'fed_fomc_calendar',title:'FOMC meeting (last day; release hour unverified)',category:'fomc_meeting',scheduled_at:day.toISOString(),event_url:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',time_precision:'day_only_not_exact_release_time',execution_enabled:false});
   }
 }
 return out.sort((a,b)=>a.scheduled_at.localeCompare(b.scheduled_at)).slice(0,30);
}
export async function fetchBoundedOfficial(url,hostname,{fetchImpl=globalThis.fetch,timeoutMs=8500,maxBytes=400000,accept='text/html, text/calendar;q=0.9'}={}){
 const u=new URL(url);
 if(u.protocol!=='https:'||u.hostname!==hostname||u.username||u.password||u.port)throw new Error('geo_v02_source_not_allowlisted');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
   const res=await fetchImpl(url,{method:'GET',redirect:'error',signal:controller.signal,headers:{'accept':accept,'user-agent':'ShadowGEO/0.2 (+research-only)'}});
   if(!res.ok)throw new Error('geo_v02_http_'+res.status);
   if(Number(res.headers?.get?.('content-length')||0)>maxBytes)throw new Error('geo_v02_oversize');
   let body='';
   if(res.body?.getReader){
     const reader=res.body.getReader(),decoder=new TextDecoder();let used=0;
     while(true){
       const {done,value}=await reader.read();
       if(done)break;
       used+=value?.byteLength||0;
       if(used>maxBytes){await reader.cancel().catch(()=>{});throw new Error('geo_v02_oversize');}
       body+=decoder.decode(value,{stream:true});
     }
     body+=decoder.decode();
   }else{
     body=await res.text();
     if(Buffer.byteLength(body,'utf8')>maxBytes)throw new Error('geo_v02_oversize');
   }
   return {body,content_type:(res.headers?.get?.('content-type')||'').toLowerCase()};
 }finally{clearTimeout(timer);}
}
export async function fetchGeoCalendar(source,{fetchImpl=globalThis.fetch,now=new Date()}={}){
 if(!GEO_V02_CALENDAR_SOURCES.some(x=>x.url===source.url&&x.id===source.id&&x.hostname===source.hostname))throw new Error('geo_calendar_source_not_allowlisted');
 const {body,content_type}=await fetchBoundedOfficial(source.url,source.hostname,{fetchImpl,accept:'text/calendar, text/html, application/octet-stream;q=0.5'});
 if(content_type.includes('text/html')&&source.format==='ics')throw new Error('geo_calendar_unexpected_html');
 const events=source.format==='ics'?parseBLSCalendar(body,{now}):parseFomcCalendar(body,{now});
 return {source_id:source.id,ok:true,events};
}
const words=txt=>new Set(textOnly(txt).toLowerCase().match(/[a-z]{4,}/g)?.filter(x=>!['from','with','this','that','their','press','news','bank','statement','federal','reserve','european'].includes(x))||[]);
export async function attestGeoDocument(event,{allowedHosts,fetchImpl=globalThis.fetch}={}){
 try{
   const u=new URL(event.article_url);
   const expected=allowedHosts?.[event.source_id];
   if(!expected||u.hostname!==expected||u.protocol!=='https:'||u.port||u.username||u.password)throw new Error('document_url_not_allowlisted');
   if(/\.pdf(?:$|\?)/i.test(u.pathname))return {status:'unsupported_pdf',evidence:{reason:'pdf_unsupported'},execution_enabled:false};
   const res=await fetchBoundedOfficial(u.toString(),expected,{fetchImpl,maxBytes:220000});
   if(res.content_type&&!res.content_type.includes('text/html')&&!res.content_type.includes('text/plain'))return {status:'unsupported_content_type',evidence:{content_type:res.content_type.slice(0,64)},execution_enabled:false};
   const officialTitle=/(?:<title\b[^>]*>|<h1\b[^>]*>)([\s\S]*?)(?:<\/title>|<\/h1>)/i.exec(res.body)?.[1]||'';
   const requested=words(event.title),got=words(officialTitle),overlap=[...requested].filter(x=>got.has(x)).length;
   const status=overlap>=2?'retrieved_title_consistent':'retrieved_title_mismatch';
   return {status,evidence:{matched_terms:overlap,document_title:textOnly(officialTitle).slice(0,200),content_sha256:crypto.createHash('sha256').update(res.body).digest('hex'),verified_scope:'same_publisher_document_title_only'},execution_enabled:false};
 }catch(e){return {status:'fetch_failed',evidence:{reason:String(e.message||e).slice(0,110)},execution_enabled:false};}
}
const asMs=v=>Date.parse(v instanceof Date?v.toISOString():String(v||''));
export function calculateGeoObservedOutcomes(events,snapshots,{now=new Date(),baselineToleranceMs=95*60000,laterToleranceMs=95*60000}={}){
 const currentMs=+new Date(now);
 const rows=(snapshots||[]).filter(r=>Number.isFinite(asMs(r.generated_at)))
   .map(r=>({...r,ts:asMs(r.generated_at),prices:extractUsdPrices(r.payload||{})})).sort((a,b)=>a.ts-b.ts);
 const out=[];
 for(const event of events||[]){
   const seen=asMs(event.first_seen_at);
   if(!Number.isFinite(seen)||seen>currentMs)continue;
   const baseline=rows.find(r=>r.ts>=seen&&r.ts<=seen+baselineToleranceMs);
   if(!baseline)continue;
   for(const [horizon,ms] of Object.entries(GEO_V02_HORIZONS)){
     const target=baseline.ts+ms;
     if(target>currentMs)continue;
     const later=rows.find(r=>r.ts>=target&&r.ts<=Math.min(currentMs,target+laterToleranceMs));
     if(!later)continue;
     for(const asset of GEO_V02_ASSETS){
       const a=Number(baseline.prices[asset]),b=Number(later.prices[asset]);
       if(!(a>0&&b>0))continue;
       const signed=(b-a)/a*100;
       out.push({
         event_key:event.event_key,asset,horizon,
         baseline_snapshot_id:baseline.id,later_snapshot_id:later.id,
         baseline_at:new Date(baseline.ts).toISOString(),
         later_at:new Date(later.ts).toISOString(),
         signed_return_pct:Number(signed.toFixed(5)),
         abs_return_pct:Number(Math.abs(signed).toFixed(5)),
         execution_enabled:false
       });
     }
   }
 }
 return out;
}
export function summarizeGeoOutcomes(rows){
 const out={};
 for(const asset of GEO_V02_ASSETS){
   out[asset]={};
   for(const horizon of Object.keys(GEO_V02_HORIZONS)){
     const vals=rows.filter(r=>r.asset===asset&&r.horizon===horizon).map(r=>Number(r.signed_return_pct)).filter(Number.isFinite);
     out[asset][horizon]={n:vals.length,avg_signed_return_pct:vals.length?Number((vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(4)):null,positive_rate_pct:vals.length?Number((100*vals.filter(v=>v>0).length/vals.length).toFixed(2)):null};
   }
 }
 return {assets:out,interpretation:'observational_overlapping_events_no_causality_no_executable_edge',execution_enabled:false};
}
