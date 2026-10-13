# Learning Engine v0.1-alpha

This branch starts the 24/7 shadow-learning layer without changing the production v0.6.2 gateway or enabling exchange execution.

## Sprint 1 scope

- Deterministic snapshot feature extraction.
- Material-event detector to suppress redundant observations.
- PostgreSQL schema for immutable snapshots, shadow decisions, paper orders and 4h/24h/7d/30d outcomes.
- Persistent storage adapter using `DATABASE_URL`.
- Synthetic self-test for event detection.

## Safety invariants

1. No exchange writes and no Bitso private credentials.
2. A price decline alone cannot create a move-to-USD decision.
3. Learning records are append-only; historical decisions are never rewritten with hindsight.
4. DeFi fundamentals remain confirmation/degradation context, never a standalone BUY trigger.
5. Execution-context signals are evidence, not commands.
6. `main` remains the stable v0.6.2 production gateway until a reviewed merge/deploy decision is made.

## Next sprint

- Scheduled collector entrypoint.
- Decision contract and paper-order sizing.
- Outcome evaluator.
- Anti-whipsaw persistence rule across separated observations/daily closes.
- Macro/regime input contract.

No Render deployment is included in this alpha commit.
