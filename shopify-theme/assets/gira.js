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

  document.querySelectorAll('[data-gira-collection]').forEach((root) => {
    const grid = root.querySelector('[data-gira-collection-grid]');
    const search = root.querySelector('[data-gira-collection-search]');
    const count = root.querySelector('[data-gira-collection-count]');
    const empty = root.querySelector('[data-gira-collection-empty]');
    const chips = root.querySelector('[data-gira-filter-chips]');
    const pagination = root.querySelector('[data-gira-collection-pagination]');
    const sheet = root.querySelector('[data-gira-filter-sheet]');
    const mobileOptions = root.querySelector('[data-gira-filter-mobile-options]');
    const state = { style: '', color: '', price: '', shape: '', q: search?.value.trim() || '' };
    const params = new URLSearchParams(window.location.search);
    ['style', 'color', 'price', 'shape', 'q'].forEach((key) => { state[key] = params.get(key) || state[key]; });
    let loadedAllPages = false;
    let loadingPages = null;

    const labelFor = (type, value) => {
      const labels = { style: value, color: value, price: value === 'under-5000' ? 'UNDER ¥5,000' : value === '5000-7499' ? '¥5,000 – ¥7,499' : value === '7500-9999' ? '¥7,500 – ¥9,999' : '¥10,000+', shape: value };
      return (labels[type] || value).toUpperCase();
    };
    const hasFilters = () => Object.values(state).some(Boolean);
    const priceMatches = (cents) => {
      if (!state.price) return true;
      if (state.price === 'under-5000') return cents < 500000;
      if (state.price === '5000-7499') return cents >= 500000 && cents < 750000;
      if (state.price === '7500-9999') return cents >= 750000 && cents < 1000000;
      return cents >= 1000000;
    };
    const matches = (item) => {
      const tags = (item.dataset.giraTags || '').toLowerCase();
      const colors = (item.dataset.giraColors || '').toLowerCase();
      const shapes = (item.dataset.giraShapes || '').toLowerCase();
      const text = `${item.dataset.giraTitle || ''} ${tags} ${colors} ${shapes}`.toLowerCase();
      return (!state.style || tags.split(/\s+/).includes(state.style))
        && (!state.color || colors.includes(state.color) || tags.includes(`color-${state.color}`))
        && (!state.shape || shapes.includes(`shape-${state.shape}`))
        && priceMatches(Number(item.dataset.giraPrice || 0))
        && (!state.q || text.includes(state.q.toLowerCase()));
    };
    const syncUrl = () => {
      const next = new URL(window.location.href);
      ['style', 'color', 'price', 'shape', 'q'].forEach((key) => state[key] ? next.searchParams.set(key, state[key]) : next.searchParams.delete(key));
      next.searchParams.delete('page');
      history.replaceState({}, '', next);
      root.querySelectorAll('[data-gira-query-input]').forEach((input) => { input.value = state[input.dataset.giraQueryInput] || ''; });
      root.querySelectorAll('[data-gira-collection-pagination] a').forEach((link) => {
        const href = new URL(link.href, window.location.origin);
        ['style', 'color', 'price', 'shape', 'q'].forEach((key) => state[key] ? href.searchParams.set(key, state[key]) : href.searchParams.delete(key));
        link.href = href;
      });
    };
    const syncControls = () => {
      root.querySelectorAll('[data-gira-filter-control]').forEach((button) => {
        const type = button.dataset.giraFilterType;
        button.setAttribute('aria-pressed', String(Boolean(button.dataset.giraFilterValue) && state[type] === button.dataset.giraFilterValue || !button.dataset.giraFilterValue && !state[type]));
      });
      if (search && search.value !== state.q) search.value = state.q;
      const active = Object.entries(state).filter(([, value]) => value);
      root.querySelectorAll('[data-gira-filter-count]').forEach((node) => { node.textContent = `(${active.length})`; });
      chips.hidden = active.length === 0;
      chips.replaceChildren(...active.map(([type, value]) => {
        const button = document.createElement('button');
        button.className = 'gira-collection__chip'; button.type = 'button'; button.dataset.giraRemoveFilter = type;
        button.textContent = `${labelFor(type, value)} ×`;
        return button;
      }));
      if (active.length) { const clear = document.createElement('button'); clear.className = 'gira-collection__clear'; clear.type = 'button'; clear.dataset.giraClearFilters = ''; clear.textContent = 'CLEAR ALL'; chips.append(clear); }
    };
    const filterProducts = () => {
      const items = [...grid.querySelectorAll('[data-gira-collection-item]')];
      let visible = 0;
      items.forEach((item) => { const visibleItem = matches(item); item.hidden = !visibleItem; if (visibleItem) visible += 1; });
      empty.hidden = visible !== 0;
      count.textContent = `${visible} ${visible === 1 ? 'PRODUCT' : 'PRODUCTS'}${hasFilters() ? ' / FILTERED' : ''}`;
      if (pagination) pagination.hidden = hasFilters();
    };
    const loadAllPages = async () => {
      const pages = Number(count.dataset.giraPages || 1);
      if (loadedAllPages || pages < 2) return;
      if (!loadingPages) loadingPages = (async () => {
        const currentPage = Number(new URLSearchParams(window.location.search).get('page') || 1);
        const requests = [];
        for (let page = 1; page <= pages; page += 1) {
          if (page === currentPage) continue;
          const url = new URL(window.location.href);
          url.searchParams.set('page', String(page)); url.searchParams.set('section_id', 'gira-main-collection');
          requests.push(fetch(url).then((response) => response.text()));
        }
        const html = await Promise.all(requests);
        html.forEach((markup) => {
          const documentFragment = new DOMParser().parseFromString(markup, 'text/html');
          documentFragment.querySelectorAll('[data-gira-collection-item]').forEach((item) => grid.append(item));
        });
        loadedAllPages = true;
      })().finally(() => { loadingPages = null; });
      await loadingPages;
    };
    const apply = async () => {
      syncUrl(); syncControls();
      if (hasFilters()) await loadAllPages();
      filterProducts();
    };
    const desktopFilterMenus = window.matchMedia('(min-width: 768px) and (hover: hover) and (pointer: fine)');
    const filterDropdowns = [...root.querySelectorAll('.gira-collection__filter-dropdown')];
    const setDropdownOpen = (dropdown, isOpen) => {
      const summary = dropdown.querySelector('summary');
      if (isOpen) {
        filterDropdowns.forEach((other) => {
          if (other !== dropdown) {
            other.open = false;
            other.classList.remove('is-align-end');
            other.querySelector('summary')?.setAttribute('aria-expanded', 'false');
          }
        });
      }
      dropdown.open = isOpen;
      summary?.setAttribute('aria-expanded', String(isOpen));
      if (!isOpen) {
        dropdown.classList.remove('is-align-end');
        return;
      }
      requestAnimationFrame(() => {
        const options = dropdown.querySelector('.gira-collection__filter-options');
        if (!options || !dropdown.open) return;
        dropdown.classList.remove('is-align-end');
        const viewportGutter = 8;
        if (options.getBoundingClientRect().right > window.innerWidth - viewportGutter) {
          dropdown.classList.add('is-align-end');
        }
      });
    };
    filterDropdowns.forEach((dropdown) => {
      const summary = dropdown.querySelector('summary');
      dropdown.addEventListener('toggle', () => {
        const isOpen = dropdown.open;
        summary?.setAttribute('aria-expanded', String(isOpen));
        if (isOpen && desktopFilterMenus.matches) setDropdownOpen(dropdown, true);
      });
      dropdown.addEventListener('pointerenter', () => { if (desktopFilterMenus.matches) setDropdownOpen(dropdown, true); });
      dropdown.addEventListener('pointerleave', () => { if (desktopFilterMenus.matches) setDropdownOpen(dropdown, false); });
      summary?.addEventListener('click', (event) => {
        if (!desktopFilterMenus.matches) return;
        // Hover opens before a click can reach <summary>. Prevent the native
        // details toggle from immediately closing the already-open menu.
        event.preventDefault();
        setDropdownOpen(dropdown, true);
      });
      summary?.addEventListener('focus', () => { if (desktopFilterMenus.matches) setDropdownOpen(dropdown, true); });
      dropdown.addEventListener('focusout', (event) => {
        if (desktopFilterMenus.matches && !dropdown.contains(event.relatedTarget)) setDropdownOpen(dropdown, false);
      });
      dropdown.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          summary?.focus();
          setDropdownOpen(dropdown, false);
        }
      });
    });
    window.addEventListener('resize', () => {
      if (!desktopFilterMenus.matches) return;
      filterDropdowns.filter((dropdown) => dropdown.open).forEach((dropdown) => setDropdownOpen(dropdown, true));
    });
    root.querySelectorAll('[data-gira-filter-control]').forEach((button) => button.addEventListener('click', async () => {
      const type = button.dataset.giraFilterType; const value = button.dataset.giraFilterValue;
      state[type] = state[type] === value || !value ? '' : value;
      await apply();
      const dropdown = button.closest('.gira-collection__filter-dropdown');
      if (dropdown) setDropdownOpen(dropdown, false);
    }));
    search?.addEventListener('input', async () => { state.q = search.value.trim(); await apply(); });
    chips.addEventListener('click', async (event) => {
      const remove = event.target.closest('[data-gira-remove-filter]');
      if (remove) state[remove.dataset.giraRemoveFilter] = '';
      if (event.target.closest('[data-gira-clear-filters]')) Object.keys(state).forEach((key) => { state[key] = ''; });
      await apply();
    });
    const closeSheet = () => { if (sheet) sheet.hidden = true; };
    root.querySelector('[data-gira-filter-open]')?.addEventListener('click', () => { if (!sheet) return; mobileOptions.replaceChildren(); const styleCopy = document.createElement('section'); const styleTitle = document.createElement('h3'); styleTitle.textContent = 'STYLE'; styleCopy.append(styleTitle); const styleOptions = root.querySelector('.gira-collection__tags')?.cloneNode(true); if (styleOptions) styleCopy.append(styleOptions); mobileOptions.append(styleCopy); root.querySelectorAll('.gira-collection__filter-dropdown').forEach((dropdown) => { const copy = document.createElement('section'); const title = document.createElement('h3'); title.textContent = dropdown.querySelector('summary').textContent.replace('▾', '').trim(); copy.append(title); const options = dropdown.querySelector('.gira-collection__filter-options')?.cloneNode(true); if (options) copy.append(options); mobileOptions.append(copy); }); sheet.hidden = false; });
    mobileOptions?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-gira-filter-control]');
      if (!button) return;
      const type = button.dataset.giraFilterType; const value = button.dataset.giraFilterValue;
      state[type] = state[type] === value || !value ? '' : value;
      await apply();
    });
    root.querySelectorAll('[data-gira-filter-close]').forEach((button) => button.addEventListener('click', closeSheet));
    root.querySelector('[data-gira-filter-apply]')?.addEventListener('click', closeSheet);
    root.querySelector('[data-gira-clear-filters]')?.addEventListener('click', async () => { Object.keys(state).forEach((key) => { state[key] = ''; }); await apply(); });
    root.querySelector('[data-gira-mobile-sort]')?.addEventListener('change', (event) => { const desktopSort = root.querySelector('[data-gira-sort]'); if (!desktopSort) return; desktopSort.value = event.target.value; desktopSort.dispatchEvent(new Event('change', { bubbles: true })); });
    window.addEventListener('popstate', () => { const next = new URLSearchParams(window.location.search); ['style', 'color', 'price', 'shape', 'q'].forEach((key) => { state[key] = next.get(key) || ''; }); apply(); });
    apply();
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
      if (!desktopAccountMenu.matches) return;
      // The member control is a normal link. Desktop hover exposes the menu;
      // activation always takes the member to the Theme-native MY GIRA page.
      closeAccountMenu();
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
