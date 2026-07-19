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

// The gallery lightbox that used to live here is now provided by the shared
// /scripts/gallery.js (event-delegated, so it also works for grids rendered
// dynamically from /json/galleries.json by /scripts/site-gallery.js).
