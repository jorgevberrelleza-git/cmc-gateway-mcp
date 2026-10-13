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

## Sprint 4 — event-driven AI reasoning bridge

- Pending material events can be claimed safely with PostgreSQL row locking.
- Stale processing claims are automatically requeued after a configurable timeout.
- Old material events are skipped instead of producing hindsight-contaminated decisions.
- A normalized reasoning packet contains:
  - current and recent market features;
  - material-event context;
  - deterministic persistence evidence;
  - point-in-time portfolio context;
  - only decisions/watchdog events known at the snapshot time.
- Provider packet redaction removes absolute portfolio value, exact cash and exact quantities before any external AI call.
- OpenAI Responses API support is optional and disabled by default.
- Structured JSON output is enforced through a JSON Schema.
- Web search is optional; however, any position-changing proposal is rejected unless:
  - macro status is verified;
  - at least two macro sources are supplied;
  - at least one source is a trusted primary domain or Reuters;
  - provider output actually attests the cited URLs.
- The AI cannot activate a kill-switch.
- BUY reward/risk is recalculated deterministically from current price, invalidation and target.
- BUY invalidation must be below entry and target above entry.
- Requested risk is capped deterministically before paper sizing.
- Defensive actions use persistence computed from stored observations, not model claims.
- Duplicate proposals for the same asset in one reasoning run are rejected.
- Accepted and rejected proposals, validation reasons, provider metadata and usage are persisted in `learning_reasoning_runs`.
- The hourly cycle now includes the reasoner between collection and paper-fill synchronization.
- Real-money execution remains impossible.

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
- `npm run learning:reasoner`
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

Reasoning bridge:
- `LEARNING_REASONING_ENABLED=false` — must be explicitly changed to `true`.
- `LEARNING_REASONING_PROVIDER=disabled|mock|openai_responses`.
- `LEARNING_REASONING_MODEL` — required for OpenAI provider; no model is hard-coded.
- `OPENAI_API_KEY` — secret, never commit.
- `OPENAI_BASE_URL` — defaults to the OpenAI API base URL.
- `LEARNING_REASONING_WEB_SEARCH=false` — enable only when fresh macro verification is desired.
- `LEARNING_REASONING_MAX_ITEMS=3`.
- `LEARNING_REASONING_MAX_OUTPUT_TOKENS=1800`.
- `LEARNING_REASONING_MAX_EVENT_AGE_HOURS=6`.
- `LEARNING_REASONING_STALE_MINUTES=30`.
- `LEARNING_MACRO_MAX_AGE_HOURS=12`.
- deterministic sizing/risk caps remain configurable but are enforced after AI output.

Do not commit portfolio quantities or credentials. Existing CMC/Bitso/DefiLlama environment variables remain unchanged.

## Next sprint

Sprint 5 should focus on shadow go-live readiness rather than adding more model intelligence:
- deployment-grade configuration validation;
- PostgreSQL migrations/backup/retention policy;
- health and cost telemetry;
- full dry-run cycle using mock reasoning;
- optional OpenAI event-driven reasoning canary;
- source-quality and provider-failure monitoring;
- deployment checklist for Render without enabling exchange execution.

No Render deployment and no real-money execution are included in Sprint 4.
