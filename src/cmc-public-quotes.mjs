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

export function summarizeCmcMcpFailure(result) {
  // Diagnostic is intentionally allowlisted: NEVER persist arbitrary
  // upstream error messages, request headers or API-key fragments.
  const structured=result?.structuredContent;
  const texts=Array.isArray(result?.content)
    ? result.content.filter(x=>x?.type==='text' && typeof x?.text==='string').map(x=>x.text.slice(0,2500))
    : [];
  let machineCode=null;
  for(const candidate of [
    structured?.status?.error_code,
    structured?.error?.code,
    structured?.error_code,
    structured?.code
  ]){
    const n=Number(candidate);
    if(candidate!=null && Number.isInteger(n) && n>=0 && n<=100000) {
      machineCode=n;break;
    }
  }
  if(machineCode==null){
    for(const part of texts){
      const found=/(?:error_code|status_code)["']?\\s*[:=]\\s*["']?(\\d{3,5})/i.exec(part);
      if(found){machineCode=Number(found[1]);break;}
    }
  }
  const category=classifyCmcQuoteFailure([
    ...texts,
    structured?.error?.message,
    structured?.status?.error_message,
    machineCode==null?'':String(machineCode)
  ].filter(Boolean).join(' ').slice(0,4000));
  return {
    category,
    numeric_code:machineCode,
    has_structured_content:structured!=null,
    text_blocks_present:texts.length,
    upstream_result_error:result?.isError===true,
    raw_error_retained:false
  };
}

export function summarizeCmcThrownError(error) {
  // Only allowlisted machine diagnostics may be saved. In particular, never
  // serialize error.message, cause.message, headers, response bodies or URLs.
  const safeStages=new Set(['initialize','list_tools','call_tool','unknown']);
  const stage=safeStages.has(error?.cmc_stage)?error.cmc_stage:'unknown';
  const root=error?.cause&&typeof error.cause==='object'?error.cause:null;
  const name=String(error?.name||'');
  const codeCandidate=error?.code??error?.statusCode??error?.status??error?.response?.status
    ??root?.code??root?.statusCode??root?.status??root?.response?.status??null;
  const code=typeof codeCandidate==='number'||typeof codeCandidate==='string'?Number(codeCandidate):NaN;
  const numeric=Number.isInteger(code)&&code>=-32768&&code<=100000?code:null;
  const statusCandidate=error?.statusCode??error?.status??error?.response?.status
    ??root?.statusCode??root?.status??root?.response?.status;
  const statusNumber=Number(statusCandidate);
  const httpStatus=Number.isInteger(statusNumber)&&statusNumber>=400&&statusNumber<=599?statusNumber:null;
  const safeNetworkCodes=new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT']);
  const networkCode=[error?.code,root?.code].find(v=>safeNetworkCodes.has(v))||null;
  const rootName=String(root?.name||'');
  const safeName=v=>['McpError','TimeoutError','AbortError','TypeError','Error','ResponseError'].includes(v)?v:'other';
  const observedMessage=String(error?.message||'').slice(0,1500);
  const category=classifyCmcQuoteFailure([
    observedMessage,String(root?.message||'').slice(0,500),
    numeric==null?'':String(numeric),httpStatus==null?'':String(httpStatus),
    networkCode||''
  ].filter(Boolean).join(' '));
  return {
    category,
    numeric_code:numeric,
    http_status:httpStatus,
    network_code:networkCode,
    phase:stage,
    exception_type:safeName(name),
    cause_type:root?safeName(rootName):null,
    thrown_error:true,
    raw_error_retained:false
  };
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
 const quotes=row?.quote;
 const usd=Array.isArray(quotes)
   ? quotes.find(x=>String(x?.symbol||x?.convert_symbol||'').toUpperCase()==='USD')
   : (quotes?.USD??quotes?.usd??(String(quotes?.symbol||'').toUpperCase()==='USD'?quotes:null));
 // v3 emits quote as an array of quote-currency objects; do not drop all
 // assets when encountering the official array representation. Never use EUR.
 const direct=row?.price_usd;
 const price=Number(usd?.price??direct);
 return (usd?.price!=null||direct!=null)&&Number.isFinite(price)&&price>0;
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
