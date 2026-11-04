# Sprint 2 Closeout — Shadow Decision & Risk Layer

Status: **COMPLETE FOR ALPHA / NOT DEPLOYED / NO REAL-MONEY EXECUTION**

## Delivered

- Scheduled learning collector entrypoint.
- PostgreSQL initializer and persistent storage methods for snapshots, decisions, paper orders, and outcomes.
- Formal shadow decision contract:
  - HOLD
  - BUY
  - REDUCE
  - SELL
  - MOVE_TO_USD
- BUY guardrails:
  - at least 3 independent evidence families;
  - reward/risk >= 2;
  - DeFi fundamentals cannot create BUY alone.
- Defensive guardrails:
  - price/structure decline alone cannot force USD;
  - at least 2 independent evidence families;
  - persistence confirmation required unless a deterministic kill-switch applies.
- Persistence evaluator:
  - separated observations;
  - default max gap 12h;
  - daily-close confirmation path;
  - multi-family persistence requirement.
- Risk-based paper sizing with cash, concentration, new-exposure, fee, and slippage constraints.
- Outcome evaluation primitives and due-horizon scheduling for 4h/24h/7d/30d.
- Macro regime input contract:
  - favorable / neutral / adverse;
  - expanding / stable / contracting liquidity;
  - low / medium / high shock risk;
  - evidence and timestamp requirements.
- CI workflow isolated to the feature branch.

## Validation

GitHub Actions run #1 completed successfully after installing dependencies and executing:

1. syntax checks;
2. Sprint 1 learning self-test;
3. Sprint 2 learning self-test.

Additional anti-whipsaw tests were added afterward and locally revalidated:
- repeated structure-only weakness does not satisfy persistence;
- structure-only MOVE_TO_USD is rejected even if a caller claims persistence;
- stale observations outside the default persistence window do not confirm;
- DeFi-fundamentals-only BUY is rejected;
- BUY with reward/risk < 2 is rejected;
- any attempt to set execution_enabled=true is rejected.

## Safety state

- No Bitso private keys.
- No exchange writes.
- No deployment changes.
- No Render changes.
- No merge to main.
- main remains the stable v0.6.2 gateway.

## Known alpha limitations

- Macro context is a validated contract, not yet an automatically populated macro feed.
- Outcome evaluator primitives exist, but the automatic historical/fresh-price outcome runner belongs to Sprint 3.
- Paper portfolio ledger and benchmark aggregation belong to Sprint 3.
- Decision generation from material events is not yet autonomous; Sprint 2 validates and stores decisions, Sprint 3 will queue and evaluate them.
- PostgreSQL schema exists but has not yet been provisioned in Render.

## Sprint 3 entry criteria

Sprint 2 is considered closed for alpha development because the shadow decision/risk contract, persistence rules, sizing primitives, storage contract, collector entrypoint, and outcome primitives exist and pass validation without changing production or enabling execution.
