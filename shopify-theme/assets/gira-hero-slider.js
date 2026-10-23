(() => {
  const SWIPE_DISTANCE = 40;

  const initializeHero = (root) => {
    if (root.dataset.giraHeroReady) return () => {};
    const slides = [...root.querySelectorAll('[data-gira-hero-slide]')];
    if (slides.length < 2) return () => {};
    root.dataset.giraHeroReady = 'true';

    const indicators = [...root.querySelectorAll('[data-gira-hero-indicator]')];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const interval = Math.max(3000, Number(root.dataset.interval) || 5000);
    let currentIndex = 0;
    let timer;
    let hovering = false;
    let touchStartX = null;
    let touchStartY = null;

    const setSlide = (nextIndex) => {
      currentIndex = (nextIndex + slides.length) % slides.length;
      slides.forEach((slide, index) => slide.classList.toggle('is-active', index === currentIndex));
      indicators.forEach((indicator, index) => {
        const isActive = index === currentIndex;
        indicator.classList.toggle('is-active', isActive);
        if (isActive) indicator.setAttribute('aria-current', 'true');
        else indicator.removeAttribute('aria-current');
      });
    };
    const stop = () => { window.clearInterval(timer); timer = undefined; };
    const start = () => {
      stop();
      if (root.dataset.autoplay !== 'true' || reducedMotion.matches || document.hidden) return;
      if (hovering || root.contains(document.activeElement)) return;
      timer = window.setInterval(() => setSlide(currentIndex + 1), interval);
    };
    const go = (nextIndex) => { setSlide(nextIndex); start(); };

    root.querySelector('[data-gira-hero-previous]')?.addEventListener('click', () => go(currentIndex - 1));
    root.querySelector('[data-gira-hero-next]')?.addEventListener('click', () => go(currentIndex + 1));
    indicators.forEach((indicator) => indicator.addEventListener('click', () => go(Number(indicator.dataset.giraHeroIndicator))));

    root.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') { hovering = true; stop(); } });
    root.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') { hovering = false; start(); } });
    root.addEventListener('focusin', stop);
    root.addEventListener('focusout', (event) => { if (!root.contains(event.relatedTarget)) start(); });

    root.addEventListener('touchstart', (event) => {
      if (event.touches.length !== 1 || event.target.closest('.gira-best-sellers-track')) { touchStartX = null; return; }
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    }, { passive: true });
    root.addEventListener('touchend', (event) => {
      if (touchStartX === null) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      touchStartX = null;
      if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy)) return;
      go(currentIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });
    root.addEventListener('touchcancel', () => { touchStartX = null; }, { passive: true });

    document.addEventListener('visibilitychange', start);
    reducedMotion.addEventListener('change', start);
    start();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', start);
      reducedMotion.removeEventListener('change', start);
    };
  };

  const cleanups = new WeakMap();
  const rootFor = (target) => (target.matches('[data-gira-hero]') ? target : target.querySelector('[data-gira-hero]'));
  const mount = (root) => { if (root) cleanups.set(root, initializeHero(root)); };

  document.querySelectorAll('[data-gira-hero]').forEach(mount);
  document.addEventListener('shopify:section:load', (event) => mount(rootFor(event.target)));
  document.addEventListener('shopify:section:unload', (event) => {
    const root = rootFor(event.target);
    if (!root) return;
    cleanups.get(root)?.();
    cleanups.delete(root);
  });
})();
