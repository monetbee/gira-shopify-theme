import { randomUUID } from 'node:crypto';
import { createShopifyClient, readShopifyConfig, readExpectedShopId, verifyShopIdentity, ShopifyConnectionError, validRequestId } from './admin-client.js';

// Preview is the default. Network access requires an exact, explicit domain confirmation.
export async function runShopifyCheck({
  args = [], env = process.env, output = console.log, errorOutput = console.error,
  clientFactory = createShopifyClient,
} = {}) {
  const diagnosticId = randomUUID();
  let correlation = { diagnosticId, attempt: 0, requestId: null };
  try {
    const config = readShopifyConfig(env, { requireCredentials: false });
    if (args.length === 0 || (args.length === 1 && args[0] === '--dry-run')) {
      output(JSON.stringify({
        status: 'dry_run', ...correlation, shopDomain: config.shopDomain, apiVersion: config.apiVersion,
        query: 'shop { id name myshopifyDomain }', networkRequests: 0,
        expectedShopIdConfigured: Boolean(env.SHOPIFY_EXPECTED_SHOP_ID),
      }));
      return 0;
    }
    if (args.length !== 2 || args[0] !== '--confirm-shop' || args[1] !== config.shopDomain) {
      throw new ShopifyConnectionError('SHOP_CONFIRMATION_REQUIRED');
    }
    const expectedShopId = readExpectedShopId(env);
    const onDiagnostic = (event) => {
      // Rebuild from an explicit allowlist: never serialize a transport object.
      if (!['token', 'graphql', 'graphql_structure', 'identity_parsed', 'identity_before_validation', 'identity_final'].includes(event?.stage)) return;
      correlation = { diagnosticId,
        attempt: [1, 2].includes(event.attempt) ? event.attempt : 0,
        requestId: validRequestId(event.requestId) ? event.requestId : null };
      const diagnostic = { stage: event.stage };
      for (const key of [
        'requestHostMatches', 'requestHttps', 'responseReceived', 'responseHostMatches',
        'responseHttps', 'redirected', 'contentTypeJson', 'apiVersionMatches',
        'jsonParsed', 'rootObject', 'dataObject', 'shopObject', 'idString', 'nameString',
        'domainString', 'errorsPresent', 'errorsArray', 'hasGraphqlErrors',
        'domainMatchesPrimaryAfterTrim', 'domainMatchesConnectedAfterTrim',
        'domainMatchesPrimaryAfterTrimLowercase', 'domainMatchesConnectedAfterTrimLowercase',
        'idMatchesAfterTrim',
        'requestIdPresent', 'requestIdValid', 'identityAvailable', 'responseMatchesPrimary',
        'responseMatchesConnected', 'shopIdMatchesExpected', 'expectedMatchesIndependent', 'accepted',
      ]) {
        if (Object.hasOwn(event, key)) diagnostic[key] = typeof event[key] === 'boolean' ? event[key] : null;
      }
      if (Object.hasOwn(event, 'httpStatus')) {
        diagnostic.httpStatus = Number.isInteger(event.httpStatus) && event.httpStatus >= 100 && event.httpStatus <= 599 ? event.httpStatus : null;
      }
      output(JSON.stringify({ status: 'diagnostic', ...correlation, diagnostic }));
    };
    const shop = await clientFactory(env, { onDiagnostic }).checkConnection({ diagnosticId });
    const diagnostics = verifyShopIdentity(shop, expectedShopId);
    // Do not print the response body or remotely controlled shop name.
    output(JSON.stringify({ status: 'connected', ...correlation, diagnostics }));
    return 0;
  } catch (error) {
    const result = { status: 'error', ...correlation, code: error instanceof ShopifyConnectionError ? error.code : 'INTERNAL_ERROR' };
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
