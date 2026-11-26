// Directional diagnostics only: signed observed returns do not predict a trade.
function round(value, places = 4) { return Number(value.toFixed(places)); }

function stats(values) {
  const sorted = [...values].sort((a,b) => a - b);
  const n = sorted.length;
  if (!n) return {
    n: 0, mean_signed_return_pct: null, median_signed_return_pct: null,
    positive_rate_pct: null, negative_rate_pct: null,
    mean_abs_return_pct: null, min_return_pct: null, max_return_pct: null
  };
  const middle = Math.floor(n / 2);
  const median = n % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return {
    n,
    mean_signed_return_pct: round(values.reduce((a,b)=>a+b,0)/n),
    median_signed_return_pct: round(median),
    positive_rate_pct: round(100*values.filter(x=>x>0).length/n,2),
    negative_rate_pct: round(100*values.filter(x=>x<0).length/n,2),
    mean_abs_return_pct: round(values.reduce((a,b)=>a+Math.abs(b),0)/n),
    min_return_pct: round(sorted[0]),
    max_return_pct: round(sorted[n-1])
  };
}

export function summarizeDirectionalCohorts(rows = []) {
  const buckets = { research_candidate: {}, filtered_context: {} };
  const uniqueEventIds = { research_candidate: new Set(), filtered_context: new Set() };
  for (const row of rows) {
    const cohort = row?.research_candidate === true ? 'research_candidate' : 'filtered_context';
    if (row?.snapshot_id != null) uniqueEventIds[cohort].add(String(row.snapshot_id));
    for (const [rawSymbol, data] of Object.entries(row?.assets || {})) {
      const symbol = String(rawSymbol).toUpperCase();
      if (!/^[A-Z0-9]{2,12}$/.test(symbol)) continue;
      if (data?.available !== true || typeof data?.return_pct !== 'number' || !Number.isFinite(data.return_pct)) continue;
      (buckets[cohort][symbol] ||= []).push(data.return_pct);
    }
  }
  return {
    contract_version: 'shadow_v0.2_signed_observations',
    mode: 'research_only_no_directional_trade_signal',
    cohorts: Object.fromEntries(
      Object.entries(buckets).map(([cohort, assets]) => [cohort, {
        independent_snapshot_count_upper_bound: uniqueEventIds[cohort].size,
        assets: Object.fromEntries(Object.entries(assets).sort(([a],[b])=>a.localeCompare(b))
          .map(([asset, values]) => [asset, stats(values)]))
      }])
    ),
    limitations: [
      'overlapping_horizons_and_events_not_independent',
      'selection_not_randomized',
      'signed_observations_not_directional_forecasts',
      'transaction_costs_not_included'
    ],
    execution_enabled: false
  };
}
