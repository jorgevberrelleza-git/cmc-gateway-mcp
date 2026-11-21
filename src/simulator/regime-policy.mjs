// Shadow Time Machine v0.3: causal, deterministic market-regime RESEARCH policy.
// No trading clients, look-ahead features, paid AI, or model training.
const avg = xs => xs.reduce((s, n) => s + n, 0) / xs.length;
const fail = msg => { throw new Error('shadow_regime:' + msg); };
const round = x => Number(x.toFixed(5));

export const REGIME_CANDIDATES = Object.freeze([
  Object.freeze({ id:'regime_cautious', btcFast:30, btcSlow:120, bullRet30Min:0.03, bearRet30Max:-0.08, shockDrop10:-0.12, shockVol:0.95, assetFast:15, assetSlow:45 }),
  Object.freeze({ id:'regime_balanced', btcFast:40, btcSlow:150, bullRet30Min:0.01, bearRet30Max:-0.1, shockDrop10:-0.15, shockVol:1.15, assetFast:20, assetSlow:60 }),
  Object.freeze({ id:'regime_defensive', btcFast:20, btcSlow:90, bullRet30Min:0.05, bearRet30Max:-0.06, shockDrop10:-0.09, shockVol:0.75, assetFast:10, assetSlow:35 }),
  Object.freeze({ id:'regime_slow', btcFast:50, btcSlow:200, bullRet30Min:0, bearRet30Max:-0.12, shockDrop10:-0.18, shockVol:1.35, assetFast:30, assetSlow:90 })
]);
export const REGIMES = Object.freeze(['UNKNOWN', 'BULL', 'BEAR', 'SIDEWAYS', 'SHOCK']);

function validSettings(c) {
  if (!c || typeof c !== 'object') fail('missing_config');
  const keys=['btcFast','btcSlow','bullRet30Min','bearRet30Max','shockDrop10','shockVol','assetFast','assetSlow'];
  if (typeof c.id !== 'string' || !/^regime_[a-z0-9_]+$/.test(c.id)) fail('invalid_id');
  if(keys.some(k=>!Number.isFinite(c[k]))) fail('nonfinite_settings');
  if (![c.btcFast,c.btcSlow,c.assetFast,c.assetSlow].every(Number.isInteger)) fail('invalid_window');
  if (c.btcFast<5 || c.btcSlow<=c.btcFast || c.btcSlow>365 || c.assetFast<5 || c.assetSlow<=c.assetFast || c.assetSlow>200) fail('window_out_of_bounds');
  if(c.shockDrop10>=0 || c.bearRet30Max>=0 || c.bullRet30Min<0 || c.shockVol<=0) fail('invalid_regime_thresholds');
}

function closeHistory(history, observedThrough) {
  if (!Array.isArray(history)) fail('history_required');
  if (history.length && history.at(-1).closeTime > observedThrough) fail('future_data_detected');
  return history.map(b=>b.close);
}
function standardDeviation(xs) {
  const mean=avg(xs);
  return Math.sqrt(avg(xs.map(x=>(x-mean)**2)));
}
function measureBtcRegime(closes, c) {
  if (closes.length < Math.max(c.btcSlow, 45)) {
    return { regime:'UNKNOWN', reason:'insufficient_closed_bars', ret30:null, ret10:null, realizedVol:null };
  }
  const last=closes.at(-1);
  const fast=avg(closes.slice(-c.btcFast)), slow=avg(closes.slice(-c.btcSlow));
  const ret30=last / closes.at(-31)-1, ret10=last/closes.at(-11)-1;
  const recent=closes.slice(-31).map((v,i,arr)=>i===0?null:Math.log(v/arr[i-1])).slice(1);
  const realizedVol=standardDeviation(recent) * Math.sqrt(365);
  let regime='SIDEWAYS',reason='mixed_or_flat';
  if (ret10<=c.shockDrop10 || (realizedVol>=c.shockVol && ret10<0)) {
    regime='SHOCK';reason='btc_shock';
  } else if ((last < slow && fast < slow) || ret30 <= c.bearRet30Max) {
    regime='BEAR';reason='btc_downtrend';
  } else if (last > slow && fast > slow && ret30 > c.bullRet30Min && realizedVol < c.shockVol) {
    regime='BULL';reason='btc_uptrend_confirmed';
  }
  return { regime, reason, ret30:round(ret30), ret10:round(ret10), realizedVol:round(realizedVol) };
}

export function classifyMarketRegime({ btcHistory, observedThrough, config=REGIME_CANDIDATES[1] }={}) {
  validSettings(config);
  if(!Number.isFinite(observedThrough))fail('observation_time_required');
  const closes=closeHistory(btcHistory, observedThrough);
  return Object.freeze(measureBtcRegime(closes, config));
}

export function createRegimePolicy(config=REGIME_CANDIDATES[1]) {
  validSettings(config);
  const c=Object.freeze({...config});
  return Object.freeze({
    id:c.id,
    config:c,
    decide({asset, history, btcHistory, units, observedThrough}) {
      if(!['BTC','ADA','AAVE'].includes(asset))fail('asset_not_supported');
      if(!Number.isFinite(units) || units<0)fail('invalid_units');
      const regime=classifyMarketRegime({btcHistory,observedThrough,config:c}).regime;
      const closes=closeHistory(history,observedThrough);
      if(regime==='UNKNOWN')return 'HOLD';
      if(regime==='SHOCK'||regime==='BEAR')return units>1e-12?'SELL':'HOLD';
      if(closes.length<Math.max(c.assetSlow,21))return 'HOLD';
      const last=closes.at(-1), fast=avg(closes.slice(-c.assetFast)), slow=avg(closes.slice(-c.assetSlow));
      const ret20=last/closes.at(-21)-1;
      // SIDEWAYS: protect deteriorating holdings; never create new alt positions.
      if(regime==='SIDEWAYS')return units>1e-12 && (last<slow||fast<slow)?'SELL':'HOLD';
      // BULL: require own asset momentum, not BTC market label alone.
      if(units<=1e-12 && last>slow && fast>slow && ret20>0)return 'BUY';
      if(units>1e-12 && (last<slow || fast<slow || ret20<-0.08))return 'SELL';
      return 'HOLD';
    }
  });
}
