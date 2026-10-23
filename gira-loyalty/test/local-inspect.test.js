import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocalInspection, formatIdentity } from '../src/shopify/local-inspect.js';
import { createShopifyClient } from '../src/shopify/admin-client.js';

const env = { SHOPIFY_SHOP_DOMAIN: 'giragiraglasses.myshopify.com', SHOPIFY_API_VERSION: '2026-07',
  SHOPIFY_EXPECTED_SHOP_ID: 'gid://shopify/Shop/7368034643', SHOPIFY_CLIENT_ID: 'fake-id', SHOPIFY_CLIENT_SECRET: 'secret-sentinel' };
const args = ['--view-identity', '--confirm-shop', env.SHOPIFY_SHOP_DOMAIN];
function setup(answer = 'VIEW') {
  const events = [];
  return { events, terminal: { open: () => events.push('open'), confirm: async () => answer,
    view: async text => events.push(text), result: async ok => events.push(ok), close: () => events.push('closed') } };
}

test('local viewer rejects hosting, CI, non-TTY and missing flags before any interaction or client', async () => {
  for (const overrides of [{ interactive: false }, { env: { ...env, RENDER: 'true' } },
    { env: { ...env, CI: 'false' } }, { env: { ...env, GITHUB_ACTIONS: 'true' } },
    { args: [] }, { args: ['--view-identity', '--confirm-shop', 'other.myshopify.com'] }]) {
    const { events, terminal } = setup();
    assert.equal(await runLocalInspection({ env, args, interactive: true, terminal,
      clientFactory: () => { throw new Error('must not create'); }, ...overrides }), 1);
    assert.deepEqual(events, []);
  }
});

test('local viewer requires typed consent before creating a client', async () => {
  const { events, terminal } = setup('NO');
  let created = false;
  assert.equal(await runLocalInspection({ env, args, interactive: true, terminal,
    clientFactory: () => { created = true; } }), 1);
  assert.equal(created, false);
  assert.deepEqual(events, ['open', 'closed']);
});

test('refusal and setup failures report only fixed safe reasons', async () => {
  for (const [overrides, expected] of [
    [{ interactive: false }, 'INTERACTIVE_TERMINAL_REQUIRED'],
    [{ env: { ...env, RENDER: 'true' } }, 'HOSTED_OR_CI_REFUSED'],
    [{ args: [] }, 'FLAGS_OR_SHOP_CONFIRMATION_INVALID'],
    [{ env: { ...env, SHOPIFY_CLIENT_SECRET: '' } }, 'MISSING_OR_INVALID_CREDENTIALS'],
    [{ env: { ...env, SHOPIFY_EXPECTED_SHOP_ID: '' } }, 'MISSING_EXPECTED_SHOP_ID'],
  ]) {
    const { terminal } = setup();
    const reasons = [];
    let created = false;
    assert.equal(await runLocalInspection({ env, args, interactive: true, terminal,
      report: code => reasons.push(code), clientFactory: () => { created = true; }, ...overrides }), 1);
    assert.deepEqual(reasons, [expected]);
    assert.equal(created, false);
  }
  const { terminal } = setup();
  terminal.open = () => { throw new Error('secret-sentinel token-sentinel'); };
  const reasons = [];
  assert.equal(await runLocalInspection({ env, args, interactive: true, terminal, report: code => reasons.push(code) }), 1);
  assert.deepEqual(reasons, ['TERMINAL_OPEN_FAILED']);
});

test('viewer exposes only two fields and preserves matching, domain and ID failures', async () => {
  for (const mode of ['ok', 'id', 'domain']) {
    const { events, terminal } = setup();
    let requests = 0;
    const code = await runLocalInspection({ env, args, interactive: true, terminal,
      clientFactory: (config, options) => createShopifyClient(config, { ...options, fetchImpl: async (url, request) => {
        requests++;
        if (url.endsWith('/access_token')) return new Response(JSON.stringify({ access_token: 'token-sentinel', expires_in: 86399 }));
        assert.deepEqual(JSON.parse(request.body), { query: 'query ConnectionCheck { shop { id name myshopifyDomain } }' });
        assert.equal(new URL(url).hostname, env.SHOPIFY_SHOP_DOMAIN);
        return new Response(JSON.stringify({ data: { shop: { id: mode === 'id' ? 'gid://shopify/Shop/2' : env.SHOPIFY_EXPECTED_SHOP_ID,
          myshopifyDomain: mode === 'domain' ? 'other.myshopify.com' : 'utuidm-sx.myshopify.com', name: 'person@example.com' } } }),
        { headers: { 'x-shopify-api-version': '2026-07' } });
      } }),
    });
    assert.equal(code, mode === 'ok' ? 0 : 1);
    assert.equal(requests, 2);
    assert.equal(events.at(-1), 'closed');
    assert.equal(events[1].split('\n').length, 2);
    assert.equal(events[2], mode === 'ok');
    for (const secret of ['secret-sentinel', 'token-sentinel', 'person@example.com', 'fake-id']) assert.ok(!JSON.stringify(events).includes(secret));
  }
});

test('viewer suppresses malicious identity values and raw exceptions', async () => {
  for (const domain of ['person@example.com', 'utuidm-sx.myshopify.com\u001b[2J', 'x'.repeat(254)]) {
    assert.throws(() => formatIdentity({ id: 'gid://shopify/Shop/1', myshopifyDomain: domain }));
  }
  const { events, terminal } = setup();
  assert.equal(await runLocalInspection({ env, args, interactive: true, terminal,
    clientFactory: () => { throw new Error('secret-sentinel token-sentinel'); } }), 1);
  assert.deepEqual(events, ['open', false, 'closed']);
});

test('post-consent failures identify API phase and show mismatched identities before rejection', async () => {
  for (const [mode, expected] of [
    ['setup', 'CLIENT_SETUP_FAILED'], ['auth', 'AUTH_AUTHENTICATION_FAILED'],
    ['network', 'AUTH_NETWORK_ERROR'], ['graphql', 'GRAPHQL_GRAPHQL_ERROR'],
    ['json', 'GRAPHQL_INVALID_RESPONSE'], ['format', 'IDENTITY_DISPLAY_FORMAT_REJECTED'],
    ['mismatch', 'IDENTITY_SHOP_DOMAIN_MISMATCH'],
  ]) {
    const { events, terminal } = setup();
    let detail;
    terminal.result = async (_ok, value) => { detail = value; };
    const reasons = [];
    let calls = 0;
    const code = await runLocalInspection({ env, args, interactive: true, terminal, report: value => reasons.push(value),
      clientFactory: (config, options) => {
        if (mode === 'setup') throw new Error('secret-sentinel');
        return createShopifyClient(config, { ...options, fetchImpl: async url => {
          calls++;
          if (mode === 'network') throw new Error('secret-sentinel');
          if (url.endsWith('/access_token')) return new Response(JSON.stringify({ access_token: 'token-sentinel', expires_in: 86399 }), { status: mode === 'auth' ? 401 : 200 });
          const body = mode === 'graphql' ? { errors: [{ message: 'secret-sentinel' }] } : { data: { shop: {
            id: env.SHOPIFY_EXPECTED_SHOP_ID, name: 'person@example.com', myshopifyDomain: mode === 'format' ? 'person@example.com' : 'other.myshopify.com',
          } } };
          return new Response(mode === 'json' ? '{' : JSON.stringify(body), { headers: { 'x-shopify-api-version': '2026-07' } });
        } });
      },
    });
    assert.equal(code, 1);
    assert.equal(reasons[0], expected);
    assert.equal(detail.apiStarted, mode !== 'setup');
    assert.equal(detail.identityDisplayed, mode === 'mismatch');
    assert.equal(calls, mode === 'setup' ? 0 : ['auth', 'network'].includes(mode) ? 1 : 2);
    if (mode === 'mismatch') assert.ok(events[1].includes('other.myshopify.com'));
    assert.ok(!JSON.stringify({ detail, reasons }).includes('secret-sentinel'));
  }
});
