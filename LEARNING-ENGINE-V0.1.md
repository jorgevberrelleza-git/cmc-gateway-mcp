# Learning Engine v0.1-alpha

This branch builds the 24/7 shadow-learning layer without changing the production v0.6.2 gateway or enabling exchange execution.

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
- Macro regime contract.
- Storage methods for decisions, paper orders and immutable outcome records.

## Sprint 3 — portfolio learning & audit layer

- Material events are written to a persistent decision queue.
- Shadow portfolio ledger is append-only and reconstructable.
- Paper orders can be converted into simulated fills with cash/position validation.
- Portfolio marks value the shadow state against the latest stored market snapshot.
- Benchmark engine compares shadow performance against:
  - initial USD baseline;
  - HODL of the initial crypto positions.
- Outcome runner evaluates due 4h/24h/7d/30d decision horizons using stored snapshots nearest the target time.
- Drift watchdog detects rapid BUY↔REDUCE/SELL reversals and excessive action frequency.
- Process-quality heuristic scores decision construction, not future returns.
- 24h report summarizes snapshots, material events, decision queue, decisions, outcomes, portfolio alpha and watchdog warnings.
- One hourly orchestration command is prepared: `npm run learning:hourly`.
- Deployment blueprint is documented but not applied.

## Safety invariants

1. No exchange writes and no Bitso private credentials.
2. A price decline alone cannot create a move-to-USD decision.
3. Learning records are append-only; historical decisions are never rewritten with hindsight.
4. DeFi fundamentals remain confirmation/degradation context, never a standalone BUY trigger.
5. Execution-context signals are evidence, not commands.
6. Shadow sizing and ledger fills cannot enable real execution.
7. Portfolio quantities must enter through environment configuration or the database, never the public repository.
8. `main` remains the stable v0.6.2 production gateway until a reviewed merge/deploy decision is made.

## Learning commands

- `npm run learning:db:init`
- `npm run learning:collector`
- `npm run learning:portfolio:seed`
- `npm run learning:paper:fill`
- `npm run learning:portfolio:mark`
- `npm run learning:outcomes`
- `npm run learning:watchdog`
- `npm run learning:report`
- `npm run learning:hourly`

## Environment

Core learning:
- `DATABASE_URL`
- `LEARNING_ASSETS` — defaults to `BTC,AAVE,ADA`.
- `LEARNING_CAPTURE_MS` — defaults to `18000`, capped at 45000.
- `LEARNING_INCLUDE_MICROSTRUCTURE` — defaults to `true`.
- `LEARNING_SOURCE` — defaults to `cron`.

Private one-time portfolio seed:
- `LEARNING_INITIAL_PORTFOLIO_JSON`

Do not commit portfolio quantities or credentials. Existing CMC/Bitso/DefiLlama environment variables remain unchanged.

## Next sprint

Sprint 4 should focus on the reasoning bridge:
- consume pending material-event queue items;
- build a normalized decision packet;
- add event-driven AI reasoning without calling a model on every hourly observation;
- validate every AI proposal through the deterministic Sprint 2 risk contract;
- persist accepted/rejected shadow decisions and their decision-quality score;
- keep real-money execution disabled.

No Render deployment and no real-money execution are included in Sprint 3.
