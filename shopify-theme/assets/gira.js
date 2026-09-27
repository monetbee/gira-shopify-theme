(() => {
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-gira-menu-toggle]');
    if (!toggle) return;
    const menu = document.getElementById(toggle.getAttribute('aria-controls'));
    if (!menu) return;
    const isOpen = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!isOpen));
    menu.hidden = isOpen;
    document.documentElement.classList.toggle('gira-menu-open', !isOpen);
  });
  document.addEventListener('change', (event) => {
    if (event.target.matches('[data-gira-sort]')) event.target.form.submit();
  });

  const closeAccountMenu = () => {
    document.querySelectorAll('[data-gira-account-menu]').forEach((menuRoot) => {
      const toggle = menuRoot.querySelector('[data-gira-account-toggle]');
      const popover = menuRoot.querySelector('[data-gira-account-popover]');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
      if (popover) popover.hidden = true;
    });
  };
  const setAccountMenuOpen = (menuRoot, isOpen) => {
    const toggle = menuRoot?.querySelector('[data-gira-account-toggle]');
    const popover = menuRoot?.querySelector('[data-gira-account-popover]');
    if (!toggle || !popover) return;
    toggle.setAttribute('aria-expanded', String(isOpen));
    popover.hidden = !isOpen;
  };

  document.querySelectorAll('[data-gira-account-menu]').forEach((menuRoot) => {
    const toggle = menuRoot.querySelector('[data-gira-account-toggle]');
    if (!toggle) return;
    const desktopAccountMenu = window.matchMedia('(min-width: 768px) and (hover: hover) and (pointer: fine)');

    toggle.addEventListener('click', (event) => {
      if (desktopAccountMenu.matches) {
        const accountUrl = toggle.dataset.giraAccountUrl;
        if (accountUrl) window.location.assign(accountUrl);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const isOpen = toggle.getAttribute('aria-expanded') === 'true';
      closeAccountMenu();
      setAccountMenuOpen(menuRoot, !isOpen);
    });

    if (desktopAccountMenu.matches) {
      menuRoot.addEventListener('mouseenter', () => {
        closeAccountMenu();
        setAccountMenuOpen(menuRoot, true);
      });
      menuRoot.addEventListener('mouseleave', () => {
        setAccountMenuOpen(menuRoot, false);
      });
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('[data-gira-account-menu]')) closeAccountMenu();
  });

  document.querySelectorAll('[data-gira-product]').forEach((productRoot) => {
    const variantSelect = productRoot.querySelector('[data-gira-variant-select]');
    if (!variantSelect) return;

    const setActiveMedia = (mediaId) => {
      if (!mediaId) return;
      productRoot.querySelectorAll('[data-gira-product-media]').forEach((media) => {
        media.hidden = media.dataset.mediaId !== String(mediaId);
      });
      productRoot.querySelectorAll('[data-gira-product-thumb]').forEach((thumb) => {
        const active = thumb.dataset.mediaId === String(mediaId);
        thumb.classList.toggle('is-active', active);
        thumb.setAttribute('aria-pressed', String(active));
      });
    };

    const updateVariant = () => {
      const option = variantSelect.options[variantSelect.selectedIndex];
      if (!option) return;
      productRoot.querySelectorAll('[data-gira-variant-button]').forEach((button) => {
        const active = button.dataset.giraVariantId === option.value;
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-pressed', String(active));
      });
      const price = productRoot.querySelector('[data-gira-product-price]');
      if (price) price.textContent = option.dataset.price || '';
      const compare = productRoot.querySelector('[data-gira-product-compare]');
      if (compare) {
        compare.textContent = option.dataset.compare || '';
        compare.hidden = !option.dataset.compare;
      }
      const stock = productRoot.querySelector('[data-gira-product-stock]');
      const submit = productRoot.querySelector('[data-gira-add-to-cart]');
      const available = option.dataset.available === 'true';
      if (stock) {
        stock.classList.toggle('is-sold-out', !available);
        stock.querySelector('[data-gira-stock-copy]').textContent = available ? 'IN STOCK — AVAILABLE TO PURCHASE' : 'CURRENTLY SOLD OUT';
        stock.querySelector('[data-gira-stock-icon]').textContent = available ? '✓' : '×';
      }
      if (submit) {
        submit.disabled = !available;
        submit.textContent = available ? 'ADD TO CART' : 'SOLD OUT';
      }
      setActiveMedia(option.dataset.featuredMediaId);
    };

    variantSelect.addEventListener('change', updateVariant);
    productRoot.querySelectorAll('[data-gira-variant-button]').forEach((button) => {
      button.addEventListener('click', () => {
        variantSelect.value = button.dataset.giraVariantId;
        variantSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    productRoot.querySelectorAll('[data-gira-product-thumb]').forEach((thumb) => {
      thumb.addEventListener('click', () => setActiveMedia(thumb.dataset.mediaId));
    });
    const shiftMedia = (direction) => {
      const media = Array.from(productRoot.querySelectorAll('[data-gira-product-media]'));
      const activeIndex = media.findIndex((item) => !item.hidden);
      if (activeIndex < 0 || media.length < 2) return;
      const nextIndex = (activeIndex + direction + media.length) % media.length;
      setActiveMedia(media[nextIndex].dataset.mediaId);
    };
    productRoot.querySelector('[data-gira-gallery-previous]')?.addEventListener('click', () => shiftMedia(-1));
    productRoot.querySelector('[data-gira-gallery-next]')?.addEventListener('click', () => shiftMedia(1));
    updateVariant();
  });

  const cartDrawerSelector = '[data-gira-cart-drawer]';
  const cartOpenClass = 'is-open';
  let isCartUpdating = false;
  const setCartOpen = (isOpen) => {
    const drawer = document.querySelector(cartDrawerSelector);
    if (!drawer) return;
    drawer.classList.toggle(cartOpenClass, isOpen);
    drawer.setAttribute('aria-hidden', String(!isOpen));
    document.documentElement.classList.toggle('gira-cart-open', isOpen);
    document.querySelectorAll('[data-gira-cart-toggle]').forEach((toggle) => toggle.setAttribute('aria-expanded', String(isOpen)));
  };
  const updateCartCount = (count) => {
    document.querySelectorAll('[data-gira-cart-count]').forEach((bubble) => {
      bubble.textContent = String(count);
      bubble.hidden = count === 0;
    });
  };
  const replaceCartSection = (html, selector) => {
    if (!html) return;
    const documentFragment = new DOMParser().parseFromString(html, 'text/html');
    const nextSection = documentFragment.querySelector(selector);
    const currentSection = document.querySelector(selector);
    if (nextSection && currentSection) currentSection.replaceWith(nextSection);
  };
  const setCartControlsDisabled = (disabled) => {
    document.querySelectorAll('[data-gira-cart-change]').forEach((control) => {
      control.disabled = disabled;
      control.setAttribute('aria-busy', String(disabled));
    });
  };
  const renderCartSections = (sections) => {
    if (!sections) return;
    replaceCartSection(sections['gira-cart-drawer'], cartDrawerSelector);
    if (document.querySelector('[data-gira-cart-page]')) {
      replaceCartSection(sections['gira-main-cart'], '[data-gira-cart-page]');
    }
  };
  const refreshCart = async ({ openDrawer = false } = {}) => {
    const requests = [
      fetch('/cart.js', { headers: { Accept: 'application/json' } }),
      fetch('/?section_id=gira-cart-drawer'),
    ];
    if (document.querySelector('[data-gira-cart-page]')) requests.push(fetch('/cart?section_id=gira-main-cart'));
    const responses = await Promise.all(requests);
    const [cartResponse, drawerResponse, pageResponse] = responses;
    if (!cartResponse.ok || !drawerResponse.ok || (pageResponse && !pageResponse.ok)) throw new Error('Unable to refresh cart');
    const cart = await cartResponse.json();
    replaceCartSection(await drawerResponse.text(), cartDrawerSelector);
    if (pageResponse) replaceCartSection(await pageResponse.text(), '[data-gira-cart-page]');
    updateCartCount(cart.item_count);
    if (openDrawer) setCartOpen(true);
  };

  document.addEventListener('click', (event) => {
    const cartToggle = event.target.closest('[data-gira-cart-toggle]');
    if (cartToggle) {
      setCartOpen(true);
      return;
    }
    const cartClose = event.target.closest('[data-gira-cart-close]');
    if (cartClose) setCartOpen(false);
  });
  document.querySelectorAll('[data-gira-cart-toggle]').forEach((toggle) => {
    toggle.addEventListener('click', () => setCartOpen(true));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setCartOpen(false);
      closeAccountMenu();
    }
  });
  document.addEventListener('submit', async (event) => {
    const productForm = event.target.closest('.gira-product-form');
    if (!productForm) return;
    event.preventDefault();
    const submit = productForm.querySelector('[data-gira-add-to-cart]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'ADDING…';
    }
    try {
      const response = await fetch(productForm.action, { method: 'POST', body: new FormData(productForm), headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Unable to add item');
      await refreshCart({ openDrawer: true });
    } catch (error) {
      const errorContainer = productForm.querySelector('.gira-product-form-errors');
      if (errorContainer) errorContainer.textContent = 'Unable to add this item. Please try again.';
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'ADD TO CART';
      }
    }
  });
  document.addEventListener('click', async (event) => {
    const cartChange = event.target.closest('[data-gira-cart-change]');
    if (!cartChange) return;
    event.preventDefault();
    if (isCartUpdating) return;
    const quantity = Math.max(0, Number(cartChange.dataset.quantity));
    const lineKey = cartChange.dataset.lineKey;
    if (!lineKey || Number.isNaN(quantity)) return;
    const wasDrawerOpen = document.querySelector(cartDrawerSelector)?.classList.contains(cartOpenClass);
    isCartUpdating = true;
    setCartControlsDisabled(true);
    try {
      const response = await fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          id: lineKey,
          quantity,
          sections: ['gira-cart-drawer', 'gira-main-cart'],
          sections_url: window.location.pathname,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Unable to update cart (${response.status}): ${detail}`);
      }
      const cart = await response.json();
      renderCartSections(cart.sections);
      updateCartCount(cart.item_count);
      if (wasDrawerOpen) setCartOpen(true);
    } catch (error) {
      setCartControlsDisabled(false);
    } finally {
      isCartUpdating = false;
    }
  });
})();
