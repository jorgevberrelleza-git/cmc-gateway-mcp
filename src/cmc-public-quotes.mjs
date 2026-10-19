import { extractLearningFeatures } from './learning/features.mjs';

const HOST='pro-api.coinmarketcap.com';
const URL_PATH='/public-api/v3/cryptocurrency/quotes/latest';
const MAX_BYTES=480000;
const MAX_IDS=5;

export function classifyCmcQuoteFailure(message='') {
 const value=String(message).toLowerCase();
 if(/429|rate.limit|too many|1008|quota|limit exceeded/.test(value))return 'rate_limited';
 if(/401|403|auth|unauthori|forbidden|invalid.key/.test(value))return 'authentication_or_entitlement';
 if(/timed? out|timeout|abort/.test(value))return 'timeout';
 if(/500|502|503|504|upstream|unavailable/.test(value))return 'upstream_unavailable';
 if(/tool.*not found|unknown tool|not supported/.test(value))return 'tool_unavailable';
 if(/invalid.argument|validation|schema/.test(value))return 'invalid_arguments';
 if(/network|fetch|transport|connect|session|socket/.test(value))return 'transport_error';
 return 'unclassified_upstream_error';
}

function cleanIds(ids) {
 if(!Array.isArray(ids)||ids.length===0||ids.length>MAX_IDS)throw new Error('cmc_public_invalid_id_count');
 const unique=[...new Set(ids.map(x=>String(x)))];
 if(unique.length>MAX_IDS||unique.some(x=>!/^[1-9][0-9]{0,11}$/.test(x)))throw new Error('cmc_public_invalid_id');
 return unique;
}
function statusProblem(value) {
 const st=value?.status;
 if(!st)return null;
 const code=Number(st.error_code??0);
 return Number.isFinite(code)&&code!==0?'cmc_public_api_status_error':null;
}
function isKnownUsdAsset(row) {
 const usd=row?.quote?.USD??row?.quote?.usd;
 const direct=row?.price_usd;
 const price=Number(usd?.price??direct);
 return Number.isFinite(price)&&price>0;
}
export function normalizeCmcPublicQuotesResponse(body,{assets=[],cmcIds={}}={}) {
 if(!body||typeof body!=='object'||body.status?.error_message && statusProblem(body))throw new Error('cmc_public_api_status_error');
 if(statusProblem(body))throw new Error('cmc_public_api_status_error');
 const raw=body.data;
 if(!raw||typeof raw!=='object')throw new Error('cmc_public_data_missing');
 const data=Array.isArray(raw)?raw:Object.values(raw);
 const expected=assets.map(s=>String(s).toUpperCase());
 const idToSymbol=Object.fromEntries(expected.map(s=>[String(cmcIds[s]),s]));
 const normalized=data.map(x=>{
   if(!x||typeof x!=='object')return null;
   const id=String(x.id??'');
   if(!Object.hasOwn(idToSymbol,id))return null;
   const symbol=idToSymbol[id];
   if(x.symbol!=null&&String(x.symbol).toUpperCase()!==symbol)return null;
   if(!isKnownUsdAsset(x))return null;
   return {...x,id,symbol};
 }).filter(Boolean);
 const covered=new Set(normalized.map(v=>v.symbol));
 if(expected.some(x=>!covered.has(x)))throw new Error('cmc_public_asset_coverage_incomplete');
 // If the public API delivers a different data layout later, fail closed.
 const candidate={assets:expected,cmc_ids:cmcIds,quotes:{structuredContent:{data:normalized}}};
 const parsed=extractLearningFeatures(candidate);
 if(expected.some(x=>!(Number(parsed.assets?.[x]?.price_usd)>0)))throw new Error('cmc_public_usd_parse_failed');
 return {isError:false,structuredContent:{data:normalized},quote_source:'cmc_public_v3_keyless'};
}
export async function fetchCmcPublicQuotes({assets,cmcIds,fetchImpl=globalThis.fetch,timeoutMs=9000}={}) {
 const names=(assets||[]).map(s=>String(s).toUpperCase());
 if(names.length===0||names.length>4||names.some(x=>!/^[A-Z0-9]{2,12}$/.test(x)))throw new Error('cmc_public_invalid_assets');
 const ids=cleanIds(names.map(x=>cmcIds?.[x]));
 const url=new URL('https://'+HOST+URL_PATH);
 url.searchParams.set('id',ids.join(','));
 url.searchParams.set('convert','USD');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),Math.max(1000,Math.min(timeoutMs,12000)));
 try{
   const res=await fetchImpl(url.toString(),{
     method:'GET',redirect:'error',signal:controller.signal,headers:{accept:'application/json'}
   });
   if(res.status===429)throw new Error('cmc_public_http_429');
   if(!res.ok)throw new Error('cmc_public_http_'+res.status);
   if(Number(res.headers?.get?.('content-length')||0)>MAX_BYTES)throw new Error('cmc_public_response_oversize');
   let raw='';
   if(res.body?.getReader){
     const reader=res.body.getReader(),decoder=new TextDecoder();let bytes=0;
     while(true){
       const {done,value}=await reader.read();
       if(done)break;
       bytes+=value?.byteLength||0;
       if(bytes>MAX_BYTES){await reader.cancel().catch(()=>{});throw new Error('cmc_public_response_oversize');}
       raw+=decoder.decode(value,{stream:true});
     }
     raw+=decoder.decode();
   }else{
     raw=await res.text();
     if(Buffer.byteLength(raw,'utf8')>MAX_BYTES)throw new Error('cmc_public_response_oversize');
   }
   let body;
   try{body=JSON.parse(raw);}catch{throw new Error('cmc_public_invalid_json');}
   return normalizeCmcPublicQuotesResponse(body,{assets:names,cmcIds});
 }finally{clearTimeout(timer);}
}
