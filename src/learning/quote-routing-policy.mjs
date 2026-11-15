// Read-only market-data source selection. No trades, credentials or hidden retries.
// The core learning cron uses independent data first, while on-demand CMC tools
// remain available as opt-in research, not mandatory hourly dependencies.
export const QUOTE_ROUTING_POLICY=Object.freeze({
  version:'quote_routing_v0.1',
  modes:['cmc_first','paprika_first'],
  paper_only:true,
  paid_calls_permitted:0,
  automatic_retries:0,
  execution_enabled:false
});
const REQUIRED=new Set(['BTC','ADA','AAVE']);
export function chooseQuoteRoute({mode='cmc_first',assets=[]}={}){
 if(!QUOTE_ROUTING_POLICY.modes.includes(mode))throw Error('quote_routing_invalid_mode');
 const a=Array.isArray(assets)?assets.map(s=>String(s).toUpperCase()):[];
 if(!a.length||a.length!==new Set(a).size)throw Error('quote_routing_duplicate_or_empty_assets');
 // CoinPaprika's audited identity guard requires exactly these three tickers.
 // Do not downgrade to CMC silently when a user switches the asset list.
 if(mode==='paprika_first'&&(a.length!==3||a.some(x=>!REQUIRED.has(x))))
   throw Error('quote_routing_paprika_requires_BTC_ADA_AAVE');
 return {mode,primary:mode==='paprika_first'?'coinpaprika_public':'cmc_mcp',
   cmc_allowed_only_if_primary_failed:mode==='paprika_first',
   independent_primary:mode==='paprika_first',
   paid_calls_permitted:0,execution_enabled:false,policy_version:QUOTE_ROUTING_POLICY.version};
}
export function sourceRouteSummary({route,primarySucceeded,primaryError=null,fallbackSource=null}={}){
 if(!route?.policy_version)throw Error('quote_routing_missing_route');
 return {policy_version:route.policy_version,mode:route.mode,
   primary:route.primary,primary_succeeded:primarySucceeded===true,
   primary_error_class:primaryError,
   cmc_deprioritized:route.independent_primary&&primarySucceeded===true,
   failover_source:fallbackSource,
   fallback_requires_primary_failure:route.cmc_allowed_only_if_primary_failed,
   orders_created:0,execution_enabled:false};
}
