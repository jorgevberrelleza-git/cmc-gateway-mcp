const ALLOWED_KINDS = new Set(['primary','official','regulator','issuer','exchange','central_bank']);

function safeHttps(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

export function buildSelectiveResearchRequest({ evaluation, outcomeEvidence = null, assets = [] } = {}) {
  const quality = evaluation?.event_quality || {};
  const catalyst = evaluation?.regime_evidence?.news_catalyst_gate || {};
  const shouldResearch = quality.research_candidate === true
    || catalyst.near_term_catalyst_risk === 'elevated_unverified'
    || outcomeEvidence?.historical_precision_support === true;

  return {
    contract_version: 'selective_research_request_v0.2',
    research_required: shouldResearch,
    assets: [...new Set((assets || []).map(x => String(x).toUpperCase()).filter(Boolean))],
    topics: shouldResearch ? [
      'primary_macro_catalysts',
      'regulatory_or_policy_changes',
      'institutional_flow_context',
      'asset_specific_material_news'
    ] : [],
    source_policy: {
      minimum_sources: 2,
      minimum_primary_sources: 1,
      allowed_primary_kinds: [...ALLOWED_KINDS],
      aggregator_only_is_insufficient: true
    },
    cache_policy: { mode: 'shared', max_age_hours: 12 },
    budget_policy: {
      trigger_only_on_research_candidate: true,
      paid_ai_default: false,
      external_fetch_default: false
    },
    execution_enabled: false
  };
}

export function attestResearchBundle(bundle = {}, { referenceTime = new Date().toISOString(), maxAgeHours = 12 } = {}) {
  const now = Date.parse(referenceTime);
  const fetched = Date.parse(bundle?.fetched_at || '');
  const ageHours = Number.isFinite(now) && Number.isFinite(fetched) ? (now - fetched) / 3600000 : null;
  const sources = Array.isArray(bundle?.sources) ? bundle.sources : [];
  const valid = sources.filter(s => s?.fetched_ok === true && safeHttps(s?.url));
  const primary = valid.filter(s => ALLOWED_KINDS.has(String(s?.kind || '').toLowerCase()));
  const fresh = ageHours != null && ageHours >= 0 && ageHours <= maxAgeHours;
  const attested = bundle?.verified_by === 'authoritative_fetch'
    && bundle?.provider_attested === true
    && valid.length >= 2
    && primary.length >= 1
    && fresh;
  return {
    contract_version: 'research_attestation_v0.2',
    attested,
    valid_source_count: valid.length,
    primary_source_count: primary.length,
    age_hours: ageHours == null ? null : Number(ageHours.toFixed(2)),
    exposure_change_allowed: attested,
    reason: attested ? 'authoritative_research_attested' : 'insufficient_authoritative_research',
    execution_enabled: false
  };
}
