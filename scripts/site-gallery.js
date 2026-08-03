// Renders every [data-gallery-id] grid on the page from json/galleries.json.
// Markup mirrors the static galleries (.pc-item > img[data-full] + figcaption) so the
// shared lightbox (scripts/gallery.js) picks images up via its DOM-delegated handlers.
// If the fetch fails, whatever static fallback markup is in the grid is left in place.
// A grid with data-gallery-hide-empty hides its closest <section> while it has no images.
(() => {
  const grids = Array.from(document.querySelectorAll('[data-gallery-id]'));
  if (!grids.length) return;

  const src = grids[0].getAttribute('data-gallery-src') || '/json/galleries.json';

  const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);

  const renderItem = (img) => {
    const thumb = img.src || img.full;
    if (!thumb) return '';
    const full = img.full && img.full !== thumb ? ` data-full="${escapeHtml(img.full)}"` : '';
    const caption = img.caption ? `\n              <figcaption>${escapeHtml(img.caption)}</figcaption>` : '';
    return `
            <figure class="pc-item">
              <img src="${escapeHtml(thumb)}"${full} alt="${escapeHtml(img.alt || '')}" loading="lazy" decoding="async" tabindex="0" />${caption}
            </figure>`;
  };

  fetch(src)
    .then((resp) => {
      if (!resp.ok) throw new Error(`Galleries fetch failed: ${resp.status}`);
      return resp.json();
    })
    .then((data) => {
      const galleries = Array.isArray(data.galleries) ? data.galleries : [];
      grids.forEach((grid) => {
        const id = grid.getAttribute('data-gallery-id');
        const gallery = galleries.find((g) => g.id === id);
        const images = gallery && Array.isArray(gallery.images) ? gallery.images : null;
        const section = grid.closest('section[data-gallery-section]') || grid.closest('section');
        const reveals = document.querySelectorAll(`[data-gallery-reveal="${id}"]`);
        if (!images || !images.length) {
          // keep any static fallback; hide opt-in empty sections (and their nav links)
          if (grid.hasAttribute('data-gallery-hide-empty')) {
            if (section) section.style.display = 'none';
            reveals.forEach((el) => { el.style.display = 'none'; });
          }
          return;
        }
        grid.innerHTML = images.map(renderItem).join('');
        if (section) section.style.display = '';
        reveals.forEach((el) => { el.style.display = ''; });
      });
    })
    .catch((err) => {
      console.error(err); // static fallback markup remains visible
    });
})();
