// Retrospective crypto event study. PRICE DATA ONLY; no fabricated equity candles.
// SpaceX actual IPO 2026-06-12 verified by https://ir.spacex.com/
// Day-0 UTC crypto candle overlaps pre/post Nasdaq opening; study is NONCAUSAL.
import crypto from 'node:crypto';
import { validateSeries, TIME_MACHINE_DAY_MS, TIME_MACHINE_ASSETS } from './time-machine.mjs';

const hash=o=>crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const fixed=x=>Number(x.toFixed(5));
const mean=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
const std=arr=>{const m=mean(arr);return Math.sqrt(mean(arr.map(x=>(x-m)**2)));};
const fail=x=>{throw new Error('event_study:'+x);};

export const VERIFIED_EVENT_CATALOG=Object.freeze([
  Object.freeze({
    id:'SPACEX_IPO_20260612',assetClass:'US_EQUITY_IPO',company:'SpaceX',symbol:'SPCX',
    eventDate:'2026-06-12',
    listingTimeUtc:'2026-06-12T14:15:00.000Z',
    source:'https://ir.spacex.com/updates/releases-details/2026/Space-Exploration-Technologies-Corp--Announces-Closing-of-Initial-Public-Offering-Including-Full-Exercise-of-Underwriters-Option-to-Purchase-Additional-Shares-2026-RgoR-Y1Vwh/',
    timeSource:'https://www.nasdaq.com/newsroom/spacex-ipo-rocket-company-launches-historic-ipo',
    status:'VERIFIED_HISTORICAL',
    ipoOfferUsd:135,firstTradeUsd:150
  }),
  Object.freeze({
    id:'ANTHROPIC_IPO_20261119',assetClass:'US_EQUITY_IPO',company:'Anthropic',symbol:'ANT',
    eventDate:'2026-11-19',
    listingTimeUtc:null,
    source:'https://www.anthropic.com/news/anthropic-prices-initial-public-offering',
    status:'SCHEDULED_UNOBSERVED_IN_DATA',
    ipoOfferUsd:83,firstTradeUsd:null
  })
]);

const HORIZONS=Object.freeze([1,3,7,30]);
function buildIndicators(btc,i) {
  if(i<45 || i>=btc.length) return null;
  const pre=btc[i-1].close;
  const trend30=pre/btc[i-31].close-1;
  const logRet=[];
  for(let k=i-20;k<i;k++)logRet.push(Math.log(btc[k].close/btc[k-1].close));
  return {trend30,vol20:std(logRet)*Math.sqrt(365)};
}
function compareEventAt(aligned,i) {
  const day0={},post={};
  for(const a of TIME_MACHINE_ASSETS) {
    const b=aligned[a], pre=b[i-1].close, ev=b[i].close;
    day0[a]=fixed((ev/pre-1)*100);
    post[a]={};
    for(const h of HORIZONS)post[a][h]=fixed((b[i+h].close/ev-1)*100);
  }
  return {day0,post};
}
function controlsFor(aligned,times,eventIndex,{maxControls=20,leadDays=60}={}) {
  const btc=aligned.BTC;
  const eventInd=buildIndicators(btc,eventIndex);
  if(!eventInd)fail('event_insufficient_pre_history');
  const candidates=[];
  // Only earlier history can be a matching control. Do not let returns AFTER
  // the event select/control the regime similarity features.
  for(let i=46;i<eventIndex-leadDays;i++) {
    if(i+30>=eventIndex-leadDays)continue;
    const x=buildIndicators(btc,i);
    if(!x)continue;
    const distance=Math.abs(x.trend30-eventInd.trend30)+0.15*Math.abs(x.vol20-eventInd.vol20);
    candidates.push({i,distance,trend30:x.trend30,vol20:x.vol20});
  }
  candidates.sort((a,b)=>a.distance-b.distance || a.i-b.i);
  const picked=[];
  for(const c of candidates) {
    // Avoid contiguous overlapping control windows.
    if(picked.every(p=>Math.abs(p.i-c.i)>30))picked.push(c);
    if(picked.length>=maxControls)break;
  }
  return picked.map(x=>({index:x.i,date:new Date(times[x.i]).toISOString().slice(0,10),
    matchDistance:fixed(x.distance)}));
}
export function runHistoricalEventStudy({series,stepMs=TIME_MACHINE_DAY_MS,eventId='SPACEX_IPO_20260612'}={}) {
  if(stepMs!==TIME_MACHINE_DAY_MS)fail('daily_only');
  const ev=VERIFIED_EVENT_CATALOG.find(x=>x.id===eventId);
  if(!ev)fail('event_not_whitelisted');
  const v=validateSeries(series,{stepMs});
  const eventIndex=v.times.findIndex(t=>t===Date.parse(ev.eventDate+'T00:00:00.000Z'));
  const eventDayMs=Date.parse(ev.eventDate+'T00:00:00.000Z');
  const last=v.times.at(-1);
  if(eventIndex<46 || eventIndex+30>=v.times.length) {
    return {
      schema:'shadow_event_study_v0.3',eventId,statisticalStatus:'INSUFFICIENT_OBSERVED_OUTCOMES',
      eventDate:ev.eventDate, datasetLastDay:new Date(last).toISOString().slice(0,10),
      eventInDataset:eventIndex>=0,daysToEventFromDatasetEnd:fixed((eventDayMs-last)/TIME_MACHINE_DAY_MS),
      portfolioOrders:0,liveExecution:false,
      warning:'No stock-price simulation or future crypto returns. Await actual prices and verified listing timestamp.'
    };
  }
  const controls=controlsFor(v.alignedBars,v.times,eventIndex);
  if(controls.length<8)fail('insufficient_independent_control_windows');
  const observed=compareEventAt(v.alignedBars,eventIndex);
  const matched=controls.map(x=>({date:x.date,comparison:compareEventAt(v.alignedBars,x.index)}));
  const assets={};
  for(const asset of TIME_MACHINE_ASSETS) {
    const ctrlDay0=mean(matched.map(c=>c.comparison.day0[asset]));
    const ret={};
    for(const horizon of HORIZONS) {
      const vals=matched.map(c=>c.comparison.post[asset][horizon]);
      const btcAfter=observed.post.BTC[horizon];
      const assetAfter=observed.post[asset][horizon];
      ret[horizon]={
        cryptoReturnPct:assetAfter,
        btcReturnPct:btcAfter,
        assetMinusBtcPp:fixed(assetAfter-btcAfter),
        matchedControlMeanPct:fixed(mean(vals)),
        eventMinusMatchedMeanPp:fixed(assetAfter-mean(vals)),
        controlCount:vals.length
      };
    }
    assets[asset]={
      day0UtcReturnPct:observed.day0[asset],
      matchedDay0MeanPct:fixed(ctrlDay0),
      day0MinusMatchedPp:fixed(observed.day0[asset]-ctrlDay0),
      postEventUtcCloseToClose:ret
    };
  }
  const report={
    schema:'shadow_event_study_v0.3',eventId,
    source:ev.source,firstTradingTimeUtc:ev.listingTimeUtc,assetClass:ev.assetClass,
    eventDate:ev.eventDate,dataVenue:'Binance Spot USDT',
    sampleType:'single_observational_event_with_pre_event_matched_controls',
    controlMethod:'pre_event_BTC_30d_trend_20d_realized_vol; separated_by_30_days; selected_only_before_event_minus_60d',
    controls,assets,
    horizonDays:[...HORIZONS],
    controlsCount:controls.length,earliestControl:controls[0]?.date||null,
    statisticalStatus:'DESCRIPTIVE_NON_CAUSAL',
    equityReturnsSimulated:false,IPOExecutionSimulated:false,
    cryptoDay0CandleIncludesPreAndPostListing:true,
    disclaimer:'Daily UTC crypto candle straddles US equity IPO hours. Matching cannot establish IPO caused moves. No trading recommendation.',
    ordersCreated:0,liveExecution:false,policyPromoted:false
  };
  report.reportHash=hash(report);
  return report;
}
