const DEFAULTS = Object.freeze({
  min_observations: 2,
  min_independent_families: 2,
  max_gap_hours: 12
});

function normalizedFamilies(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(x => String(x || '').trim().toLowerCase())
    .filter(Boolean))];
}

function hoursBetween(a, b) {
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.abs(y - x) / 3_600_000;
}

export function evaluateDefensivePersistence(observations = [], options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const killSwitch = options.kill_switch === true;
  const dailyCloseConfirmed = options.daily_close_confirmed === true;

  if (killSwitch) {
    return {
      confirmed: true,
      mode: 'kill_switch',
      observation_count: observations.length,
      common_families: [],
      reason: 'kill_switch_bypass'
    };
  }

  const normalized = (Array.isArray(observations) ? observations : [])
    .map(x => ({
      observed_at: x?.observed_at || null,
      families: normalizedFamilies(x?.evidence_families)
    }))
    .filter(x => x.observed_at && x.families.length >= cfg.min_independent_families)
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));

  const last = normalized.at(-1);
  if (!last) {
    return { confirmed: false, mode: 'insufficient', observation_count: 0, common_families: [], reason: 'no_multi_family_observation' };
  }

  if (dailyCloseConfirmed) {
    return {
      confirmed: true,
      mode: 'daily_close',
      observation_count: normalized.length,
      common_families: last.families,
      reason: 'daily_close_plus_multi_family_confirmation'
    };
  }

  if (normalized.length < cfg.min_observations) {
    return {
      confirmed: false,
      mode: 'insufficient',
      observation_count: normalized.length,
      common_families: last.families,
      reason: 'needs_second_separated_observation'
    };
  }

  const tail = normalized.slice(-cfg.min_observations);
  for (let i = 1; i < tail.length; i++) {
    const gap = hoursBetween(tail[i - 1].observed_at, tail[i].observed_at);
    if (gap == null || gap > cfg.max_gap_hours || gap === 0) {
      return {
        confirmed: false,
        mode: 'insufficient',
        observation_count: tail.length,
        common_families: [],
        reason: 'observations_not_properly_separated'
      };
    }
  }

  let common = new Set(tail[0].families);
  for (const item of tail.slice(1)) {
    common = new Set([...common].filter(f => item.families.includes(f)));
  }

  const commonFamilies = [...common];
  const confirmed = commonFamilies.length >= cfg.min_independent_families;
  return {
    confirmed,
    mode: confirmed ? 'multi_observation' : 'insufficient',
    observation_count: tail.length,
    common_families: commonFamilies,
    reason: confirmed ? 'persistent_multi_family_deterioration' : 'signal_families_did_not_persist'
  };
}
