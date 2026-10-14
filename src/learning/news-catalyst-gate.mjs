import { unpackMcp } from './data-consistency.mjs';

function isoDate(value) {
  const t = Date.parse(String(value || ''));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function eventRows(snapshot) {
  const raw = unpackMcp(snapshot?.market?.events);
  const table = raw?.upcomingEventNews;
  if (!Array.isArray(table?.headers) || !Array.isArray(table?.rows)) return [];
  return table.rows.map(row => Object.fromEntries(table.headers.map((h, i) => [h, row?.[i]])));
}

function safeUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

export function evaluateNewsCatalystGate(snapshot = {}, {
  referenceTime = snapshot?.generated_at,
  windowHours = 48,
  proposedAction = 'HOLD',
  verifiedResearch = null,
  maxResearchAgeHours = 12
} = {}) {
  const now = Date.parse(referenceTime || '');
  const action = String(proposedAction || 'HOLD').toUpperCase();
  const positionChanging = action !== 'HOLD';
  const upcoming = [];
  if (Number.isFinite(now)) {
    for (const row of eventRows(snapshot)) {
      const at = isoDate(row.eventDate);
      if (!at) continue;
      const hours = (Date.parse(at) - now) / 3600000;
      if (hours < -24 || hours > windowHours) continue;
      upcoming.push({
        title: String(row.title || '').slice(0, 140),
        event_date: at,
        hours_to_event: Math.round(hours * 10) / 10,
        discovery_url: safeUrl(row.url),
        source_status: 'unverified_aggregator'
      });
    }
  }
  upcoming.sort((a, b) => Math.abs(a.hours_to_event) - Math.abs(b.hours_to_event));
  const nearTerm = upcoming.some(e => e.hours_to_event >= -4 && e.hours_to_event <= 24);

  // Research is a separate, budget-gated adapter. Never equate a headline URL
  // or a self-reported 'verified' field with independently attested evidence.
  const ageHours = verifiedResearch?.fetched_at && Number.isFinite(now)
    ? (now - Date.parse(verifiedResearch.fetched_at)) / 3600000 : null;
  const attested = verifiedResearch?.verified_by === 'authoritative_fetch'
    && verifiedResearch?.provider_attested === true
    && Array.isArray(verifiedResearch?.sources)
    && verifiedResearch.sources.filter(s => s?.fetched_ok === true && safeUrl(s?.url)).length >= 2
    && verifiedResearch.sources.some(s => s?.fetched_ok === true && s?.kind === 'primary' && safeUrl(s?.url))
    && ageHours != null && ageHours >= 0 && ageHours <= maxResearchAgeHours;

  const researchRequired = positionChanging || nearTerm;
  return {
    contract_version: 'news_catalyst_gate_v0.2',
    upcoming_events: upcoming.slice(0, 6),
    near_term_catalyst_risk: nearTerm ? 'elevated_unverified' : (upcoming.length ? 'scheduled_unverified' : 'unknown'),
    research_triggered: researchRequired,
    research_mode: 'on_demand_shared_cache_only',
    primary_source_verification: attested ? 'attested' : 'unverified',
    position_change_allowed: positionChanging ? Boolean(attested) : true,
    reason: positionChanging && !attested ? 'primary_news_verification_required' : (nearTerm && !attested ? 'scheduled_event_requires_verification' : 'no_news_block_for_hold'),
    // This module never initiates a network request or spends tokens.
    external_calls_made: 0,
    execution_enabled: false
  };
}
