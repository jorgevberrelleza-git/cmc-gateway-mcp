# Sprint 5 Render shadow go-live checklist — NOT APPLIED

No action in this checklist has been applied to Render yet.

## Phase A — before touching Render

- [ ] Feature branch CI green through Sprint 5.
- [ ] PostgreSQL migration integration green.
- [ ] Mock end-to-end shadow dry run green.
- [ ] Configuration checker green with intended production environment values.
- [ ] Provider mock canary green.
- [ ] Total monthly budget approved.
- [ ] Planned fixed infrastructure allocation is within that budget.
- [ ] Monthly AI budget and reasoning-run limit configured.
- [ ] Current API/model/web-search cost assumptions reviewed.
- [ ] Backup/restore capability selected.
- [ ] No Bitso private credentials present.
- [ ] Real execution flags absent/false.
- [ ] Explicit user approval to make Render changes.

## Phase B — first Render change after approval

Planned changes only:
1. provision persistent PostgreSQL;
2. create a separate scheduled shadow-learning service/job;
3. point it to the reviewed Learning Engine release;
4. add non-secret learning configuration;
5. add database URL as a secret/internal connection;
6. initialize/migrate schema;
7. seed the shadow portfolio through a private environment value;
8. run mock reasoner first.

The existing production gateway should remain isolated.

## Phase C — shadow burn-in

Start with:
- hourly collector;
- mock provider or reasoning disabled;
- health/cost telemetry enabled;
- no private Bitso API;
- no exchange writes.

Then verify:
- snapshots persist for at least 24 hours;
- hourly cycles remain healthy;
- portfolio marks are continuous;
- queue does not accumulate;
- outcome horizons begin filling;
- storage growth is sane.

## Phase D — AI canary

Only after stable burn-in:
- configure an OpenAI API key;
- select a reasoning model explicitly;
- enable event-driven reasoning for a limited number of queue items;
- inspect accepted/rejected decisions and citations;
- keep the application-level monthly AI budget guard active;
- keep the monthly reasoning-run limit active;
- keep every action paper-only.

## Explicitly out of scope

- Bitso private API;
- order placement;
- withdrawals;
- autonomous real-money trading.

Those require a later, separate approval and evidence gate.
