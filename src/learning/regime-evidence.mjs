function parseToolPayload(block) {
  if (block == null) return null;
  if (block?.structuredContent != null) return block.structuredContent;
  if (block?.content_json != null) return block.content_json;
  for (const item of block?.content || []) {
    if (item?.type !== 'text' || typeof item.text !== 'string') continue;
    try { return JSON.parse(item.text); } catch {}
  }
  return block && typeof block === 'object' && !Array.isArray(block) ? block : null;
}

function n(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseFloat(value.replace(/,/g, '').replace(/%/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function rows(table) {
  if (!table) return [];
  if (Array.isArray(table)) return table;
  if (Array.isArray(table.rows) && Array.isArray(table.headers)) {
    return table.rows.map(row => Object.fromEntries(table.headers.map((h, i) => [h, row?.[i]])));
  }
  return [];
}

function parseEventDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/.test(text)) {
    const noonUtc = Date.parse(`${text} 12:00:00 UTC`);
    if (Number.isFinite(noonUtc)) return noonUtc;
  }
  const direct = Date.parse(text);
  if (Number.isFinite(direct)) return direct;
  const utc = Date.parse(`${text} UTC`);
  return Number.isFinite(utc) ? utc : null;
}

function hoursFrom(nowMs, eventMs) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(eventMs)) return null;
  return (eventMs - nowMs) / 3_600_000;
}

export function buildRegimeEvidence(snapshot = {}, materialEvent = null) {
  const global = parseToolPayload(snapshot?.market?.global) || {};
  const technicals = parseToolPayload(snapshot?.market?.technicals) || {};
  const derivatives = parseToolPayload(snapshot?.market?.derivatives) || {};
  const eventsPayload = parseToolPayload(snapshot?.market?.events) || {};

  const marketCap24 = n(global?.market_size?.total_crypto_market_cap_usd?.percent_change?.['24h']);
  const spotVolume24 = n(global?.liquidity?.volume24h?.spot?.percent_change?.['24h']);
  const totalVolume24 = n(global?.liquidity?.volume24h?.total?.percent_change?.['24h']);
  const fearGreed = n(global?.sentiment?.fear_greed?.current?.index);
  const btcDominance = n(global?.rotation?.dominance?.btc?.current);
  const btcDominanceYesterday = n(global?.rotation?.dominance?.btc?.history?.yesterday);
  const marketRsi14 = n(technicals?.rsi?.rsi14);
  const oi24 = n(derivatives?.totalOpenInterest?.percentage_change_24h)
    ?? n(global?.leverage?.open_interest?.total?.percent_change?.['24h']);
  const fundingAcceleration24 = n(derivatives?.fundingRate?.percentage_change_24h);
  const fundingCurrent = n(derivatives?.fundingRate?.current)
    ?? n(global?.leverage?.funding_rate?.average?.current);

  let score = 0;
  if (marketCap24 != null) score += marketCap24 >= 1 ? 1 : marketCap24 <= -1 ? -1 : 0;
  if (marketRsi14 != null) score += marketRsi14 >= 55 ? 1 : marketRsi14 <= 45 ? -1 : 0;
  if (spotVolume24 != null && marketCap24 != null) {
    if (spotVolume24 > 10 && marketCap24 > 0) score += 1;
    if (spotVolume24 > 10 && marketCap24 < 0) score -= 1;
  }

  const cryptoRegime = score >= 2 ? 'favorable' : score <= -2 ? 'adverse' : 'neutral';
  const liquidity = spotVolume24 == null
    ? 'unknown'
    : spotVolume24 >= 10 ? 'expanding' : spotVolume24 <= -10 ? 'contracting' : 'stable';

  const leverageElevated = (oi24 != null && oi24 >= 10)
    || (fundingAcceleration24 != null && fundingAcceleration24 >= 100);

  const eventTable = eventsPayload?.upcomingEventNews || eventsPayload?.events || eventsPayload;
  const nowMs = Date.parse(snapshot?.generated_at || new Date().toISOString());
  const upcoming = rows(eventTable)
    .map(item => {
      const eventMs = parseEventDate(item?.eventDate || item?.date || item?.event_date);
      const delta = hoursFrom(nowMs, eventMs);
      return {
        title: item?.title || null,
        event_date: item?.eventDate || item?.date || item?.event_date || null,
        url: item?.url || null,
        hours_until: delta == null ? null : Number(delta.toFixed(2))
      };
    })
    .filter(x => x.hours_until != null && x.hours_until >= -6 && x.hours_until <= 72)
    .sort((a, b) => a.hours_until - b.hours_until);

  const within24 = upcoming.some(x => x.hours_until <= 24);
  const shockRisk = within24 ? 'high' : (upcoming.length || leverageElevated) ? 'medium' : 'low';

  const materialAssets = [...new Set((materialEvent?.reasons || [])
    .map(x => String(x).split(':')[0].toUpperCase())
    .filter(Boolean))];

  const macroPrimaryVerified = false;
  const primaryValidationRequired = upcoming.length > 0 || materialAssets.length > 0;

  const confidenceInputs = [
    marketCap24 != null,
    marketRsi14 != null,
    spotVolume24 != null,
    oi24 != null,
    fearGreed != null
  ];
  const coverage = confidenceInputs.filter(Boolean).length / confidenceInputs.length;
  const confidence = Math.max(20, Math.min(90, Math.round(coverage * 80 + (leverageElevated ? 0 : 5))));

  return {
    contract_version: 'regime_evidence_v0.2',
    observed_at: snapshot?.generated_at || null,
    crypto_regime: {
      classification: cryptoRegime,
      score,
      liquidity,
      shock_risk: shockRisk,
      confidence_0_100: confidence
    },
    market_evidence: {
      market_cap_change_24h_pct: marketCap24,
      spot_volume_change_24h_pct: spotVolume24,
      total_volume_change_24h_pct: totalVolume24,
      market_rsi14: marketRsi14,
      fear_greed_index: fearGreed,
      btc_dominance_pct: btcDominance,
      btc_dominance_change_vs_yesterday_pp:
        btcDominance != null && btcDominanceYesterday != null
          ? Number((btcDominance - btcDominanceYesterday).toFixed(2))
          : null,
      open_interest_change_24h_pct: oi24,
      funding_current: fundingCurrent,
      funding_change_24h_pct: fundingAcceleration24,
      leverage_elevated: leverageElevated
    },
    catalyst_gate: {
      upcoming_72h: upcoming,
      high_event_risk_within_24h: within24,
      primary_source_verified: macroPrimaryVerified,
      primary_validation_required: primaryValidationRequired,
      material_assets: materialAssets,
      policy: 'secondary_event_feed_can_trigger_research_but_cannot_authorize_position_change'
    },
    macro_gate: {
      classification: 'unverified',
      primary_source_verified: false,
      position_change_allowed: false,
      reason: 'deterministic_v0.2_has_no_primary_macro_attestation'
    }
  };
}
