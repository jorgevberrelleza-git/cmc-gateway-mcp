# Sprint 3 deployment blueprint — NOT APPLIED

This document is a deployment plan only. The current Render service and production `main` branch remain unchanged.

## Goal

Run the shadow-learning pipeline continuously with one persistent PostgreSQL database and one scheduled job, while keeping real-money execution impossible.

## Proposed components

1. Existing production gateway:
   - branch: `main`
   - version: v0.6.2
   - unchanged

2. Learning PostgreSQL:
   - persistent paid instance
   - `DATABASE_URL` injected only as an environment variable
   - schema initialized once with `npm run learning:db:init`

3. One scheduled learning job:
   - branch: reviewed Learning Engine branch/release
   - suggested cadence: hourly
   - command: `npm run learning:hourly`
   - collector is the only stage that calls the market-data gateway stack
   - outcome, portfolio, watchdog and report stages operate primarily on stored data

## First-time initialization

After PostgreSQL exists:

1. Run `npm run learning:db:init`.
2. Run `npm run learning:collector` once to create a market baseline.
3. Set `LEARNING_INITIAL_PORTFOLIO_JSON` as a secret environment variable.
4. Run `npm run learning:portfolio:seed` once.
5. Remove or retain the seed environment variable according to operational preference; never commit its value.
6. Run `npm run learning:portfolio:mark`.
7. Only then enable the recurring hourly cycle.

## Required environment variables

Existing gateway variables remain unchanged.

Learning layer:
- `DATABASE_URL`
- `LEARNING_ASSETS=BTC,AAVE,ADA`
- `LEARNING_CAPTURE_MS=18000`
- `LEARNING_INCLUDE_MICROSTRUCTURE=true`
- `LEARNING_SOURCE=cron`

One-time private seed:
- `LEARNING_INITIAL_PORTFOLIO_JSON`

The repository is public. Never commit portfolio quantities, API keys, OAuth secrets, database passwords, or exchange credentials.

## Hourly cycle

`learning:hourly` runs:

1. collector
2. paper-fill ledger sync
3. portfolio mark
4. due outcome evaluation
5. drift watchdog
6. 24h learning report

Material events are enqueued for deeper decision reasoning. Sprint 3 intentionally does not make an external LLM call or place an exchange order.

## Safety

- no Bitso private API credentials;
- no withdrawal permission;
- no exchange writes;
- no autonomous real-money order path;
- shadow paper fills are separate ledger events;
- historical decisions and outcomes remain append-only;
- a price decline alone cannot force a move to USD.

## Cost control

Use one scheduled job rather than multiple cron jobs where practical. Keep deep AI reasoning event-driven instead of hourly. The data collector may run hourly while expensive reasoning is reserved for material events.

## Go-live gate for shadow deployment

Do not deploy until:
- CI passes all Sprint 1-3 self-tests;
- database schema has been reviewed;
- branch diff against `main` is clean and understood;
- initial portfolio seed is supplied through environment configuration only;
- no execution credentials are present.
