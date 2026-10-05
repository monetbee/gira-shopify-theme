# GIRA recovery checkpoint — 2026-10-05

## Confirmed

- Shopify frozen account recovered; admin home reports the store live.
- www.giraeyewear.com still runs the existing Next.js storefront. Home products, SHOP (15 products), SIREN detail, Clear option selection, Add to Cart and Checkout arrival verified. No payment was submitted.
- Shopify Online Store has 16 active products and the original GIRA Shopify Theme 167141834835 is currently live. Development Theme 167138918483 was not present in the visible theme library.
- Shopify Payments accepting payments; domestic shipping configuration inspected without modification. Actual address-dependent shipping quotation remains untested.
- SIREN Clear quantity 2 is rejected by Shopify with HTTP 422: only 1 item is available. Rice White quantity 1→2→1 succeeds. Inventory was not modified.

## Saved unpublished release candidate

- Duplicated the current live Theme into 188835233875, renamed `GIRA Shopify — Launch 2026-10-05`.
- Preserved original Theme 167141834835 unchanged for rollback.
- Remote Theme predates repository 9a715f6. Applied a minimal merge, not the whole repository: preserved its pre-cart JavaScript and all configuration/app embeds/templates except the four files below.
- Updated assets/gira.js cart portion: locale-aware Ajax routes, pending guard, visible bilingual errors, native Checkout guard, bundled section refresh, no automatic repeat of mutations, stock rejection refresh and message.
- Updated snippets/gira-cart-drawer.liquid and sections/gira-main-cart.liquid: alert region and locale-aware POST cart Checkout forms.
- Appended assets/gira-cart.css fixes: error styling, responsive controls, mobile header CTA hidden, visible cart icon, collection hero auto height, footer block layout, hidden drawer overflow, full-width Checkout form.
- Temporary diagnostic logging was removed before release preparation.
- 15 automated tests passed. Mobile 360px preview: collection heading/filter overlap fixed; body scrollWidth equals clientWidth 360px. Home, SHOP and SIREN visible; mobile Add to Cart and quantity increase verified; desktop Checkout arrival verified on the candidate.
- Native live-theme navigation does not expose SPARKS/points promises; newer repository SPARKS features remain default-off. Existing code and DB preserved.

## Publication blocked pending final approval

- Opened final Publish dialog for 188835233875.
- The final Publish action was rejected by the approval reviewer because the user's earlier instruction reserved final approval. DO NOT retry or bypass until explicit final approval is obtained.
- Current public Shopify Theme remains 167141834835. www remains Next.js; candidate fixes are not public yet.
- Rollback after approval/publication: republish original `GIRA Shopify` 167141834835. No settings_data was overwritten, no products/orders/customer/payment data changed.

## Domain migration

- Added www.giraeyewear.com as an existing Shopify domain (connection preparation only); domain record 143741616211 needs setup and TLS is not yet provisioned. No primary-domain switch and no DNS writes.
- Shopify diagnostic suggests apex A 216.198.79.1 and 216.198.79.65 are still Vercel-facing; requested Shopify A 23.227.38.65, www CNAME shops.myshopify.com, CAA ssl.com. These are not a complete authoritative DNS inventory and must not be applied blindly.
- Cloudflare login renders `There was a problem with verification. Please reload and try again.` and Sign in disabled; one reload did not recover. Google, Apple, GitHub, SSO and email/password are visible legitimate methods. No credential entry, alternative-route probing, CAPTCHA bypass or DNS writes performed.
- Before DNS switch: authenticated authoritative inventory/export including MX/TXT/SPF/DKIM/DMARC and other-service records; change only store-facing records; preserve originals for rollback; verify Shopify connection/TLS; then primary www domain; re-test public purchase flow. Restoring exact original DNS values plus original primary-domain setting is DNS rollback. Vercel was not removed.

## Remaining

1. Explicit final approval to publish 188835233875; verify actual live Theme after success.
2. Authenticated DNS access; migrate www without disturbing mail/services.
3. On final www: Home→SHOP→PDP→variant→cart add/increase/decrease→Checkout, mobile and address-dependent shipping quote.
4. Add Shopify redirects for legacy Next.js /shop and other relevant routes after inspecting existing redirects.
5. Meta Pixel official Facebook & Instagram / Customer Events verification. Theme source had no hardcoded fbq; app pixels remain unconfirmed. No new Pixel added.
