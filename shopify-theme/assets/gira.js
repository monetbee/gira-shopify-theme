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
})();
