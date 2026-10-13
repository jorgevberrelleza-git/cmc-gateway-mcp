# Learning Engine v0.1-alpha

This branch starts the 24/7 shadow-learning layer without changing the production v0.6.2 gateway or enabling exchange execution.

## Sprint 1 — foundation

- Deterministic snapshot feature extraction.
- Material-event detector to suppress redundant observations.
- PostgreSQL schema for immutable snapshots, shadow decisions, paper orders and 4h/24h/7d/30d outcomes.
- Persistent storage adapter using `DATABASE_URL`.
- Synthetic self-test for event detection.

## Sprint 2 — shadow decision/risk layer

- Scheduled collector entrypoint: `npm run learning:collector`.
- Database initializer: `npm run learning:db:init`.
- Formal shadow decision contract with BUY/HOLD/REDUCE/SELL/MOVE_TO_USD validation.
- BUY requires at least three independent evidence families and reward/risk >= 2.
- Defensive position changes require multi-family evidence plus persistence, unless an explicit kill-switch applies.
- Anti-whipsaw persistence across separated observations or a confirmed daily close.
- Risk-based paper BUY sizing with cash, concentration and new-exposure caps.
- Paper REDUCE sizing.
- Outcome math for BUY/HOLD/REDUCE/SELL/MOVE_TO_USD and due-horizon logic for 4h/24h/7d/30d.
- Macro regime contract: regime, liquidity, shock risk, evidence and timestamp.
- Storage methods for decisions, paper orders and immutable outcome records.
- Sprint 2 synthetic test entrypoint: `npm run learning:sprint2:selftest`.

## Safety invariants

1. No exchange writes and no Bitso private credentials.
2. A price decline alone cannot create a move-to-USD decision.
3. Learning records are append-only; historical decisions are never rewritten with hindsight.
4. DeFi fundamentals remain confirmation/degradation context, never a standalone BUY trigger.
5. Execution-context signals are evidence, not commands.
6. Shadow sizing cannot enable execution.
7. `main` remains the stable v0.6.2 production gateway until a reviewed merge/deploy decision is made.

## Environment for learning collector

- `DATABASE_URL` — required.
- `LEARNING_ASSETS` — defaults to `BTC,AAVE,ADA`.
- `LEARNING_CAPTURE_MS` — defaults to `18000`, capped at 45000.
- `LEARNING_INCLUDE_MICROSTRUCTURE` — defaults to `true`.
- `LEARNING_SOURCE` — defaults to `cron`.
- Existing CMC/Bitso/DefiLlama environment variables remain unchanged.

## Next sprint

- Outcome runner that resolves each due horizon against historical/fresh market marks.
- Shadow-decision queue for material events.
- Portfolio state ledger and benchmark engine.
- Drift/oscillation metrics and decision-quality score.
- Deployment blueprint for Render Postgres + scheduled learning job.
- Observability/health summary for overnight activity.

No Render deployment and no real-money execution are included in Sprint 2.
