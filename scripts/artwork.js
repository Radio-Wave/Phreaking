/* ===========================================================================
 * Artwork — shared renderer + hydration
 * ===========================================================================
 *
 * WHY THIS FILE IS SHAPED LIKE THIS
 *
 * Same reasoning as scripts/past-events.js, one phase earlier. Past Events is
 * baked: the editor renders it to a string at push time and splices it into
 * static HTML. Exhibition pages are NOT baked yet — they still fetch JSON and
 * build the DOM client-side, the way Past Events did before the SEO overhaul.
 *
 * So this file is deliberately split in two:
 *
 *   • PURE LAYER — buildContext / artworkFor / renderCardHTML / renderGridHTML
 *     / buildJsonLd. These take data and return strings. No document, no
 *     fetch, no side effects. They run identically in a browser, in the JSON
 *     editor's preview pane, and (later) in Node at bake time.
 *
 *   • BROWSER LAYER — hydrate() / autoInit(). Fetches, injects, wires up the
 *     modal. This is the part that gets replaced when baking arrives.
 *
 * When someone adds marker-spliced baking for exhibition pages, they should be
 * able to call renderGridHTML() from the editor's push path and delete nothing
 * from the pure layer. That is the whole point of the split — do not reach for
 * `document` above the BROWSER LAYER banner.
 *
 * The detail view is BAKED INTO THE CARD (stowed, display:none) and MOVED into
 * the dialog on open, then moved back on close — exactly what the Performance
 * Night modal does in past-events.js. It is not rebuilt from data on click.
 * That means what a crawler reads and what a visitor sees are the same nodes,
 * and it is why the description and the full image list are already in the DOM
 * before anyone clicks anything.
 * =========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ArtworkRender = api;
  if (typeof document !== 'undefined' && !(root && root.__AW_NO_AUTO_INIT__)) {
    api.autoInit();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SITE_ORIGIN = 'https://phreaking.co.uk';
  var ARTWORK_TYPE = 'VisualArtwork';

  /* =====================================================================
   * PURE LAYER — strings in, strings out. No DOM, no fetch.
   * ===================================================================== */

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function typesOf(item) {
    var t = item && item['@type'];
    if (!t) return [];
    return Array.isArray(t) ? t : [t];
  }

  function isArtwork(item) {
    return typesOf(item).indexOf(ARTWORK_TYPE) !== -1;
  }

  function absUrl(p) {
    if (!p) return '';
    if (/^https?:/i.test(p)) return p;
    return SITE_ORIGIN + (p.charAt(0) === '/' ? p : '/' + p);
  }

  /* Artist links are stored the way event performer credits are stored:
   * {'@id': '…'} references, single object or array. Never a duplicated name
   * string — the name is looked up from artists.json at render time so a
   * rename in the artist registry propagates everywhere without a migration. */
  function artistRefs(art) {
    var a = art && art.artist;
    if (!a) return [];
    return (Array.isArray(a) ? a : [a])
      .map(function (x) { return x && x['@id']; })
      .filter(Boolean);
  }

  /* ctx.artistsMap is built from artists.json (the full-bio registry), NOT
   * from schema.json's lightweight Person stubs. Those two registries are
   * deliberately separate — see the note in jsonedit.html's artwork section. */
  function buildContext(schemaData, artistsData) {
    var artistsMap = {};
    var exhMap = {};
    ((artistsData && artistsData['@graph']) || []).forEach(function (p) {
      if (p && p['@id']) artistsMap[p['@id']] = p;
    });
    ((schemaData && schemaData['@graph']) || []).forEach(function (item) {
      if (!item || !item['@id']) return;
      if (typesOf(item).indexOf('ExhibitionEvent') === -1) return;
      var frag = String(item['@id']).split('#')[1];
      if (frag) exhMap[frag] = item;
    });
    return { artistsMap: artistsMap, exhMap: exhMap };
  }

  function artistNames(art, ctx) {
    return artistRefs(art).map(function (id) {
      var p = ctx && ctx.artistsMap && ctx.artistsMap[id];
      /* Falling back to the raw @id is deliberate and ugly on purpose: a
       * broken artist link should be visible on the page, not silently
       * rendered as an artwork with no attribution. */
      return (p && p.name) || id;
    });
  }

  /* Joins with an ampersand for the last pair, matching how the gallery
   * captions this data was back-filled from already read
   * ("Phoenix Isla Kea & Jasmine Broadhurst"). */
  function artistLine(art, ctx) {
    var names = artistNames(art, ctx);
    if (names.length <= 1) return names[0] || '';
    return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
  }

  /* An artwork's year. Falls back to the exhibition's own startDate, which is
   * why exhibition nodes are the single source of truth for it — but ONLY if
   * that exhibition actually carries one. Nothing here invents a year: a
   * fabricated date is a lie, a missing one is honest, and the caption simply
   * drops the "(year)" segment when there isn't one. */
  function yearOf(art, ctx) {
    if (art && art.dateCreated) return String(art.dateCreated);
    var exh = ctx && ctx.exhMap && ctx.exhMap[art && art.exhibition];
    return (exh && exh.startDate) ? String(exh.startDate) : '';
  }

  function imagesOf(art) {
    return (art && Array.isArray(art.images) ? art.images : []).filter(function (im) {
      return im && (im.src || im.full);
    });
  }

  /* Selection is by PAGE PATH, not by exhibition key. An artwork carries
   * visibleOn:[…] holding resolved paths ('/does-cloud-compute-ever-precipitate/',
   * '/'), so the same record can appear on its exhibition page, the homepage
   * and any future cross-listing without a second lookup table mapping keys to
   * pages. Passing an exhibition instead is supported for the editor preview,
   * which groups by exhibition rather than by page. */
  function artworkFor(schemaData, opts) {
    opts = opts || {};
    var page = opts.page;
    var exhibition = opts.exhibition;
    return ((schemaData && schemaData['@graph']) || [])
      .filter(function (item) {
        if (!isArtwork(item)) return false;
        if (item.visible === false) return false;
        if (exhibition && item.exhibition !== exhibition) return false;
        if (page) {
          var on = Array.isArray(item.visibleOn) ? item.visibleOn : [];
          if (on.indexOf(page) === -1) return false;
        }
        return true;
      })
      .sort(function (a, b) { return (a.sortOrder || 999) - (b.sortOrder || 999); });
  }

  function artworkSlug(art) {
    return slugify(art && art.name) || 'artwork';
  }

  function thumbStripHTML(imgs, slug) {
    if (imgs.length < 2) return '';
    var items = imgs.map(function (im, i) {
      return '<button type="button" class="aw-thumb' + (i === 0 ? ' is-current' : '') +
        '" data-aw-index="' + i + '" aria-label="Show image ' + (i + 1) + ' of ' + imgs.length + '">' +
        '<img src="' + esc(im.src || im.full) + '" alt="" loading="lazy" decoding="async">' +
        '</button>';
    }).join('');
    return '<div class="aw-thumbs" role="group" aria-label="Other images of ' + esc(slug) + '">' + items + '</div>';
  }

  function carouselHTML(art, imgs) {
    if (!imgs.length) return '';
    var first = imgs[0];
    var nav = imgs.length > 1
      ? '<button type="button" class="aw-nav aw-nav--prev" aria-label="Previous image">&#8249;</button>' +
        '<button type="button" class="aw-nav aw-nav--next" aria-label="Next image">&#8250;</button>'
      : '';
    /* Every image's full-size path rides along in data-aw-full/-src/-alt on the
     * thumb buttons below; the carousel just swaps the main <img>. Only one
     * <img> is ever the "main" one so the modal never double-downloads. */
    return '<div class="aw-carousel" data-aw-count="' + imgs.length + '">' +
      '<div class="aw-stage">' +
        '<img class="aw-main" src="' + esc(first.full || first.src) + '" alt="' + esc(first.alt || '') + '" decoding="async">' +
        nav +
      '</div></div>';
  }

  /* The stowed detail block. Real semantic structure — <figure>, real heading,
   * real <img alt> — so that when exhibition-page baking lands, this markup is
   * already crawlable and barely needs to change. */
  function detailHTML(art, ctx, imgs, slug) {
    var title = String(art.name || 'Untitled');
    var line = artistLine(art, ctx);
    var year = yearOf(art, ctx);
    var meta = [];
    var dims = dimensionLine(art);
    if (dims) meta.push(esc(dims));
    // artForm / artMedium are deliberately NOT rendered here. They exist as
    // curatorial dropdowns in the editor for the site owner's own internal
    // categorisation, not as public-facing copy — the sheets these records
    // were imported from never populate them in a form fit for public
    // display, and showing a controlled-vocabulary term like "Sculpture"
    // next to a real materials list in `keywords` reads as redundant or
    // contradictory. If that changes, add them back here rather than in
    // renderCardHTML — this is the detail view, not the condensed card,
    // and the two were never wired to show these fields in the first place.

    var credit = title + (year ? ' (' + year + ')' : '') + (line ? ' \u00a9 ' + line : '');
    var link = (art.url && art.linkLabel)
      ? '<p class="aw-detail__link"><a href="' + esc(art.url) + '" target="_blank" rel="noopener">' + esc(art.linkLabel) + '</a></p>'
      : '';

    return '<div class="aw-detail is-stowed" id="aw-detail-' + esc(slug) + '">' +
      '<header class="aw-detail__head">' +
        '<h3 class="aw-detail__title">' + esc(title) + (line ? ' <span class="aw-detail__artist">&mdash; ' + esc(line) + '</span>' : '') + '</h3>' +
      '</header>' +
      carouselHTML(art, imgs) +
      thumbStripHTML(imgs, title) +
      (art.description ? '<p class="aw-detail__desc">' + esc(art.description) + '</p>' : '') +
      (meta.length ? '<p class="aw-detail__meta">' + meta.join(' &middot; ') + '</p>' : '') +
      link +
      '<p class="aw-detail__credit">' + esc(credit) + '</p>' +
      '</div>';
  }

  function dimensionLine(art) {
    var w = art && art.width, h = art && art.height;
    if (!w && !h) return '';
    if (w && h) return w + ' \u00d7 ' + h;
    return String(w || h);
  }

  /* One condensed card: square cover, title + artist subtitle, stowed detail.
   * The whole card is a <button> so the click target, the hover affordance and
   * the keyboard affordance are the same element — no div-with-onclick. */
  function renderCardHTML(art, ctx) {
    var imgs = imagesOf(art);
    var cover = imgs[0];
    var slug = artworkSlug(art);
    var title = String(art.name || 'Untitled');
    var line = artistLine(art, ctx);

    /* alt never falls back to empty or to a placeholder: the gallery entry's
     * own alt first (galleries.json is the source of truth for the image and
     * therefore for its description), then a composed one from the artwork's
     * own fields. */
    var alt = (cover && cover.alt) || (title + (line ? ', ' + line : ''));

    var coverHTML = cover
      ? '<img class="aw-cover" src="' + esc(cover.src || cover.full) + '" alt="' + esc(alt) + '" loading="lazy" decoding="async">'
      : '<span class="aw-cover aw-cover--empty" aria-hidden="true"></span>';

    return '<article class="aw-card" data-aw-slug="' + esc(slug) + '">' +
      '<button type="button" class="aw-card__open" aria-haspopup="dialog" aria-expanded="false" aria-controls="aw-detail-' + esc(slug) + '">' +
        '<figure class="aw-figure">' +
          coverHTML +
          '<figcaption class="aw-figcaption">' +
            '<span class="aw-card__title">' + esc(title) + '</span>' +
            (line ? '<span class="aw-card__artist">' + esc(line) + '</span>' : '') +
          '</figcaption>' +
        '</figure>' +
      '</button>' +
      detailHTML(art, ctx, imgs, slug) +
      '</article>';
  }

  function renderGridHTML(list, ctx) {
    if (!list || !list.length) return '';
    return '<div class="aw-grid">' + list.map(function (a) { return renderCardHTML(a, ctx); }).join('') + '</div>';
  }

  /* JSON-LD for the artwork on this page. Artists are emitted as bare @id
   * references — artists.js injects the matching Person nodes on the same
   * page, so the references resolve without either script duplicating the
   * other's nodes. Display-only helper fields (exhibition, sortOrder,
   * visibleOn, linkLabel) are dropped: they are ours, not schema.org's. */
  function buildJsonLd(list, ctx) {
    var nodes = (list || []).map(function (art) {
      var imgs = imagesOf(art).map(function (im) { return absUrl(im.full || im.src); }).filter(Boolean);
      var refs = artistRefs(art);
      var year = yearOf(art, ctx);
      var node = {
        '@type': ARTWORK_TYPE,
        '@id': art['@id'] || (SITE_ORIGIN + '/#artwork-' + artworkSlug(art)),
        name: String(art.name || '')
      };
      if (art.description) node.description = String(art.description).trim();
      if (refs.length) node.artist = refs.length === 1 ? { '@id': refs[0] } : refs.map(function (id) { return { '@id': id }; });
      if (year) node.dateCreated = year;
      if (imgs.length) node.image = imgs;
      if (art.artForm) node.artform = art.artForm;
      if (art.artMedium) node.artMedium = art.artMedium;
      if (art.width) node.width = art.width;
      if (art.height) node.height = art.height;
      if (Array.isArray(art.keywords) && art.keywords.length) node.keywords = art.keywords.slice();
      if (Array.isArray(art.sameAs) && art.sameAs.length) node.sameAs = art.sameAs.slice();
      if (art.url) node.url = art.url;
      return node;
    });
    return { '@context': 'https://schema.org', '@graph': nodes };
  }

  /* =====================================================================
   * BROWSER LAYER — everything below touches the DOM.
   * ===================================================================== */

  var modalEl = null;
  var modalBody = null;
  var openCard = null;
  var lastFocus = null;
  var carouselIndex = 0;
  var carouselImgs = [];

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'aw-modal';
    modalEl.setAttribute('role', 'dialog');
    modalEl.setAttribute('aria-modal', 'true');
    modalEl.setAttribute('aria-hidden', 'true');
    modalEl.innerHTML =
      '<div class="aw-modal__inner" role="document">' +
        '<button type="button" class="aw-modal__close" aria-label="Close">&times;</button>' +
        '<div class="aw-modal__body"></div>' +
      '</div>';
    document.body.appendChild(modalEl);
    modalBody = modalEl.querySelector('.aw-modal__body');

    modalEl.addEventListener('click', function (e) {
      if (e.target === modalEl) closeModal();
    });
    modalEl.querySelector('.aw-modal__close').addEventListener('click', function () { closeModal(); });

    /* The detail block is MOVED, not cloned, so these listeners are delegated
     * off the modal and survive every open/close cycle. */
    modalBody.addEventListener('click', function (e) {
      var thumb = e.target.closest && e.target.closest('.aw-thumb');
      if (thumb) { showImage(parseInt(thumb.dataset.awIndex, 10)); return; }
      var nav = e.target.closest && e.target.closest('.aw-nav');
      if (nav) { showImage(carouselIndex + (nav.classList.contains('aw-nav--next') ? 1 : -1)); }
    });
    return modalEl;
  }

  function readCarousel() {
    carouselImgs = [];
    carouselIndex = 0;
    var thumbs = modalBody.querySelectorAll('.aw-thumb img');
    var main = modalBody.querySelector('.aw-main');
    if (!main) return;
    if (!thumbs.length) { carouselImgs = [{ src: main.getAttribute('src'), alt: main.getAttribute('alt') }]; return; }
    /* Thumb srcs are the webp thumbnails; the main image wants the full-size
     * file. The detail markup only carries thumbnail paths on the buttons, so
     * the full path is derived from the card's own image list, stashed here at
     * open time by openModal(). */
    carouselImgs = openCard.__awImages || [];
  }

  function showImage(i) {
    if (!carouselImgs.length) return;
    var n = carouselImgs.length;
    carouselIndex = ((i % n) + n) % n;            /* wraparound, both directions */
    var im = carouselImgs[carouselIndex];
    var main = modalBody.querySelector('.aw-main');
    if (main) {
      main.src = im.full || im.src;
      main.alt = im.alt || '';
    }
    var thumbs = modalBody.querySelectorAll('.aw-thumb');
    Array.prototype.forEach.call(thumbs, function (t, ti) {
      t.classList.toggle('is-current', ti === carouselIndex);
    });
  }

  function openModal(card) {
    ensureModal();
    if (openCard) closeModal(true);
    var detail = card.querySelector('.aw-detail');
    if (!detail) return;
    openCard = card;
    lastFocus = document.activeElement;
    detail.classList.remove('is-stowed');
    modalBody.appendChild(detail);
    modalEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('aw-modal-open');
    var btn = card.querySelector('.aw-card__open');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    readCarousel();
    showImage(0);
    var close = modalEl.querySelector('.aw-modal__close');
    if (close) close.focus();
  }

  function closeModal(silent) {
    if (!openCard || !modalEl) return;
    var detail = modalBody.querySelector('.aw-detail');
    if (detail) {
      detail.classList.add('is-stowed');
      openCard.appendChild(detail);            /* put it back where it was baked */
    }
    var btn = openCard.querySelector('.aw-card__open');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    modalEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('aw-modal-open');
    var restore = lastFocus;
    openCard = null;
    lastFocus = null;
    carouselImgs = [];
    if (!silent && restore && restore.focus) restore.focus();
  }

  function modalIsOpen() { return !!openCard; }

  var keysBound = false;
  function bindKeys() {
    if (keysBound) return;
    keysBound = true;
    document.addEventListener('keydown', function (e) {
      if (!modalIsOpen()) return;
      if (e.key === 'Escape') { closeModal(); return; }
      if (e.key === 'ArrowRight') { showImage(carouselIndex + 1); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { showImage(carouselIndex - 1); e.preventDefault(); }
    });
  }

  /* Attaches behaviour to cards already in the DOM. Safe to call more than
   * once — cards are marked so a second pass over the same grid is a no-op.
   * That matters because the editor preview re-renders on every keystroke. */
  function hydrate(root) {
    root = root || document;
    ensureModal();
    bindKeys();
    var cards = root.querySelectorAll('.aw-card');
    Array.prototype.forEach.call(cards, function (card) {
      if (card.dataset.awHydrated === '1') return;
      card.dataset.awHydrated = '1';
      var btn = card.querySelector('.aw-card__open');
      if (!btn) return;
      btn.addEventListener('click', function () { openModal(card); });
    });
    return cards.length;
  }

  /* Full-size paths live on the data, not in the stowed markup, so hydration
   * needs the records too. Called by render targets right after innerHTML. */
  function attachImageData(root, list) {
    var cards = (root || document).querySelectorAll('.aw-card');
    Array.prototype.forEach.call(cards, function (card) {
      var slug = card.dataset.awSlug;
      var rec = (list || []).filter(function (a) { return artworkSlug(a) === slug; })[0];
      card.__awImages = rec ? imagesOf(rec) : [];
    });
  }

  /* Renders every [data-artwork-exhibition] container on the page, the same
   * container-driven shape site-gallery.js uses for galleries. The container
   * carries the page path so selection is by visibleOn, with the exhibition
   * only used as a secondary filter. */
  function autoInit() {
    if (typeof document === 'undefined') return;
    var start = function () {
      var mounts = Array.prototype.slice.call(document.querySelectorAll('[data-artwork-exhibition]'));
      if (!mounts.length) return;
      Promise.all([
        fetch('/json/schema.json').then(function (r) { return r.json(); }),
        fetch('/json/artists.json').then(function (r) { return r.json(); }).catch(function () { return null; })
      ]).then(function (res) {
        var schemaData = res[0], artistsData = res[1];
        var ctx = buildContext(schemaData, artistsData);
        mounts.forEach(function (mount) {
          var list = artworkFor(schemaData, {
            exhibition: mount.getAttribute('data-artwork-exhibition') || null,
            page: mount.getAttribute('data-artwork-page') || null
          });
          if (!list.length) {
            /* An exhibition with no artwork records yet should show nothing at
             * all rather than an "Artwork" heading over an empty space — the
             * DCCeP page opts into this with data-artwork-hide-empty, matching
             * site-gallery.js's behaviour for empty galleries. Without the
             * attribute, a placeholder line is shown instead. */
            var section = mount.closest('section');
            if (mount.hasAttribute('data-artwork-hide-empty') && section) section.style.display = 'none';
            else mount.innerHTML = '<p class="aw-empty">Artwork to be announced.</p>';
            return;
          }
          var section2 = mount.closest('section');
          if (section2) section2.style.display = '';
          mount.innerHTML = renderGridHTML(list, ctx);
          attachImageData(mount, list);
          hydrate(mount);
          injectJsonLd(list, ctx);
        });
      }).catch(function (err) {
        console.error('artwork.js:', err);
        mounts.forEach(function (m) { m.innerHTML = '<p class="aw-empty">Artwork to be announced.</p>'; });
      });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }

  function injectJsonLd(list, ctx) {
    if (document.getElementById('artwork-jsonld')) return;
    var s = document.createElement('script');
    s.type = 'application/ld+json';
    s.id = 'artwork-jsonld';
    s.textContent = JSON.stringify(buildJsonLd(list, ctx));
    document.head.appendChild(s);
  }

  return {
    /* pure */
    isArtwork: isArtwork,
    buildContext: buildContext,
    artworkFor: artworkFor,
    artistRefs: artistRefs,
    artistNames: artistNames,
    artistLine: artistLine,
    yearOf: yearOf,
    imagesOf: imagesOf,
    artworkSlug: artworkSlug,
    renderCardHTML: renderCardHTML,
    renderGridHTML: renderGridHTML,
    buildJsonLd: buildJsonLd,
    /* browser */
    hydrate: hydrate,
    attachImageData: attachImageData,
    openModal: openModal,
    closeModal: closeModal,
    autoInit: autoInit
  };
}));
