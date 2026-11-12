import assert from 'node:assert/strict';
import {assessNodeRuntimeSecurity} from '../src/learning/node-runtime-security.mjs';
for(const [version,expected] of [
 ['v22.23.3','vulnerable'],['v22.23.4','patched'],
 ['v24.22.0','vulnerable'],['v24.22.1','patched'],
 ['v26.12.0','vulnerable'],['v26.12.1','patched'],
 ['v24.23.0','patched'],['v20.20.2','unsupported_or_eol'],
 ['v25.1.0','unsupported_or_eol'],['v27.0.0','unverified_major'],
 ['invalid','unknown']
]){
 const report=assessNodeRuntimeSecurity(version);
 assert.equal(report.status,expected,version);
 assert.equal(report.requires_attention,expected!=='patched',version);
 assert.equal(report.cve,'CVE-2026-111497');
 assert.equal(report.execution_enabled,false);
 assert.equal(report.external_calls_made,0);
 assert.equal(report.paid_ai_calls_made,0);
 assert.equal(JSON.stringify(report).includes('process.env'),false);
}
assert.equal(assessNodeRuntimeSecurity('v22.23.4').remediation,null);
assert.ok(assessNodeRuntimeSecurity('v22.23.3').remediation.includes('22.23.4'));
console.log('learning-node-security-selftest: ok');
