// Explicit MCP protocol-era switch. 'legacy' uses initialize directly and
// skips the optional SDK v2 server/discover probe. Rollback to auto via env.
// No network, credentials, or trading functionality.
export function cmcMcpProtocolMode(env = {}) {
  return String(env.CMC_MCP_PROTOCOL_MODE || 'auto').trim().toLowerCase()==='legacy' ? 'legacy' : 'auto';
}
export const CMC_MCP_PROTOCOL_POLICY=Object.freeze({
  supported_modes:['legacy','auto'],
  paid_calls_permitted:0,
  trading_enabled:false
});
