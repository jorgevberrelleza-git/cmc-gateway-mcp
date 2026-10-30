// Shadow v0.4 research-only primitive. This module is intentionally disconnected
// from cron, ledgers, order execution and any network client.
// Family counting is NOT a risk-mode transition: persistence, price quality,
// shock verification and recovery are separate, future gates (issue #5).
export const RISK_EVIDENCE_V04 = Object.freeze({
  version: 'risk_evidence_v0.4_research',
  directional_families: Object.freeze(['structure', 'microstructure', 'fundamentals', 'macro']),
  execution_enabled: false,
  position_change_allowed: false
});

export function classifyRiskEvidence({asset, snapshotId, asOf, evidence = []} = {}) {
  const symbol = String(asset || '').toUpperCase();
  if (!['BTC', 'ADA', 'AAVE'].includes(symbol)) throw new Error('unsupported_asset');
  if (snapshotId == null || String(snapshotId).trim() === '') throw new Error('snapshot_id_required');
  const cutoff = Date.parse(asOf);
  if (!Number.isFinite(cutoff)) throw new Error('valid_as_of_required');
  if (!Array.isArray(evidence)) throw new Error('evidence_must_be_array');

  const accepted = new Map();
  const rejected = [];
  for (let index = 0; index < evidence.length; index++) {
    const item = evidence[index];
    const family = String(item?.family || '');
    const observed = Date.parse(item?.observed_at || '');
    let reason = null;
    if (!RISK_EVIDENCE_V04.directional_families.includes(family)) reason = 'non_directional_or_unknown_family';
    else if (!Number.isFinite(observed) || observed > cutoff) reason = 'missing_invalid_or_future_timestamp';
    else if (item.verified !== true || item.direction !== 'risk') reason = 'unverified_or_nonrisk_evidence';
    else if (typeof item.source !== 'string' || !item.source.trim()) reason = 'source_required';
    else if (family === 'macro' && item.primary_source !== true) reason = 'macro_primary_source_required';
    else if (family === 'fundamentals' && symbol !== 'AAVE') reason = 'fundamentals_not_applicable';
    else if (accepted.has(family)) reason = 'duplicate_family';
    if (reason) {
      rejected.push({index, family, reason});
      continue;
    }
    accepted.set(family, Object.freeze({
      family,
      observed_at: new Date(observed).toISOString(),
      source: item.source.trim()
    }));
  }
  const acceptedEvidence = [...accepted.values()];
  return {
    policy_version: RISK_EVIDENCE_V04.version,
    snapshot_id: String(snapshotId),
    asset: symbol,
    as_of: new Date(cutoff).toISOString(),
    accepted_evidence: acceptedEvidence,
    risk_families: acceptedEvidence.map(x => x.family),
    independent_risk_family_count: acceptedEvidence.length,
    rejected_evidence: rejected,
    // Two families in one snapshot never authorize DEFENSIVO or an order.
    mode: 'UNDETERMINED_PENDING_PERSISTENCE',
    state_transition_allowed: false,
    paper_fill_allowed: false,
    position_change_allowed: false,
    orders_created: 0,
    paid_ai_calls_made: 0,
    external_calls_made: 0,
    execution_enabled: false
  };
}
