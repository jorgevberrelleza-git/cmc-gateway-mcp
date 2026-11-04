// Read-only runtime exposure check for Node.js CVE-2026-111497.
// Official advisory: https://nodejs.org/en/blog/vulnerability/october-2026-security-releases
// No network, credentials, trade actions, or changes to the runtime are made.
const PATCHED=Object.freeze({22:[22,23,4],24:[24,22,1],26:[26,12,1]});
function compare(v, min){for(let i=0;i<3;i++){if(v[i]>min[i])return 1;if(v[i]<min[i])return -1;}return 0;}
export function assessNodeRuntimeSecurity(input){
 const version=String(input??'').trim();
 const m=/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version);
 const base={contract_version:'shadow_node_runtime_security_v01',node_version:version||null,
   cve:'CVE-2026-111497',advisory:'https://nodejs.org/en/blog/vulnerability/october-2026-security-releases',
   patched_versions:['22.23.4','24.22.1','26.12.1'],execution_enabled:false,
   external_calls_made:0,paid_ai_calls_made:0};
 if(!m)return {...base,status:'unknown',requires_attention:true,reason:'unparseable_runtime_version'};
 const parts=m.slice(1,4).map(Number), major=parts[0];
 if(PATCHED[major]){
   const ok=compare(parts,PATCHED[major])>=0;
   return {...base,status:ok?'patched':'vulnerable',requires_attention:!ok,
     reason:ok?'at_or_above_security_patch':'below_security_patch',
     remediation:ok?null:`Upgrade Node.js ${major}.x to ${PATCHED[major].join('.')} or later in the same supported major.`};
 }
 if(major<26)return {...base,status:'unsupported_or_eol',requires_attention:true,
   reason:'major_not_in_current_supported_security_release_lines'};
 return {...base,status:'unverified_major',requires_attention:true,
   reason:'version_not_covered_by_this_2026_advisory'};
}
