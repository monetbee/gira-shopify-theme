import test from 'node:test';
import assert from 'node:assert/strict';
import { createShopifyClient, readShopifyConfig } from '../src/shopify/admin-client.js';
import { runShopifyCheck } from '../src/shopify/check-command.js';

const env = {
  SHOPIFY_SHOP_DOMAIN: 'giragiraglasses.myshopify.com', SHOPIFY_API_VERSION: '2026-07',
  SHOPIFY_CLIENT_ID: 'fake-client-id', SHOPIFY_CLIENT_SECRET: 'fake-client-secret',
  SHOPIFY_EXPECTED_SHOP_ID: 'gid://shopify/Shop/1',
};
const shop = { id: 'gid://shopify/Shop/1', name: 'GIRA', myshopifyDomain: env.SHOPIFY_SHOP_DOMAIN };
const response = (body, status = 200, version = '2026-07') => new Response(JSON.stringify(body), {
  status, headers: { 'x-shopify-api-version': version },
});
const tokenResponse = (token = 'fake-token') => response({ access_token: token, expires_in: 86399 });
const shopResponse = () => response({ data: { shop } });
const rejectsCode = (fn, code) => assert.rejects(fn, (error) => error.code === code && error.message === code && !error.cause);

test('identity diagnostics accept only the two approved domains with the pinned Shop ID', async () => {
  for (const domain of ['giragiraglasses.myshopify.com', 'utuidm-sx.myshopify.com', 'unknown.myshopify.com']) {
    for (const id of ['gid://shopify/Shop/1', 'gid://shopify/Shop/2', 'gid://shopify/Shop/not-an-id']) {
      const lines = [];
      const urls = [];
      const exitCode = await runShopifyCheck({ env, args: ['--confirm-shop', env.SHOPIFY_SHOP_DOMAIN],
        output: (line) => lines.push(line), errorOutput: (line) => lines.push(line),
        clientFactory: (config) => createShopifyClient(config, { fetchImpl: async (url, options) => {
          urls.push(url);
          assert.equal(options.redirect, 'error');
          return url.endsWith('/access_token') ? tokenResponse() : response({ data: { shop: { ...shop, id, myshopifyDomain: domain } } });
        } }),
      });
      const result = JSON.parse(lines[0]);
      const allowed = domain !== 'unknown.myshopify.com';
      assert.equal(exitCode, allowed && id === shop.id ? 0 : 1);
      assert.equal(result.diagnostics.responseMatchesPrimary, domain === 'giragiraglasses.myshopify.com');
      assert.equal(result.diagnostics.responseMatchesConnected, domain === 'utuidm-sx.myshopify.com');
      assert.equal(result.diagnostics.shopIdMatchesExpected, id === shop.id);
      if (exitCode) assert.equal(result.code, id.endsWith('not-an-id') ? 'INVALID_RESPONSE' : !allowed ? 'SHOP_DOMAIN_MISMATCH' : 'SHOP_ID_MISMATCH');
      assert.equal(urls.length, 2);
      assert.ok(urls.every((url) => new URL(url).hostname === env.SHOPIFY_SHOP_DOMAIN));
      for (const value of [id, domain, env.SHOPIFY_CLIENT_ID, env.SHOPIFY_CLIENT_SECRET, 'fake-token']) {
        assert.ok(!lines.join('').includes(value));
      }
    }
  }
});

test('missing or invalid expected ID prevents client creation and network; dry run is not connected', async () => {
  for (const value of [undefined, '', '1', 'gid://shopify/Shop/0', 'gid://shopify/Shop/1 ', 'gid://shopify/Customer/1']) {
    const config = { ...env, SHOPIFY_EXPECTED_SHOP_ID: value };
    const expectedCode = value === undefined || value === '' ? 'MISSING_EXPECTED_SHOP_ID' : 'INVALID_EXPECTED_SHOP_ID';
    let calls = 0;
    assert.throws(() => createShopifyClient(config, { fetchImpl: async () => { calls++; } }), { code: expectedCode });
    const lines = [];
    const options = { env: config, output: (line) => lines.push(line), errorOutput: (line) => lines.push(line),
      clientFactory: () => { calls++; throw new Error('must not run'); } };
    assert.equal(await runShopifyCheck({ ...options, args: ['--confirm-shop', config.SHOPIFY_SHOP_DOMAIN] }), 1);
    assert.equal(JSON.parse(lines[0]).code, expectedCode);
    assert.equal(await runShopifyCheck(options), 0);
    assert.equal(JSON.parse(lines[1]).status, 'dry_run');
    assert.equal(JSON.parse(lines[1]).networkRequests, 0);
    assert.equal(calls, 0);
  }
});

test('config accepts only canonical domains, pinned version and new credentials', () => {
  assert.equal(readShopifyConfig(env).shopDomain, env.SHOPIFY_SHOP_DOMAIN);
  for (const domain of ['', 'https://giragiraglasses.myshopify.com', 'evil.com', 'a.myshopify.com/abc',
    'a.myshopify.com.evil.com', 'a@b.myshopify.com', '-a.myshopify.com', 'a.myshopify.com:443']) {
    assert.throws(() => readShopifyConfig({ ...env, SHOPIFY_SHOP_DOMAIN: domain }), { code: 'INVALID_SHOP_DOMAIN' });
  }
  for (const key of ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET']) {
    assert.throws(() => readShopifyConfig({ ...env, [key]: '' }), { code: 'MISSING_OR_INVALID_CREDENTIALS' });
  }
  for (const key of ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET']) {
    assert.throws(() => readShopifyConfig({ ...env, [key]: 'legacy' }), { code: 'LEGACY_CONFIG_NOT_SUPPORTED' });
  }
  assert.throws(() => readShopifyConfig({ ...env, SHOPIFY_API_VERSION: 'latest' }), { code: 'INVALID_API_VERSION' });
});

test('grant uses form body, GraphQL is fixed, and token expires with a 60 second margin', async () => {
  let time = 0;
  const calls = [];
  const client = createShopifyClient(env, { now: () => time, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/access_token') ? tokenResponse() : shopResponse();
  } });
  assert.deepEqual(await client.checkConnection(), shop);
  time = (86399 - 60) * 1000 - 1;
  await client.checkConnection();
  assert.equal(calls.filter((call) => call.url.endsWith('/access_token')).length, 1);
  time += 1;
  await client.checkConnection();
  assert.equal(calls.filter((call) => call.url.endsWith('/access_token')).length, 2);
  const grant = calls[0];
  assert.equal(grant.url, `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/oauth/access_token`);
  assert.deepEqual(Object.fromEntries(grant.options.body), {
    grant_type: 'client_credentials', client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET,
  });
  for (const { url, options } of calls) {
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(!url.includes(env.SHOPIFY_CLIENT_SECRET));
    if (url.endsWith('/graphql.json')) {
      assert.equal(url, `https://${env.SHOPIFY_SHOP_DOMAIN}/admin/api/2026-07/graphql.json`);
      assert.deepEqual(JSON.parse(options.body), { query: 'query ConnectionCheck { shop { id name myshopifyDomain } }' });
      assert.equal(options.headers['X-Shopify-Access-Token'], 'fake-token');
    }
  }
  assert.deepEqual(Object.keys(client), ['checkConnection']);
});

test('concurrent calls share a grant; failed grants are not cached', async () => {
  let grants = 0;
  let fail = true;
  const client = createShopifyClient(env, { fetchImpl: async (url) => {
    if (!url.endsWith('/access_token')) return shopResponse();
    grants += 1;
    await Promise.resolve();
    return fail ? response({}, 500) : tokenResponse();
  } });
  const first = await Promise.allSettled([client.checkConnection(), client.checkConnection()]);
  assert.ok(first.every((result) => result.status === 'rejected'));
  assert.equal(grants, 1);
  fail = false;
  await Promise.all([client.checkConnection(), client.checkConnection(), client.checkConnection()]);
  assert.equal(grants, 2);
});

test('401 renews once and repeated 401 fails without a retry loop', async () => {
  for (const persistent of [false, true]) {
    let grants = 0;
    let queries = 0;
    const client = createShopifyClient(env, { fetchImpl: async (url) => {
      if (url.endsWith('/access_token')) return tokenResponse(`fake-token-${++grants}`);
      queries += 1;
      return persistent || queries === 1 ? response({}, 401) : shopResponse();
    } });
    if (persistent) await rejectsCode(() => client.checkConnection(), 'TOKEN_REJECTED');
    else assert.deepEqual(await client.checkConnection(), shop);
    assert.equal(grants, 2);
    assert.equal(queries, 2);
  }
});

test('a delayed 401 does not discard a newer token during concurrent checks', async () => {
  let grants = 0;
  let oldQueries = 0;
  let releaseDelayed;
  const delayed = new Promise((resolve) => { releaseDelayed = resolve; });
  const client = createShopifyClient(env, { fetchImpl: async (url, options) => {
    if (url.endsWith('/access_token')) return tokenResponse(`fake-token-${++grants}`);
    if (options.headers['X-Shopify-Access-Token'] === 'fake-token-1') {
      oldQueries += 1;
      if (oldQueries === 2) await delayed;
      return response({}, 401);
    }
    return shopResponse();
  } });
  const first = client.checkConnection();
  const second = client.checkConnection();
  await first;
  releaseDelayed();
  await second;
  assert.equal(grants, 2);
});

test('HTTP, GraphQL, schema and version errors are sanitized', async () => {
  const cases = [
    [() => response({ secret: env.SHOPIFY_CLIENT_SECRET }, 403), 'ACCESS_DENIED'],
    [() => response({}, 429), 'RATE_LIMITED'], [() => response({}, 503), 'SHOPIFY_UNAVAILABLE'],
    [() => response({}, 400), 'API_REQUEST_FAILED'],
    [() => response({ errors: [{ message: env.SHOPIFY_CLIENT_SECRET }] }), 'GRAPHQL_ERROR'],
    [() => response({ errors: [{ extensions: { code: 'THROTTLED' } }] }), 'RATE_LIMITED'],
    [() => response({ errors: [{ extensions: { code: 'ACCESS_DENIED' } }] }), 'ACCESS_DENIED'],
    [() => response({ errors: 'bad' }), 'INVALID_RESPONSE'],
    [() => response({ data: { shop: null } }), 'INVALID_RESPONSE'],
    [() => response({ data: { shop: { ...shop, myshopifyDomain: 'other.myshopify.com' } } }), 'SHOP_DOMAIN_MISMATCH'],
    [() => response({ data: { shop } }, 200, '2026-10'), 'API_VERSION_MISMATCH'],
    [() => new Response('not-json', { headers: { 'x-shopify-api-version': '2026-07' } }), 'INVALID_RESPONSE'],
    [() => { throw new Error(env.SHOPIFY_CLIENT_SECRET); }, 'NETWORK_ERROR'],
  ];
  for (const [getResponse, code] of cases) {
    const client = createShopifyClient(env, { fetchImpl: async (url) => url.endsWith('/access_token') ? tokenResponse() : getResponse() });
    await rejectsCode(() => client.checkConnection(), code);
  }
});

test('invalid token payloads and authentication errors fail safely', async () => {
  for (const body of [{}, null, { access_token: 'x', expires_in: 0 },
    { access_token: 'x', expires_in: '86399' }, { access_token: 'x', expires_in: 1e20 },
    { access_token: 'bad\ntoken', expires_in: 86399 }]) {
    const client = createShopifyClient(env, { fetchImpl: async () => response(body) });
    await rejectsCode(() => client.checkConnection(), body === null ? 'INVALID_RESPONSE' : 'INVALID_TOKEN_RESPONSE');
  }
  for (const [status, code] of [[401, 'AUTHENTICATION_FAILED'], [400, 'TOKEN_REQUEST_FAILED']]) {
    const client = createShopifyClient(env, { fetchImpl: async () => response({ secret: env.SHOPIFY_CLIENT_SECRET }, status) });
    await rejectsCode(() => client.checkConnection(), code);
  }
});

test('request timeout is bounded and sanitized', async () => {
  const client = createShopifyClient(env, { timeoutMs: 5, fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
    const keepAlive = setTimeout(() => resolve(tokenResponse()), 1000);
    signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(new Error(env.SHOPIFY_CLIENT_SECRET)); }, { once: true });
  }) });
  await rejectsCode(() => client.checkConnection(), 'REQUEST_TIMEOUT');
});

test('CLI previews without credentials/network and requires exact confirmation', async () => {
  let factories = 0;
  const output = [];
  const errorOutput = [];
  const options = { env: { ...env, SHOPIFY_CLIENT_ID: '', SHOPIFY_CLIENT_SECRET: '' },
    output: (line) => output.push(line), errorOutput: (line) => errorOutput.push(line),
    clientFactory: () => { factories += 1; throw new Error('must not connect'); } };
  assert.equal(await runShopifyCheck(options), 0);
  assert.equal(await runShopifyCheck({ ...options, args: ['--dry-run'] }), 0);
  assert.equal(JSON.parse(output[0]).networkRequests, 0);
  for (const args of [['--confirm-shop', 'wrong.myshopify.com'], ['--live'], ['--confirm-shop']]) {
    assert.equal(await runShopifyCheck({ ...options, args }), 1);
  }
  assert.equal(factories, 0);
  assert.ok(errorOutput.every((line) => JSON.parse(line).code === 'SHOP_CONFIRMATION_REQUIRED'));
});

test('CLI live path only with confirmation; output never contains secrets, tokens or raw errors', async () => {
  const lines = [];
  const options = { env, args: ['--confirm-shop', env.SHOPIFY_SHOP_DOMAIN],
    output: (line) => lines.push(line), errorOutput: (line) => lines.push(line) };
  assert.equal(await runShopifyCheck({ ...options, clientFactory: () => ({ checkConnection: async () => ({ ...shop, name: 'fake-token' }) }) }), 0);
  assert.equal(await runShopifyCheck({ ...options, clientFactory: () => { throw new Error(`${env.SHOPIFY_CLIENT_SECRET} fake-token`); } }), 1);
  assert.equal(await runShopifyCheck({ ...options, clientFactory: (config) => createShopifyClient(config, {
    fetchImpl: async () => response({ error: `${env.SHOPIFY_CLIENT_SECRET} fake-token` }, 401),
  }) }), 1);
  const output = lines.join('\n');
  for (const secret of [env.SHOPIFY_CLIENT_ID, env.SHOPIFY_CLIENT_SECRET, 'fake-token']) assert.ok(!output.includes(secret));
  assert.equal(JSON.parse(lines[0]).status, 'connected');
  assert.equal(JSON.parse(lines[1]).code, 'INTERNAL_ERROR');
  assert.equal(JSON.parse(lines[2]).code, 'AUTHENTICATION_FAILED');
});
