# Sprint 4 Closeout — Event-Driven AI Reasoning Bridge

Status: **COMPLETE FOR ALPHA / NOT DEPLOYED / NO REAL-MONEY EXECUTION**

## Delivered

- Safe PostgreSQL queue claiming with `FOR UPDATE SKIP LOCKED`.
- Recovery of stale processing claims.
- Maximum event-age gate to avoid acting on stale material events.
- Point-in-time reasoning packets to prevent hindsight leakage.
- Deterministic persistence evidence derived from stored material events.
- External-provider data minimization:
  - absolute capital redacted;
  - exact cash redacted;
  - exact asset quantities redacted;
  - portfolio weights/returns/drawdown retained.
- Provider abstraction:
  - disabled;
  - mock;
  - OpenAI Responses API adapter.
- Strict structured-output JSON schema.
- Optional provider web search.
- Macro verification state:
  - verified;
  - insufficient;
  - conflicted.
- Macro source provenance with URL capture.
- Provider web-search attestation.
- URL-level matching between claimed macro sources and provider citations.
- Trusted-domain check for sources labeled primary or Reuters.
- Deterministic proposal validation after AI output.
- AI kill-switch activation prohibited.
- BUY direction checks:
  - invalidation below entry;
  - target above entry.
- BUY reward/risk recalculated locally.
- BUY risk percentage capped locally.
- Portfolio concentration/cash/new-exposure limits remain deterministic.
- Defensive actions require deterministic multi-observation persistence.
- Duplicate same-asset proposals are rejected.
- Accepted and rejected AI proposals are audited in PostgreSQL.
- Model usage metadata is persisted for later cost analytics.
- Reasoner inserted into the hourly shadow cycle.
- Provider remains disabled by default.

## Critical authority boundary

The AI is a proposal generator, not the risk authority.

A model output cannot directly:
- trade;
- change exchange permissions;
- enable execution;
- activate a kill-switch;
- bypass persistence;
- set authoritative reward/risk;
- bypass portfolio concentration limits;
- bypass macro/source verification.

## Validation

The feature branch passed:
- syntax checks;
- Sprint 1 self-test;
- Sprint 2 self-test;
- Sprint 3 self-test;
- Sprint 4 self-test;
- PostgreSQL 16 integration test;
- point-in-time portfolio lookup test;
- source-attestation tests;
- trusted-domain source classification tests.

Safety tests explicitly include:
- price-only move-to-USD rejection;
- AI kill-switch rejection;
- stale macro rejection;
- unverified macro action rejection;
- unattested source rejection;
- false primary-source label rejection;
- BUY reward/risk recalculation;
- BUY risk-cap enforcement;
- HOLD fallback when macro is insufficient.

## Production state

- Render unchanged.
- `render.yaml` unchanged.
- production `main` unchanged.
- no production PostgreSQL.
- no OpenAI API key configured by this sprint.
- no reasoning model configured by this sprint.
- no Bitso private key.
- no exchange write path.
- no withdrawal path.

## Sprint 5 entry criteria

Sprint 4 is closed because material events can now flow into a source-aware, event-driven AI proposal layer whose outputs are independently validated and sized by deterministic controls.

Sprint 5 should focus on **shadow deployment readiness and controlled go-live**, not additional trading intelligence:
- configuration validator;
- DB migration/backup/retention policy;
- observability and cost telemetry;
- mock end-to-end dry run;
- provider canary;
- Render deployment plan and explicit approval gate;
- then turn on 24/7 shadow learning while real-money execution remains disabled.
