// One-shot read-only CMC response-shape diagnostic. No API key, no
// arbitrary URL, no raw body or untrusted text in CI logs.
const requests=[
  {name:'v3_quotes_by_id',url:'https://pro-api.coinmarketcap.com/public-api/v3/cryptocurrency/quotes/latest?id=1%2C2010%2C7278&convert=USD'},
  {name:'v2_simple_by_id',url:'https://pro-api.coinmarketcap.com/public-api/v2/simple/price?id=1%2C2010%2C7278&convert=USD'}
];
const wanted=new Set(['1','2010','7278']);
function shape(value){
  const data=value?.data;
  const entries=Array.isArray(data)?data:(data&&typeof data==='object'?Object.entries(data).map(([key,val])=>({key,val})):[]);
  const found=[];
  const sampleFields=[];
  for(const entry of entries.slice(0,50)){
    const raw=entry.val??entry;
    if(!raw || typeof raw!=='object')continue;
    const id=String(raw.id??entry.key??'');
    if(wanted.has(id)){
      const key=raw.quote?.USD??raw.quote?.usd??(Array.isArray(raw.quote)?raw.quote.find(x=>x?.symbol==='USD'):null);
      const v=Number(raw.price??raw.price_usd??key?.price);
      found.push({id,positive_usd_price:Number.isFinite(v)&&v>0,quote_kind:Array.isArray(raw.quote)?'array':raw.quote!=null?'object':'absent'});
    }
    if(sampleFields.length===0) sampleFields.push(...Object.keys(raw).filter(x=>['id','symbol','price','price_usd','quote','last_updated','name'].includes(x)));
  }
  const direct=Array.isArray(value?.data)?'array':value?.data&&typeof value.data==='object'?'object':Array.isArray(value)?'top_level_array':'missing';
  return {envelope_kind:direct,top_level_keys:value&&!Array.isArray(value)&&typeof value==='object'?Object.keys(value).filter(x=>['status','data','error'].includes(x)):[],data_length:entries.length,fields:sampleFields,matched:found,status_error_code:(value?.status?.error_code!=null&&/^\\d{1,6}$/.test(String(value.status.error_code)))?String(value.status.error_code):null};
}
for(const request of requests){
  let res;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try{
    res=await fetch(request.url,{method:'GET',headers:{Accept:'application/json'},redirect:'error',signal:controller.signal});
    const reported={name:request.name,http_status:res.status};
    if(Number(res.headers.get('content-length')||0)>160000)throw Error('response_too_large');
    const data=await res.text();
    if(Buffer.byteLength(data)>160000)throw Error('response_too_large');
    if(res.ok){
      let value;try{value=JSON.parse(data)}catch{throw Error('invalid_json')}
      reported.shape=shape(value);
    }
    console.log('CMC_SHAPE_DIAGNOSTIC='+JSON.stringify(reported));
  }catch(error){
    const name=['AbortError','TypeError'].includes(error?.name)?error.name:'OtherError';
    console.log('CMC_SHAPE_DIAGNOSTIC='+JSON.stringify({name:request.name,error_kind:name}));
  }finally{clearTimeout(timeout);}
}
console.log('diagnostic_execution_enabled=false');
