function tokenNumber(usage = {}, names = []) {
  for (const name of names) {
    const value = Number(usage?.[name]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

export function summarizeReasoningCost(runs = [], rates = {}) {
  const inputRate = Math.max(0, Number(rates.input_usd_per_million_tokens) || 0);
  const outputRate = Math.max(0, Number(rates.output_usd_per_million_tokens) || 0);
  const webRate = Math.max(0, Number(rates.web_search_usd_per_call) || 0);
  let inputTokens = 0;
  let outputTokens = 0;
  let webSearchCalls = 0;

  for (const run of Array.isArray(runs) ? runs : []) {
    const usage = run?.usage || {};
    inputTokens += tokenNumber(usage, ['input_tokens','prompt_tokens']);
    outputTokens += tokenNumber(usage, ['output_tokens','completion_tokens']);
    if (run?.response_payload?.provider_evidence?.web_search_used === true) webSearchCalls += 1;
  }

  const estimatedUsd =
    (inputTokens / 1_000_000) * inputRate +
    (outputTokens / 1_000_000) * outputRate +
    webSearchCalls * webRate;

  return {
    reasoning_runs: Array.isArray(runs) ? runs.length : 0,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    web_search_calls: webSearchCalls,
    rate_assumptions: {
      input_usd_per_million_tokens: inputRate,
      output_usd_per_million_tokens: outputRate,
      web_search_usd_per_call: webRate
    },
    estimated_usd: Number(estimatedUsd.toFixed(6)),
    note: 'estimate_only_rates_are_runtime_configuration_not_hard_coded_vendor_prices'
  };
}

export function buildRuntimeHealth({
  now = new Date(),
  latestSnapshot = null,
  latestPortfolioMark = null,
  queue = [],
  reasoningRuns = [],
  runtimeCycles = []
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const ageHours = value => {
    const t = Date.parse(value);
    return Number.isFinite(t) && Number.isFinite(nowMs) ? (nowMs - t) / 3_600_000 : null;
  };
  const pending = queue.filter(x => x.status === 'pending');
  const processing = queue.filter(x => x.status === 'processing');
  const errors24h = reasoningRuns.filter(x => {
    const age = ageHours(x.started_at);
    return x.status === 'error' && age != null && age >= 0 && age <= 24;
  });
  const latestCycle = runtimeCycles[0] || null;
  const snapshotAge = ageHours(latestSnapshot?.generated_at);
  const markAge = ageHours(latestPortfolioMark?.marked_at);

  const blockers = [];
  if (!latestSnapshot) blockers.push('no_snapshot');
  else if (snapshotAge > 2.5) blockers.push('snapshot_stale_over_2_5h');
  if (!latestPortfolioMark) blockers.push('no_portfolio_mark');
  else if (markAge > 3.5) blockers.push('portfolio_mark_stale_over_3_5h');
  if (processing.length > 3) blockers.push('reasoning_processing_backlog');
  if (pending.length > 10) blockers.push('decision_queue_backlog');
  if (errors24h.length >= 3) blockers.push('reasoning_error_burst');
  if (latestCycle && latestCycle.status === 'error') blockers.push('latest_runtime_cycle_failed');

  return {
    healthy: blockers.length === 0,
    blockers,
    snapshot_age_hours: snapshotAge,
    portfolio_mark_age_hours: markAge,
    queue: {
      pending: pending.length,
      processing: processing.length,
      total: queue.length
    },
    reasoning_errors_24h: errors24h.length,
    latest_cycle: latestCycle ? {
      started_at: latestCycle.started_at,
      completed_at: latestCycle.completed_at,
      status: latestCycle.status,
      duration_ms: Number(latestCycle.duration_ms)
    } : null,
    execution_enabled: false
  };
}


export function monthWindowUtc(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(d.getTime())) throw new Error('invalid_month_window_date');
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

export function estimateReasoningRequestCeilingUsd({
  packet,
  max_output_tokens = 1800,
  web_search_enabled = false,
  web_search_reserve_calls = 3
} = {}, rates = {}) {
  const inputRate = Math.max(0, Number(rates.input_usd_per_million_tokens) || 0);
  const outputRate = Math.max(0, Number(rates.output_usd_per_million_tokens) || 0);
  const webRate = Math.max(0, Number(rates.web_search_usd_per_call) || 0);
  const raw = JSON.stringify(packet || {});
  const estimatedInputTokens = Math.ceil(raw.length / 3);
  const outputTokens = Math.max(0, Number(max_output_tokens) || 0);
  const reservedWebCalls = web_search_enabled ? Math.max(0, Number(web_search_reserve_calls) || 0) : 0;
  const estimatedUsd =
    (estimatedInputTokens / 1_000_000) * inputRate +
    (outputTokens / 1_000_000) * outputRate +
    reservedWebCalls * webRate;

  return {
    estimated_input_tokens_ceiling: estimatedInputTokens,
    output_tokens_ceiling: outputTokens,
    reserved_web_search_calls: reservedWebCalls,
    estimated_request_ceiling_usd: Number(estimatedUsd.toFixed(6)),
    methodology: 'conservative_preflight_estimate_using_3_chars_per_input_token'
  };
}

export function evaluateMonthlyReasoningBudget({
  runs = [],
  monthly_ai_budget_usd,
  monthly_reasoning_run_limit = 100,
  request_ceiling_usd = 0,
  alert_pct = 80,
  rates = {}
} = {}) {
  const budget = Number(monthly_ai_budget_usd);
  const runLimit = Math.max(1, Number(monthly_reasoning_run_limit) || 100);
  const alertPct = Math.min(99, Math.max(1, Number(alert_pct) || 80));
  if (!Number.isFinite(budget) || budget <= 0) {
    return {
      allowed: false,
      reason: 'monthly_ai_budget_not_configured',
      current_estimated_usd: 0,
      projected_estimated_usd: null,
      remaining_estimated_usd: null,
      monthly_ai_budget_usd: budget,
      run_count: Array.isArray(runs) ? runs.length : 0,
      run_limit: runLimit,
      alert: true
    };
  }

  const cost = summarizeReasoningCost(runs, rates);
  const current = Number(cost.estimated_usd || 0);
  const reserve = Math.max(0, Number(request_ceiling_usd) || 0);
  const projected = current + reserve;
  const runCount = Array.isArray(runs) ? runs.length : 0;
  const bySpend = projected <= budget + 1e-9;
  const byRuns = runCount < runLimit;
  const usedPct = budget > 0 ? (current / budget) * 100 : 100;

  return {
    allowed: bySpend && byRuns,
    reason: !byRuns ? 'monthly_reasoning_run_limit_reached'
      : !bySpend ? 'monthly_ai_budget_would_be_exceeded'
      : 'within_budget',
    current_estimated_usd: Number(current.toFixed(6)),
    request_ceiling_usd: Number(reserve.toFixed(6)),
    projected_estimated_usd: Number(projected.toFixed(6)),
    remaining_estimated_usd: Number(Math.max(0, budget - current).toFixed(6)),
    monthly_ai_budget_usd: budget,
    used_pct: Number(usedPct.toFixed(2)),
    run_count: runCount,
    run_limit: runLimit,
    alert: usedPct >= alertPct,
    alert_pct: alertPct,
    cost
  };
}
