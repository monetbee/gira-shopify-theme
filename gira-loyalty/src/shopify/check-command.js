import { createShopifyClient, readShopifyConfig, ShopifyConnectionError } from './admin-client.js';

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
      }));
      return 0;
    }
    if (args.length !== 2 || args[0] !== '--confirm-shop' || args[1] !== config.shopDomain) {
      throw new ShopifyConnectionError('SHOP_CONFIRMATION_REQUIRED');
    }
    await clientFactory(env).checkConnection();
    // Do not print the response body or remotely controlled shop name.
    output(JSON.stringify({ status: 'connected', shopDomain: config.shopDomain, apiVersion: config.apiVersion }));
    return 0;
  } catch (error) {
    errorOutput(JSON.stringify({ status: 'error', code: error instanceof ShopifyConnectionError ? error.code : 'INTERNAL_ERROR' }));
    return 1;
  }
}
