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
    const fade = Math.max(0, Number(root.dataset.duration) || 800);
    root.style.setProperty('--gira-hero-fade', `${fade}ms`);
    let currentIndex = 0;
    let timer;
    let hovering = false;
    let touchStartX = null;
    let touchStartY = null;

    const setSlide = (nextIndex) => {
      currentIndex = (nextIndex + slides.length) % slides.length;
      slides.forEach((slide, index) => {
        const active = index === currentIndex;
        slide.classList.toggle('is-active', active);
        if (active) slide.removeAttribute('aria-hidden');
        else slide.setAttribute('aria-hidden', 'true');
      });
      indicators.forEach((indicator, index) => {
        const active = index === currentIndex;
        indicator.classList.toggle('is-active', active);
        if (active) indicator.setAttribute('aria-current', 'true');
        else indicator.removeAttribute('aria-current');
      });
    };
    const stop = () => { window.clearInterval(timer); timer = undefined; };
    const start = () => {
      stop();
      if (root.dataset.autoplay !== 'true' || reducedMotion.matches || document.hidden || hovering) return;
      timer = window.setInterval(() => setSlide(currentIndex + 1), interval);
    };
    const go = (nextIndex) => { setSlide(nextIndex); start(); };

    const listeners = [];
    const on = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      listeners.push(() => target.removeEventListener(type, handler, options));
    };

    const previous = root.querySelector('[data-gira-hero-previous]');
    const next = root.querySelector('[data-gira-hero-next]');
    if (previous) on(previous, 'click', () => go(currentIndex - 1));
    if (next) on(next, 'click', () => go(currentIndex + 1));
    indicators.forEach((indicator) => on(indicator, 'click', () => go(Number(indicator.dataset.giraHeroIndicator))));

    on(root, 'keydown', (event) => {
      if (!event.target.closest('.gira-hero-controls')) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(currentIndex - 1); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); go(currentIndex + 1); }
    });
    on(root, 'pointerenter', (event) => { if (event.pointerType === 'mouse') { hovering = true; stop(); } });
    on(root, 'pointerleave', (event) => { if (event.pointerType === 'mouse') { hovering = false; start(); } });

    on(root, 'touchstart', (event) => {
      if (event.touches.length !== 1 || event.target.closest('.gira-best-sellers-track')) { touchStartX = null; return; }
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    }, { passive: true });
    on(root, 'touchend', (event) => {
      if (touchStartX === null) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      touchStartX = null;
      if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy)) return;
      go(currentIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });
    on(root, 'touchcancel', () => { touchStartX = null; }, { passive: true });

    on(document, 'visibilitychange', start);
    on(reducedMotion, 'change', start);
    start();

    return () => {
      stop();
      listeners.forEach((off) => off());
      delete root.dataset.giraHeroReady;
    };
  };

  const cleanups = new WeakMap();
  const rootFor = (target) => (target.matches('[data-gira-hero]') ? target : target.querySelector('[data-gira-hero]'));
  const mount = (root) => {
    if (!root || cleanups.has(root)) return;
    try { cleanups.set(root, initializeHero(root)); } catch (error) { /* first slide stays visible */ }
  };

  document.querySelectorAll('[data-gira-hero]').forEach(mount);
  document.addEventListener('shopify:section:load', (event) => mount(rootFor(event.target)));
  document.addEventListener('shopify:section:unload', (event) => {
    const root = rootFor(event.target);
    if (!root) return;
    cleanups.get(root)?.();
    cleanups.delete(root);
  });
})();
