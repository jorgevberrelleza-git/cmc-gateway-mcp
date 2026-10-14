import { buildReasoningPacket } from './reasoning-packet.mjs';
import { buildRegimeEvidencePacket } from './regime-evidence.mjs';

export function buildReasoningPacketV02(input = {}) {
  const base = buildReasoningPacket(input);
  const evidence = buildRegimeEvidencePacket(input.snapshotRow?.payload || {}, {
    portfolio: input.latestPortfolioMark,
    referenceTime: input.snapshotRow?.generated_at
  });
  return {
    ...base,
    contract_version: 'reasoning_packet_v0.2',
    market: { ...base.market, regime_evidence: evidence },
    policy: { ...base.policy, unverified_macro_blocks_exposure_change: true }
  };
}
