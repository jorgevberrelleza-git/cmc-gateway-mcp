import { collectBitsoRaw } from './bitso-client.mjs';

function num(v) {
  const n = Number(String(v ?? '').replaceAll(',', '').replaceAll('%', '').trim());
  return Number.isFinite(n) ? n : null;
}
function clamp(v, lo = 0, hi = 100) { return Math.min(hi, Math.max(lo, v)); }
function round(v, d = 2) { return v == null || !Number.isFinite(v) ? null : Number(v.toFixed(d)); }
function mean(values) {
  const a = values.filter(Number.isFinite);
  return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
}
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
    // REST trades reports maker_side. If maker sold, taker/aggressor bought; vice versa.
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
    sample_span_seconds: newest!=null&&oldest!=null ? round((newest-oldest)/1000,1) : null,
    newest_trade_at: newest != null ? new Date(newest).toISOString() : null
  };
}

function phaseMeans(values) {
  if (!values.length) return { early:null, middle:null, late:null };
  const n = values.length;
  const cut1 = Math.max(1, Math.floor(n/3));
  const cut2 = Math.max(cut1+1, Math.floor((2*n)/3));
  return {
    early: round(mean(values.slice(0,cut1)),4),
    middle: round(mean(values.slice(cut1,cut2)),4),
    late: round(mean(values.slice(cut2)),4)
  };
}

function summarizeWallPersistence(snaps) {
  const map = new Map();
  const notionals=[];
  for (const s of snaps) {
    for (const w of (s?.wall_candidates || [])) {
      const n=num(w?.notional), rate=num(w?.rate);
      if (n==null || rate==null) continue;
      notionals.push(n);
      const key=w?.oid ? `oid:${w.oid}` : `${w.side}:${rate}`;
      const cur=map.get(key)||{oid:w?.oid||null,side:w?.side||null,rate,appearances:0,first:null,last:null,max_notional:0};
      cur.appearances += 1;
      cur.first = cur.first==null ? num(s?.sent) : Math.min(cur.first,num(s?.sent)??cur.first);
      cur.last = cur.last==null ? num(s?.sent) : Math.max(cur.last,num(s?.sent)??cur.last);
      cur.max_notional = Math.max(cur.max_notional,n);
      map.set(key,cur);
    }
  }
  const med=median(notionals);
  const ranked=[...map.values()].map(x=>({
    oid:x.oid, side:x.side, rate:x.rate, max_notional:round(x.max_notional,2), appearances:x.appearances,
    persistence_ratio:snaps.length?round(x.appearances/snaps.length,4):null,
    observed_span_ms:x.first!=null&&x.last!=null?Math.max(0,x.last-x.first):null
  })).sort((a,b)=>(b.persistence_ratio||0)*(b.max_notional||0)-(a.persistence_ratio||0)*(a.max_notional||0));
  const persistentLarge=ranked.filter(x=>(x.persistence_ratio||0)>=0.35 && med!=null && (x.max_notional||0)>=2*med);
  return {
    candidate_notional_median:round(med,2),
    dominant_wall:ranked[0]||null,
    persistent_large_wall_count:persistentLarge.length,
    top_persistent_walls:persistentLarge.slice(0,3)
  };
}

function summarizeMidPath(snaps) {
  const mids=snaps.map(s=>num(s?.mid)).filter(Number.isFinite);
  if (mids.length<2) return {
    observations:mids.length,start:null,end:null,high:null,low:null,max_up_bps:null,max_down_bps:null,
    down_sweep_recovery:null,up_sweep_rejection:null,heuristic:null
  };
  const start=mids[0], end=mids.at(-1), high=Math.max(...mids), low=Math.min(...mids);
  const maxUp=((high-start)/start)*10000;
  const maxDown=((low-start)/start)*10000;
  const drop=start-low;
  const rise=high-start;
  const downRecovery=drop>0?clamp((end-low)/drop,0,1):null;
  const upRejection=rise>0?clamp((high-end)/rise,0,1):null;
  let heuristic=null;
  if(maxDown<=-5 && downRecovery!=null && downRecovery>=0.6) heuristic='DOWN_SWEEP_RECOVERED';
  if(maxUp>=5 && upRejection!=null && upRejection>=0.6) heuristic=heuristic?`${heuristic}+UP_SWEEP_REJECTED`:'UP_SWEEP_REJECTED';
  return {
    observations:mids.length,start:round(start,8),end:round(end,8),high:round(high,8),low:round(low,8),
    change_bps:round(((end-start)/start)*10000,2),max_up_bps:round(maxUp,2),max_down_bps:round(maxDown,2),
    down_sweep_recovery:downRecovery==null?null:round(downRecovery,3),
    up_sweep_rejection:upRejection==null?null:round(upRejection,3),
    heuristic
  };
}

function microstructureConfidence(ws, snaps, streamTrades, resolvedMatched) {
  let score=100; const reasons=[];
  const capture=num(ws?.capture_ms)||0;
  if(capture<8000){score-=30;reasons.push('capture_under_8s')} else if(capture<12000){score-=18;reasons.push('capture_under_12s')} else if(capture<18000){score-=8;reasons.push('capture_under_18s')}
  if(snaps.length<6){score-=35;reasons.push('few_order_snapshots')} else if(snaps.length<15){score-=15;reasons.push('limited_order_snapshots')}
  if(streamTrades.length===0){score-=15;reasons.push('no_live_trades')} else if(streamTrades.length<3){score-=7;reasons.push('few_live_trades')}
  const diffs=num(ws?.diff_events)||0;
  if(diffs<5){score-=20;reasons.push('few_diff_events')} else if(diffs<15){score-=8;reasons.push('limited_diff_events')}
  if(resolvedMatched<3){score-=10;reasons.push('few_matched_order_lifecycles')}
  const gaps=num(ws?.sequence_gaps)||0;
  if(gaps>0){score-=35;reasons.push(`sequence_gaps_${gaps}`)}
  if((ws?.errors||[]).length){score-=30;reasons.push('websocket_errors')}
  score=round(clamp(score),0);
  return {score,label:score>=80?'high':score>=55?'medium':'low',reasons};
}

function summarizeWs(ws = {}) {
  const snaps = Array.isArray(ws?.orders_snapshots) ? ws.orders_snapshots : [];
  const imbalances = snaps.map(s => {
    const b=num(s?.bid_value_top20)||0, a=num(s?.ask_value_top20)||0, total=b+a;
    return total ? (b-a)/total : null;
  }).filter(Number.isFinite);
  let flips=0;
  for (let i=1;i<imbalances.length;i++) {
    const a=Math.sign(imbalances[i-1]), b=Math.sign(imbalances[i]);
    if(a!==0&&b!==0&&a!==b) flips++;
  }

  const lifecycle=ws?.lifecycle_counts||{};
  const cancelled=num(lifecycle.cancelled)||0;
  const completed=num(lifecycle.completed)||0;
  const resolvedMatched=cancelled+completed;
  const matchedCancelShare=resolvedMatched>=3?cancelled/resolvedMatched:null;
  const openNotionals = Array.isArray(ws?.open_order_notionals) ? ws.open_order_notionals.map(num).filter(Number.isFinite) : [];
  const med = median(openNotionals);
  const pairs = Array.isArray(ws?.lifecycle_pairs) ? ws.lifecycle_pairs : [];
  const largeFastCancelled = pairs.filter(p => p?.outcome==='cancelled' && num(p?.lifetime_ms)!=null && num(p.lifetime_ms)<=3000 && med!=null && num(p?.notional)!=null && num(p.notional)>=5*med);

  const streamTrades = Array.isArray(ws?.stream_trades) ? ws.stream_trades : [];
  let buy=0,sell=0;
  for (const t of streamTrades) {
    const value = num(t?.value) ?? ((num(t?.price)||0)*(num(t?.amount)||0));
    if (t?.taker_side==='buy') buy += value;
    else if (t?.taker_side==='sell') sell += value;
  }
  const tradeTotal=buy+sell;
  const phases=phaseMeans(imbalances);
  const imbRange=imbalances.length?Math.max(...imbalances)-Math.min(...imbalances):null;
  const stability=imbRange==null?null:round(clamp(100*(1-imbRange/2)),0);
  const wallPersistence=summarizeWallPersistence(snaps);
  const midPath=summarizeMidPath(snaps);
  const confidence=microstructureConfidence(ws,snaps,streamTrades,resolvedMatched);

  return {
    capture_ms: ws?.capture_ms ?? null,
    subscriptions: ws?.subscriptions || {},
    order_snapshots: snaps.length,
    imbalance_mean: imbalances.length ? round(mean(imbalances),4) : null,
    imbalance_min: imbalances.length ? round(Math.min(...imbalances),4) : null,
    imbalance_max: imbalances.length ? round(Math.max(...imbalances),4) : null,
    imbalance_sign_flips: flips,
    imbalance_flips_per_10s: ws?.capture_ms ? round(flips/(ws.capture_ms/10000),2) : null,
    imbalance_phase_means: phases,
    imbalance_stability_0_100: stability,
    diff_events: num(ws?.diff_events)||0,
    raw_diff_counts: ws?.diff_counts_raw || {},
    matched_lifecycle: {
      opened_during_capture:num(lifecycle.opened_during_capture)||0,
      cancelled,
      completed,
      unresolved:num(lifecycle.unresolved)||0,
      resolved_sample:resolvedMatched,
      cancellation_share_observed:matchedCancelShare==null?null:round(matchedCancelShare,4),
      note:'Cancellation share uses only orders first opened during this capture and later resolved during the same capture; raw diff cancellations are not treated as comparable lifecycle outcomes.'
    },
    median_new_order_notional: round(med,2),
    large_fast_cancelled_orders: largeFastCancelled.length,
    wall_persistence:wallPersistence,
    mid_path:midPath,
    sequence_first:num(ws?.sequence_first),
    sequence_last:num(ws?.sequence_last),
    sequence_gaps: num(ws?.sequence_gaps)||0,
    stream_trade_count: streamTrades.length,
    stream_aggressive_buy_value:round(buy,2),
    stream_aggressive_sell_value:round(sell,2),
    stream_aggressive_flow_imbalance: tradeTotal ? round((buy-sell)/tradeTotal,4) : null,
    confidence_0_100:confidence.score,
    confidence_label:confidence.label,
    confidence_reasons:confidence.reasons,
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

  const cancel=num(wsSummary?.matched_lifecycle?.cancellation_share_observed);
  const resolved=num(wsSummary?.matched_lifecycle?.resolved_sample)||0;
  if(cancel!=null&&resolved>=3){
    const pts=cancel>=0.8?20:cancel>=0.65?15:cancel>=0.5?10:cancel>=0.35?5:0;
    if(pts){score+=pts;reasons.push(`matched_cancel_share_${round(cancel*100,0)}pct_n${resolved}`)}
  }

  const fast=num(wsSummary?.large_fast_cancelled_orders)||0;
  if(fast){const pts=Math.min(25,fast*8);score+=pts;reasons.push(`large_fast_cancels_${fast}`)}

  const flips10=num(wsSummary?.imbalance_flips_per_10s)||0;
  if(flips10>=4){score+=15;reasons.push(`book_flip_rate_${round(flips10,1)}_per10s`)}
  else if(flips10>=2){score+=8;reasons.push(`book_flip_rate_${round(flips10,1)}_per10s`)}

  const sweep=wsSummary?.mid_path?.heuristic;
  if(sweep){score+=12;reasons.push(`mid_path_${String(sweep).toLowerCase()}`)}

  const gaps=num(wsSummary?.sequence_gaps)||0;
  if(gaps>0) reasons.push(`data_sequence_gaps_${gaps}`);

  const bookImb=num(depth?.depth?.['50bps']?.imbalance);
  const liveFlow=num(wsSummary?.stream_aggressive_flow_imbalance);
  const recentFlow=num(recent?.aggressive_flow_imbalance);
  const flow=liveFlow??recentFlow;
  if(bookImb!=null&&flow!=null&&Math.abs(bookImb)>=0.45&&Math.abs(flow)>=0.2&&Math.sign(bookImb)!==Math.sign(flow)){
    score+=15;reasons.push('book_vs_aggressive_flow_divergence');
  }

  const confidence=num(wsSummary?.confidence_0_100)||0;
  return { score: round(clamp(score),0), reasons, confidence, confidence_label:wsSummary?.confidence_label||'low' };
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
  if(fr24!=null&&fr24>=100){score+=10;reasons.push(`global_funding_acceleration_${round(fr24,0)}pct`)} else if(fr24!=null&&fr24>=30){score+=6;reasons.push(`global_funding_acceleration_${round(fr24,0)}pct`)}
  const fg=num(global?.sentiment?.fear_greed?.current?.index);
  if(fg!=null&&fg>=80){score+=10;reasons.push(`fear_greed_${fg}`)} else if(fg!=null&&fg>=70){score+=5;reasons.push(`fear_greed_${fg}`)}
  if(String(symbol).toUpperCase()!=='BTC') {
    const alt=num(global?.rotation?.altcoin_season?.current?.index);
    if(alt!=null&&alt>=70){score+=5;reasons.push(`altseason_${alt}`)}
  }
  return { score: round(clamp(score),0), reasons, derivatives_scope:'global_proxy_not_asset_specific' };
}

function applyDirectionalEvidence(score, reasons, label, v, weight) {
  if(v==null) return score;
  if(v>=0.25){score+=weight;reasons.push(`${label}_buy`)}
  else if(v<=-0.25){score-=weight;reasons.push(`${label}_sell`)}
  else if(Math.abs(v)<=0.1){reasons.push(`${label}_neutral`)}
  return score;
}

function computeSpotConfirmation(depth, wsSummary, recent) {
  let score=50; const reasons=[];
  const recentFlow=num(recent?.aggressive_flow_imbalance);
  const liveFlow=num(wsSummary?.stream_aggressive_flow_imbalance);
  const lateBook=num(wsSummary?.imbalance_phase_means?.late);
  const finalBook=num(depth?.depth?.['50bps']?.imbalance);
  const span=num(recent?.sample_span_seconds);
  const recentWeight=span!=null&&span<=900?10:span!=null&&span<=3600?7:4;
  score=applyDirectionalEvidence(score,reasons,'recent_flow',recentFlow,recentWeight);
  score=applyDirectionalEvidence(score,reasons,'live_flow',liveFlow,15);
  score=applyDirectionalEvidence(score,reasons,'late_book',lateBook,8);
  score=applyDirectionalEvidence(score,reasons,'rest_book',finalBook,7);
  const spread=num(depth?.spread_bps);
  if(spread!=null&&spread<=3){score+=5;reasons.push('tight_spread')}
  else if(spread!=null&&spread>=10){score-=10;reasons.push('wide_spread')}

  let confidence=35;
  if((num(wsSummary?.order_snapshots)||0)>=15) confidence+=20;
  if((num(wsSummary?.stream_trade_count)||0)>=3) confidence+=30;
  else if((num(wsSummary?.stream_trade_count)||0)>0) confidence+=15;
  if(span!=null&&span<=900) confidence+=10;
  else if(span!=null&&span<=3600) confidence+=5;
  if((num(wsSummary?.sequence_gaps)||0)>0) confidence-=30;
  confidence=round(clamp(confidence),0);
  return { score: round(clamp(score),0), reasons, confidence_0_100:confidence };
}

function venuePriceCheck(symbol, minor, depth, quotes) {
  const q=getQuoteFor(symbol,quotes)||{};
  const cmc=num(q?.price), mid=num(depth?.mid);
  if(cmc==null||mid==null) return {available:false,reason:'missing_price'};
  if(!['usd','usdc','usdt'].includes(String(minor||'').toLowerCase())) {
    return {available:false,reason:`book_minor_${minor||'unknown'}_requires_fx_conversion`};
  }
  const basis=((mid-cmc)/cmc)*10000;
  return {
    available:true,
    cmc_usd_price:round(cmc,8),
    bitso_mid:round(mid,8),
    basis_bps:round(basis,2),
    material_mismatch:Math.abs(basis)>=100,
    note:String(minor).toLowerCase()==='usd'?'Direct USD comparison.':'Stablecoin-quoted book; basis also includes stablecoin/USD deviation.'
  };
}

export function analyzeBitsoRaw(raw, { symbol, quotes, technicals, market } = {}) {
  if (!raw?.available) return { available:false, symbol, book:null, reason:raw?.error||'Bitso book unavailable' };
  const depth=summarizeDepth(raw.order_book);
  const recent=summarizeRecentTrades(raw.recent_trades);
  const wsSummary=summarizeWs(raw.websocket);
  const trap=computeTrapRisk(depth,wsSummary,recent);
  const crowding=computeCrowdingRisk(symbol,quotes,technicals,market);
  const spot=computeSpotConfirmation(depth,wsSummary,recent);
  const venue=venuePriceCheck(symbol,raw.resolved?.minor,depth,quotes);
  const confidence=num(wsSummary?.confidence_0_100)||0;
  const sweep=Boolean(wsSummary?.mid_path?.heuristic);

  let gate='NORMAL_REVIEW';
  const gateReasons=[];
  if(confidence<35){
    gate='DATA_INSUFFICIENT_FOR_MICROSTRUCTURE'; gateReasons.push('microstructure_confidence_below_35');
  } else if(trap.score>=75 || (spot.score<25&&spot.confidence_0_100>=55) || venue?.material_mismatch&&Math.abs(venue.basis_bps)>=250){
    gate='BLOCK_NEW_ENTRY_UNTIL_CLEANER_DATA';
    if(trap.score>=75)gateReasons.push('trap_risk_75_plus');
    if(spot.score<25&&spot.confidence_0_100>=55)gateReasons.push('strong_negative_spot_confirmation');
    if(venue?.material_mismatch&&Math.abs(venue.basis_bps)>=250)gateReasons.push('large_venue_price_mismatch');
  } else if(trap.score>=60 || crowding.score>=70 || (spot.score<40&&spot.confidence_0_100>=45) || sweep || venue?.material_mismatch){
    gate='WAIT_FOR_RETEST_OR_CONFIRMATION';
    if(trap.score>=60)gateReasons.push('trap_risk_60_plus');
    if(crowding.score>=70)gateReasons.push('crowding_70_plus');
    if(spot.score<40&&spot.confidence_0_100>=45)gateReasons.push('weak_spot_confirmation');
    if(sweep)gateReasons.push('sweep_or_rejection_heuristic');
    if(venue?.material_mismatch)gateReasons.push('venue_price_mismatch_100bps_plus');
  }

  return {
    available:true,
    symbol,
    book:raw.resolved?.book,
    minor_currency:raw.resolved?.minor,
    capture_window_ms:raw.websocket?.capture_ms||null,
    order_book:depth,
    recent_trades:recent,
    live_microstructure:wsSummary,
    venue_price_check:venue,
    scores:{
      trap_risk_0_100:trap.score,
      crowding_risk_0_100:crowding.score,
      spot_confirmation_0_100:spot.score,
      spot_confirmation_confidence_0_100:spot.confidence_0_100,
      microstructure_confidence_0_100:confidence
    },
    execution_context_gate: gate,
    execution_context_gate_reasons:gateReasons,
    flags:{
      possible_liquidity_trap:trap.score>=60&&confidence>=35,
      crowded_positioning:crowding.score>=65,
      weak_spot_confirmation:spot.score<40&&spot.confidence_0_100>=45,
      sweep_or_rejection_heuristic:sweep,
      venue_price_mismatch:Boolean(venue?.material_mismatch),
      data_quality_reduced:confidence<55
    },
    reasons:{trap:trap.reasons,crowding:crowding.reasons,spot_confirmation:spot.reasons},
    data_quality:{confidence_0_100:confidence,confidence_label:wsSummary.confidence_label,sequence_gaps:wsSummary.sequence_gaps,errors:[...(raw.errors||[]),...(wsSummary.errors||[])]},
    interpretation_note:'Heuristic market-microstructure risk signals only. They do not prove spoofing, manipulation, or stop-hunting. v0.5 cancellation metrics use matched order lifecycles observed from open to resolution within the capture window.'
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
    mode:'public_read_only_microstructure_v2',
    execution_enabled:false,
    assets:out,
    methodology:{
      trap_risk:'Spread + matched open-to-cancel lifecycle evidence + large fast cancellations + normalized book-imbalance churn + short-window sweep/rejection heuristics + book-vs-flow divergence.',
      crowding_risk:'Public technical/momentum + global derivatives + sentiment. Global derivatives are a proxy, not asset-specific positioning.',
      spot_confirmation:'Fresh live taker flow receives the highest weight; slower REST trade flow receives less weight when its 100-trade window spans hours. Book imbalance and spread are supporting evidence.',
      persistence:'Tracks dominant top-book order IDs across snapshots and reports how persistently large walls remain visible.',
      confidence:'Scores capture length, order snapshots, live trades, diff-order events, matched lifecycles, sequence integrity and WebSocket errors.',
      cancellation_fix:'Raw cancellation counts can include orders opened before the capture. v0.5 only computes cancellation share from orders first observed as newly opened during the capture and then resolved before capture end.'
    }
  };
}

export const _test = { summarizeDepth, summarizeRecentTrades, summarizeWs, computeTrapRisk, computeSpotConfirmation, venuePriceCheck };
