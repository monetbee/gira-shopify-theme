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
})();
