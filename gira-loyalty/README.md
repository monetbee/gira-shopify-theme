# GIRA Loyalty backend foundation

This project is intentionally independent of the Shopify Theme and Next.js.
It includes a server-only Shopify Client Credentials Grant client and a manual,
fixed read-only connection check. No App Proxy route, webhook subscription,
discount creation, customer/order mutation, or Theme code is included.

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

Tests use an in-memory repository and mocked Shopify transport, so PostgreSQL,
Shopify credentials, and network access are not required.
The HTTP server currently exposes only `GET /health`.

On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`. In environments that
block child processes, use `node --test --test-isolation=none` to run the tests.

## Shopify configuration and manual connection check

Set these variables only on the server (Render's GIRA Loyalty service):

| Variable | Value |
| --- | --- |
| `SHOPIFY_SHOP_DOMAIN` | `giragiraglasses.myshopify.com` (verify before connecting) |
| `SHOPIFY_API_VERSION` | `2026-07` (the only accepted version in this phase) |
| `SHOPIFY_CLIENT_ID` | Client ID from the GIRA Loyalty app's Dev Dashboard |
| `SHOPIFY_CLIENT_SECRET` | Client Secret from the same app; keep secret |
| `SHOPIFY_EXPECTED_SHOP_ID` | Independently verified GIRA Shop GID, exactly `gid://shopify/Shop/<numeric-id>` |

`SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` are obsolete placeholders, not aliases.
Remove them if populated: the checker rejects nonempty legacy variables even
when the new names are present. No access-token or webhook-secret variable is
needed. Never use `NEXT_PUBLIC_` variables for these credentials, commit a
populated `.env`, or paste credentials into commands, logs, or review output.

Render injects environment variables directly. The npm scripts do **not** load
`.env` automatically. For an optional local `.env`, use Node's explicit loading:
`node --env-file=.env scripts/shopify-check.js --dry-run`.

Before a live check, confirm that the installed GIRA Loyalty app and GIRA store
belong to the **same Shopify organization**. Installation alone does not prove
Client Credentials Grant eligibility. Verify the canonical `myshopify.com`
domain in Shopify admin; do not use a storefront custom domain.

Run from `gira-loyalty/`. Preview works without credentials and makes no requests:

```sh
npm run shopify:check
# Equivalent explicit preview:
npm run shopify:check -- --dry-run
```

Review the displayed domain and version. Only after live API access is authorized,
set the server-side credentials securely and explicitly confirm the same domain:

```sh
npm run shopify:check -- --confirm-shop giragiraglasses.myshopify.com
```

The live command exchanges credentials at `/admin/oauth/access_token` and sends
exactly this query to `/admin/api/2026-07/graphql.json`:

```graphql
query ConnectionCheck {
  shop { id name myshopifyDomain }
}
```

It verifies the API version and requires BOTH an approved response domain and
an exact match against the independently verified expected Shop ID. The fixed
approved response domains are `giragiraglasses.myshopify.com` and
`utuidm-sx.myshopify.com`; no wildcard or automatic domain enrollment is used.
Neither response domain changes the request host: keep `SHOPIFY_SHOP_DOMAIN`
as `giragiraglasses.myshopify.com`. CLI confirmation still checks that host.

The expected ID must be verified independently by the operator against trusted
GIRA store information before configuration. Do not copy an unverified mismatch
response into the expected ID or use a domain/name as identity proof. This code
checks the pinned value; it cannot attest how the operator verified it.
Missing or malformed expected IDs stop a live check before any network request.
A dry run can still preview configuration without an ID and never means connected.

Success prints `status` and boolean identity diagnostics. Identity failures print
a fixed error code plus the same boolean diagnostics and exit with status 1.
Diagnostics are `responseMatchesPrimary`, `responseMatchesConnected`,
`shopIdValid`, `expectedShopIdConfigured`, and `shopIdMatchesExpected`.
These refer to the two fixed domains above, not a dynamically discovered domain role.
Preflight or transport failures have no API identity diagnostics because no
validated shop response is available. The dry run retains its configured-host
preview and adds an expected-ID presence flag, without exposing the ID.

Live checks also emit JSON lines with `status: diagnostic` before their final
`connected` or `error` result. These describe each actual token/GraphQL request
and the parsed GraphQL structure; they make no additional requests. Cached tokens
produce no token-request event; the existing single 401 retry may produce another
pair of request events. Consumers must use the final result and process exit code,
not treat a diagnostic line as success.

Transport diagnostics include fixed stage names, HTTP status, HTTPS/host equality,
redirect status, JSON content-type/parse checks and API-version equality. A missing
response URL or unavailable response metadata is `null` (unknown), not a match.
Structure diagnostics contain presence/type checks and GraphQL error presence.
Trim/lowercase comparison flags help identify spelling differences only: they
never normalize the identity used for acceptance. Exact ID and domain validation,
redirect rejection, authentication, token caching and the fixed query are unchanged.
Only allowlisted boolean/null fields, a validated HTTP status and fixed stage labels
are logged; no URLs, header dumps, bodies, error messages, IDs or personal fields
are included. No new Render variables or command-line flags are required.

### Correlating a check with Shopify's request log

Every command invocation generates a random `diagnosticId`, included on preview,
diagnostic and final lines. `attempt` is 1 for the first check and 2 for the existing
401 retry (0 before any attempt). The same run ID is kept across the retry.
Each GraphQL response's `X-Request-ID` is exposed as `requestId` only if it matches
the bounded UUID-shaped format: hexadecimal 8-4-4-4-12 groups, optionally followed
by a hyphen and 1–16 decimal digits. Missing or unrecognized formats produce null;
`requestIdPresent` and `requestIdValid` distinguish those cases. No token-response
request ID, other headers or raw rejected values are printed. An unrecognized
format does not change the identity verdict. This is a conservative output
allowlist, not a guarantee of all future Shopify Request ID formats.

Use the exact `requestId` to locate the same ConnectionCheck in Shopify's logs,
not the operation name alone. Correlated identity stages are:

1. `identity_parsed`: immediately after GraphQL JSON parsing.
2. `identity_before_validation`: immediately before response/identity validation.
3. `identity_final`: after the client's final outcome, with `accepted`.

Each stage repeats only boolean matches against the expected ID and the two
approved domains. `expectedMatchesIndependent` compares the configured expected
ID against the independently confirmed GIRA GID `gid://shopify/Shop/7368034643`.
That flag is diagnostic only; it does not replace or relax the configured exact
identity checks. `identityAvailable: false` indicates no shop object to compare.
Transport/parse failures or GraphQL errors can skip stages that were never reached;
the final stage still records failure. The final command result also includes the
run ID, last attempt and validated Request ID. Final exit status remains authoritative.
Token acquisition shared by concurrent client calls is logged under the initiating
call; each GraphQL call and its identity stages retain their own correlation context.

No additional API requests, response persistence, raw Shop IDs/domains, credentials,
tokens or personal fields are introduced by correlation. Request IDs are the sole
allowlisted response-header values printed for matching Shopify's request log.

Live success/failure never prints the configured or returned IDs/domains,
credentials, token, shop name,
raw response, or raw exception. There is no generic query/mutation entry point.
An app token may carry existing write scopes; the fixed checker does not use
them or change app scopes. It does not read customers, orders, discounts or
SPARKS, and does not connect to the database.

Tokens are held only in process memory and reused until 60 seconds before their
`expires_in` deadline. Concurrent calls share token acquisition. The next call
renews an expired token; process restarts or separate CLI runs acquire a new one.
There is no refresh-token storage or migration. HTTP 401 invalidates the rejected
token and retries authentication/query once. Other failures are not retried
automatically. Each HTTP request (including response-body reading) has a 10-second
timeout, and redirects are rejected.

Typical failure codes:

| Code | Action |
| --- | --- |
| `INVALID_SHOP_DOMAIN`, `INVALID_API_VERSION`, `LEGACY_CONFIG_NOT_SUPPORTED`, `MISSING_OR_INVALID_CREDENTIALS` | Correct the server configuration without printing its secret values. |
| `SHOP_CONFIRMATION_REQUIRED` | Preview and confirm the exact configured shop domain. |
| `AUTHENTICATION_FAILED`, `TOKEN_REQUEST_FAILED` | Check credentials, installation and same-organization eligibility in Dev Dashboard. |
| `TOKEN_REJECTED`, `ACCESS_DENIED` | Check app access/installation; no automatic scope changes occur. |
| `RATE_LIMITED`, `SHOPIFY_UNAVAILABLE`, `REQUEST_TIMEOUT`, `NETWORK_ERROR` | Investigate availability and retry manually later. |
| `SHOP_DOMAIN_MISMATCH`, `API_VERSION_MISMATCH` | Stop and verify the intended store/API version. |
| `MISSING_EXPECTED_SHOP_ID`, `INVALID_EXPECTED_SHOP_ID` | Independently verify the GIRA Shop ID and set its full GID; no live requests occur. |
| `SHOP_ID_MISMATCH` | Stop: the response does not match the independently pinned store identity, even if the domain is approved. |
| `INVALID_TOKEN_RESPONSE`, `INVALID_RESPONSE`, `GRAPHQL_ERROR`, `API_REQUEST_FAILED`, `INTERNAL_ERROR` | Investigate safely without enabling raw request/response logging. |

### Render operations

Keep the existing service configuration, `DATABASE_URL`, `PORT`, and `LOG_LEVEL`.
The existing start script remains `node src/server.js` (`npm start`). Add the five
Shopify variables only after approval. **Never add `shopify:check` to Build Command,
Start Command, predeploy hooks, health checks, CI, or automatic migrations.**
The command is for an authorized operator's manual shell session only.
`GET /health` remains independent of Shopify configuration and availability.

Deploying, changing Render settings, pushing to GitHub, and performing a live
connection check are separate operational steps requiring approval for this rollout.

References: [Client Credentials Grant](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant),
[shop query](https://shopify.dev/docs/api/admin-graphql/2026-07/queries/shop).

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
