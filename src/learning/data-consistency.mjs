// Shadow v0.2: read-only quality checks. Never invent a missing metric.
export function unpackMcp(block) {
  if (block == null) return null;
  if (block.isError === true) return null;
  if (block.structuredContent != null) return block.structuredContent;
  if (Array.isArray(block.content)) {
    const text = block.content.find(item => item?.type === 'text')?.text;
    if (typeof text === 'string') {
      try { return JSON.parse(text); } catch { return null; }
    }
  }
  return block;
}

export function finiteNumber(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/,/g, '').replace(/%$/, '');
  const match = cleaned.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(?:\s*([KMBT]))?$/i);
  if (!match) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  const n = Number(match[1]) * (scale[match[2]?.toUpperCase()] || 1);
  return Number.isFinite(n) ? n : null;
}

function validTime(t) {
  const ms = Date.parse(t || '');
  return Number.isFinite(ms) ? ms : null;
}

function addIssue(issues, code, severity, detail) {
  issues.push({ code, severity, detail });
}

export function assessDataConsistency(snapshot = {}, {
  maxSnapshotAgeMinutes = 120,
  maxAssetQuoteAgeMinutes = 120,
  maxVenueBasisBps = 150,
  referenceTime = snapshot?.generated_at
} = {}) {
  const issues = [];
  const snapshotAt = validTime(snapshot?.generated_at);
  const referenceAt = validTime(referenceTime);
  if (snapshotAt == null) addIssue(issues, 'missing_snapshot_timestamp', 'block', 'generated_at absent/invalid');
  if (referenceAt != null && snapshotAt != null && (snapshotAt > referenceAt + 120000 || referenceAt - snapshotAt > maxSnapshotAgeMinutes * 60000)) {
    addIssue(issues, 'stale_or_future_snapshot', 'block', 'snapshot time outside configured window');
  }
  const market = snapshot?.market || {};
  for (const key of ['global','technicals','derivatives','narratives','events']) {
    if (market[key]?.isError === true) addIssue(issues, 'source_error_' + key, 'warning', 'provider reported error');
  }
  if (snapshot?.quotes?.isError === true) addIssue(issues, 'quotes_provider_error', 'block', 'asset quotes unavailable');
  const global = unpackMcp(market.global) || {};
  const total = finiteNumber(global?.liquidity?.volume24h?.total?.current);
  const spot = finiteNumber(global?.liquidity?.volume24h?.spot?.current);
  if (total != null && spot != null && total > 0 && spot > total * 1.05) {
    addIssue(issues, 'market_volume_scope_inconsistent', 'warning', 'reported spot volume exceeds reported total; definitions may differ');
  }
  const specialized = unpackMcp(market.derivatives) || {};
  const globalOiPct = finiteNumber(global?.leverage?.open_interest?.total?.percent_change?.['24h']);
  const specializedOiPct = finiteNumber(specialized?.totalOpenInterest?.percentage_change_24h);
  if (globalOiPct != null && specializedOiPct != null && Math.abs(globalOiPct - specializedOiPct) >= 8) {
    addIssue(issues, 'open_interest_24h_scope_conflict', 'warning', 'OI growth differs across providers/definitions; not directly comparable without scope');
  }
  const globalOi = finiteNumber(global?.leverage?.open_interest?.total?.current);
  const specializedOi = finiteNumber(specialized?.totalOpenInterest?.current);
  if (globalOi != null && specializedOi != null && Math.abs(globalOi - specializedOi) / Math.max(globalOi, specializedOi) > 0.2) {
    addIssue(issues, 'open_interest_notional_conflict', 'warning', 'OI notional differs by >20%; scope unverified');
  }

  const quotes = unpackMcp(snapshot?.quotes);
  const quoteMap = {};
  if (Array.isArray(quotes?.headers) && Array.isArray(quotes?.rows)) {
    const headers = quotes.headers;
    for (const row of quotes.rows) {
      const q = Object.fromEntries(headers.map((h, i) => [h, row?.[i]]));
      if (q.symbol) quoteMap[String(q.symbol).toUpperCase()] = q;
    }
  }
  for (const symbol of snapshot?.assets || []) {
    const asset = String(symbol).toUpperCase();
    const quote = quoteMap[asset];
    if (!quote) {
      addIssue(issues, 'quote_unavailable_' + asset, 'warning', 'no directly parseable quote row; may be nested');
    } else {
      const quoteAt = validTime(quote.last_updated_time);
      if (snapshotAt != null && quoteAt != null && (snapshotAt - quoteAt > maxAssetQuoteAgeMinutes * 60000 || quoteAt - snapshotAt > 120000)) {
        addIssue(issues, 'quote_stale_' + asset, 'warning', 'quote age exceeds tolerance');
      }
    }
    const micro = snapshot?.microstructure?.assets?.[asset];
    if (micro?.available !== true) continue;
    if ((micro?.data_quality?.sequence_gaps ?? 0) > 0 || (micro?.live_microstructure?.sequence_gaps ?? 0) > 0) {
      addIssue(issues, 'sequence_gaps_' + asset, 'warning', 'Bitso order stream has sequence gaps');
    }
    const venue = micro?.venue_price_check;
    if (venue?.available === true) {
      const basis = finiteNumber(venue.basis_bps);
      if (basis != null && Math.abs(basis) > maxVenueBasisBps) {
        addIssue(issues, 'venue_basis_' + asset, 'block', 'venue price diverges beyond configured threshold');
      }
    } else if (String(micro?.minor_currency || '').toLowerCase() !== 'usd') {
      addIssue(issues, 'venue_fx_unverified_' + asset, 'info', 'cross-currency comparison requires FX rate');
    }
    if (micro?.live_microstructure?.stream_trade_count === 0) {
      addIssue(issues, 'no_live_trades_' + asset, 'info', 'cancellation-only evidence must be down-weighted');
    }
  }
  const blocks = issues.filter(i => i.severity === 'block').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const confidence = Math.max(0, 100 - blocks * 35 - warnings * 10);
  return {
    contract_version: 'data_consistency_v0.2',
    checked_at: referenceTime || null,
    issues,
    block_count: blocks,
    warning_count: warnings,
    confidence_0_100: confidence,
    position_change_allowed: blocks === 0 && warnings === 0 && confidence >= 80,
    missing_data_policy: 'unknown_not_zero',
    execution_enabled: false
  };
}
