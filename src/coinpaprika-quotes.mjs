import { extractLearningFeatures } from './learning/features.mjs';

// Fixed, audited ids: do not let news, prompts or user-supplied URLs drive fetch.
const IDS=Object.freeze({BTC:'btc-bitcoin',ADA:'ada-cardano',AAVE:'aave-new'});
const HOST='api.coinpaprika.com';
const MAX_BYTES=80000;
const MAX_AGE_MS=30*60*1000;

function fixedId(symbol){return IDS[String(symbol||'').toUpperCase()]||null;}
export function validateCoinPaprikaTicker(ticker,symbol,{now=new Date()}={}){
 const s=String(symbol||'').toUpperCase(),id=fixedId(s);
 if(!id)throw new Error('paprika_unsupported_asset');
 if(!ticker||typeof ticker!=='object'||ticker.id!==id||String(ticker.symbol||'').toUpperCase()!==s)
   throw new Error('paprika_identity_mismatch');
 const updated=Date.parse(ticker.last_updated||'');
 if(!Number.isFinite(updated)||updated>+now+2*60000||+now-updated>MAX_AGE_MS)
   throw new Error('paprika_stale_quote');
 const quote=ticker.quotes?.USD;
 const price=Number(quote?.price);
 if(!(Number.isFinite(price)&&price>0))throw new Error('paprika_usd_price_missing');
 // Preserve source timestamp and relevant CMC-compatible change columns.
 return {
   id, symbol:s,price,
   price_source:'coinpaprika_public',
   source_updated_at:new Date(updated).toISOString(),
   percent_change_1h:Number.isFinite(Number(quote.percent_change_1h))?Number(quote.percent_change_1h):null,
   percent_change_24h:Number.isFinite(Number(quote.percent_change_24h))?Number(quote.percent_change_24h):null,
   percent_change_7d:Number.isFinite(Number(quote.percent_change_7d))?Number(quote.percent_change_7d):null,
   quote_symbol:'USD'
 };
}
async function getTicker(symbol,{fetchImpl=globalThis.fetch,now=new Date()}={}){
 const id=fixedId(symbol);
 if(!id)throw new Error('paprika_unsupported_asset');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),9500);
 try {
  const res=await fetchImpl('https://'+HOST+'/v1/tickers/'+id,{method:'GET',redirect:'error',signal:controller.signal,headers:{accept:'application/json'}});
  if(!res.ok)throw new Error('paprika_http_'+res.status);
  if(Number(res.headers?.get?.('content-length')||0)>MAX_BYTES)throw new Error('paprika_response_oversize');
  let raw='';
  if(res.body?.getReader){
    const reader=res.body.getReader(),decoder=new TextDecoder();let bytes=0;
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value?.byteLength||0;
      if(bytes>MAX_BYTES){await reader.cancel().catch(()=>{});throw new Error('paprika_response_oversize');}
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }else{
    raw=await res.text();
    if(Buffer.byteLength(raw,'utf8')>MAX_BYTES)throw new Error('paprika_response_oversize');
  }
  let parsed;
  try{parsed=JSON.parse(raw)}catch{throw new Error('paprika_invalid_json');}
  return validateCoinPaprikaTicker(parsed,symbol,{now});
 }finally{clearTimeout(timer);}
}
export async function fetchCoinPaprikaQuotes({assets=['BTC','ADA','AAVE'],fetchImpl=globalThis.fetch,now=new Date()}={}){
 const selected=(assets||[]).map(s=>String(s).toUpperCase());
 if(selected.length!==3||new Set(selected).size!==3||selected.some(s=>!fixedId(s)))
   throw new Error('paprika_strict_asset_list_required');
 // 3 calls max, only after CMC MCP + keyless failure. No retries or extra runtime.
 const results=await Promise.allSettled(selected.map(s=>getTicker(s,{fetchImpl,now})));
 const errors=results.filter(x=>x.status==='rejected');
 if(errors.length) {
  const message=String(errors[0].reason?.message||'');
  const known=/^paprika_[a-z0-9_]+$/.test(message)?message:'paprika_network_unavailable';
  throw new Error(known);
 }
 const rows=results.map(x=>x.value);
 const output={isError:false,structuredContent:{headers:[
  'id','symbol','price','price_source','source_updated_at',
  'percent_change_1h','percent_change_24h','percent_change_7d','quote_symbol'
 ],rows:rows.map(x=>[x.id,x.symbol,x.price,x.price_source,x.source_updated_at,
 x.percent_change_1h,x.percent_change_24h,x.percent_change_7d,x.quote_symbol])},
 quote_source:'coinpaprika_public'};
 const parsed=extractLearningFeatures({assets:selected,quotes:output});
 if(selected.some(s=>!(Number(parsed.assets?.[s]?.price_usd)>0)))throw new Error('paprika_normalization_failed');
 return output;
}
