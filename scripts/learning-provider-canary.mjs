import { createReasoningProvider } from '../src/learning/reasoning-provider.mjs';
import { sanitizeReasoningPacketForProvider } from '../src/learning/reasoning-packet.mjs';

const providerName = String(process.env.LEARNING_CANARY_PROVIDER || 'mock').toLowerCase();
const allowNetwork = String(process.env.LEARNING_CANARY_ALLOW_NETWORK || 'false').toLowerCase() === 'true';
if (providerName === 'openai_responses' && !allowNetwork) {
  throw new Error('openai_canary_requires_LEARNING_CANARY_ALLOW_NETWORK=true');
}

const observedAt = new Date().toISOString();
const packet = sanitizeReasoningPacketForProvider({
  contract_version: 'reasoning_packet_v0.1',
  queue: { id: 0, queue_key: 'canary', priority: 50, created_at: observedAt, material_event: { material: true, reasons: ['BTC:spot_delta_20'] } },
  market: {
    current_snapshot_id: 0,
    generated_at: observedAt,
    snapshot_version: 'canary',
    current_features: {
      generated_at: observedAt,
      assets: {
        BTC: { price_usd: 80000, pct_24h: 0, spot_confirmation: 70, trap_risk: 30 }
      }
    },
    recent_observations: []
  },
  portfolio: {
    total_value_usd: 10000,
    cash_usd: 3000,
    positions: { BTC: { quantity: 0.0875, value_usd: 7000 } },
    shadow_return_pct: 0,
    hodl_return_pct: 0,
    alpha_vs_hodl_pct: 0,
    drawdown_pct: 0
  },
  recent_decisions: [],
  watchdog: [],
  deterministic_persistence_by_asset: {
    BTC: { confirmed: false, mode: 'insufficient', observation_count: 1, common_families: ['microstructure'], reason: 'canary' }
  },
  policy: { shadow_only: true, execution_enabled: false }
});

const provider = createReasoningProvider({ provider: providerName });
const started = Date.now();
const result = await provider.reason(packet);
const durationMs = Date.now() - started;
const proposals = Array.isArray(result?.output?.proposals) ? result.output.proposals : [];

console.log(JSON.stringify({
  ok: proposals.length > 0 || result?.skipped === true,
  provider: provider.name,
  model: provider.model,
  duration_ms: durationMs,
  proposals: proposals.map(x => ({ asset: x.asset, action: x.action })),
  usage: result?.usage ?? null,
  evidence: result?.evidence ?? null,
  execution_enabled: false
}, null, 2));
