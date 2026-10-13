# Sprint 5 operations policy — shadow runtime

This policy applies to the shadow-learning system only. Real-money execution remains outside scope.

## Database lifecycle

Use `npm run learning:migrate` as the canonical database bootstrap/upgrade command. It:
1. applies the idempotent baseline schema;
2. verifies migration checksums;
3. applies unapplied numbered migrations in order;
4. stops on checksum drift or SQL failure.

Never edit an already-applied migration. Add a new numbered migration instead.

## Backup policy before 24/7 shadow go-live

Before production shadow deployment:
- use a PostgreSQL plan with persistent storage;
- verify the hosting plan's backup/restore capability;
- create at least one manual backup before the first migration on a persistent database;
- perform a restore drill before any future real-money pilot;
- keep application secrets outside the database dump;
- document backup timestamps and restore result.

The repository does not automate destructive restore operations.

## Retention policy

Default planning target:
- raw snapshots: 365 days;
- decisions: indefinite;
- paper orders: indefinite;
- outcomes: indefinite;
- portfolio ledger: indefinite;
- reasoning audit: indefinite;
- runtime telemetry: at least 180 days.

`npm run learning:retention:report` reports storage growth only. It does not delete data.

Automated deletion is intentionally deferred until enough learning history exists to prove which raw data can be safely compacted.

## Runtime health gates

The health report treats these as blockers:
- market snapshot older than 2.5 hours;
- no portfolio mark or mark older than 3.5 hours;
- decision queue backlog over 10 pending items;
- excessive simultaneous processing backlog;
- 3 or more reasoning errors in 24 hours;
- latest recorded hourly cycle failed.

A health blocker does not enable trading. It should pause or investigate shadow reasoning.

## Cost telemetry

Model/vendor prices are not hard-coded because they can change.

Configure current rates externally:
- `LEARNING_COST_INPUT_USD_PER_MILLION`
- `LEARNING_COST_OUTPUT_USD_PER_MILLION`
- `LEARNING_COST_WEB_SEARCH_USD_PER_CALL`

Then run `npm run learning:cost`.

The result is an estimate, not a billing authority.

## Provider canary

`npm run learning:provider:canary` defaults to the mock provider and makes no network request.

An OpenAI canary requires both:
- `LEARNING_CANARY_PROVIDER=openai_responses`
- `LEARNING_CANARY_ALLOW_NETWORK=true`

This prevents an accidental paid/network call during CI or local validation.

## Security

Shadow runtime must reject:
- Bitso private/trading credentials;
- any enabled real-execution flag;
- `ALLOW_INSECURE=true`.

The deployment configuration checker is a mandatory preflight gate.
