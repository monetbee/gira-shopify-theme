# GIRA Shopify launch readiness — 2026-10-05

## Scope and current state

Source baseline: `monetbee/gira-shopify-theme` commit
`9a715f6d01f8eecdfe1d4733483bfc5419fe8ac8`.

This preparation does **not** publish a Theme, change DNS, make a payment,
alter Shopify payment/shipping settings, add a Pixel, deploy the loyalty
service, or modify/delete customer data or the database.

The supplied Theme IDs are lookup targets, **not live-verified roles**:

| Theme | ID | Required verification |
| --- | --- | --- |
| GIRA Shopify candidate | 167141834835 | Confirm it is unpublished before writing |
| Development reference | 167138918483 | Discover current development Theme ID; IDs can change |
| Previously live Rise | 149731934291 | Verify the actual current live Theme before rollback planning |

Shopify admin required login. The earlier Google sign-in returned 502.
Email, passkey, Apple, Facebook and WhatsApp were offered on the official
Shopify login form. A secure alternative-method request was interrupted;
authentication success is **unknown**. Do not resume credential entry without
the user's renewed direction. Cloudflare's login displayed a verification
problem; no authenticated DNS records were obtained. Public DNS resolution
from this runtime returned ECONNREFUSED, not a domain health verdict.

## Prepared code changes

- `gira_sparks_enabled` is a Theme setting defaulting to false. Gate every
  SPARKS balance, welcome bonus, earn/redeem promise and exchange rate in the
  header, GIRA CLUB and MY GIRA. Keep account/profile/order navigation.
  Existing loyalty code, metafields and database are untouched.
- Cart errors use visible `role="alert"` messages. Re-enable controls in
  finally blocks; prevent checkout and repeated cart mutations while a cart
  write is pending. Do not retry an ambiguous write automatically.
- An add-success/display-refresh-failure message warns against adding again.
- Preserve sold-out variant state after an asynchronous add request.
- Use Shopify's locale-aware root for Ajax Cart calls. Both Checkout controls
  submit native `POST {{ routes.cart_url }}` forms with `name="checkout"`.
- If bundled section rendering is missing, use read-only cart/section refreshes.
- Add intrinsic-width guards for cart lines and product galleries on narrow
  displays without shrinking the 44px quantity touch targets.

`settings_data.json` is intentionally not overwritten: it can contain merchant
settings and app embeds absent from GitHub. Explicitly verify the SPARKS flag
is false in the remote candidate, even though the new default is false.

## Validation performed / remaining

Local command: `node --test tests/theme-release.test.mjs`.
Tests execute the complete Theme JavaScript in a Node VM with mocked DOM and
transport. They cover HTTP/network failure, success, stock clamping, last-item
removal, in-flight checkout/duplicate-write guards, locale URLs, section fallback,
partial add success, sold-out state, point-display guards and cart markup.

The loyalty-condition projection is **not** a full Liquid renderer. CSS tests
are structural and **not** visual mobile QA. Run Shopify Theme Check and render
the remote preview before declaring ready. No real API, database, checkout,
payment, Pixel reception or DNS cutover has been validated here.

## Remote preparation (requires authenticated access)

1. Verify canonical store identity in Shopify, actual live Theme, candidate ID
   and current development Theme. Check the candidate is not live.
2. Download/back up **each** remote Theme and its settings before writing.
   Record Theme IDs, filenames and timestamps. Compare the candidate with the
   development Theme and source baseline; remote content can be ahead of GitHub.
3. Inspect the diff, preserve remote-only app embeds, settings, assets and merchant
   edits. Apply only the reviewed changes. Never blind-push the entire baseline.
4. Test first on the development/preview Theme; apply the same reviewed patch to
   candidate `167141834835` while leaving the live Theme untouched.
5. Set/verify SPARKS display off in candidate settings. Check both guest and signed-in
   header, `/pages/gira-club` and `/pages/my-gira`, including any Shopify page body
   text or app content that could independently promise points.
6. Preview at 320, 360, 390, 430 and desktop widths: Home, collection/filter sheet,
   product gallery/variant buttons, cart drawer, cart page and account links.
   Check long titles, sold-out variants, low stock and empty cart. Do not count
   a synthetic fixture as real Shopify preview validation.
7. Verify active products/variants, Online Store availability, prices/currency,
   inventory policy, shipping zones/rates and product-to-shipping-profile mapping.
8. Verify payment activation, test-mode status, store access/password status,
   Checkout availability, notification sender and support/policy links. Inspect
   actual settings without changing payout, identity or payment credentials.
9. Verify a non-charge purchase path up to the payment step. Do not enable
   store-wide test payment mode or place a real order without approval.

## Meta Pixel: confirm, do not duplicate

No manually embedded Meta Pixel was found in the audited Theme source.
`content_for_header` remains intact. This does **not** rule out an app Pixel.

Read Shopify's Facebook & Instagram sales channel/app, selected data source,
data-sharing settings and Settings > Customer events (app and custom Pixels).
Record Pixel IDs and connected/disconnected status without changing settings.
Also review app embeds and old Next.js tracking to avoid duplicate events after
cutover. With legitimate Meta access, use Test events to verify PageView,
ViewContent, AddToCart and InitiateCheckout; verify Purchase only through an
authorized test/real order. Respect consent requirements. Never add another
Pixel merely because Theme grep is empty. No Pixel has been added by this patch.

## DNS migration plan — pending actual record inventory

The existing authoritative Cloudflare zone has **not** been read. Before any
change, export records and record exact values, TTLs, proxy flags and relevant
Workers routes, redirects/origin rules and CAA entries. Public resolution alone
cannot reveal proxied origins or all email/service records.

Intended `www` target: CNAME `www` → `shops.myshopify.com`, DNS only, subject
to the Shopify admin's current instructions. The official Shopify guide also
documents apex A `23.227.38.65` and AAAA `2620:0127:f00f:5::`; the admin may
provide a supported regional A address. These are a **plan**, not current values.

Decide and obtain approval for the apex `giraeyewear.com` behavior separately:
connect it to Shopify and redirect to www, or retain the verified existing
behavior. Do not assume permission to rewrite all apex records merely because
the requested target is www. Do not use an automatic DNS connection that might
change unreviewed records.

Preserve nameservers, MX, SPF, DKIM, DMARC, domain-verification TXT, email routing,
and unrelated subdomains/services. A Worker route or redirect can intercept web
traffic even when DNS is correct: inventory it and propose only the affected
hostname change for approval. Do not disable DNSSEC, alter CAA or delete wildcard
records automatically. If they block connection, describe the exact issue first.
Keep Vercel/Next.js deployments and domain configuration available for rollback.

Official instructions consulted:

- https://help.shopify.com/en/manual/domains/add-a-domain/connecting-domains/connecting-to-cloudflare
- https://shopify.dev/docs/api/ajax
- https://shopify.dev/docs/storefronts/themes/markets/multiple-currencies-languages

## Approval gate and rollback

Before final approval, present:

- actual live Theme name/ID and timestamped backup;
- reviewed candidate/development diff and successful preview checks;
- exact current and proposed DNS records (type/name/value/TTL/proxy);
- any required hostname-specific Worker/redirect changes;
- payment/shipping verification, unresolved risks and Pixel identity/status;
- exact order of operations and rollback actions below.

Only after explicit user approval: publish the verified candidate, change only
the approved web-host records/routes, connect/verify the domain in Shopify and
choose the approved primary-domain redirect. Check SSL and DNS propagation;
Shopify notes that connection can take up to 48 hours. Do not repeatedly change
records while waiting. Real charging is a separate approval gate.

Rollback: re-publish the **verified pre-change live Theme**, restore each changed
DNS record's exact previous value/TTL/proxy and any reviewed Worker/redirect or
primary-domain setting. Keep email and unrelated records untouched. Theme rollback
alone does not restore Vercel routing; DNS rollback alone does not restore the
old Shopify Theme. Cached DNS and certificate propagation mean rollback is not
instant. Confirm both old application and store remain reachable.

Status: code patch prepared; remote Theme diff/upload, admin settings, authoritative
DNS inventory, live preview and Pixel installation status remain blocked on access.
