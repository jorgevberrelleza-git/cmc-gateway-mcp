import assert from 'node:assert/strict';
import { GEO_SOURCES,parseGeoFeed,fetchGeoSource,buildGeoRiskSummary } from '../src/learning/geo-intelligence.mjs';
const source=GEO_SOURCES[0];
const now=new Date('2026-10-18T18:00:00Z');
const xml=`<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title>Federal funds interest rate decision &amp; statement</title>
  <link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261018a.htm</link>
  <pubDate>Sun, 18 Oct 2026 16:00:00 GMT</pubDate></item>
  <item><title>Unrelated news</title><link>https://bad.example/x</link>
  <pubDate>Sun, 18 Oct 2026 16:00:00 GMT</pubDate></item>
  <item><title>Old statement</title><link>https://www.federalreserve.gov/newsevents/pressreleases/old.htm</link>
  <pubDate>Sun, 18 Oct 2020 16:00:00 GMT</pubDate></item>
  <item><title>Duplicate news</title>
  <link>https://www.federalreserve.gov/newsevents/pressreleases/monetary20261018a.htm</link>
  <pubDate>Sun, 18 Oct 2026 16:00:00 GMT</pubDate></item>
</channel></rss>`;
const events=parseGeoFeed(xml,source,{now});
assert.equal(events.length,1);
assert.equal(events[0].topic,'monetary_policy');
assert.equal(events[0].severity,'high');
assert.equal(events[0].execution_enabled,false);
const risk=buildGeoRiskSummary(events,{sourceStatus:[{source_id:source.id,ok:true}]});
assert.equal(risk.level,'elevated');
assert.equal(risk.authorizes_position_change,false);
assert.equal(buildGeoRiskSummary([],{sourceStatus:[{ok:false}]}).level,'unknown');
await assert.rejects(()=>fetchGeoSource({...source,url:'http://localhost/private'}),/geo_source_not_allowlisted/);
const fakeFetch=async()=>({
  ok:true,
  headers:{get:()=>null},
  text:async()=>xml
});
const fetched=await fetchGeoSource(source,{fetchImpl:fakeFetch,now});
assert.equal(fetched.ok,true);
assert.equal(fetched.events.length,1);
assert.throws(()=>parseGeoFeed('<html>invalid</html>',source,{now}),/geo_feed_invalid_xml/);
console.log('learning-geo-v0.1-selftest: ok');
