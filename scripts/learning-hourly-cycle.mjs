import { spawnSync } from 'node:child_process';
import { validateShadowRuntimeConfig } from '../src/learning/runtime-config.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';
import { assessNodeRuntimeSecurity } from '../src/learning/node-runtime-security.mjs';

const config = validateShadowRuntimeConfig(process.env);
if (!config.ready_for_shadow) {
  console.error(JSON.stringify({
    ok: false,
    stage: 'configuration_preflight',
    errors: config.errors,
    warnings: config.warnings,
    execution_enabled: false
  }, null, 2));
  process.exit(2);
}

const steps = [
  ['collector', ['run', 'learning:collector']],
  ['shadow-v2-bootstrap', ['run', 'learning:v2:bootstrap']],
  ['shadow-v2', ['run', 'learning:v2:latest']],
  ['portfolio-seed', ['run', 'learning:portfolio:seed']],
  ['reasoner', ['run', 'learning:reasoner']],
  ['paper-fill', ['run', 'learning:paper:fill']],
  ['portfolio-mark', ['run', 'learning:portfolio:mark']],
  ['outcomes', ['run', 'learning:outcomes']],
  ['watchdog', ['run', 'learning:watchdog']],
  ['report', ['run', 'learning:report']]
];

const cycleStarted = new Date();
const results = [];
for (const [name, args] of steps) {
  const stepStarted = Date.now();
  const run = spawnSync('npm', args, { encoding: 'utf8', env: process.env });
  const durationMs = Date.now() - stepStarted;
  results.push({
    name,
    status: run.status,
    ok: run.status === 0,
    duration_ms: durationMs,
    stdout_tail: String(run.stdout || '').trim().slice(name === 'shadow-v2' ? -9000 : -2000),
    stderr_tail: String(run.stderr || '').trim().slice(-2000)
  });
  if (name === 'collector' && run.status !== 0) break;
}

const cycleCompleted = new Date();
const coreOk = results.every(x => x.ok);
const collectorOk = results.find(x => x.name === 'collector')?.ok === true;
const cycleStatus = coreOk ? 'success' : collectorOk ? 'partial' : 'error';
let telemetrySaved = false;
let telemetryError = null;

try {
  const store = createLearningStore();
  try {
    const row = await store.saveRuntimeCycle({
      cycleKey: `hourly:${cycleStarted.toISOString()}`,
      startedAt: cycleStarted.toISOString(),
      completedAt: cycleCompleted.toISOString(),
      status: cycleStatus,
      durationMs: cycleCompleted.getTime() - cycleStarted.getTime(),
      steps: results.map(x => ({
        name: x.name,
        status: x.status,
        ok: x.ok,
        duration_ms: x.duration_ms
      })),
      configFingerprint: config.config_fingerprint
    });
    telemetrySaved = Boolean(row);
  } finally {
    await store.close();
  }
} catch (error) {
  telemetryError = error?.message || String(error);
}

const ok = coreOk && telemetryError == null;

let v02OneShot = null;
if (String(process.env.LEARNING_V02_RUN_ONCE || '').toLowerCase() === 'true') {
  const run = spawnSync('npm', ['run', 'learning:v02:outcomes'], {
    encoding: 'utf8',
    env: { ...process.env, LEARNING_V02_OUTCOME_HOURS: process.env.LEARNING_V02_OUTCOME_HOURS || '96' }
  });
  v02OneShot = {
    attempted: true,
    status: run.status,
    ok: run.status === 0,
    stdout_tail: String(run.stdout || '').trim().slice(-12000),
    stderr_tail: String(run.stderr || '').trim().slice(-4000),
    execution_enabled: false
  };
}

/*
 * Lightweight daily research evidence. Runs inside the existing hourly cron
 * only at 00:15 UTC when explicitly enabled; never affects the core cycle,
 * calls external research, or places orders.
 */
let v02DailyReport = null;
if (String(process.env.LEARNING_V02_DAILY_REPORT || 'false').toLowerCase() === 'true'
    && cycleStarted.getUTCHours() === 0
    && v02OneShot == null) {
  const run = spawnSync('npm', ['run', 'learning:v02:outcomes'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      LEARNING_V02_OUTCOME_HOURS: process.env.LEARNING_V02_OUTCOME_HOURS || '96',
      LEARNING_V02_COMPACT_ONLY: 'true'
    }
  });
  const compactLine = String(run.stdout || '').split(/\r?\n/)
    .find(line => line.startsWith('V02_COMPACT_SUMMARY=')) || null;
  v02DailyReport = {
    attempted: true,
    ok: run.status === 0 && compactLine != null,
    status: run.status,
    compact_summary: compactLine ? compactLine.slice(0, 10500) : null,
    stderr_tail: String(run.stderr || '').trim().slice(-1500),
    execution_enabled: false
  };
}

/*
 * GEO intelligence runs in the existing cron every 3 hours when enabled.
 * It cannot change the core cycle outcome or create a trade. Any fetch/DB
 * failure is reported explicitly as a geo sidecar error.
 */
let geoScan = null;
if (String(process.env.LEARNING_GEO_ENABLED || 'false').toLowerCase() === 'true'
    && cycleStarted.getUTCHours() % 3 === 0
    && collectorOk) {
  const geo = spawnSync('npm', ['run','learning:geo:scan'],{
    encoding:'utf8',
    env:process.env,
    timeout:45000,
    maxBuffer:2*1024*1024
  });
  const compact = String(geo.stdout || '').split(/\r?\n/).find(x=>x.startsWith('GEO_COMPACT_SUMMARY='));
  geoScan = {
    attempted: true,
    ok:geo.status===0 && Boolean(compact),
    status:geo.status,
    compact_summary:compact ? compact.slice(0, 9000) : null,
    stderr_tail:String(geo.stderr || '').trim().slice(-1500),
    execution_enabled:false
  };
}

/* GEO v0.2 is an optional, read-only companion to the v0.1 scan. */
let geoV02Scan=null;
if (String(process.env.LEARNING_GEO_V02_ENABLED || 'false').toLowerCase()==='true'
    && geoScan?.attempted === true
    && collectorOk) {
  const run=spawnSync('npm',['run','learning:geo:v02:scan'],{
    encoding:'utf8',
    env:process.env,
    timeout:60000,
    maxBuffer:2*1024*1024
  });
  const line=String(run.stdout || '').split(/\r?\n/).find(x=>x.startsWith('GEO_V02_SUMMARY='))||null;
  geoV02Scan={
    attempted:true,
    ok:run.status===0&&Boolean(line),
    status:run.status,
    summary:line ? line.slice(0,14500) : null,
    stderr_tail:String(run.stderr||'').trim().slice(-1600),
    execution_enabled:false
  };
}

// Fixed 4h walk-forward benchmark, next-day sidecar only, no paid/market calls.
let walkforwardReport=null;
if (String(process.env.LEARNING_WALKFORWARD_REPORT_ENABLED||'false').toLowerCase()==='true'
    && cycleStarted.getUTCHours()===1 && collectorOk) {
  const r=spawnSync('npm',['run','learning:walkforward:report'],{
    encoding:'utf8',env:process.env,timeout:25000,maxBuffer:1024*1024
  });
  const line=String(r.stdout||'').split(/\r?\n/)
    .find(x=>x.startsWith('SHADOW_WALKFORWARD_SUMMARY='))||null;
  walkforwardReport={
    attempted:true,ok:r.status===0&&!!line,status:r.status,
    summary:line?line.slice(0,13000):null,
    stderr_tail:String(r.stderr||'').trim().slice(-800),
    position_change_allowed:false,execution_enabled:false
  };
}

// Official CMC skills marketplace playbook: once daily, read the stored
// evidence and select research priorities with ZERO additional network calls.
let skillsDaily=null;
if(String(process.env.LEARNING_SKILLS_DAILY_ENABLED||'false').toLowerCase()==='true'
    && cycleStarted.getUTCHours()===2 && collectorOk){
  const run=spawnSync('npm',['run','learning:skills:daily'],{
    encoding:'utf8',env:process.env,timeout:23000,maxBuffer:1024*1024
  });
  const line=String(run.stdout||'').split(/\r?\n/).find(x=>x.startsWith('SHADOW_SKILLS_DAILY='))||null;
  skillsDaily={
    attempted:true,ok:run.status===0&&Boolean(line),status:run.status,
    summary:line?line.slice(0,9000):null,
    stderr_tail:String(run.stderr||'').trim().slice(-450),
    external_calls_made:0,paid_ai_calls_made:0,execution_enabled:false
  };
}

// Daily evidence-only counterfactual: no trading or queue threshold changes.
let eventNoiseAudit=null;
if (String(process.env.LEARNING_EVENT_NOISE_AUDIT || 'false').toLowerCase()==='true'
    && cycleStarted.getUTCHours()===0 && collectorOk) {
  const run=spawnSync('npm',['run','learning:event:audit'],{
    encoding:'utf8',env:process.env,timeout:20000,maxBuffer:1024*1024
  });
  const line=String(run.stdout||'').split(/\r?\n/).find(x=>x.startsWith('SHADOW_EVENT_AUDIT='))||null;
  eventNoiseAudit={
    attempted:true,ok:run.status===0&&Boolean(line),status:run.status,
    summary:line?line.slice(0,5000):null,
    stderr_tail:String(run.stderr||'').trim().slice(-600),
    execution_enabled:false
  };
}

console.log(JSON.stringify({
  ok,
  cycle_status: cycleStatus,
  started_at: cycleStarted.toISOString(),
  completed_at: cycleCompleted.toISOString(),
  duration_ms: cycleCompleted.getTime() - cycleStarted.getTime(),
  config_warnings: config.warnings,
  node_runtime_security: assessNodeRuntimeSecurity(process.version),
  telemetry_saved: telemetrySaved,
  telemetry_error: telemetryError,
  steps: results,
  v02_one_shot: v02OneShot,
  v02_daily_report: v02DailyReport,
  geo_scan: geoScan,
  geo_scan_v02: geoV02Scan,
  event_noise_audit: eventNoiseAudit,
  walkforward_report: walkforwardReport,
  skills_daily: skillsDaily,
  execution_enabled: false
}, null, 2));
if (!ok) process.exitCode = 1;
