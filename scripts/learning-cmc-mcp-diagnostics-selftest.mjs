import assert from 'node:assert/strict';
import {summarizeCmcThrownError} from '../src/cmc-public-quotes.mjs';
import {cmcMcpProtocolMode,CMC_MCP_PROTOCOL_POLICY} from '../src/learning/cmc-protocol-policy.mjs';
const secret='SECRET_SHOULD_NEVER_LEAK_66dc31';
const failure=Object.assign(new Error('401 Unauthorized '+secret),{
 name:'McpError',cmc_stage:'initialize',statusCode:401,
 cause:Object.assign(new TypeError('Sensitive token='+secret),{code:'ECONNRESET'})
});
const a=summarizeCmcThrownError(failure);
assert.equal(a.phase,'initialize');
assert.equal(a.http_status,401);
assert.equal(a.numeric_code,401);
assert.equal(a.category,'authentication_or_entitlement');
assert.equal(a.network_code,'ECONNRESET');
assert.equal(a.raw_error_retained,false);
assert.equal(JSON.stringify(a).includes(secret),false);
const discovered=Object.assign(new Error('error during tool list '+secret),{
  cmc_stage:'list_tools',response:{status:403}
});
const b=summarizeCmcThrownError(discovered);
assert.equal(b.phase,'list_tools');
assert.equal(b.http_status,403);
assert.equal(b.category,'authentication_or_entitlement');
assert.equal(JSON.stringify(b).includes(secret),false);
const transport=Object.assign(new Error('fetch failed '+secret),{
  cmc_stage:'call_tool',cause:Object.assign(new Error('reset '+secret),{code:'ETIMEDOUT'})
});
const c=summarizeCmcThrownError(transport);
assert.equal(c.phase,'call_tool');
assert.equal(c.network_code,'ETIMEDOUT');
assert.equal(c.category,'transport_error');
assert.equal(JSON.stringify(c).includes(secret),false);
const strange=Object.assign(new Error('undisclosed internal error'),{cmc_stage:'arbitrary_untrusted_text'});
assert.equal(summarizeCmcThrownError(strange).phase,'unknown');
assert.equal(cmcMcpProtocolMode({}),'auto');
assert.equal(cmcMcpProtocolMode({CMC_MCP_PROTOCOL_MODE:'legacy'}),'legacy');
assert.equal(cmcMcpProtocolMode({CMC_MCP_PROTOCOL_MODE:'LEGACY'}),'legacy');
assert.equal(cmcMcpProtocolMode({CMC_MCP_PROTOCOL_MODE:'untrusted-value'}),'auto');
assert.equal(CMC_MCP_PROTOCOL_POLICY.trading_enabled,false);
const negotiation=Object.assign(new Error('untrusted ERA '+secret),{
  cmc_stage:'initialize',name:'SdkError',code:'ERA_NEGOTIATION_FAILED'
});
const diag=summarizeCmcThrownError(negotiation);
assert.equal(diag.phase,'initialize');
assert.equal(diag.sdk_error_code,'ERA_NEGOTIATION_FAILED');
assert.equal(diag.exception_type,'SdkError');
assert.equal(JSON.stringify(diag).includes(secret),false);
const madeUp=Object.assign(new Error('secret '+secret),{
  name:'SdkError',code:'SENSITIVE_'+secret
});
assert.equal(summarizeCmcThrownError(madeUp).sdk_error_code,null);
console.log('learning-cmc-mcp-diagnostics-selftest: ok');
