import { extractLearningFeatures } from './features.mjs';
import { unpackMcp, finiteNumber, assessDataConsistency } from './data-consistency.mjs';
import { evaluateNewsCatalystGate } from './news-catalyst-gate.mjs';

export function buildRegimeEvidencePacket(snapshot = {}, options = {}) {
  const global = unpackMcp(snapshot.market?.global) || {};
  const cap7 = finiteNumber(global.market_size?.total_crypto_market_cap_usd?.percent_change?.['7d']);
  const spot24 = finiteNumber(global.liquidity?.volume24h?.spot?.percent_change?.['24h']);
  const oi24 = finiteNumber(global.leverage?.open_interest?.total?.percent_change?.['24h']);
  const fear = finiteNumber(global.sentiment?.fear_greed?.current?.index);
  const quality = assessDataConsistency(snapshot, { referenceTime: options.referenceTime || snapshot.generated_at });
  const news = evaluateNewsCatalystGate(snapshot, { referenceTime: options.referenceTime || snapshot.generated_at });
  let regime = 'unknown';
  if ([cap7, spot24, oi24].every(x => x != null)) {
    regime = 'neutral';
    if (cap7 <= -3 && oi24 >= 5) regime = 'cautious_leveraged';
    else if (cap7 >= 3 && spot24 > 0 && oi24 < 10) regime = 'risk_on_confirming';
    else if (cap7 <= -5 && spot24 < 0) regime = 'risk_off';
  }
  return {
    contract_version: 'regime_evidence_packet_v0.2',
    generated_at: snapshot.generated_at ?? null,
    global_regime: { classification: 'unknown', verification: 'unverified' },
    crypto_regime: { classification: regime, cap_7d_pct: cap7, spot_24h_pct: spot24, oi_24h_pct: oi24, fear_greed: fear },
    assets: extractLearningFeatures(snapshot).assets,
    data_consistency: quality,
    news_catalyst_gate: news,
    decision_gate: { eligible_for_exposure_change: false, reason: 'primary_macro_attestation_missing' },
    execution_enabled: false
  };
}
