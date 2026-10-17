import { spawnSync } from 'node:child_process';
import { validateShadowRuntimeConfig } from '../src/learning/runtime-config.mjs';
import { createLearningStore } from '../src/learning/storage.mjs';

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
    stdout_tail: String(run.stdout || '').trim().slice(-2000),
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

console.log(JSON.stringify({
  ok,
  cycle_status: cycleStatus,
  started_at: cycleStarted.toISOString(),
  completed_at: cycleCompleted.toISOString(),
  duration_ms: cycleCompleted.getTime() - cycleStarted.getTime(),
  config_warnings: config.warnings,
  telemetry_saved: telemetrySaved,
  telemetry_error: telemetryError,
  steps: results,
  v02_one_shot: v02OneShot,
  execution_enabled: false
}, null, 2));
if (!ok) process.exitCode = 1;
