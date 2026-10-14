import { extractLearningFeatures } from './features.mjs';
import { unpackMcp, finiteNumber, assessDataConsistency } from './data-consistency.mjs';
import { evaluateNewsCatalystGate } from './news-catalyst-gate.mjs';
import { attestResearchBundle } from './research-gate-v02.mjs';

export function buildRegimeEvidencePacket(snapshot = {}, options = {}) {
  const global = unpackMcp(snapshot.market?.global) || {};
  const cap7 = finiteNumber(global.market_size?.total_crypto_market_cap_usd?.percent_change?.['7d']);
  const spot24 = finiteNumber(global.liquidity?.volume24h?.spot?.percent_change?.['24h']);
  const oi24 = finiteNumber(global.leverage?.open_interest?.total?.percent_change?.['24h']);
  const fear = finiteNumber(global.sentiment?.fear_greed?.current?.index);
  const referenceTime = options.referenceTime || snapshot.generated_at;
  const quality = assessDataConsistency(snapshot, { referenceTime });
  const researchAttestation = attestResearchBundle(options.verifiedResearch || {}, { referenceTime });
  const news = evaluateNewsCatalystGate(snapshot, {
    referenceTime,
    proposedAction: options.proposedAction || 'HOLD',
    verifiedResearch: options.verifiedResearch || null
  });
  let regime = 'unknown';
  if ([cap7, spot24, oi24].every(x => x != null)) {
    regime = 'neutral';
    if (cap7 <= -3 && oi24 >= 5) regime = 'cautious_leveraged';
    else if (cap7 >= 3 && spot24 > 0 && oi24 < 10) regime = 'risk_on_confirming';
    else if (cap7 <= -5 && spot24 < 0) regime = 'risk_off';
  }
  const exposureEligible = quality.position_change_allowed === true && researchAttestation.attested === true;
  return {
    contract_version: 'regime_evidence_packet_v0.2',
    generated_at: snapshot.generated_at ?? null,
    global_regime: {
      classification: researchAttestation.attested ? 'externally_attested_context' : 'unknown',
      verification: researchAttestation.attested ? 'attested' : 'unverified'
    },
    crypto_regime: { classification: regime, cap_7d_pct: cap7, spot_24h_pct: spot24, oi_24h_pct: oi24, fear_greed: fear },
    assets: extractLearningFeatures(snapshot).assets,
    data_consistency: quality,
    news_catalyst_gate: news,
    research_attestation: researchAttestation,
    decision_gate: {
      eligible_for_exposure_change: exposureEligible,
      reason: exposureEligible
        ? 'data_clean_and_primary_macro_attested'
        : (quality.position_change_allowed !== true ? 'data_consistency_not_clean' : 'primary_macro_attestation_missing')
    },
    execution_enabled: false
  };
}
