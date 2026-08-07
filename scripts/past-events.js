// Past Events — built dynamically from /json/schema.json (same source that
// drives the does-cloud-compute / can-we-start-again exhibition pages), so
// an event only needs `pastEvents: true` in the JSON editor to appear here.
// Category (Talks/Workshops/Performances/Screenings) is derived from the
// event's @type; sr-only meta + a JSON-LD block are still emitted for SEO.

// NOTE: the JSON editor writes `PerformingArtsEvent` for performances (the
// schema.org type); `PerformanceEvent` is kept as an alias so any older
// entries still map. SocialEvent is also accepted by the editor, so it is
// bucketed here rather than being silently dropped.
const CATEGORY_BY_TYPE = {
  Event: { key: 'talks', badge: 'Talk', sectionId: 'section-talks', heading: 'Talks' },
  EducationEvent: { key: 'workshops', badge: 'Workshop', sectionId: 'section-workshops', heading: 'Workshops' },
  PerformingArtsEvent: { key: 'performances', badge: 'Performance', sectionId: 'section-performances', heading: 'Performances' },
  PerformanceEvent: { key: 'performances', badge: 'Performance', sectionId: 'section-performances', heading: 'Performances' },
  SocialEvent: { key: 'performances', badge: 'Event', sectionId: 'section-performances', heading: 'Performances' },
  ScreeningEvent: { key: 'screenings', badge: 'Screening', sectionId: 'section-screenings', heading: 'Screenings' },
};

// ── Performance Night ───────────────────────────────────────────────────────
// A performance event whose badge is "Performance Night" carries an extra
// `performances` array — one block per act, each with its own title, artists,
// description and images. Its card stays visually identical when condensed but
// expands on click to show the full log, and is deep-linkable at
// /past-events/#event-name.
const PN_BADGE = 'Performance Night';
const PN_ALIASES = ['performance night', 'experimental performance night'];

function isPerfNight(ev) {
  return !!ev && PN_ALIASES.includes(String(ev.label || '').trim().toLowerCase());
}

function perfBlocks(ev) {
  return (ev.performances || []).filter(
    p => p && (p.title || p.artists || p.description || (p.images || []).length)
  );
}

function esc(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function itemType(item) {
  const t = item && item['@type'];
  return Array.isArray(t) ? t[0] : t;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

// Chronological sort key built from displayDate (e.g. "Friday 16th January —
// 18:00–19:00"), falling back to just the startDate year when an event has
// no displayDate — so it still lands in the right year, ahead of anything
// dated later that same year.
function chronoKey(ev) {
  const year = parseInt(ev.startDate, 10) || 0;
  const dd = ev.displayDate || '';
  const dm = dd.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/);
  if (!dm) return year * 1000000;
  const day = parseInt(dm[1], 10);
  const month = MONTHS[dm[2].slice(0, 3).toLowerCase()];
  if (!month) return year * 1000000;
  const tm = dd.match(/(\d{1,2}):(\d{2})/);
  const quarterHours = tm ? Math.floor((parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10)) / 15) : 0;
  return year * 1000000 + month * 10000 + day * 100 + quarterHours;
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

// opts.imgs      — override the image list (defaults to the event's own)
// opts.cls       — extra class on the row
// opts.label     — aria-label for the row
// opts.preview   — render as plain figures rather than lightbox buttons; used
//                  for the condensed Performance Night strip, where a click
//                  should open the card instead of the lightbox
function imageRowHTML(ev, opts) {
  opts = opts || {};
  const imgs = opts.imgs || ev.images || [];
  if (!imgs.length) return '';
  const label = opts.label || `Photos from ${esc(ev.name)}`;
  const items = imgs.map((img, i) => {
    const full = img.full || img.src;
    const caption = (img.alt || '') + (img.credit ? ` Photo: ${img.credit}.` : '');
    const figure = `<figure>
      <img src="${esc(img.src)}" data-full="${esc(full)}" alt="${esc(img.alt || '')}"${img.altHtml ? ` data-caption-html="${esc(img.altHtml)}"` : ''} loading="lazy" decoding="async"${i === 0 && !opts.imgs ? ' itemprop="image"' : ''}>
      <figcaption class="sr-only">${esc(caption)}</figcaption>
    </figure>`;
    return opts.preview
      ? `<div role="listitem">${figure}</div>`
      : `<button role="listitem" aria-label="View photo ${i + 1} of ${esc(opts.ofName || ev.name)}">${figure}</button>`;
  }).join('');
  return `<div class="image-row${opts.cls ? ' ' + opts.cls : ''}" role="list" aria-label="${label}">${items}</div>`;
}

// Condensed Performance Night strip: the event poster followed by the lead
// image of the first two acts, so the card matches every other card at rest.
function pnPreviewImages(ev) {
  const out = [];
  if ((ev.images || []).length) out.push(ev.images[0]);
  perfBlocks(ev).forEach(p => {
    if (out.length >= 3) return;
    const im = (p.images || [])[0];
    if (im) out.push(im);
  });
  (ev.images || []).slice(1).forEach(im => { if (out.length < 3) out.push(im); });
  return out.slice(0, 3);
}

// Events keyed by slug, so the modal can be built on demand from the JSON
const PN_EVENTS = {};

// "Friday 12th June — 19:00–23:00" → { day: 'Friday 12th June', time: '19:00–23:00' }
function splitDisplayDate(dd) {
  const s = String(dd || '').trim();
  if (!s) return { day: '', time: '' };
  const tm = s.match(/\d{1,2}:\d{2}(?:\s*[–—-]\s*\d{1,2}:\d{2})?/);
  if (!tm) return { day: s, time: '' };
  return {
    day: s.slice(0, tm.index).replace(/[\s,–—-]+$/, '').trim(),
    time: tm[0].replace(/\s+/g, ''),
  };
}

// The expanded log — one section per act, each with its own lightbox gallery.
function performanceLogHTML(ev) {
  const blocks = perfBlocks(ev);
  if (!blocks.length) return '<p class="pn-empty">Details for this night are being added.</p>';
  return blocks.map((p, i) => {
    const title = p.title || 'Untitled';
    return `<section class="pn-perf">
      <div class="pn-perf-n">Performance ${i + 1}</div>
      <h4 class="pn-perf-title">${esc(title)}</h4>
      ${p.artists ? `<div class="pn-perf-artists">${esc(p.artists)}</div>` : ''}
      ${p.description ? `<p class="pn-perf-desc">${esc(p.description)}</p>` : ''}
      ${imageRowHTML(ev, {
        imgs: p.images || [],
        label: `Photos of ${esc(title)} at ${esc(ev.name)}`,
        ofName: title,
      })}
    </section>`;
  }).join('');
}

function buildCard(ev, personsMap, exhMap) {
  const cat = eventCategory(ev);
  const exh = exhMap[ev.exhibition];
  const credit = creditHTML(ev, personsMap);
  const year = ev.startDate || '';
  const showSeries = ev.exhibition === 'bitrot' && exh;
  const pn = isPerfNight(ev);
  const evSlug = slugify(ev.name);

  const article = document.createElement('article');
  article.className = 'event-card' + (pn ? ' pn-card' : '');
  article.dataset.chronoKey = String(chronoKey(ev));
  const idSlug = (ev['@id'] || '').split('#')[1];
  if (idSlug) article.id = idSlug.startsWith('event-') ? idSlug : 'event-' + idSlug;
  article.setAttribute('itemscope', '');
  article.setAttribute('itemtype', `https://schema.org/${itemType(ev)}`);
  article.setAttribute('aria-labelledby', 'title-' + (idSlug || evSlug));

  if (pn) {
    // Deep-link handle: /past-events/#<slug> opens this card's modal
    PN_EVENTS[evSlug] = ev;
    article.dataset.slug = evSlug;
    if (ev.cardColor) article.style.background = ev.cardColor;
    article.setAttribute('role', 'button');
    article.setAttribute('tabindex', '0');
    article.setAttribute('aria-haspopup', 'dialog');
  }

  const venue = pn && ev.venue ? esc(ev.venue) : '';
  const creditLine = (credit || year || venue)
    ? `<strong>${credit || 'Phreaking Collective'}</strong>${year ? ' — ' + esc(year) : ''}${venue ? ' — ' + venue : ''}<br>`
    : '';
  const partOf = exh
    ? `Part of <strong><a href="${esc(exh.url)}" target="_blank" rel="noreferrer" class="inline-link" itemprop="about">${esc(exh.name)}</a></strong>`
    : '';

  const nBlocks = pn ? perfBlocks(ev).length : 0;
  const hint = pn
    ? `<div class="pn-hint"><span class="pn-hint-chev">&#8599;</span><span class="pn-hint-text">View ${nBlocks} performance${nBlocks === 1 ? '' : 's'}</span></div>`
    : '';

  article.innerHTML = `
    <meta itemprop="eventStatus" content="https://schema.org/EventPastdue">
    <meta itemprop="eventAttendanceMode" content="https://schema.org/OfflineEventAttendanceMode">
    <div class="event-top">
      <div class="event-meta">
        <span class="event-type" aria-label="Event type: ${pn ? PN_BADGE : cat.badge}">${pn ? PN_BADGE : cat.badge}</span>
        <div>
          <h3 id="title-${idSlug || evSlug}" itemprop="name">${esc(ev.name)}</h3>
          <div class="event-credit">${creditLine}${partOf}</div>
        </div>
      </div>
      ${showSeries ? `<div class="event-series" aria-label="Exhibition: ${esc(exh.name)}, ${esc(year)}"><a href="${esc(exh.url)}" target="_blank" rel="noreferrer" class="inline-link">${esc(exh.name)}</a> / ${esc(year)}</div>` : ''}
    </div>
    <p class="event-description" itemprop="description">${esc(pn && ev.previewDescription ? ev.previewDescription : (ev.description || ''))}</p>
    ${pn
      ? imageRowHTML(ev, { imgs: pnPreviewImages(ev), cls: 'pn-preview-row', preview: true, label: `Preview photos from ${esc(ev.name)}` })
      : imageRowHTML(ev)}
    ${ev.eventCompletedUrl ? `<p class="event-link"><a href="${esc(ev.eventCompletedUrl)}" target="_blank" rel="noreferrer">${esc(ev.eventCompletedUrlLabel || 'Event Completed')}</a></p>` : ''}
    ${hint}
  `;
  return article;
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// ── Performance Night modal ─────────────────────────────────────────────────
// One dialog element, created once and repopulated per event. It sits above the
// page but below the lightbox, so a photo inside the modal still opens full
// screen over it.
let pnModal = null;
let pnLastFocus = null;

function ensurePnModal() {
  if (pnModal) return pnModal;
  pnModal = document.createElement('div');
  pnModal.className = 'pn-modal';
  pnModal.setAttribute('aria-hidden', 'true');
  pnModal.setAttribute('role', 'dialog');
  pnModal.setAttribute('aria-modal', 'true');
  pnModal.setAttribute('aria-labelledby', 'pn-modal-title');
  pnModal.innerHTML = `
    <div class="pn-modal__backdrop"></div>
    <div class="pn-modal__card" role="document">
      <div class="pn-modal__head">
        <div class="pn-modal__headline">
          <span class="pn-modal__label"></span>
          <h2 class="pn-modal__title" id="pn-modal-title"></h2>
        </div>
        <div class="pn-modal__when">
          <span class="pn-modal__day"></span>
          <span class="pn-modal__time"></span>
        </div>
        <button type="button" class="pn-modal__close" aria-label="Close">[ &times; ]</button>
      </div>
      <div class="pn-modal__scroll"></div>
    </div>`;
  document.body.appendChild(pnModal);

  pnModal.querySelector('.pn-modal__close').addEventListener('click', () => closePnModal(true));
  pnModal.querySelector('.pn-modal__backdrop').addEventListener('click', () => closePnModal(true));
  // clicking the padding around the card also dismisses
  pnModal.addEventListener('click', e => { if (e.target === pnModal) closePnModal(true); });
  return pnModal;
}

function pnModalBodyHTML(ev) {
  const poster = (ev.images || [])[0];
  const paras = String(ev.description || '')
    .split(/\n{2,}/).filter(Boolean)
    .map(t => `<p>${esc(t)}</p>`).join('') || '';
  const intro = (paras || poster)
    ? `<div class="pn-modal__intro">
        ${poster ? `<figure class="pn-modal__poster">
          <img src="${esc(poster.full || poster.src)}" alt="${esc(poster.alt || '')}" loading="lazy" decoding="async">
        </figure>` : ''}
        <div class="pn-modal__desc">${paras}</div>
      </div>`
    : '';
  return `${intro}<div class="pn-modal__log">${performanceLogHTML(ev)}</div>`;
}

function openPnModal(slug, writeUrl) {
  const ev = PN_EVENTS[slug];
  if (!ev) return;
  const modal = ensurePnModal();
  const when = splitDisplayDate(ev.displayDate);

  modal.querySelector('.pn-modal__label').textContent = PN_BADGE;
  modal.querySelector('.pn-modal__title').textContent = ev.name || '';
  modal.querySelector('.pn-modal__day').textContent = when.day || ev.startDate || '';
  modal.querySelector('.pn-modal__time').textContent = when.time;
  modal.querySelector('.pn-modal__scroll').innerHTML = pnModalBodyHTML(ev);
  modal.querySelector('.pn-modal__card').style.background = ev.cardColor || '';
  modal.dataset.slug = slug;

  pnLastFocus = document.activeElement;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('pn-modal-open');
  modal.querySelector('.pn-modal__scroll').scrollTop = 0;
  modal.querySelector('.pn-modal__close').focus();
  pnSizePoster();
  const posterImg = modal.querySelector('.pn-modal__poster img');
  if (posterImg) posterImg.addEventListener('load', pnSizePoster, { once: true });
  if (writeUrl) window.history.pushState(null, '', '#' + slug);
}

// The poster height is driven by the description block: CSS can't measure a
// sibling, so it's set here and kept in step on resize and once the image loads.
// Starts at 500px and then tracks the description 1:1 once the text is taller
// than that, capped so it can't outgrow the viewport.
const PN_POSTER_MIN = 500;
function pnSizePoster() {
  if (!pnModalIsOpen()) return;
  const desc = pnModal.querySelector('.pn-modal__desc');
  const fig = pnModal.querySelector('.pn-modal__poster');
  if (!fig) return;
  if (window.innerWidth <= 760) { fig.style.height = ''; return; }  // stacked layout sizes itself
  const textH = desc ? desc.getBoundingClientRect().height : 0;
  const target = Math.max(textH, PN_POSTER_MIN);
  const cap = Math.max(PN_POSTER_MIN, window.innerHeight * 0.72);
  fig.style.height = Math.round(Math.min(target, cap)) + 'px';
}

function closePnModal(writeUrl) {
  if (!pnModal || pnModal.getAttribute('aria-hidden') === 'true') return;
  pnModal.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('pn-modal-open');
  delete pnModal.dataset.slug;
  if (pnLastFocus && pnLastFocus.focus) pnLastFocus.focus();
  pnLastFocus = null;
  if (writeUrl) window.history.pushState(null, '', window.location.pathname);
}

function pnModalIsOpen() {
  return !!pnModal && pnModal.getAttribute('aria-hidden') === 'false';
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

  // Default order: newest first, matching the sort button's initial label
  Object.values(stacks).forEach(stack => sortStack(stack, true));
}

function sortStack(stack, descending) {
  if (!stack) return;
  const cards = Array.from(stack.children);
  cards.sort((a, b) => {
    const ka = parseFloat(a.dataset.chronoKey) || 0;
    const kb = parseFloat(b.dataset.chronoKey) || 0;
    return descending ? kb - ka : ka - kb;
  });
  cards.forEach(card => stack.appendChild(card));
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

  // ── Performance Night: open the modal ─────────────────────────────────────
  // The hash does double duty here: it already carries the active filter
  // (#talks, #performances…), so an event slug is only treated as an event
  // when it isn't one of the filter names.
  const VALID_FILTERS = ['talks', 'workshops', 'performances', 'screenings'];
  const pnCards = Array.from(document.querySelectorAll('.event-card.pn-card'));

  pnCards.forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('a')) return;                 // links keep their behaviour
      if (e.target.closest('.image-row:not(.pn-preview-row)')) return;
      openPnModal(card.dataset.slug, true);
    });
    card.addEventListener('keydown', e => {
      if (e.target !== card) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPnModal(card.dataset.slug, true);
      }
    });
  });

  function applyHashFilter() {
    let raw = '';
    try { raw = decodeURIComponent(window.location.hash.replace('#', '')); } catch (err) { raw = ''; }
    if (raw && VALID_FILTERS.includes(raw)) { closePnModal(false); setFilter(raw, false); return; }

    // Accept both /#event-name and /#event-event-name, since @id values in
    // schema.json already carry the "event-" prefix.
    const slug = raw && (PN_EVENTS[slugify(raw)] ? slugify(raw)
      : (PN_EVENTS[slugify(raw.replace(/^event-/, ''))] ? slugify(raw.replace(/^event-/, '')) : ''));
    setFilter('all', false);
    if (!slug) { closePnModal(false); return; }
    if (pnModal && pnModal.dataset.slug === slug && pnModalIsOpen()) return;
    openPnModal(slug, false);
  }
  applyHashFilter();
  window.addEventListener('hashchange', applyHashFilter);
  window.addEventListener('popstate', applyHashFilter);
  window.addEventListener('resize', () => {
    movePill(document.querySelector('.filter-btn.active'));
    pnSizePoster();
  });

  let isDescending = true; // matches the "newest first" default order rendered above
  sortBtn.addEventListener('click', () => {
    isDescending = !isDescending;
    sortBtn.textContent = isDescending ? 'Sort: Newest First ↓' : 'Sort: Oldest First ↑';
    document.querySelectorAll('.event-stack').forEach(stack => sortStack(stack, isDescending));
  });

  // Rebuilt on demand: modal galleries are created when a Performance Night
  // opens, so the list can't be captured once at init. Preview strips on
  // Performance Night cards are excluded — clicking one opens the modal.
  let galleryImages = [];
  function refreshGallery() {
    galleryImages = Array.from(document.querySelectorAll('.image-row:not(.pn-preview-row) img'));
  }
  refreshGallery();
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
    // Performance images carry a rich caption ("Act, <em>Event Name</em> 2026")
    // generated by the editor; plain images fall back to their alt text.
    if (img.dataset.captionHtml) lightboxCaption.innerHTML = img.dataset.captionHtml;
    else lightboxCaption.textContent = img.alt;
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeLightbox() { lightbox.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
  function updateLightbox(direction) { if (galleryImages.length === 0) return; currentIndex = (currentIndex + direction + galleryImages.length) % galleryImages.length; openLightbox(currentIndex); }

  // Delegated so images added by the modal are picked up automatically
  document.addEventListener('click', e => {
    const fig = e.target.closest('.image-row:not(.pn-preview-row) figure');
    if (!fig) return;
    const img = fig.querySelector('img');
    refreshGallery();
    const index = galleryImages.indexOf(img);
    if (index >= 0) openLightbox(index);
  });
  closeBtn.addEventListener('click', closeLightbox);
  nextBtn.addEventListener('click', () => { updateLightbox(1); });
  prevBtn.addEventListener('click', () => { updateLightbox(-1); });
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) { closeLightbox(); } });
  document.addEventListener('keydown', (e) => {
    if (lightbox.getAttribute('aria-hidden') === 'false') {
      if (e.key === 'Escape') { closeLightbox(); }
      if (e.key === 'ArrowRight') { updateLightbox(1); }
      if (e.key === 'ArrowLeft') { updateLightbox(-1); }
      return;
    }
    // Escape falls through to the Performance Night modal once the
    // lightbox above it has been dismissed
    if (e.key === 'Escape' && pnModalIsOpen()) { closePnModal(true); }
  });
}

initPastEvents();
