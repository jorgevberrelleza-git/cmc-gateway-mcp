# Shadow Statistical Validation & Noise Discipline — v0.1

## Scope
Repository-local operating guidance for deterministic **research-only** Shadow. Does not install an account-level ChatGPT skill, enable money movement, subscribe to AI products, or create live trades.

## Research noise filter
- `LEARNING_RESEARCH_QUEUE_GATE_ENABLED=true` gates only the **mock/research decision queue**, **never raw snapshots or their material-event fields**. When disabled the original queue logic remains.
- Uses `assessEventQuality` cross-family rules. Always preserve queue processing for explicit price-move reasons, fundamental-quality changes, transitions into critical `BLOCK...` states and unknown reason types.
- The historic observation (68 of 72 material; 46 low-signal) is a **retrospective potential workload reduction**, not evidence of better trades. Every month, test the filter for missed verified macro/price events.
- Do not touch paid reasoning, exchange credentials, order permissions, cron schedule, or the database schema.

## CoinMarketCap original connection
- The upstream CMC MCP remains a **primary candidate**; CoinPaprika is a separately attributed fallback, not a silent equivalent of CMC.
- `mcp_failure_diagnostics` records allowlisted numeric/type/category information only; raw exception text and authentication material must never appear in snapshots or logs.
- On rate-limit/auth/schema errors, do **not** immediately repeat the same CMC request. Reconnect/retry only transient transport failures, behind the existing 9 calls/min limiter.
- The recovery status is not closed unless primary CMC quotes are actually available on recurring cron cycles; fallback success is not primary repair.

## Predeclared 4h walk-forward study
- `LEARNING_WALKFORWARD_REPORT_ENABLED=true` runs at 01:15 UTC in existing cron. Read-only 4h non-overlapping windows from max 14 days of snapshots; entry-time features only, future price assigned at or after the horizon.
- Fixed hypotheses use spot confirmation >=65, trap risk <=35, microstructure confidence >=55, a valid USD price and data consistency. AAVE also requires fundamental confirmation >=65. They are **hypothetical long/flat study labels**, not actual BUY recommendations.
- 60% chronological training context; last 40% out-of-sample with a 4h embargo, no fitted tuning. Assumes 40bps round-trip cost plus venue spread when available (30bps fallback); contrasts each 4h window with a passive HODL return in that interval.
- Reports Wilson 95% interval for positive net hypothetical trades and refuses statistical actionability until at least 20 OOS windows and 10 OOS long hypotheses; even those minimums alone **do not establish predictive alpha**. Require out-of-time repeats, credible macro sources, measured drawdown, capital sizing, and actual realized outperformance after verified execution costs.
- Never use future snapshots to classify a current signal; AAVE fundamental veto stays active absent new evidence. Data may be correlated across windows/regimes.
- `position_change_allowed:false`, `execution_enabled:false`, `paid_ai_calls_made:0`, zero exchange writes.

## Acceptance
1. GitHub CI validate and PostgreSQL integration both pass for deployed SHA.
2. Verify the Render deploy is LIVE; first actual cycle remains `success`.
3. Inspect `research_queue_gate`, `quote_provenance` and first `SHADOW_WALKFORWARD_SUMMARY` independently.
4. Preserve conservative posture if original CMC still fails, or OOS sample/edge is inadequate.
