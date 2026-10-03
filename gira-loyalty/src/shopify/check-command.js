import { createShopifyClient, readShopifyConfig, readExpectedShopId, verifyShopIdentity, ShopifyConnectionError } from './admin-client.js';

// Preview is the default. Network access requires an exact, explicit domain confirmation.
export async function runShopifyCheck({
  args = [], env = process.env, output = console.log, errorOutput = console.error,
  clientFactory = createShopifyClient,
} = {}) {
  try {
    const config = readShopifyConfig(env, { requireCredentials: false });
    if (args.length === 0 || (args.length === 1 && args[0] === '--dry-run')) {
      output(JSON.stringify({
        status: 'dry_run', shopDomain: config.shopDomain, apiVersion: config.apiVersion,
        query: 'shop { id name myshopifyDomain }', networkRequests: 0,
        expectedShopIdConfigured: Boolean(env.SHOPIFY_EXPECTED_SHOP_ID),
      }));
      return 0;
    }
    if (args.length !== 2 || args[0] !== '--confirm-shop' || args[1] !== config.shopDomain) {
      throw new ShopifyConnectionError('SHOP_CONFIRMATION_REQUIRED');
    }
    const expectedShopId = readExpectedShopId(env);
    const shop = await clientFactory(env).checkConnection();
    const diagnostics = verifyShopIdentity(shop, expectedShopId);
    // Do not print the response body or remotely controlled shop name.
    output(JSON.stringify({ status: 'connected', diagnostics }));
    return 0;
  } catch (error) {
    const result = { status: 'error', code: error instanceof ShopifyConnectionError ? error.code : 'INTERNAL_ERROR' };
    if (error instanceof ShopifyConnectionError && error.diagnostics) {
      result.diagnostics = Object.fromEntries([
        'responseMatchesPrimary', 'responseMatchesConnected', 'shopIdValid',
        'expectedShopIdConfigured', 'shopIdMatchesExpected',
      ].map((key) => [key, error.diagnostics[key] === true]));
    }
    errorOutput(JSON.stringify(result));
    return 1;
  }
}
