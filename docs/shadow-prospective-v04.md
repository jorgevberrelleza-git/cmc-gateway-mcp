# Shadow Prospective v0.4 — forward market-reading experiment

The purpose is to make **genuinely prospective, timestamped research hypotheses** that are impossible to adjust after future market prices arrive. This is NOT another backtest, a calibrated probability model, or a real investment policy.

## Precommitted daily tape
- The already running hourly collector supplies a current real observation of BTC, ADA, AAVE (coinpaprika-first, USD) and the previous snapshot.
- **Only once per UTC calendar day**, the optional sidecar issues 24h, 72h, 168h directional hypotheses for all three assets.
- Each prediction includes source as-of, issuance time, immutable SHA256 over canonical JSON, reference USD price, source quality, macro/venue caveats, UP/DOWN/FLAT/ABSTAIN and explanatory heuristic votes. There are no invented probabilities.
- Thresholds: neutral price-change band ±1.5% at 24h, ±2.5% at 72h, ±4.0% at 7 days. These are preset research buckets; not trading triggers or stop-losses.
- The frozen hypothesis uses 24h and 7d momentum, available spot/trap microstructure, and AAVE's fundamental caution. It accepts no news arriving after issuance; UNKNOWN/invalid/stale source yields ABSTAIN.
- At expiry, the first **quality-valid future quote** between scheduled target and +3h is selected, regardless of whether it favors the prediction. Missing data is classified DATA_GAP_UNSCORED. Both abstentions and missing outcomes must be counted.
- Forecast and individual horizon scores use unique append-only versions in the existing learning_shadow_v2_evaluations table; no migration or new storage resource. It never backdates a forecast and never overwrites an earlier prediction.
- No rewriting rules in response to observed hits/misses. Compare future directional hit rate against simple baselines only after sufficient independent samples, with regime and abstention coverage reported. A handful of winning calls cannot establish real alpha.

## Manual entry points
- Local tests (no DB or network): npm run learning:forecast:selftest
- Read-only sidecar using current Render DB and snapshots: npm run learning:forecast:forward
- Optional hourly activation: LEARNING_PROSPECTIVE_FORECAST_ENABLED=true (the default is false).
- The first run emits one true forward forecast with issuedAt=current time (never retroactively). Subsequent runs use the same daily forecast and append matured 24h/72h/7d results as they become verifiable.
- No new provider or AI subscriptions, no extra Render instance. The sidecar reads only existing snapshots and a research-only evaluation table. Costs are limited to incremental DB reads/CPU, not guaranteed exactly zero infrastructure consumption.

## Security / correctness
- No broker keys, Bitso account actions, orders, paper execution, portfolio ledger writes, or API calls.
- A 2026 historical replay is not blind anymore; this experiment starts **today** with frozen future targets, which are truly unknown at issuance.
- USD reference quotations are NOT guaranteed executable in Bitso. The venue and macro caveats remain visible and cannot authorize BUY/SELL.
- The score itself is separate from any strategy-improvement process. Policy changes require a new version, a new sample, and a new approval.

## Research decision
Only if prospective calls remain more accurate than predeclared naive benchmarks across many non-overlapping mature observations, with adequate quote quality, a meaningful non-abstention sample and net-cost-adjusted portfolio evidence, consider advancing to paper sizing. Real money stays blocked.


## Integrity and baseline audit (Nov 20 enhancement; no change to frozen forecasts)
Every hourly scorer now recomputes a cumulative audit over the existing, hashed **original** daily forecasts and verified, matured score rows. It displays **correct/incorrect**, abstentions and DATA_GAP_UNSCORED, realized return/direction for each recent asset × horizon, forecast version, and total coverage. A result with altered prediction, hash, due timestamp, observation timestamp, price math, status, hit bit or duplicate horizon row is **rejected**, never silently counted as an error or win. The audit comparison uses naive always-UP/DOWN/FLAT on **the same observed cases**, with explicit sample insufficiency flags. These naive baselines are reference measurements, not superior trading models; cross-asset and overlapping horizons are correlated and cannot be called independent samples. Data sources remain public USD proxy quotes, not Bitso-executable order prices.

This enhancement **does not retrain, update thresholds, authorize orders, promote a strategy, or reset the live sample period**. It only makes the evidence auditable. It also logs HALT root-cause flags and latch state for the separate simulated broker. The forecast policy remains exactly v0.4, and the control plane remains fail-closed. The entire change has no new paid providers or deployments.
