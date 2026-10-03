const API_VERSION = '2026-07';
const CONNECTION_QUERY = 'query ConnectionCheck { shop { id name myshopifyDomain } }';
const REFRESH_MARGIN_MS = 60_000;

// Only fixed codes cross the transport boundary. Never retain a raw cause/body.
export class ShopifyConnectionError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ShopifyConnectionError';
    this.code = code;
  }
}

const fail = (code) => { throw new ShopifyConnectionError(code); };

const SHOP_ID_PATTERN = /^gid:\/\/shopify\/Shop\/[1-9][0-9]*$/;

export function readExpectedShopId(env = process.env) {
  const value = env.SHOPIFY_EXPECTED_SHOP_ID;
  if (value === undefined || value === '') fail('MISSING_EXPECTED_SHOP_ID');
  if (typeof value !== 'string' || !SHOP_ID_PATTERN.test(value)) fail('INVALID_EXPECTED_SHOP_ID');
  return value;
}

// Fixed response allowlist; these domains never replace the configured request host.
export function verifyShopIdentity(shop, expectedShopId) {
  const diagnostics = {
    responseMatchesPrimary: shop?.myshopifyDomain === 'giragiraglasses.myshopify.com',
    responseMatchesConnected: shop?.myshopifyDomain === 'utuidm-sx.myshopify.com',
    shopIdValid: typeof shop?.id === 'string' && SHOP_ID_PATTERN.test(shop.id),
    expectedShopIdConfigured: typeof expectedShopId === 'string' && SHOP_ID_PATTERN.test(expectedShopId),
    shopIdMatchesExpected: false,
  };
  diagnostics.shopIdMatchesExpected = diagnostics.shopIdValid && diagnostics.expectedShopIdConfigured && shop.id === expectedShopId;
  let code;
  if (!diagnostics.expectedShopIdConfigured) code = 'MISSING_EXPECTED_SHOP_ID';
  else if (!diagnostics.shopIdValid) code = 'INVALID_RESPONSE';
  else if (!diagnostics.responseMatchesPrimary && !diagnostics.responseMatchesConnected) code = 'SHOP_DOMAIN_MISMATCH';
  else if (!diagnostics.shopIdMatchesExpected) code = 'SHOP_ID_MISMATCH';
  if (code) {
    const error = new ShopifyConnectionError(code);
    error.diagnostics = Object.freeze(diagnostics);
    throw error;
  }
  return diagnostics;
}

export function readShopifyConfig(env = process.env, { requireCredentials = true } = {}) {
  if (env.SHOPIFY_API_KEY || env.SHOPIFY_API_SECRET) fail('LEGACY_CONFIG_NOT_SUPPORTED');
  const shopDomain = env.SHOPIFY_SHOP_DOMAIN;
  if (typeof shopDomain !== 'string' || shopDomain.length > 253 ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(shopDomain)) {
    fail('INVALID_SHOP_DOMAIN');
  }
  if (env.SHOPIFY_API_VERSION !== API_VERSION) fail('INVALID_API_VERSION');
  const clientId = env.SHOPIFY_CLIENT_ID;
  const clientSecret = env.SHOPIFY_CLIENT_SECRET;
  if (requireCredentials && (![clientId, clientSecret].every(
    (value) => typeof value === 'string' && value.trim().length > 0 && value === value.trim(),
  ))) fail('MISSING_OR_INVALID_CREDENTIALS');
  return { shopDomain, apiVersion: API_VERSION, clientId, clientSecret };
}

// This client exposes one fixed read operation, never arbitrary GraphQL input.
export function createShopifyClient(env = process.env, {
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = 10_000,
} = {}) {
  const { shopDomain, apiVersion, clientId, clientSecret } = readShopifyConfig(env);
  const expectedShopId = readExpectedShopId(env);
  const origin = `https://${shopDomain}`;
  let cachedToken;
  let pendingToken;

  async function request(url, options, stage) {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await fetchImpl(url, { ...options, signal, redirect: 'error' });
      if (!response.ok) {
        if (response.status === 401) fail(stage === 'token' ? 'AUTHENTICATION_FAILED' : 'TOKEN_REJECTED');
        if (response.status === 403) fail('ACCESS_DENIED');
        if (response.status === 429) fail('RATE_LIMITED');
        if (response.status >= 500) fail('SHOPIFY_UNAVAILABLE');
        fail(stage === 'token' ? 'TOKEN_REQUEST_FAILED' : 'API_REQUEST_FAILED');
      }
      if (stage === 'graphql' && response.headers.get('x-shopify-api-version') !== apiVersion) {
        fail('API_VERSION_MISMATCH');
      }
      let body;
      try { body = await response.json(); } catch {
        fail(signal.aborted ? 'REQUEST_TIMEOUT' : 'INVALID_RESPONSE');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_RESPONSE');
      return body;
    } catch (error) {
      if (error instanceof ShopifyConnectionError) throw error;
      fail(signal.aborted ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR');
    }
  }

  async function getToken() {
    if (cachedToken && now() < cachedToken.refreshAt) return cachedToken;
    if (pendingToken) return pendingToken;
    pendingToken = (async () => {
      const startedAt = now();
      const body = await request(`${origin}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
      }, 'token');
      if (typeof body.access_token !== 'string' || !body.access_token ||
          /\s/.test(body.access_token) || !Number.isSafeInteger(body.expires_in) ||
          body.expires_in <= REFRESH_MARGIN_MS / 1000 || body.expires_in > 86_400) {
        fail('INVALID_TOKEN_RESPONSE');
      }
      const refreshAt = startedAt + body.expires_in * 1000 - REFRESH_MARGIN_MS;
      if (now() >= refreshAt) fail('INVALID_TOKEN_RESPONSE');
      cachedToken = { value: body.access_token, refreshAt };
      return cachedToken;
    })();
    try { return await pendingToken; } finally { pendingToken = undefined; }
  }

  async function checkConnection() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await getToken();
      let body;
      try {
        body = await request(`${origin}/admin/api/${apiVersion}/graphql.json`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Shopify-Access-Token': token.value },
          body: JSON.stringify({ query: CONNECTION_QUERY }),
        }, 'graphql');
      } catch (error) {
        if (error.code === 'TOKEN_REJECTED') {
          // A late 401 must not invalidate a newer token acquired by another call.
          if (cachedToken === token) cachedToken = undefined;
          if (attempt === 0) continue;
        }
        throw error;
      }
      if (body.errors !== undefined) {
        if (!Array.isArray(body.errors)) fail('INVALID_RESPONSE');
        if (body.errors.length) {
          const codes = body.errors.map((error) => error?.extensions?.code);
          if (codes.includes('THROTTLED')) fail('RATE_LIMITED');
          if (codes.includes('ACCESS_DENIED')) fail('ACCESS_DENIED');
          fail('GRAPHQL_ERROR');
        }
      }
      const shop = body.data?.shop;
      if (!shop || typeof shop.id !== 'string' || !shop.id.startsWith('gid://shopify/Shop/') ||
          typeof shop.name !== 'string' || typeof shop.myshopifyDomain !== 'string') fail('INVALID_RESPONSE');
      verifyShopIdentity(shop, expectedShopId);
      return { id: shop.id, name: shop.name, myshopifyDomain: shop.myshopifyDomain };
    }
  }

  return Object.freeze({ checkConnection });
}
