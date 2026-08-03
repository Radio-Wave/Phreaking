// Past Events — built dynamically from /json/schema.json (same source that
// drives the does-cloud-compute / can-we-start-again exhibition pages), so
// an event only needs `pastEvents: true` in the JSON editor to appear here.
// Category (Talks/Workshops/Performances/Screenings) is derived from the
// event's @type; sr-only meta + a JSON-LD block are still emitted for SEO.

const CATEGORY_BY_TYPE = {
  Event: { key: 'talks', badge: 'Talk', sectionId: 'section-talks', heading: 'Talks' },
  EducationEvent: { key: 'workshops', badge: 'Workshop', sectionId: 'section-workshops', heading: 'Workshops' },
  PerformanceEvent: { key: 'performances', badge: 'Performance', sectionId: 'section-performances', heading: 'Performances' },
  ScreeningEvent: { key: 'screenings', badge: 'Screening', sectionId: 'section-screenings', heading: 'Screenings' },
};

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function itemType(item) {
  const t = item && item['@type'];
  return Array.isArray(t) ? t[0] : t;
}

function eventCategory(ev) {
  return CATEGORY_BY_TYPE[itemType(ev)] || null;
}

function creditHTML(ev, personsMap) {
  const performer = ev.performer;
  const ids = performer ? (Array.isArray(performer) ? performer : [performer]).map(p => p['@id']).filter(Boolean) : [];
  if (ids.length) {
    return ids.map(id => {
      const p = personsMap[id];
      if (!p) return '';
      return p.url
        ? `<a href="${esc(p.url)}" target="_blank" rel="noreferrer" class="inline-link" itemprop="url"><span itemprop="name">${esc(p.name)}</span></a>`
        : `<span itemprop="name">${esc(p.name)}</span>`;
    }).filter(Boolean).join(' &amp; ');
  }
  return ev.creditText ? esc(ev.creditText) : '';
}

function imageRowHTML(ev) {
  const imgs = ev.images || [];
  if (!imgs.length) return '';
  const items = imgs.map((img, i) => {
    const full = img.full || img.src;
    const caption = img.alt + (img.credit ? ` Photo: ${img.credit}.` : '');
    return `<button role="listitem" aria-label="View photo ${i + 1} of ${esc(ev.name)}"><figure>
      <img src="${esc(img.src)}" data-full="${esc(full)}" alt="${esc(img.alt || '')}" loading="lazy" decoding="async"${i === 0 ? ' itemprop="image"' : ''}>
      <figcaption class="sr-only">${esc(caption)}</figcaption>
    </figure></button>`;
  }).join('');
  return `<div class="image-row" role="list" aria-label="Photos from ${esc(ev.name)}">${items}</div>`;
}

function buildCard(ev, personsMap, exhMap) {
  const cat = eventCategory(ev);
  const exh = exhMap[ev.exhibition];
  const credit = creditHTML(ev, personsMap);
  const year = ev.startDate || '';
  const showSeries = ev.exhibition === 'bitrot' && exh;

  const article = document.createElement('article');
  article.className = 'event-card';
  const idSlug = (ev['@id'] || '').split('#')[1];
  if (idSlug) article.id = idSlug.startsWith('event-') ? idSlug : 'event-' + idSlug;
  article.setAttribute('itemscope', '');
  article.setAttribute('itemtype', `https://schema.org/${itemType(ev)}`);
  article.setAttribute('aria-labelledby', 'title-' + (idSlug || slugify(ev.name)));

  const creditLine = (credit || year)
    ? `<strong>${credit || 'Phreaking Collective'}</strong>${year ? ' — ' + esc(year) : ''}<br>`
    : '';
  const partOf = exh
    ? `Part of <strong><a href="${esc(exh.url)}" target="_blank" rel="noreferrer" class="inline-link" itemprop="about">${esc(exh.name)}</a></strong>`
    : '';

  article.innerHTML = `
    <meta itemprop="eventStatus" content="https://schema.org/EventPastdue">
    <meta itemprop="eventAttendanceMode" content="https://schema.org/OfflineEventAttendanceMode">
    <div class="event-top">
      <div class="event-meta">
        <span class="event-type" aria-label="Event type: ${cat.badge}">${cat.badge}</span>
        <div>
          <h3 id="title-${idSlug || slugify(ev.name)}" itemprop="name">${esc(ev.name)}</h3>
          <div class="event-credit">${creditLine}${partOf}</div>
        </div>
      </div>
      ${showSeries ? `<div class="event-series" aria-label="Exhibition: ${esc(exh.name)}, ${esc(year)}"><a href="${esc(exh.url)}" target="_blank" rel="noreferrer" class="inline-link">${esc(exh.name)}</a> / ${esc(year)}</div>` : ''}
    </div>
    <p class="event-description" itemprop="description">${esc(ev.description || '')}</p>
    ${imageRowHTML(ev)}
    ${ev.eventCompletedUrl ? `<p class="event-link"><a href="${esc(ev.eventCompletedUrl)}" target="_blank" rel="noreferrer">${esc(ev.eventCompletedUrlLabel || 'Event Completed')}</a></p>` : ''}
  `;
  return article;
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const SINGULAR_CATEGORY = { talks: 'talk', workshops: 'workshop', performances: 'performance', screenings: 'screening' };

function updateCount(sectionId, n) {
  const section = document.getElementById(sectionId);
  if (!section) return;
  const count = section.querySelector('.section-count');
  if (count) {
    const noun = SINGULAR_CATEGORY[section.dataset.category] || 'event';
    count.textContent = `${n} Event${n === 1 ? '' : 's'}`;
    count.setAttribute('aria-label', `${n} ${noun} event${n === 1 ? '' : 's'}`);
  }
}

function renderPastEvents(data) {
  const graph = data['@graph'] || [];
  const personsMap = {};
  const exhMap = {};
  graph.forEach(item => {
    if (!item['@id']) return;
    const t = item['@type'];
    const types = Array.isArray(t) ? t : [t];
    if (types.includes('Person') || (types.includes('Organization') && item['@id'] !== 'https://phreaking.co.uk/#phreaking')) {
      personsMap[item['@id']] = item;
    }
    if (types.includes('ExhibitionEvent')) {
      const slug = item['@id'].split('#')[1];
      if (slug) exhMap[slug] = item;
    }
  });

  const stacks = {
    talks: document.querySelector('#section-talks .event-stack'),
    workshops: document.querySelector('#section-workshops .event-stack'),
    performances: document.querySelector('#section-performances .event-stack'),
    screenings: document.querySelector('#section-screenings .event-stack'),
  };
  const counts = { talks: 0, workshops: 0, performances: 0, screenings: 0 };

  Object.values(stacks).forEach(s => { if (s) s.innerHTML = ''; });

  graph
    .filter(item => item.pastEvents === true && item.visible !== false)
    .forEach(ev => {
      const cat = eventCategory(ev);
      if (!cat || !stacks[cat.key]) return;
      stacks[cat.key].appendChild(buildCard(ev, personsMap, exhMap));
      counts[cat.key]++;
    });

  Object.entries(counts).forEach(([key, n]) => {
    const sectionId = { talks: 'section-talks', workshops: 'section-workshops', performances: 'section-performances', screenings: 'section-screenings' }[key];
    updateCount(sectionId, n);
  });
}

function initPastEvents() {
  fetch('/json/schema.json')
    .then(r => r.json())
    .then(data => {
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.textContent = JSON.stringify(data);
      document.head.appendChild(s);

      renderPastEvents(data);
      initFilterSortLightbox();
    })
    .catch(err => console.error('Failed to load past events:', err));
}

// ── Filters, sort, and lightbox — run once the cards above exist in the DOM ──
function initFilterSortLightbox() {
  const filterButtons = document.querySelectorAll('.filter-btn:not(.sort-btn)');
  const sections = document.querySelectorAll('.category-section');
  const pill = document.querySelector('.filter-pill');
  const sortBtn = document.getElementById('sort-btn');

  function movePill(button) {
    if (!button) return;
    const parentRect = button.parentElement.getBoundingClientRect();
    const rect = button.getBoundingClientRect();
    pill.style.width = rect.width + 'px';
    pill.style.height = rect.height + 'px';
    pill.style.transform = `translateX(${rect.left - parentRect.left}px)`;
  }

  function setFilter(filter, updateUrl = true) {
    filterButtons.forEach(btn => {
      const active = btn.dataset.filter === filter;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active);
    });
    if (filter === 'all') {
      sections.forEach(section => { section.classList.remove('hidden'); });
    } else {
      sections.forEach(section => { section.classList.toggle('hidden', section.dataset.category !== filter); });
    }
    const activeButton = document.querySelector(`.filter-btn[data-filter="${filter}"]`);
    movePill(activeButton);
    if (updateUrl) {
      const newUrl = filter === 'all' ? window.location.pathname : `#${filter}`;
      window.history.pushState(null, '', newUrl);
    }
  }

  filterButtons.forEach(button => { button.addEventListener('click', () => { setFilter(button.dataset.filter, true); }); });

  function applyHashFilter() {
    const hashFilter = window.location.hash.replace('#', '');
    const validFilters = ['talks', 'workshops', 'performances', 'screenings'];
    if (hashFilter && validFilters.includes(hashFilter)) { setFilter(hashFilter, false); } else { setFilter('all', false); }
  }
  applyHashFilter();
  window.addEventListener('hashchange', applyHashFilter);
  window.addEventListener('resize', () => { movePill(document.querySelector('.filter-btn.active')); });

  let isDescending = true;
  sortBtn.addEventListener('click', () => {
    isDescending = !isDescending;
    sortBtn.textContent = isDescending ? 'Sort: Newest First ↓' : 'Sort: Oldest First ↑';
    const eventStacks = document.querySelectorAll('.event-stack');
    eventStacks.forEach(stack => {
      const cards = Array.from(stack.children);
      cards.reverse();
      cards.forEach(card => stack.appendChild(card));
    });
  });

  const galleryImages = Array.from(document.querySelectorAll('.image-row img'));
  const lightbox = document.querySelector('.pc-lightbox');
  const lightboxImg = document.querySelector('.pc-lightbox__img');
  const lightboxCaption = document.querySelector('.pc-lightbox__caption');
  const closeBtn = document.querySelector('.pc-lightbox__close');
  const prevBtn = document.querySelector('.pc-lightbox__prev');
  const nextBtn = document.querySelector('.pc-lightbox__next');
  let currentIndex = 0;

  function openLightbox(index) {
    currentIndex = index;
    const img = galleryImages[currentIndex];
    lightboxImg.src = img.dataset.full || img.src;
    lightboxImg.alt = img.alt;
    lightboxCaption.textContent = img.alt;
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() { lightbox.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
  function updateLightbox(direction) { if (galleryImages.length === 0) return; currentIndex = (currentIndex + direction + galleryImages.length) % galleryImages.length; openLightbox(currentIndex); }

  galleryImages.forEach((img, index) => { img.parentElement.addEventListener('click', () => { openLightbox(index); }); });
  closeBtn.addEventListener('click', closeLightbox);
  nextBtn.addEventListener('click', () => { updateLightbox(1); });
  prevBtn.addEventListener('click', () => { updateLightbox(-1); });
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) { closeLightbox(); } });
  document.addEventListener('keydown', (e) => {
    if (lightbox.getAttribute('aria-hidden') === 'false') {
      if (e.key === 'Escape') { closeLightbox(); }
      if (e.key === 'ArrowRight') { updateLightbox(1); }
      if (e.key === 'ArrowLeft') { updateLightbox(-1); }
    }
  });
}

initPastEvents();
