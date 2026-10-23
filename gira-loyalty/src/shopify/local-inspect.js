import { createShopifyClient, readShopifyConfig, readExpectedShopId } from './admin-client.js';

export function localInspectionAllowed(env, interactive) {
  return interactive && !Object.keys(env).some(key =>
    /^(RENDER(?:_|$)|CI$|CI_|CONTINUOUS_INTEGRATION$|GITHUB_ACTIONS$|GITLAB_CI$|BUILD_BUILDID$|JENKINS_URL$|TEAMCITY_VERSION$|CIRCLECI$|TRAVIS$|BUILDKITE$)/.test(key));
}

export function formatIdentity(identity) {
  // Bounds and strict character allowlists prevent control sequences, arbitrary
  // text and personal fields masquerading as identity values from reaching the UI.
  if (typeof identity.id !== 'string' || identity.id.length > 100 ||
      !/^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/.test(identity.id) ||
      typeof identity.myshopifyDomain !== 'string' || identity.myshopifyDomain.length > 253 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(identity.myshopifyDomain)) {
    throw new Error('UNSAFE_IDENTITY_FORMAT');
  }
  return `data.shop.id: ${identity.id}\ndata.shop.myshopifyDomain: ${identity.myshopifyDomain}`;
}

export async function runLocalInspection({ args, env, interactive, terminal, clientFactory = createShopifyClient, report = () => {} }) {
  // No terminal opening, credential reading or client creation before this gate.
  if (!localInspectionAllowed(env, interactive)) {
    report(interactive ? 'HOSTED_OR_CI_REFUSED' : 'INTERACTIVE_TERMINAL_REQUIRED');
    return 1;
  }
  if (args.length !== 3 || args[0] !== '--view-identity' || args[1] !== '--confirm-shop' ||
      args[2] !== env.SHOPIFY_SHOP_DOMAIN) {
    report('FLAGS_OR_SHOP_CONFIRMATION_INVALID');
    return 1;
  }
  let phase = 'config';
  let viewFailure;
  let apiStarted = false;
  let identityDisplayed = false;
  try {
    readShopifyConfig(env);
    readExpectedShopId(env);
    phase = 'terminal';
    await terminal.open();
    phase = 'confirmation';
    if (await terminal.confirm() !== 'VIEW') { report('CONSENT_NOT_GIVEN'); return 1; }
    phase = 'client_setup';
    const client = clientFactory(env, {
      onRequestStart: stage => {
        if (stage === 'token' || stage === 'graphql') { phase = stage; apiStarted = true; }
      },
      inspectIdentity: async identity => {
        phase = 'view';
        let text;
        try { text = formatIdentity(identity); } catch {
          viewFailure = 'IDENTITY_DISPLAY_FORMAT_REJECTED';
          throw new Error('LOCAL_VIEW_FAILED');
        }
        try {
          await terminal.view(text);
          identityDisplayed = true;
        } catch {
          viewFailure = 'IDENTITY_VIEW_CANCELLED_OR_FAILED';
          throw new Error('LOCAL_VIEW_FAILED');
        }
        phase = 'identity';
      },
    });
    await client.checkConnection();
    await terminal.result(true);
    return 0;
  } catch (error) {
    const configCodes = ['LEGACY_CONFIG_NOT_SUPPORTED', 'INVALID_SHOP_DOMAIN', 'INVALID_API_VERSION',
      'MISSING_OR_INVALID_CREDENTIALS', 'MISSING_EXPECTED_SHOP_ID', 'INVALID_EXPECTED_SHOP_ID'];
    const apiCodes = ['AUTHENTICATION_FAILED', 'TOKEN_REQUEST_FAILED', 'INVALID_TOKEN_RESPONSE',
      'ACCESS_DENIED', 'RATE_LIMITED', 'SHOPIFY_UNAVAILABLE', 'REQUEST_TIMEOUT', 'NETWORK_ERROR',
      'TOKEN_REJECTED', 'API_REQUEST_FAILED', 'API_VERSION_MISMATCH', 'INVALID_RESPONSE', 'GRAPHQL_ERROR',
      'SHOP_DOMAIN_MISMATCH', 'SHOP_ID_MISMATCH'];
    const detail = apiCodes.includes(error?.code) ? error.code : 'FAILED';
    const code = phase === 'config' && configCodes.includes(error?.code) ? error.code :
      phase === 'terminal' ? 'TERMINAL_OPEN_FAILED' : phase === 'confirmation' ? 'CONFIRMATION_CANCELLED' :
      viewFailure ?? (phase === 'client_setup' ? 'CLIENT_SETUP_FAILED' :
        phase === 'token' ? `AUTH_${detail}` : phase === 'graphql' ? `GRAPHQL_${detail}` :
          phase === 'identity' ? `IDENTITY_${detail}` : 'INSPECTION_FAILED');
    report(code);
    // Never forward exception objects, response bodies or remotely supplied text.
    try { await terminal.result(false, { code, apiStarted, identityDisplayed }); } catch { /* Silent safe failure. */ }
    return 1;
  } finally {
    try { await terminal.close(); } catch { report('TERMINAL_CLEANUP_FAILED'); }
  }
}
