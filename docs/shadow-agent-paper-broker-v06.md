# Shadow Agent + Paper Broker v0.6: four-state research trading agent

## What the agent actually does
This release gives the existing Shadow research stack a single downstream, persistent **paper-only execution model**. The agent is an automated **trading client using simulated funds**, not a licensed broker, custodian, exchange or management of user assets.

Data flow:
collector (CMC or CoinPaprika first) -> integrity/Bitso microstructure/fundamentals -> Shadow v0.2 -> prospective v0.3 -> future-committed v0.4 -> v0.5 SHA256 autonomy committee -> **v0.6 mode selector** -> separate **USD paper broker** -> append-only research report.

Historical Time Machine, GEO alerts, skills learning and Groq canary remain separate research/offline/synthetic components. They DO NOT become validated live trade decision inputs merely because the new broker is deployed.

## Four states
- HALT: timestamps, source, portfolio mark, quote integrity or runtime health inadequate, incident verified, drawdown >=10%, or daily portfolio loss >=2%. New orders suppressed; unfilled paper orders canceled. It does NOT auto-liquidate on unreliable quotes.
- DEFENSIVE: two or more risk families, current defensive review and existing simulated position. Issues a paper sell of 25% of its units, only for next snapshot.
- LIQUIDITY: signals uncertain, no independent opportunity, venue unverified or no confirmation. Preserve simulated cash. Does not assert a guaranteed positive yield on cash.
- OPERATE_PAPER: purely experimental buy proposals if a recovery signal has venue comparison, the latest untampered 24h/72h hypothesis is UP, quote quality valid, and no active risk family. Forecast probabilities remain uncalibrated and macro impact unverified: this mode NEVER authorizes live trading.

Priority: global HALT > defensive evidence > recovery paper experiment > liquidity. Other assets may have different local modes. AAVE trade venue remains unverified and thus cannot meet the paper buy gate.

## A separate fictional account (NOT Bitso)
- Initial virtual balance **USD 10,000** (not user assets).
- Maximum paper buy size 5% of equity, <=20% per asset, <=60% total exposure, >=40% cash.
- Pre-fill halt if daily loss >=2% or total drawdown >=10%. Hard stop blocks ALL pending orders BEFORE settlement; not merely after a bad fill. **Severe loss or verified official incident sets a persistent halt latch**: restored prices DO NOT resume paper trading. A separately audited manual-reset workflow is not implemented, therefore this v0.6 instance stays stopped after such an incident until explicit reviewed recovery code is built.
- Simulated fees: 10 basis points, total assumed spread: 20 bps, slippage: 15 bps. These are **assumptions**, not measured Bitso costs and may be wildly wrong for AAVE, volatility or MXN-USDC cross.
- Paper execution always uses the **NEXT independently saved snapshot** after the order was issued; no same-tick fill. Old orders >3h expire. No shorting, borrowing, margin, withdrawals, real order clients, or exchange API calls.
- Every paper record includes decision snapshot ID, audit of v0.5, order IDs, quotes and costs, pending fills, simulated positions, cash, mark-to-market and halt cause.
- Persist through existing append-only learning_shadow_v2_evaluations with version shadow_agent_paper_v0.6, uniqueness of snapshot + version, SHA256 on prior record. Never touches existing production mock ledger or any Bitso account.
- Overlapping runs remain a concurrency risk for future integration; before any serious broker sandbox integration, migrate account state and idempotency to transactional DB with advisory lock and compensating recovery.

## Execution
- Tests: npm run learning:agent:paper:selftest
- Manual research invocation: npm run learning:agent:paper
- Only optional sidecar in current cron: LEARNING_AGENT_PAPER_BROKER_ENABLED=true; requires successful v0.5 sidecar in same cycle.
- Monthly spending: no new AI/market API calls or Render service. Incremental DB reads/writes/CPU may incur platform usage.
- Every output includes realExecutionAllowed:false, brokerApiCalls:0, noRealCredentials:true.

## Pilot requirements not met
True Bitso stage sandbox uses an isolated test account and signed private order REST endpoints. Official docs: https://docs.bitso.com/bitso-api/docs/set-up-your-testing-environment and https://docs.bitso.com/bitso-api/docs/place-an-order. Stage connectivity, authentication and cancel/partial-fill/reconciliation are NOT implemented here. Never supply production credentials to this research cron. Production router must be separately isolated, limited-permission, audited and explicitly approved by the account holder.

Before real capital: confirm actual tradable spot books (esp. AAVE), book currencies and FX/USDC spreads, P&L post-cost advantage vs HOLD/cash/DCA in a truly forward unseen period, accurate reconciled fills, operational incident stop (#13), recovery from failures, independent kill switch with verified revocation, and explicit user approval. There is no promised date or positive return guarantee.
