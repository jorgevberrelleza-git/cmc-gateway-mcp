# Sprint 4 deployment gate — NOT APPLIED

This document describes how the event-driven AI reasoning bridge may be enabled later. It does not modify Render, production `main`, Bitso credentials, or real-money execution.

## Safe default

The reasoning worker is inert unless:

`LEARNING_REASONING_ENABLED=true`

The default provider is `disabled`.

## Provider modes

- `disabled` — no model call; safest default.
- `mock` — deterministic HOLD-only fallback for integration tests.
- `openai_responses` — optional external reasoning provider.

For the OpenAI provider:
- `OPENAI_API_KEY` is required as a secret environment variable.
- `LEARNING_REASONING_MODEL` is required; the repository does not hard-code a model.
- `LEARNING_REASONING_WEB_SEARCH` defaults to `false`.

## Important macro gate

A model-generated BUY/REDUCE/SELL/MOVE_TO_USD cannot pass deterministic validation unless macro evidence is verified.

The bridge requires:
1. verified macro status;
2. fresh macro timestamp;
3. at least two source URLs;
4. at least one trusted primary-domain or Reuters source;
5. actual provider URL citation attestation for the claimed sources.

With web search disabled and no separately trusted macro feed, the safe expected behavior is HOLD or rejection of position-changing proposals.

## Data minimization

The external provider receives portfolio weights, returns and drawdown context.

It does not receive:
- absolute portfolio value;
- exact cash balance;
- exact crypto quantities.

Exact sizing remains local in the deterministic risk layer.

## Hindsight prevention

Reasoning packets use:
- snapshots up to the event timestamp only;
- portfolio marks at or before the event timestamp;
- decisions/watchdog events at or before the event timestamp.

Old queued material events are skipped after the configured maximum age rather than analyzed with future information.

## AI authority boundary

The AI may propose only.

It cannot:
- enable execution;
- activate a kill-switch;
- override persistence;
- override BUY reward/risk;
- override risk caps;
- fabricate paper fills;
- write to Bitso.

The deterministic layer recalculates reward/risk and sizing, validates persistence and source provenance, and may reject every proposal.

## Before any Render change

Required:
- all Sprint 1-4 CI jobs green;
- PostgreSQL integration green;
- mock end-to-end shadow cycle;
- explicit review of monthly API/web-search cost assumptions;
- explicit user approval to provision/change Render;
- no exchange private credentials.

Real-money execution is outside this deployment gate.
