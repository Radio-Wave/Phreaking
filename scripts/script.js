(() => {
  const root = document.documentElement;
  const btn  = document.getElementById('sidebarToggle');
  if (!btn) return;

  // restore previous choice
  if (localStorage.getItem('pc-sidebar') === 'collapsed') {
    root.classList.add('sidebar-collapsed');
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', () => {
    const collapsed = root.classList.toggle('sidebar-collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    localStorage.setItem('pc-sidebar', collapsed ? 'collapsed' : 'expanded');
  });
})();
