# Shadow Autonomous Control Plane v0.5 — integrated read-only risk committee

## Mission
Advance toward a **responsible, autonomous capital-management agent** by first integrating research signals and testing all prerequisites for real-money readiness. This version is NOT a trading bot and cannot create broker orders or enable trading. A policy winning historic tests does not mean it is safe or profitable in live markets.

## Integrated pathways (what is actually wired)
Runs as an optional sidecar after the hourly collector, Shadow v0.2, forward rule v0.3, and forecast v0.4. It reads already saved snapshots, the latest hashed prospective forecast and matured score records, mock portfolio marks and the latest runtime cycles. This produces one per-snapshot append-only, SHA256-audited committee record in existing learning_shadow_v2_evaluations, tagged shadow_autonomy_control_v0.5. No new database, service, broker or paid APIs.

Composed data:
- **Market observations:** CoinPaprika provenance and USD price, data consistency, age, microstructure / Bitso venue price comparison, AAVE fundamental caution.
- **Decision research:** Shadow v0.2 asset postures and persisted rule v0.3 logic evaluated on the two most recent snapshots. Source families can generate RISK_MONITOR, DEFENSIVE_REVIEW, RECOVERY_RESEARCH, DATA_BLOCKED or OBSERVE — research classifications, not broker orders.
- **Forward hypothesis v0.4:** latest precommitted forecast hash and maturity-scored 24h, 72h, 168h outcomes; counts accuracy, abstentions and missing quotes without hiding unsuccessful calls.
- **Paper benchmarking:** most recent paper portfolio mark and mock alpha vs HOLD; it is not the user's real Bitso balance.
- **Reliability:** latest successful cron health, current snapshot freshness and audit hash.
- **External skills registry:** GEO, daily skills, historical Time Machine / adaptive regime simulations and Groq canary correctly labelled SEPARATE/OFFLINE/SYNTHETIC where they are NOT proven online market-decision inputs. The control plane does not silently claim all tools have been integrated into actual trading.

## Explicit gaps: no trade without evidence
- Macro news official feed metadata is NOT verified trade impact.
- Operational / bank / exchange incident guard is PLANNED, not independently attested (Issue #13).
- AAVE venue comparability is not verified, even when a USD reference quote is present.
- No broker order router, real balance reconciliation, fill/cancel/partial-fill handling, incident emergency stop or keys in the research service.
- No independently proven prospective net alpha after costs or calibrated forecast probabilities.
- Backtests (2021–2026) and 2026 IPO study are retrospective and cannot certify future profitability.
- Runtime stability alone does not establish venue safety or profitability.

### Controls and research policy
The committee is intentionally FAIL CLOSED: all reports have realMoneyReady:false, executionEnabled:false, authorizedTradeCount:0, orderRouterConnected:false, positionChangesAllowed:false. Passing some individual data checks or supplying boolean external flags cannot activate real trades. No remote capital-management adapter is imported or invoked. The rules can only be altered in a versioned, reviewed code change.

Illustrative proposed risk budget, NOT implemented: 0.5% risk per trade, 2% daily portfolio loss limit, 10% portfolio drawdown global stop, <=20% asset exposure, independent kill switch. These values must be stress-tested and adapted to real Bitso venues and actual exposures before certification. They are **not live protections**.

## Local testing
- node scripts/learning-autonomy-control-v05-selftest.mjs
- node scripts/learning-prospective-forecast-v04-selftest.mjs
- node scripts/learning-prospective-rules-v03-selftest.mjs

## Live read-only mode
Add LEARNING_AUTONOMY_CONTROL_ENABLED=true to existing Render cron. The existing hourly script runs npm run learning:autonomy:control after the v0.4 forward predictor. It outputs SHADOW_AUTONOMY_V05 in cycle logs; report is stored in the existing JSONB evaluation table. No new scheduled job, paid market feed or separate Render service is required. The hourly cycle is not permitted to enable trade execution, change investment allocations, promote policies, use any Bitso credentials, or call Claude/Groq.

## Stage gate to capital
1. **Research autonomous:** stable hourly cycle with precommitted predictions and transparent abstention/gap accounting. Requires ongoing monitoring and incident response.
2. **Realistic forward paper autonomous:** verified executable venue, latency, bid/ask, costs, FX, broker order simulation, trade lifecycle, hard reconciled ledger, active operational incident signals, multiple independent validation horizons and a frozen policy that beats predefined passive/cash baselines after ALL costs.
3. **Independent audit:** failure injection (source failure, data poisoning, broken clock, exchange rejects, stale quotes, missing fills, network outage, duplicated webhook/order, compromised API credential), enforced exposure caps and zero-default broker privileges.
4. **Human-approved capital pilot:** explicit opt-in with predefined loss limits and revocable access; do not share trading secrets with this research process. Separate minimum-permission execution service must be built and independently reviewed. The user may decide not to authorize this stage even if research passes.

No policy or capital deployment is allowed without verifying actual legal/exchange support, API permissions, fiscal exposure, user consent, controls and evidence. No guarantee of profit.
