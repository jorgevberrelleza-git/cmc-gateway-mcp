import assert from 'node:assert/strict';
import { validateShadowRuntimeConfig } from '../src/learning/runtime-config.mjs';
import { summarizeReasoningCost, buildRuntimeHealth } from '../src/learning/runtime-telemetry.mjs';

const safe = validateShadowRuntimeConfig({
  DATABASE_URL: 'postgresql://example',
  LEARNING_ASSETS: 'BTC,AAVE,ADA',
  LEARNING_CAPTURE_MS: '18000',
  LEARNING_INCLUDE_MICROSTRUCTURE: 'true',
  LEARNING_REASONING_ENABLED: 'false',
  LEARNING_REASONING_PROVIDER: 'disabled',
  LEARNING_MAX_RISK_PCT: '0.01',
  LEARNING_DEFAULT_RISK_PCT: '0.005',
  LEARNING_MAX_POSITION_PCT: '0.20',
  LEARNING_MAX_NEW_EXPOSURE_PCT: '0.10',
  LEARNING_PAPER_FEE_RATE: '0.001',
  LEARNING_PAPER_SLIPPAGE_BPS: '10'
});
assert.equal(safe.ready_for_shadow, true);
assert.equal(safe.normalized.execution_enabled, false);

const forbidden = validateShadowRuntimeConfig({
  DATABASE_URL: 'postgresql://example',
  LEARNING_REASONING_ENABLED: 'false',
  BITSO_API_SECRET: 'do-not-allow'
});
assert.equal(forbidden.ready_for_shadow, false);
assert.ok(forbidden.errors.includes('forbidden_shadow_runtime_secret:BITSO_API_SECRET'));

const dangerous = validateShadowRuntimeConfig({
  DATABASE_URL: 'postgresql://example',
  EXECUTION_ENABLED: 'true'
});
assert.equal(dangerous.ready_for_shadow, false);
assert.ok(dangerous.errors.includes('real_execution_flag_forbidden:EXECUTION_ENABLED'));

const overRisk = validateShadowRuntimeConfig({
  DATABASE_URL: 'postgresql://example',
  LEARNING_MAX_RISK_PCT: '0.02'
});
assert.equal(overRisk.ready_for_shadow, false);

const tooManyRetries = validateShadowRuntimeConfig({
  DATABASE_URL: 'postgresql://example',
  LEARNING_REASONING_MAX_ATTEMPTS: '9'
});
assert.equal(tooManyRetries.ready_for_shadow, false);
assert.ok(tooManyRetries.errors.includes('LEARNING_REASONING_MAX_ATTEMPTS_out_of_range'));

const openaiMissingSecrets = validateShadowRuntimeConfig({
  DATABASE_URL: 'postgresql://example',
  LEARNING_REASONING_ENABLED: 'true',
  LEARNING_REASONING_PROVIDER: 'openai_responses'
});
assert.equal(openaiMissingSecrets.ready_for_shadow, false);
assert.ok(openaiMissingSecrets.errors.includes('OPENAI_API_KEY_required_for_openai_reasoning'));
assert.ok(openaiMissingSecrets.errors.includes('LEARNING_REASONING_MODEL_required_for_openai_reasoning'));

const cost = summarizeReasoningCost([
  {
    usage: { input_tokens: 1000000, output_tokens: 500000 },
    response_payload: { provider_evidence: { web_search_used: true } }
  }
], {
  input_usd_per_million_tokens: 2,
  output_usd_per_million_tokens: 8,
  web_search_usd_per_call: 0.01
});
assert.equal(cost.estimated_usd, 6.01);

const now = new Date('2026-10-13T12:00:00Z');
const healthy = buildRuntimeHealth({
  now,
  latestSnapshot: { generated_at: '2026-10-13T11:00:00Z' },
  latestPortfolioMark: { marked_at: '2026-10-13T10:30:00Z' },
  queue: [],
  reasoningRuns: [],
  runtimeCycles: [{ started_at: '2026-10-13T11:00:00Z', completed_at: '2026-10-13T11:01:00Z', status: 'success', duration_ms: 60000 }]
});
assert.equal(healthy.healthy, true);

const unhealthy = buildRuntimeHealth({
  now,
  latestSnapshot: { generated_at: '2026-10-13T06:00:00Z' },
  latestPortfolioMark: null,
  queue: Array.from({ length: 11 }, (_, i) => ({ id: i, status: 'pending' })),
  reasoningRuns: [
    { status: 'error', started_at: '2026-10-13T11:00:00Z' },
    { status: 'error', started_at: '2026-10-13T10:00:00Z' },
    { status: 'error', started_at: '2026-10-13T09:00:00Z' }
  ],
  runtimeCycles: []
});
assert.equal(unhealthy.healthy, false);
assert.ok(unhealthy.blockers.includes('snapshot_stale_over_2_5h'));
assert.ok(unhealthy.blockers.includes('decision_queue_backlog'));
assert.ok(unhealthy.blockers.includes('reasoning_error_burst'));

console.log('learning-sprint5-selftest: ok');
