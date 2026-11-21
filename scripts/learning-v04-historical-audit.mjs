// Offline, reproducible audit. See src/learning/historical-audit-v07.mjs.
//   node scripts/learning-v04-historical-audit.mjs --input=daily.json [--start=2021-01-01]
// Input: {"BTCUSDT":[{"t":<openTimeMs>,"c":<close>}, ...], ...}. No network, DB or broker.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { runAudit } from '../src/learning/historical-audit-v07.mjs';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const input = arg('input');
if (!input) { console.error('usage: --input=daily.json [--start=YYYY-MM-DD]'); process.exit(2); }
const raw = fs.readFileSync(input, 'utf8');
const report = runAudit(JSON.parse(raw), { startMs: Date.parse(arg('start') || '2021-01-01') });
report.inputSha256 = crypto.createHash('sha256').update(raw).digest('hex');
console.log(JSON.stringify(report, null, 2));
