// Lightweight shared gallery lightbox
// Supports dynamically-added .pc-item img via event delegation — items list is
// rebuilt from the current DOM on every open so new images are always included.
(() => {
  const lb = document.createElement('div');
  lb.className = 'pc-lightbox';
  lb.setAttribute('aria-hidden', 'true');
  lb.innerHTML = `
    <div class="pc-lightbox__backdrop" data-close></div>
    <div class="pc-lightbox__inner" role="dialog" aria-modal="true" aria-label="Image viewer">
      <img class="pc-lightbox__img" alt="" />
      <div class="pc-lightbox__caption" aria-live="polite"></div>
      <button class="pc-lightbox__btn pc-lightbox__prev" aria-label="Previous image">&#10094;</button>
      <button class="pc-lightbox__btn pc-lightbox__next" aria-label="Next image">&#10095;</button>
      <button class="pc-lightbox__close" aria-label="Close">Close</button>
    </div>
  `;
  document.body.appendChild(lb);

  const imgEl  = lb.querySelector('.pc-lightbox__img');
  const capEl  = lb.querySelector('.pc-lightbox__caption');
  const prevBtn = lb.querySelector('.pc-lightbox__prev');
  const nextBtn = lb.querySelector('.pc-lightbox__next');
  const closeBtn = lb.querySelector('.pc-lightbox__close');

  let items = [];
  let idx = 0;

  function show(i) {
    // Rebuild from DOM on every open so dynamic content is included
    items = Array.from(document.querySelectorAll('.pc-item img'));
    idx = (i + items.length) % items.length;
    const thumb = items[idx];
    const full = thumb.getAttribute('data-full') || thumb.src;
    const caption = thumb.closest('figure')?.querySelector('figcaption')?.textContent || '';
    imgEl.src = full;
    imgEl.alt = thumb.alt || '';
    capEl.textContent = caption;
    lb.setAttribute('aria-hidden', 'false');

    // Preload neighbours for snappy nav
    const ahead = new Image();
    ahead.src = items[(idx + 1) % items.length].getAttribute('data-full') || items[(idx + 1) % items.length].src;
    const behind = new Image();
    behind.src = items[(idx - 1 + items.length) % items.length].getAttribute('data-full') || items[(idx - 1 + items.length) % items.length].src;
  }

  function hide() {
    lb.setAttribute('aria-hidden', 'true');
    imgEl.removeAttribute('src');
  }

  // Event delegation: handles both static and dynamically-added .pc-item images
  document.addEventListener('click', e => {
    const img = e.target.closest('.pc-item img');
    if (!img) return;
    const allItems = Array.from(document.querySelectorAll('.pc-item img'));
    show(allItems.indexOf(img));
  });

  document.addEventListener('keydown', e => {
    const img = e.target.closest('.pc-item img');
    if (!img) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const allItems = Array.from(document.querySelectorAll('.pc-item img'));
      show(allItems.indexOf(img));
    }
  });

  // Make all current .pc-item images keyboard-focusable; new ones get tabIndex via CSS cursor
  document.querySelectorAll('.pc-item img').forEach(img => { img.tabIndex = 0; });

  prevBtn.addEventListener('click', () => show(idx - 1));
  nextBtn.addEventListener('click', () => show(idx + 1));
  closeBtn.addEventListener('click', hide);
  lb.addEventListener('click', e => {
    if (e.target.hasAttribute('data-close')) hide();
  });
  document.addEventListener('keydown', e => {
    if (lb.getAttribute('aria-hidden') === 'true') return;
    if (e.key === 'Escape') hide();
    if (e.key === 'ArrowLeft') show(idx - 1);
    if (e.key === 'ArrowRight') show(idx + 1);
  });

  let startX = 0;
  imgEl.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  imgEl.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) (dx < 0 ? show(idx + 1) : show(idx - 1));
  }, { passive: true });
})();
