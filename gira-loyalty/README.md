# GIRA Loyalty backend foundation

This project is intentionally independent of `shopify-theme/`. It contains no
Shopify credentials, App Proxy route, webhook subscription, Admin API call,
discount creation, or Theme code. Those integrations are a later phase.

## Guarantees established here

- PostgreSQL is the source of truth; `wallet_balances` is a materialized balance.
- Every change has an append-only `wallet_transactions` record. Database triggers
  reject updates and deletes of ledger or order-allocation history.
- All SPARKS values are integer counts. Monetary values are integer ISO currency
  minor units; in JPY this means whole yen, never floating point.
- `wallet_balances.available_sparks` and `reserved_sparks` have database checks
  against negative values. Production mutations must `SELECT ... FOR UPDATE` the
  wallet row inside one database transaction.
- Reservation and wallet events each have unique idempotency keys per shop.
- `order_spark_allocations` is append-only and preserves line-level earning,
  redemption, reversal, and restoration attribution for future return-reason rules.

## Database setup

Use PostgreSQL 15 or later. Create an empty database, then apply migrations in
order. The supplied migration uses `pgcrypto` for UUIDs.

```sh
npm run db:migrate
```

No migration is run automatically. Do not point this command at a production
database until the Shopify integration and deployment review are complete.

## Local checks

```sh
cp .env.example .env
npm test
npm run check
npm start
curl http://localhost:4100/health
```

Tests use an in-memory repository so PostgreSQL and Shopify are not required.
The HTTP server currently exposes only `GET /health`.

## Tables

| Table | Role |
| --- | --- |
| `wallet_balances` | Locked, materialized available/reserved balance; never the audit source. |
| `wallet_transactions` | Immutable balance-event ledger, including post-event balance snapshots. |
| `redemption_reservations` | State machine for a prospective 20-SPARK-increment redemption. |
| `order_spark_allocations` | Immutable per-line earn/redemption/reversal/restoration records. |
| `webhook_receipts` | Shopify delivery deduplication and asynchronous processing state. |

## Reservation state machine

`pending → code_issued → applied → consumed`

An unconsumed reservation can become `released`, `expired`, or `cancelled`.
Only a future Shopify-paid handler may consume it. That handler must record the
actual applied amount and release any unused reservation amount.

## Future Shopify connection boundary

The later integration will verify App Proxy HMAC plus the logged-in customer,
verify and deduplicate Shopify webhooks, issue customer-scoped native discount
codes, and update the Theme-visible customer metafield cache. None of that is
implemented in this foundation.
