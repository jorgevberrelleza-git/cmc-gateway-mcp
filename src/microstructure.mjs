import { collectBitsoRaw } from './bitso-client.mjs';

function num(v) {
  const n = Number(String(v ?? '').replaceAll(',', '').replaceAll('%', '').trim());
  return Number.isFinite(n) ? n : null;
}
function clamp(v, lo = 0, hi = 100) { return Math.min(hi, Math.max(lo, v)); }
function round(v, d = 2) { return v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)); }
function median(values) {
  const a = values.filter(Number.isFinite).sort((x,y) => x-y);
  if (!a.length) return null;
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i-1] + a[i]) / 2;
}
function parsePayload(result) {
  if (result?.structuredContent != null) return result.structuredContent;
  for (const block of result?.content || []) {
    if (block?.type !== 'text') continue;
    try { return JSON.parse(block.text); } catch {}
  }
  return null;
}
function quoteRows(quotes) {
  const p = parsePayload(quotes);
  if (!p) return [];
  if (Array.isArray(p)) return p;
  if (Array.isArray(p.rows) && Array.isArray(p.headers)) {
    return p.rows.map(row => Object.fromEntries(p.headers.map((h,i) => [h,row[i]])));
  }
  return [];
}
function technicalObject(result) { return parsePayload(result) || {}; }
function globalObject(result) { return parsePayload(result) || {}; }

function summarizeDepth(orderBook = {}) {
  const bids = Array.isArray(orderBook?.bids) ? orderBook.bids : [];
  const asks = Array.isArray(orderBook?.asks) ? orderBook.asks : [];
  const parsedBids = bids.map(x => ({ p:num(x?.price), a:num(x?.amount) })).filter(x => x.p != null && x.a != null).sort((a,b)=>b.p-a.p);
  const parsedAsks = asks.map(x => ({ p:num(x?.price), a:num(x?.amount) })).filter(x => x.p != null && x.a != null).sort((a,b)=>a.p-b.p);
  const bestBid = parsedBids[0]?.p ?? null;
  const bestAsk = parsedAsks[0]?.p ?? null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  const spreadBps = mid ? ((bestAsk - bestBid) / mid) * 10000 : null;
  const depth = {};
  for (const bps of [10,25,50]) {
    const band = bps / 10000;
    const bidValue = mid == null ? null : parsedBids.filter(x => x.p >= mid * (1-band)).reduce((s,x)=>s+x.p*x.a,0);
    const askValue = mid == null ? null : parsedAsks.filter(x => x.p <= mid * (1+band)).reduce((s,x)=>s+x.p*x.a,0);
    const total = bidValue != null && askValue != null ? bidValue + askValue : null;
    depth[`${bps}bps`] = {
      bid_value: round(bidValue,2), ask_value: round(askValue,2),
      imbalance: total ? round((bidValue - askValue) / total, 4) : null
    };
  }
  return { best_bid:bestBid, best_ask:bestAsk, mid:round(mid,8), spread_bps:round(spreadBps,2), depth };
}

function summarizeRecentTrades(trades = []) {
  let buyValue=0, sellValue=0, unknown=0;
  const prices=[];
  let newest=null, oldest=null;
  for (const t of trades) {
    const p=num(t?.price), a=num(t?.amount);
    const value = p != null && a != null ? p*a : 0;
    const maker = String(t?.maker_side || '').toLowerCase();
    // If maker sold, aggressive/taker side was buy; if maker bought, taker side was sell.
    if (maker === 'sell') buyValue += value;
    else if (maker === 'buy') sellValue += value;
    else unknown += value;
    if (p != null) prices.push(p);
    const ts=Date.parse(t?.created_at || '');
    if (Number.isFinite(ts)) { newest = newest==null ? ts : Math.max(newest,ts); oldest = oldest==null ? ts : Math.min(oldest,ts); }
  }
  const total=buyValue+sellValue;
  return {
    count: trades.length,
    aggressive_buy_value: round(buyValue,2), aggressive_sell_value:round(sellValue,2), unknown_value:round(unknown,2),
    aggressive_flow_imbalance: total ? round((buyValue-sellValue)/total,4) : null,
    high: prices.length ? Math.max(...prices) : null,
    low: prices.length ? Math.min(...prices) : null,
    sample_span_seconds: newest!=null&&oldest!=null ? round((newest-oldest)/1000,1) : null
  };
}

function summarizeWs(ws = {}) {
  const snaps = Array.isArray(ws?.orders_snapshots) ? ws.orders_snapshots : [];
  const imbalances = snaps.map(s => {
    const b=num(s?.bid_value_top20)||0, a=num(s?.ask_value_top20)||0, total=b+a;
    return total ? (b-a)/total : null;
  }).filter(Number.isFinite);
  let flips=0;
  for (let i=1;i<imbalances.length;i++) if (Math.sign(imbalances[i]) !== Math.sign(imbalances[i-1])) flips++;
  const openNotionals = Array.isArray(ws?.open_order_notionals) ? ws.open_order_notionals.map(num).filter(Number.isFinite) : [];
  const med = median(openNotionals);
  const pairs = Array.isArray(ws?.ephemeral_pairs) ? ws.ephemeral_pairs : [];
  const largeFastCancelled = pairs.filter(p => p?.outcome==='cancelled' && num(p?.lifetime_ms)!=null && num(p.lifetime_ms)<=3000 && med!=null && num(p?.notional)!=null && num(p.notional)>=5*med);
  const counts = ws?.diff_counts || {};
  const resolved = (num(counts.open)||0)+(num(counts.cancelled)||0)+(num(counts.completed)||0);
  const cancelledShare = resolved ? (num(counts.cancelled)||0)/resolved : null;
  const completedShare = resolved ? (num(counts.completed)||0)/resolved : null;

  const streamTrades = Array.isArray(ws?.stream_trades) ? ws.stream_trades : [];
  let buy=0,sell=0;
  for (const t of streamTrades) {
    const value = num(t?.value) ?? ((num(t?.price)||0)*(num(t?.amount)||0));
    if (t?.taker_side==='buy') buy += value;
    else if (t?.taker_side==='sell') sell += value;
  }
  const tradeTotal=buy+sell;

  return {
    capture_ms: ws?.capture_ms ?? null,
    subscriptions: ws?.subscriptions || {},
    order_snapshots: snaps.length,
    imbalance_mean: imbalances.length ? round(imbalances.reduce((a,b)=>a+b,0)/imbalances.length,4) : null,
    imbalance_min: imbalances.length ? round(Math.min(...imbalances),4) : null,
    imbalance_max: imbalances.length ? round(Math.max(...imbalances),4) : null,
    imbalance_sign_flips: flips,
    diff_events: num(ws?.diff_events)||0,
    cancellations: num(counts.cancelled)||0,
    completions: num(counts.completed)||0,
    cancellation_share_observed: cancelledShare==null?null:round(cancelledShare,4),
    completion_share_observed: completedShare==null?null:round(completedShare,4),
    median_new_order_notional: round(med,2),
    large_fast_cancelled_orders: largeFastCancelled.length,
    sequence_gaps: num(ws?.sequence_gaps)||0,
    stream_trade_count: streamTrades.length,
    stream_aggressive_flow_imbalance: tradeTotal ? round((buy-sell)/tradeTotal,4) : null,
    errors: ws?.errors || []
  };
}

function computeTrapRisk(depth, wsSummary, recent) {
  let score=0; const reasons=[];
  const spread=num(depth?.spread_bps);
  if (spread!=null) {
    const pts=spread>=20?20:spread>=10?15:spread>=5?10:spread>=2?5:0;
    if(pts){score+=pts;reasons.push(`wide_spread_${round(spread,1)}bps`)}
  }
  const cancel=num(wsSummary?.cancellation_share_observed);
  if(cancel!=null){const pts=cancel>=0.7?20:cancel>=0.5?15:cancel>=0.35?10:cancel>=0.2?5:0;if(pts){score+=pts;reasons.push(`high_cancel_share_${round(cancel*100,0)}pct`)}}
  const fast=num(wsSummary?.large_fast_cancelled_orders)||0;
  if(fast){const pts=Math.min(25,fast*8);score+=pts;reasons.push(`large_fast_cancels_${fast}`)}
  const flips=num(wsSummary?.imbalance_sign_flips)||0;
  if(flips>=4){score+=15;reasons.push(`book_imbalance_flips_${flips}`)} else if(flips>=2){score+=8;reasons.push(`book_imbalance_flips_${flips}`)}
  const gaps=num(wsSummary?.sequence_gaps)||0;
  if(gaps>0){reasons.push(`data_sequence_gaps_${gaps}`)}
  const bookImb=num(depth?.depth?.['50bps']?.imbalance);
  const flow=num(recent?.aggressive_flow_imbalance);
  if(bookImb!=null&&flow!=null&&Math.abs(bookImb)>=0.45&&Math.sign(bookImb)!==Math.sign(flow)){
    score+=15;reasons.push('book_vs_aggressive_flow_divergence');
  }
  return { score: round(clamp(score),0), reasons, confidence: gaps>0||wsSummary?.errors?.length?'reduced':'normal' };
}

function getQuoteFor(symbol, quotes) {
  return quoteRows(quotes).find(r => String(r.symbol||'').toUpperCase()===String(symbol).toUpperCase()) || null;
}

function computeCrowdingRisk(symbol, quotes, technicals, market) {
  const q=getQuoteFor(symbol,quotes)||{};
  const tech=technicalObject(technicals?.[symbol]);
  const global=globalObject(market?.global);
  const deriv=globalObject(market?.derivatives);
  let score=0;const reasons=[];
  const rsi7=num(tech?.rsi?.rsi7), rsi14=num(tech?.rsi?.rsi14);
  if(rsi7!=null){const p=rsi7>=80?20:rsi7>=75?16:rsi7>=70?12:rsi7>=65?6:0;if(p){score+=p;reasons.push(`rsi7_${round(rsi7,1)}`)}}
  if(rsi14!=null){const p=rsi14>=75?15:rsi14>=70?12:rsi14>=65?7:0;if(p){score+=p;reasons.push(`rsi14_${round(rsi14,1)}`)}}
  const p24=num(q?.percent_change_24h), vol=num(q?.volume_change_24h);
  if(p24!=null&&p24>=8){score+=15;reasons.push(`price24h_${round(p24,1)}pct`)} else if(p24!=null&&p24>=5){score+=10;reasons.push(`price24h_${round(p24,1)}pct`)}
  if(vol!=null&&vol>=200){score+=12;reasons.push(`volume24h_${round(vol,0)}pct`)} else if(vol!=null&&vol>=100){score+=8;reasons.push(`volume24h_${round(vol,0)}pct`)}
  const oi24=num(deriv?.totalOpenInterest?.percentage_change_24h);
  if(oi24!=null&&oi24>=10){score+=15;reasons.push(`global_oi24h_${round(oi24,1)}pct`)} else if(oi24!=null&&oi24>=5){score+=10;reasons.push(`global_oi24h_${round(oi24,1)}pct`)}
  const fr24=num(deriv?.fundingRate?.percentage_change_24h);
  if(fr24!=null&&fr24>=100){score+=10;reasons.push(`funding_acceleration_${round(fr24,0)}pct`)} else if(fr24!=null&&fr24>=30){score+=6;reasons.push(`funding_acceleration_${round(fr24,0)}pct`)}
  const fg=num(global?.sentiment?.fear_greed?.current?.index);
  if(fg!=null&&fg>=80){score+=10;reasons.push(`fear_greed_${fg}`)} else if(fg!=null&&fg>=70){score+=5;reasons.push(`fear_greed_${fg}`)}
  if(String(symbol).toUpperCase()!=='BTC') {
    const alt=num(global?.rotation?.altcoin_season?.current?.index);
    if(alt!=null&&alt>=70){score+=5;reasons.push(`altseason_${alt}`)}
  }
  return { score: round(clamp(score),0), reasons };
}

function computeSpotConfirmation(depth, wsSummary, recent) {
  let score=50; const reasons=[];
  const recentFlow=num(recent?.aggressive_flow_imbalance);
  const liveFlow=num(wsSummary?.stream_aggressive_flow_imbalance);
  const book=num(depth?.depth?.['50bps']?.imbalance);
  for (const [label,v] of [['recent_flow',recentFlow],['live_flow',liveFlow],['book_imbalance',book]]) {
    if(v==null) continue;
    if(v>=0.25){score+=12;reasons.push(`${label}_buy`)}
    else if(v<=-0.25){score-=12;reasons.push(`${label}_sell`)}
    else if(Math.abs(v)<=0.1){reasons.push(`${label}_neutral`)}
  }
  const spread=num(depth?.spread_bps);
  if(spread!=null&&spread<=3){score+=5;reasons.push('tight_spread')}
  else if(spread!=null&&spread>=10){score-=10;reasons.push('wide_spread')}
  return { score: round(clamp(score),0), reasons };
}

export function analyzeBitsoRaw(raw, { symbol, quotes, technicals, market } = {}) {
  if (!raw?.available) return { available:false, symbol, book:null, reason:raw?.error||'Bitso book unavailable' };
  const depth=summarizeDepth(raw.order_book);
  const recent=summarizeRecentTrades(raw.recent_trades);
  const wsSummary=summarizeWs(raw.websocket);
  const trap=computeTrapRisk(depth,wsSummary,recent);
  const crowding=computeCrowdingRisk(symbol,quotes,technicals,market);
  const spot=computeSpotConfirmation(depth,wsSummary,recent);
  const gate = trap.score >= 75 || spot.score < 25
    ? 'BLOCK_NEW_ENTRY_UNTIL_CLEANER_DATA'
    : trap.score >= 60 || crowding.score >= 70 || spot.score < 40
      ? 'WAIT_FOR_RETEST_OR_CONFIRMATION'
      : 'NORMAL_REVIEW';
  return {
    available:true,
    symbol,
    book:raw.resolved?.book,
    minor_currency:raw.resolved?.minor,
    capture_window_ms:raw.websocket?.capture_ms||null,
    order_book:depth,
    recent_trades:recent,
    live_microstructure:wsSummary,
    scores:{
      trap_risk_0_100:trap.score,
      crowding_risk_0_100:crowding.score,
      spot_confirmation_0_100:spot.score
    },
    execution_context_gate: gate,
    flags:{
      possible_liquidity_trap:trap.score>=60,
      crowded_positioning:crowding.score>=65,
      weak_spot_confirmation:spot.score<40,
      data_quality_reduced:trap.confidence==='reduced'
    },
    reasons:{trap:trap.reasons,crowding:crowding.reasons,spot_confirmation:spot.reasons},
    data_quality:{sequence_gaps:wsSummary.sequence_gaps,errors:[...(raw.errors||[]),...(wsSummary.errors||[])]},
    interpretation_note:'Heuristic market-microstructure risk signals only. They do not prove spoofing, manipulation, or stop-hunting.'
  };
}

export async function buildMicrostructureSnapshot({ assets, quotes, technicals, market, captureMs } = {}) {
  const list=[...new Set((assets||[]).map(x=>String(x).trim().toUpperCase()).filter(Boolean))];
  const raws=await Promise.all(list.map(symbol=>collectBitsoRaw(symbol,{captureMs})));
  const out={};
  for(let i=0;i<list.length;i++) out[list[i]]=analyzeBitsoRaw(raws[i],{symbol:list[i],quotes,technicals,market});
  return {
    generated_at:new Date().toISOString(),
    venue:'Bitso',
    mode:'public_read_only_microstructure',
    execution_enabled:false,
    assets:out,
    methodology:{
      trap_risk:'Spread, observed cancellation share, large fast cancellations, order-book imbalance instability, sequence/data quality and book-vs-aggressive-flow divergence.',
      crowding_risk:'Public technical/momentum + global derivatives + sentiment. High score means the setup may be consensus/crowded, not that it must reverse.',
      spot_confirmation:'Aggressive trade flow + live book imbalance + spread quality on the selected Bitso execution book.'
    }
  };
}

export const _test = { summarizeDepth, summarizeRecentTrades, summarizeWs, computeTrapRisk };
