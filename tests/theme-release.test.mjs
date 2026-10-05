import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../shopify-theme/assets/gira.js', import.meta.url), 'utf8');
const readTheme = (path) => fs.readFileSync(new URL(`../shopify-theme/${path}`, import.meta.url), 'utf8');

function node({ matches = [], dataset = {}, hidden = false } = {}) {
  const attrs = {};
  const classes = new Set();
  return {
    dataset, hidden, disabled: false, textContent: '',
    setAttribute: (key, value) => { attrs[key] = value; },
    getAttribute: (key) => attrs[key],
    matches: (selector) => matches.includes(selector),
    classList: {
      contains: (value) => classes.has(value),
      toggle: (value, on) => { if (on) classes.add(value); else classes.delete(value); },
    },
  };
}

function element(options = {}) {
  const item = node(options);
  item.closest = (selector) => (options.matches || []).includes(selector) ? item : null;
  return item;
}

function harness({ root = '/ja/', fetchImpl, withPage = true, parseSections = true } = {}) {
  const handlers = {};
  const control = element({ matches: ['[data-gira-cart-change]'], dataset: { lineKey: 'line-1', quantity: '2' } });
  const checkout = element({ matches: ['[data-gira-checkout]'] });
  const checkoutForm = element({ matches: ['[data-gira-checkout-form]'] });
  const alert = element({ hidden: true });
  const bubble = element();
  const drawer = element();
  drawer.classList.toggle('is-open', true);
  const page = withPage ? element() : null;
  drawer.replaceWith = () => {};
  if (page) page.replaceWith = () => {};
  const productError = element();
  const submit = element();
  const variant = { options: [{ dataset: { available: 'true' } }], selectedIndex: 0 };
  const product = element({ matches: ['.gira-product-form'] });
  product.querySelector = (selector) => ({
    '[data-gira-add-to-cart]': submit,
    '.gira-product-form-errors': productError,
    '[data-gira-variant-select]': variant,
  })[selector] || null;
  const document = {
    documentElement: element(),
    addEventListener: (name, handler) => (handlers[name] ||= []).push(handler),
    querySelector: (selector) => ({ '[data-gira-cart-drawer]': drawer, '[data-gira-cart-page]': page })[selector] || null,
    querySelectorAll: (selector) => ({
      '[data-gira-cart-change]': [control],
      '[data-gira-checkout]': [checkout],
      '[data-gira-cart-error]': [alert],
      '[data-gira-cart-count]': [bubble],
    })[selector] || [],
  };
  const calls = [];
  const context = {
    document,
    window: { Shopify: { routes: { root } }, location: { pathname: '/ja/cart' }, addEventListener: () => {} },
    fetch: async (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); },
    FormData: class {},
    DOMParser: class { parseFromString(html) { return { querySelector: () => parseSections && html ? element() : null }; } },
    URL, URLSearchParams,
  };
  vm.runInNewContext(source, context);
  const fire = async (type, target) => {
    const event = { target, prevented: false, preventDefault() { this.prevented = true; } };
    for (const handler of handlers[type] || []) await handler(event);
    return event;
  };
  return { fire, control, checkout, checkoutForm, alert, bubble, drawer, product, productError, submit, variant, calls };
}

const cart = (quantity = 2, sections = { 'gira-cart-drawer': '<aside/>', 'gira-main-cart': '<main/>' }) => ({
  item_count: quantity, items: quantity ? [{ key: 'line-1', quantity }] : [], sections,
});
const response = (data, { ok = true } = {}) => ({ ok, json: async () => data, text: async () => '<section/>' });

test('failed quantity update shows a visible bilingual alert and restores controls', async () => {
  const h = harness({ fetchImpl: async () => response(null, { ok: false }) });
  await h.fire('click', h.control);
  assert.equal(h.alert.hidden, false);
  assert.match(h.alert.textContent, /数量変更/);
  assert.equal(h.control.disabled, false);
  assert.equal(h.checkout.getAttribute('aria-disabled'), 'false');
  assert.equal(h.calls.length, 1, 'no automatic retry of a write');
});

test('network failure never repeats the cart mutation', async () => {
  const h = harness({ fetchImpl: async () => { throw new Error('offline'); } });
  await h.fire('click', h.control);
  assert.equal(h.calls.length, 1);
  assert.equal(h.alert.hidden, false);
  assert.equal(h.control.disabled, false);
});

test('successful quantity update clears old errors and updates count', async () => {
  const h = harness({ fetchImpl: async () => response(cart()) });
  h.alert.hidden = false;
  h.alert.textContent = 'previous failure';
  await h.fire('click', h.control);
  assert.equal(h.alert.hidden, true);
  assert.equal(h.bubble.textContent, '2');
  assert.equal(h.control.disabled, false);
  assert.equal(h.drawer.classList.contains('is-open'), true);
  assert.equal(h.calls[0].url, '/ja/cart/change.js');
  assert.deepEqual(JSON.parse(h.calls[0].options.body).sections, ['gira-cart-drawer', 'gira-main-cart']);
});

test('stock-clamped quantity is communicated', async () => {
  const h = harness({ fetchImpl: async () => response(cart(1)) });
  await h.fire('click', h.control);
  assert.match(h.alert.textContent, /在庫/);
  assert.equal(h.alert.hidden, false);
});

test('removing the last item clears count without a false stock alert', async () => {
  const h = harness({ fetchImpl: async () => response(cart(0)) });
  h.control.dataset.quantity = '0';
  await h.fire('click', h.control);
  assert.equal(h.bubble.hidden, true);
  assert.equal(h.alert.hidden, true);
});

test('checkout clicks, checkout submissions and duplicate updates are blocked while a write is pending', async () => {
  let release;
  const h = harness({ fetchImpl: () => new Promise(resolve => { release = resolve; }) });
  const first = h.fire('click', h.control);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.control.disabled, true);
  assert.equal((await h.fire('click', h.checkout)).prevented, true);
  assert.equal((await h.fire('submit', h.checkoutForm)).prevented, true);
  await h.fire('click', h.control);
  assert.equal(h.calls.length, 1);
  release(response(cart()));
  await first;
  assert.equal((await h.fire('submit', h.checkoutForm)).prevented, false);
});

test('missing sections trigger a read-only refresh in the active locale', async () => {
  const h = harness({ fetchImpl: async url => response(url.endsWith('change.js') ? cart(2, null) : cart()) });
  await h.fire('click', h.control);
  assert.deepEqual(h.calls.map(call => call.url), [
    '/ja/cart/change.js', '/ja/cart.js', '/ja/?section_id=gira-cart-drawer', '/ja/cart?section_id=gira-main-cart',
  ]);
  assert.equal(h.alert.hidden, true);
});

test('failed section refresh is not treated as successful display sync', async () => {
  const h = harness({ fetchImpl: async () => response(cart(2, null)), parseSections: false });
  await h.fire('click', h.control);
  assert.equal(h.alert.hidden, false);
  assert.equal(h.control.disabled, false);
});

test('add succeeds but display refresh fails: warns against adding again', async () => {
  const h = harness({ fetchImpl: async url => response({}, { ok: url.endsWith('add.js') }) });
  await h.fire('submit', h.product);
  assert.equal(h.calls[0].url, '/ja/cart/add.js');
  assert.match(h.productError.textContent, /商品は追加済み/);
  assert.equal(h.calls.filter(call => call.url.endsWith('add.js')).length, 1);
  assert.equal(h.submit.disabled, false);
});

test('variant becomes unavailable during add: submit remains sold out', async () => {
  const h = harness({ fetchImpl: async () => { h.variant.options[0].dataset.available = 'false'; throw new Error('offline'); } });
  await h.fire('submit', h.product);
  assert.equal(h.submit.disabled, true);
  assert.equal(h.submit.textContent, 'SOLD OUT');
});

test('root without trailing slash and absent locale preserve correct cart URLs', async () => {
  for (const [root, expected] of [['/en', '/en/cart/change.js'], ['/', '/cart/change.js']]) {
    const h = harness({ root, fetchImpl: async () => response(cart()) });
    await h.fire('click', h.control);
    assert.equal(h.calls[0].url, expected);
  }
});

// This projects ONLY the loyalty conditions, not Shopify's full Liquid engine.
function projectLoyalty(text, enabled) {
  const stack = [];
  let output = '';
  for (const part of text.split(/({%[\s\S]*?%})/g)) {
    const tag = part.match(/^{%\s*(if|unless|else|elsif|endif|endunless)\b([\s\S]*?)%}$/);
    if (tag) {
      const [, kind, condition] = tag;
      if (kind === 'if' || kind === 'unless') {
        const relevant = condition.trim() === 'settings.gira_sparks_enabled';
        stack.push({ relevant, active: !relevant || (kind === 'if' ? enabled : !enabled) });
      } else if (kind === 'else') {
        const frame = stack.at(-1);
        if (frame?.relevant) frame.active = !frame.active;
      } else if (kind === 'endif' || kind === 'endunless') {
        assert.ok(stack.pop(), 'balanced conditional tags');
      }
    }
    if (stack.every(frame => frame.active)) output += tag ? '' : part;
  }
  assert.equal(stack.length, 0);
  return output;
}

test('SPARKS defaults off and all customer-facing point promises/balances are gated', () => {
  const schema = JSON.parse(readTheme('config/settings_schema.json'));
  const flag = schema.flatMap(group => group.settings || []).find(setting => setting.id === 'gira_sparks_enabled');
  assert.equal(flag.default, false);
  for (const path of ['sections/gira-header.liquid', 'snippets/gira-club-content.liquid', 'snippets/gira-my-gira-content.liquid']) {
    const text = readTheme(path);
    assert.doesNotMatch(projectLoyalty(text, false), /SPARKS|sparks_balance|gira_loyalty|AVAILABLE BALANCE/);
    assert.match(projectLoyalty(text, true), /SPARKS/);
  }
  assert.match(projectLoyalty(readTheme('snippets/gira-my-gira-content.liquid'), false), /ORDER HISTORY/);
});

test('both cart surfaces have live alerts and native locale-aware Checkout forms', () => {
  for (const path of ['sections/gira-main-cart.liquid', 'snippets/gira-cart-drawer.liquid']) {
    const text = readTheme(path);
    assert.match(text, /role="alert" hidden data-gira-cart-error/);
    assert.match(text, /action="{{ routes.cart_url }}" method="post" data-gira-checkout-form/);
    assert.match(text, /name="checkout" data-gira-checkout/);
    assert.doesNotMatch(text, /href="\/checkout"/);
  }
});

test('mobile intrinsic-width guards exist without reducing quantity touch targets', () => {
  const cartCss = readTheme('assets/gira-cart.css');
  assert.match(cartCss, /\.gira-cart-page-line__body \{ min-width:0; grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(cartCss, /flex-wrap:wrap; gap:\.5rem/);
  assert.match(cartCss, /\.gira-cart-quantity button\{width:44px;height:44px/);
  assert.match(readTheme('assets/gira-product.css'), /\.gira-product-detail-gallery \{ grid-template-columns:minmax\(0,1fr\)/);
});
