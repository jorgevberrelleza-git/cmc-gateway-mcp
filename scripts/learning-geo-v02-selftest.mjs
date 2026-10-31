import assert from 'node:assert/strict';
import {
  GEO_V02_CALENDAR_SOURCES, parseBLSCalendar, parseFomcCalendar,
  fetchGeoCalendar, attestGeoDocument, calculateGeoObservedOutcomes, summarizeGeoOutcomes
} from '../src/learning/geo-v02.mjs';

const now=new Date('2026-10-18T17:00:00Z');
const ics=`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:us-cpi-2026-11
SUMMARY:Consumer Price Index for October 2026
DTSTART;TZID=America/New_York:20261110T083000
END:VEVENT
BEGIN:VEVENT
UID:old-2025
SUMMARY:Producer Price Index
DTSTART;TZID=America/New_York:20251018T083000
END:VEVENT
BEGIN:VEVENT
UID:evil
SUMMARY:Consumer Price Index
DTSTART;TZID=Europe/London:20261110T083000
END:VEVENT
END:VCALENDAR`;
const cal=parseBLSCalendar(ics,{now});
assert.equal(cal.length,1);
assert.equal(cal[0].category,'us_cpi');
assert.equal(cal[0].scheduled_at,'2026-11-10T13:30:00.000Z');
assert.equal(cal[0].execution_enabled,false);
const html='<h2>2026 FOMC Meetings</h2><div>October 27-28</div><h2>2025 FOMC Meetings</h2><div>December 9-10</div>';
const meetings=parseFomcCalendar(html,{now});
assert.equal(meetings.length,1);
assert.equal(meetings[0].scheduled_at,'2026-10-28T00:00:00.000Z');
assert.equal(meetings[0].time_precision,'day_only_not_exact_release_time');
const source=GEO_V02_CALENDAR_SOURCES[0];
const fetched=await fetchGeoCalendar(source,{now,fetchImpl:async()=>({
  ok:true,headers:{get:()=>null},text:async()=>ics
})});
assert.equal(fetched.events.length,1);
await assert.rejects(()=>fetchGeoCalendar({...source,url:'http://localhost/private'},{
 fetchImpl:async()=>{throw new Error('should_not_fetch')}
}),/geo_calendar_source_not_allowlisted/);
let networkCalls=0;
const allow={'fed_monetary':'www.federalreserve.gov'};
const fakeFetch=async()=>{
 networkCalls++;
 return {ok:true,headers:{get:k=>k==='content-type'?'text/html':null},
 text:async()=>'<html><title>Federal funds interest rate decision</title></html>'};
};
const event={source_id:'fed_monetary',article_url:'https://www.federalreserve.gov/newsevents/pressreleases/a.htm',title:'Federal funds interest rate decision and statement'};
const attestation=await attestGeoDocument(event,{allowedHosts:allow,fetchImpl:fakeFetch});
assert.equal(attestation.status,'retrieved_title_consistent');
assert.equal(attestation.execution_enabled,false);
const forged=await attestGeoDocument({...event,article_url:'https://evil.example/redirect'},{
 allowedHosts:allow,fetchImpl:fakeFetch
});
assert.equal(forged.status,'fetch_failed');
assert.equal(networkCalls,1);
const makeSnap=(id,hours,prices)=>({
  id,generated_at:new Date(Date.parse('2026-10-18T12:00:00Z')+hours*3600000),
  payload:{assets:['BTC','ADA','AAVE'],quotes:{structuredContent:{headers:['symbol','price'],rows:Object.entries(prices)}}}
});
const base=makeSnap(1,0,{BTC:100,ADA:2,AAVE:20});
const rows=[base,makeSnap(2,1,{BTC:102,ADA:1.9,AAVE:20}),makeSnap(3,4,{BTC:105,ADA:2,AAVE:22}),makeSnap(4,12,{BTC:103,ADA:2.2,AAVE:25}),makeSnap(5,24,{BTC:110,ADA:2.4,AAVE:20})];
const outcomes=calculateGeoObservedOutcomes(
 [{event_key:'event1',first_seen_at:'2026-10-18T11:59:00Z'}],rows,
 {now:new Date('2026-10-19T13:00:00Z')}
);
assert.equal(outcomes.length,12);
assert.equal(outcomes.find(x=>x.asset==='BTC'&&x.horizon==='1h').signed_return_pct,2);
assert.equal(outcomes.find(x=>x.asset==='ADA'&&x.horizon==='1h').signed_return_pct,-5);
assert.equal(summarizeGeoOutcomes(outcomes).assets.BTC['1h'].n,1);
assert.equal(summarizeGeoOutcomes(outcomes).execution_enabled,false);
const noHindsight=calculateGeoObservedOutcomes(
 [{event_key:'event2',first_seen_at:'2026-10-18T12:01:00Z'}],rows,
 {now:new Date('2026-10-19T13:00:00Z')}
);
assert.ok(noHindsight.every(x=>Number(x.baseline_snapshot_id)!==1));
console.log('learning-geo-v0.2-selftest: ok');
