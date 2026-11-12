// Observe existing MCP SDK HTTP requests without sending ANY additional
// request. This fetch wrapper is passive: never record URLs, headers, request
// bodies, response bodies, credential material or raw exception messages.
const classifyKind=ct=>{
 const x=String(ct||'').toLowerCase();
 return x.includes('text/event-stream')?'sse':
  x.includes('application/json')?'json':x===''?'unknown':'other';
};
const boundedStatus=s=>Number.isInteger(s)&&s>=100&&s<=599?s:null;
export function createCmcHttpObserver(fetchImpl=globalThis.fetch) {
 if(typeof fetchImpl!=='function')throw Error('cmc_observer_fetch_required');
 const observation={post_status:null,post_response_kind:null,
  post_requests:0,get_requests:0,other_requests:0,fetch_exceptions:0};
 const observedFetch=async(input,init)=>{
  // Web fetch accepts a Request input or URL plus RequestInit.
  const method=String(init?.method??input?.method??'GET').toUpperCase();
  const field=method==='POST'?'post_requests':method==='GET'?'get_requests':'other_requests';
  observation[field]=Math.min(99,observation[field]+1);
  try{
   const response=await fetchImpl(input,init);
   if(method==='POST'){
    observation.post_status=boundedStatus(response?.status);
    observation.post_response_kind=classifyKind(response?.headers?.get?.('content-type'));
   }
   return response;
  }catch(error){
   observation.fetch_exceptions=Math.min(99,observation.fetch_exceptions+1);
   throw error;
  }
 };
 return {fetch:observedFetch,
  snapshot:()=>Object.freeze({...observation})};
}
export function attachCmcHttpObservation(error,observer){
 if(!error||typeof error!=='object')return error;
 const observation=observer?.snapshot?.();
 if(!observation)return error;
 for(const [key,value] of Object.entries(observation)){
  try{Object.defineProperty(error,'cmc_transport_'+key,{
    configurable:true,enumerable:false,value
  });}catch{}
 }
 return error;
}
