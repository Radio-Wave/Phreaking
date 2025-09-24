(() => {
  const STORAGE_KEY = 'pc-sidebar';
  let toggleInitialised = false;

  const hosts = Array.from(document.querySelectorAll('[data-sidebar]'));
  if (!hosts.length) {
    wireToggle();
    return;
  }

  hosts.forEach(host => {
    const src = host.getAttribute('data-sidebar-src') || 'partials/sidebar.html';
    const activeHint = host.getAttribute('data-sidebar-active') || '';

    fetch(src)
      .then(resp => {
        if (!resp.ok) {
          throw new Error(`Sidebar fetch failed: ${resp.status}`);
        }
        return resp.text();
      })
      .then(html => {
        injectSidebar(host, html, activeHint);
        wireToggle();
      })
      .catch(err => {
        console.error(err);
        host.remove();
      });
  });

  function injectSidebar(host, html, activeHint) {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    const fragment = template.content.cloneNode(true);
    const sidebar = fragment.querySelector('.pc-sidebar');

    host.parentNode.insertBefore(fragment, host);
    host.remove();

    if (sidebar) {
      markActiveLink(sidebar, activeHint);
    }
  }

  function wireToggle() {
    if (toggleInitialised) return;
    const btn = document.getElementById('sidebarToggle');
    if (!btn) return;

    toggleInitialised = true;
    const root = document.documentElement;

    try {
      if (localStorage.getItem(STORAGE_KEY) === 'collapsed') {
        root.classList.add('sidebar-collapsed');
        btn.setAttribute('aria-expanded', 'false');
      } else {
        btn.setAttribute('aria-expanded', 'true');
      }
    } catch (err) {
      btn.setAttribute('aria-expanded', String(!root.classList.contains('sidebar-collapsed')));
    }

    btn.addEventListener('click', () => {
      const collapsed = root.classList.toggle('sidebar-collapsed');
      btn.setAttribute('aria-expanded', String(!collapsed));
      try {
        localStorage.setItem(STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
      } catch (err) {
        /* no-op */
      }
    });
  }

  function markActiveLink(sidebar, hint) {
    const nav = sidebar.querySelector('.index');
    if (!nav) return;

    let target = hint;
    if (!target) {
      const path = window.location.pathname.replace(/\/+/g, '/');
      let file = path.substring(path.lastIndexOf('/') + 1);
      if (file === '') file = 'index.html';
      target = file;
    }

    const links = Array.from(nav.querySelectorAll('a[href]'));
    const match = links.find(link => link.getAttribute('href') === target)
      || links.find(link => link.getAttribute('href') === `/${target}`)
      || links.find(link => link.getAttribute('href')?.endsWith(target));

    if (match) {
      match.setAttribute('aria-current', 'page');
      match.classList.add('active');
    }
  }
})();
