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
 *
 * KNOWN GAP — INLINE MICRODATA
 * past-events.js treats microdata and JSON-LD as two independent
 * representations kept in field-parity, because Google's Rich Results parser
 * reads both separately and a mismatch reports one entity twice. This file
 * emits NO inline microdata at all (no itemscope/itemprop on the card or the
 * detail block) — only the JSON-LD below. That is a real gap against this
 * codebase's own discipline, and it is left open DELIBERATELY rather than
 * overlooked: closing it is a symmetric expansion of the SEO surface
 * (itemprops on cover, description, artist, dimensions…), independent of
 * baking, and it was kept out of the baking pass so that pass changed the
 * pure layer's markup shape in exactly one way (the thumb data attributes
 * below) instead of two at once. Close it as its own pass, in
 * renderCardHTML/detailHTML, and extend verifyArtworkPageHTML to assert
 * parity with buildJsonLd the way test-past-events.js section C does.
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
   * WHICH PAGES GET BAKED — THE SOURCE OF TRUTH, AND IT IS THIS FILE
   * =====================================================================
   * Not jsonedit.html, and not dev-tools/build-artwork-pages.js. Both of
   * those READ this array; neither carries its own copy. If you are looking
   * for the artwork bake's page list and you started in the editor's GitHub
   * settings modal, this is where you were headed — the modal configures
   * `pagePath` for the single Past Events page and has nothing to do with
   * artwork.
   *
   * TO ONBOARD A PAGE (e.g. can-we-start-again, deliberately absent below
   * until its owner is ready): add one row here, then hand-place the four
   * markers in that page's index.html —
   *
   *     <!-- AW:START:artwork-grid -->   <!-- AW:END:artwork-grid -->
   *     <!-- AW:START:artwork-jsonld --> <!-- AW:END:artwork-jsonld -->
   *
   * — the grid pair inside the page's [data-artwork-exhibition] container,
   * the jsonld pair in <head>. Nothing else needs editing anywhere. A page
   * with a row here but no markers fails loudly at bake time rather than
   * being silently skipped.
   *
   *   exhibition   — the exhibition key, used for reporting only
   *   pagePath     — repo-relative path to the file that gets rewritten
   *   artworkPage  — the resolved site path matched against each artwork's
   *                  visibleOn[], i.e. the page's own data-artwork-page value
   * ===================================================================== */
  var ARTWORK_BAKE_PAGES = [
    {
      exhibition: 'does-cloud-compute',
      pagePath: 'does-cloud-compute-ever-precipitate/index.html',
      artworkPage: '/does-cloud-compute-ever-precipitate/'
    },
    {
      exhibition: 'bitrot',
      pagePath: 'BitRot/index.html',
      artworkPage: '/BitRot/'
    }
  ];

  /* Marker names bounding the generated regions. Prefixed AW:, never PE: —
   * two generators writing into the same page must not share a namespace. */
  var AW_REGION_KEYS = ['artwork-grid', 'artwork-jsonld'];

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

  /* Each thumb carries its own full-size path and alt text as data attributes,
   * alongside the thumbnail src on the <img> inside it. That is what makes a
   * BAKED card's carousel work with no live data at all: readCarousel() builds
   * its image list straight off these attributes when nothing has been handed
   * to the card by a fetch. Before this, the thumb markup carried only the
   * thumbnail path, so navigating past the first image needed schema.json +
   * artists.json to have loaded successfully — a hidden fetch dependency that
   * survived baking and failed silently, since the first image always worked.
   * The attributes live on the <button>, not the <img>, so the thumbnail's own
   * src stays the thumbnail's and nothing double-downloads. */
  function thumbStripHTML(imgs, slug) {
    if (imgs.length < 2) return '';
    var items = imgs.map(function (im, i) {
      return '<button type="button" class="aw-thumb' + (i === 0 ? ' is-current' : '') +
        '" data-aw-index="' + i + '"' +
        ' data-aw-full="' + esc(im.full || im.src) + '"' +
        ' data-aw-alt="' + esc(im.alt || '') + '"' +
        ' aria-label="Show image ' + (i + 1) + ' of ' + imgs.length + '">' +
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
    /* Every image's full-size path rides along in data-aw-full/-alt on the
     * thumb buttons below; the carousel just swaps the main <img>. Only one
     * <img> is ever the "main" one so the modal never double-downloads.
     *
     * The same pair is repeated on .aw-main itself so the SINGLE-image case
     * (no thumb strip is emitted at all below two images) reads through the
     * same attribute path as the multi-image one, rather than readCarousel()
     * having to fall back to scraping src/alt off the element. */
    return '<div class="aw-carousel" data-aw-count="' + imgs.length + '">' +
      '<div class="aw-stage">' +
        '<img class="aw-main" src="' + esc(first.full || first.src) + '"' +
          ' data-aw-full="' + esc(first.full || first.src) + '"' +
          ' data-aw-alt="' + esc(first.alt || '') + '"' +
          ' alt="' + esc(first.alt || '') + '" decoding="async">' +
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
   * BAKING — still the pure layer. Strings in, strings out, no DOM.
   * =====================================================================
   * Mirrors scripts/past-events.js sections 6/8/9 deliberately and closely:
   * same marker-bounded string splice (never a DOM parse-and-reserialise,
   * which would silently rewrite hand-authored markup across the whole
   * page), same outside-the-markers equality check, same "re-derive what the
   * content should be from the JSON and go looking for it in the output"
   * verification. The mechanism is content-agnostic; only the marker prefix
   * and the per-item checks differ.
   * ===================================================================== */

  function startMarker(key) { return '<!-- AW:START:' + key + ' -->'; }
  function endMarker(key) { return '<!-- AW:END:' + key + ' -->'; }

  function applyRegions(htmlText, regions) {
    var out = String(htmlText);
    var missing = [];
    var applied = [];

    Object.keys(regions).forEach(function (key) {
      var s = startMarker(key);
      var e = endMarker(key);
      var si = out.indexOf(s);
      var ei = out.indexOf(e);
      if (si === -1 || ei === -1 || ei < si) { missing.push(key); return; }
      if (out.indexOf(s, si + s.length) !== -1) { missing.push(key + ' (start marker appears more than once)'); return; }
      if (out.indexOf(e, ei + e.length) !== -1) { missing.push(key + ' (end marker appears more than once)'); return; }

      var lineStart = out.lastIndexOf('\n', si) + 1;
      var indent = (out.slice(lineStart, si).match(/^[ \t]*/) || [''])[0];
      var inner = String(regions[key] || '');
      var block = inner
        ? '\n' + indent + inner.split('\n').join('\n' + indent) + '\n' + indent
        : '\n' + indent;
      out = out.slice(0, si + s.length) + block + out.slice(ei);
      applied.push(key);
    });

    return { html: out, missing: missing, applied: applied };
  }

  /* Everything outside the generated regions must survive a bake byte for
   * byte. Blanking each region lets two versions of the file be compared. */
  function outsideRegions(htmlText, keys) {
    var out = String(htmlText);
    (keys || AW_REGION_KEYS).forEach(function (key) {
      var s = startMarker(key);
      var e = endMarker(key);
      var si = out.indexOf(s);
      var ei = out.indexOf(e);
      if (si === -1 || ei === -1 || ei < si) return;
      out = out.slice(0, si + s.length) + '\u0000' + key + '\u0000' + out.slice(ei);
    });
    return out;
  }

  /* renderPageRegions(schemaData, artistsData, pageCfg) → everything a caller
   * needs to rewrite one page. `pageCfg` is a row from ARTWORK_BAKE_PAGES.
   *
   *   regions  — marker key → markup
   *   list/ctx — what was selected, for the caller's own verify pass
   *   baked/skipped/errors/warnings — diagnostics surfaced after a push
   *   fatal    — set when nothing usable could be produced (blocks the push)
   */
  function renderPageRegions(schemaData, artistsData, pageCfg) {
    var result = {
      page: (pageCfg && pageCfg.pagePath) || '',
      exhibition: (pageCfg && pageCfg.exhibition) || '',
      regions: {}, list: [], ctx: null,
      baked: 0, skipped: 0, errors: [], warnings: [], fatal: null
    };

    if (!schemaData || typeof schemaData !== 'object' || !Array.isArray(schemaData['@graph'])) {
      result.fatal = 'The loaded JSON has no "@graph" array — nothing can be generated.';
      return result;
    }
    if (!pageCfg || !pageCfg.artworkPage) {
      result.fatal = 'No artworkPage configured for this bake target.';
      return result;
    }

    var ctx = buildContext(schemaData, artistsData);
    result.ctx = ctx;

    /* Selection is by page path only — exactly what autoInit() does live, and
     * NOT filtered by exhibition as well. An artwork cross-listed onto a page
     * it does not "belong" to is still on that page by its own visibleOn, and
     * baking it out because its exhibition key differs would make the static
     * page disagree with the client render. */
    var candidates = artworkFor(schemaData, { page: pageCfg.artworkPage });

    var kept = [];
    var cards = [];
    var seenSlugs = {};

    candidates.forEach(function (art) {
      var who = 'Artwork "' + String((art && art.name) || '(untitled)') + '"';
      var slug = artworkSlug(art);
      if (seenSlugs[slug]) {
        result.warnings.push(who + ' shares the slug "' + slug + '" with another artwork on ' +
          pageCfg.artworkPage + ' — verification can only match the first one');
      }
      seenSlugs[slug] = true;

      if (!imagesOf(art).length) {
        result.warnings.push(who + ' has no images — it will bake as a card with an empty cover');
      }
      artistRefs(art).forEach(function (id) {
        if (!(ctx.artistsMap && ctx.artistsMap[id])) {
          result.warnings.push(who + ' credits unknown artist ' + id +
            ' — the raw @id will appear on the page until artists.json carries it');
        }
      });

      var html;
      try {
        html = renderCardHTML(art, ctx);
      } catch (err) {
        result.errors.push(who + ' could not be rendered: ' + (err && err.message ? err.message : err));
        result.skipped++;
        return;
      }
      kept.push(art);
      cards.push(html);
      result.baked++;
    });

    if (candidates.length > 0 && result.baked === 0) {
      result.fatal = 'All ' + candidates.length + ' artworks for ' + pageCfg.artworkPage +
        ' failed to render — refusing to publish an empty artwork grid over a page that has artwork.';
      return result;
    }
    if (candidates.length === 0) {
      /* Not fatal: a page can legitimately be in the allowlist before its
       * artwork records exist. The grid region bakes empty, the mount then
       * contains no .aw-card, and autoInit() treats it as unbaked and takes
       * the existing client path — including data-artwork-hide-empty. */
      result.warnings.push('No artwork matches ' + pageCfg.artworkPage +
        ' — the grid region will bake empty and the page falls back to its client-side behaviour.');
    }

    result.list = kept;
    result.regions['artwork-grid'] = kept.length ? renderGridHTML(kept, ctx) : '';

    var jsonLd;
    try {
      jsonLd = buildJsonLd(kept, ctx);
    } catch (err) {
      result.fatal = 'Structured data (JSON-LD) could not be generated: ' + (err && err.message ? err.message : err);
      return result;
    }
    result.jsonLd = jsonLd;
    /* id="artwork-jsonld" is load-bearing: injectJsonLd() checks for exactly
     * this id and no-ops when it is already present, so a baked page cannot
     * end up with two copies even if something does call it. One line, like
     * pe-jsonld, because it is machine output living inside markers. */
    result.regions['artwork-jsonld'] = kept.length
      ? '<script type="application/ld+json" id="artwork-jsonld">' +
        JSON.stringify(jsonLd).replace(/<\//g, '<\\/') +
        '</script>'
      : '';

    return result;
  }

  /* ---------------------------------------------------------------------
   * Verification. Like verifyBakedHTML(), this does NOT compare the
   * generator's output to itself — it re-derives what each artwork should
   * contain from the records and looks for it in the raw markup, which is
   * what a crawler actually reads.
   *
   * It goes one step further than the Past Events verifier on images, and
   * has to: per-image data is now written at TWO DOM positions (the
   * thumbnail src on the <img>, the full-size path on the parent <button>'s
   * data-aw-full). Checking only that the attribute exists somewhere would
   * pass a bake that put the wrong image's full-size path on the wrong
   * thumb, so the values are compared positionally against the record.
   * ------------------------------------------------------------------- */

  function awTextOf(s) {
    return String(s || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ').trim();
  }

  function awStripTags(html) {
    return awTextOf(String(html).replace(/<[^>]*>/g, ' '));
  }

  /* The markup for one card, sliced out of the page by its slug so that a
   * per-image positional check cannot accidentally match another card's
   * images. */
  function cardBlockFor(htmlText, slug) {
    var needle = '<article class="aw-card" data-aw-slug="' + esc(slug) + '">';
    var si = String(htmlText).indexOf(needle);
    if (si === -1) return '';
    var next = String(htmlText).indexOf('<article class="aw-card"', si + needle.length);
    return next === -1 ? String(htmlText).slice(si) : String(htmlText).slice(si, next);
  }

  function thumbAttrsIn(cardBlock) {
    var thumbsAt = cardBlock.indexOf('class="aw-thumbs"');
    if (thumbsAt === -1) return [];
    var strip = cardBlock.slice(thumbsAt);
    var out = [];
    var re = /<button[^>]*class="aw-thumb[^"]*"[^>]*>[\s\S]*?<\/button>/g;
    var m;
    while ((m = re.exec(strip)) !== null) {
      var btn = m[0];
      var full = /data-aw-full="([^"]*)"/.exec(btn);
      var alt = /data-aw-alt="([^"]*)"/.exec(btn);
      var src = /<img[^>]*\ssrc="([^"]*)"/.exec(btn);
      out.push({
        full: full ? full[1] : null,
        alt: alt ? alt[1] : null,
        src: src ? src[1] : null
      });
    }
    return out;
  }

  /* verifyArtworkPageHTML(html, list, ctx) → { ok, problems[], checked }
   * Pure string work, so it runs identically in the browser (the editor's
   * pre-push sanity check) and in Node (the CLI and the tests). */
  function verifyArtworkPageHTML(htmlText, list, ctx) {
    var html = String(htmlText);
    var text = awStripTags(html);
    var problems = [];
    var checked = 0;

    (list || []).forEach(function (art) {
      var who = 'Artwork "' + String((art && art.name) || '(untitled)') + '"';
      var slug = artworkSlug(art);
      var block = cardBlockFor(html, slug);
      checked++;

      if (!block) {
        problems.push(who + ': no baked .aw-card with data-aw-slug="' + slug + '" in the generated HTML');
        return;
      }
      var blockText = awStripTags(block);

      if (art.name && blockText.indexOf(awTextOf(art.name)) === -1) {
        problems.push(who + ': name missing from the generated HTML');
      }
      var line = artistLine(art, ctx);
      if (line && blockText.indexOf(awTextOf(line)) === -1) {
        problems.push(who + ': artist credit missing from the generated HTML');
      }
      if (art.description && blockText.indexOf(awTextOf(art.description).slice(0, 60)) === -1) {
        problems.push(who + ': description missing from the baked detail block');
      }

      var imgs = imagesOf(art);
      if (!imgs.length) return;

      /* Cover: the condensed card's square image, thumbnail resolution. */
      var coverSrc = imgs[0].src || imgs[0].full;
      if (block.indexOf('class="aw-cover" src="' + esc(coverSrc) + '"') === -1) {
        problems.push(who + ': cover image ' + coverSrc + ' has no <img class="aw-cover" src> in the generated HTML');
      }

      /* Main carousel image: full resolution, plus the data pair the baked
       * carousel reads when no live fetch has populated the card. */
      var mainFull = imgs[0].full || imgs[0].src;
      var mainTag = /<img class="aw-main"[^>]*>/.exec(block);
      if (!mainTag) {
        problems.push(who + ': no <img class="aw-main"> in the baked carousel');
      } else {
        var tag = mainTag[0];
        if (tag.indexOf('src="' + esc(mainFull) + '"') === -1) {
          problems.push(who + ': the main carousel image is not ' + mainFull);
        }
        if (tag.indexOf('data-aw-full="' + esc(mainFull) + '"') === -1) {
          problems.push(who + ': .aw-main is missing data-aw-full="' + mainFull +
            '" — a baked carousel would depend on a live fetch');
        }
        if (tag.indexOf('data-aw-alt="' + esc(imgs[0].alt || '') + '"') === -1) {
          problems.push(who + ': .aw-main data-aw-alt does not match the record');
        }
      }

      if (imgs.length < 2) return;

      /* Thumb strip: every image's own full path and alt, in record order,
       * on its own button. Positional — not "the attribute exists". */
      var thumbs = thumbAttrsIn(block);
      if (thumbs.length !== imgs.length) {
        problems.push(who + ': baked ' + thumbs.length + ' thumbnail button(s) for ' +
          imgs.length + ' image(s)');
        return;
      }
      imgs.forEach(function (im, i) {
        var expFull = im.full || im.src;
        var expSrc = im.src || im.full;
        var expAlt = im.alt || '';
        var got = thumbs[i];
        if (got.full === null) {
          problems.push(who + ' image ' + (i + 1) + ': thumbnail button has no data-aw-full — ' +
            'a baked carousel would depend on a live fetch');
        } else if (got.full !== esc(expFull)) {
          problems.push(who + ' image ' + (i + 1) + ': data-aw-full is "' + got.full +
            '", expected "' + esc(expFull) + '"');
        }
        if (got.src !== esc(expSrc)) {
          problems.push(who + ' image ' + (i + 1) + ': thumbnail src is "' + got.src +
            '", expected "' + esc(expSrc) + '"');
        }
        if (got.alt !== esc(expAlt)) {
          problems.push(who + ' image ' + (i + 1) + ': data-aw-alt is "' + got.alt +
            '", expected "' + esc(expAlt) + '"');
        }
      });
    });

    /* The structured-data block has to be there too, and has to carry the
     * same artworks the cards do. */
    if ((list || []).length) {
      var ldAt = html.indexOf('<script type="application/ld+json" id="artwork-jsonld">');
      if (ldAt === -1) {
        problems.push('the baked JSON-LD block (id="artwork-jsonld") is missing from the generated HTML');
      } else {
        var ldEnd = html.indexOf('</script>', ldAt);
        var ldRaw = html.slice(ldAt, ldEnd === -1 ? html.length : ldEnd).replace(/<\\\//g, '</');
        (list || []).forEach(function (art) {
          var id = art['@id'] || (SITE_ORIGIN + '/#artwork-' + artworkSlug(art));
          if (ldRaw.indexOf(JSON.stringify(id).slice(1, -1)) === -1) {
            problems.push('Artwork "' + String(art.name || '') + '": ' + id + ' missing from the baked JSON-LD');
          }
        });
      }
    }

    return { ok: problems.length === 0, problems: problems, checked: checked };
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

  /* Builds the modal's image list. Two sources, in this order:
   *
   *   1. card.__awImages — set by attachImageData() when a live fetch (or the
   *      editor preview) has the real records to hand. Preferred because it is
   *      the records themselves, unescaped and untruncated.
   *   2. the DOM — data-aw-full / data-aw-alt baked onto each thumb button by
   *      thumbStripHTML(), or onto .aw-main for a single-image artwork.
   *
   * (2) is why a baked card is fully interactive with no live data at all.
   * Before it existed this function returned card.__awImages or nothing, so a
   * baked page whose schema.json fetch failed — or which never fetched,
   * because the mount was already baked — silently had a carousel that could
   * not navigate past its first image. */
  function readCarousel() {
    carouselImgs = [];
    carouselIndex = 0;
    var main = modalBody.querySelector('.aw-main');
    if (!main) return;

    if (openCard && openCard.__awImages && openCard.__awImages.length) {
      carouselImgs = openCard.__awImages;
      return;
    }

    var thumbs = modalBody.querySelectorAll('.aw-thumb');
    if (thumbs.length) {
      carouselImgs = Array.prototype.map.call(thumbs, function (btn) {
        var img = btn.querySelector('img');
        var thumbSrc = img ? img.getAttribute('src') : '';
        var full = btn.getAttribute('data-aw-full') || thumbSrc || '';
        return { src: thumbSrc || full, full: full, alt: btn.getAttribute('data-aw-alt') || '' };
      });
      return;
    }

    /* Single image: no strip is emitted, so .aw-main carries the pair. */
    var mainFull = main.getAttribute('data-aw-full') || main.getAttribute('src') || '';
    carouselImgs = [{
      src: mainFull,
      full: mainFull,
      alt: main.getAttribute('data-aw-alt') || main.getAttribute('alt') || ''
    }];
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
  /* A mount is baked when it already holds real cards. Checked PER MOUNT, not
   * once per page: a page can be baked for one exhibition and later grow a
   * second [data-artwork-exhibition] container that the bake allowlist has not
   * caught up with yet. Skipping the fetch for the whole page because some
   * other mount was baked would leave that second mount permanently empty, and
   * the cause would be almost untraceable from the symptom. */
  function isBakedMount(mount) {
    return !!(mount && mount.querySelector('.aw-card'));
  }

  function autoInit() {
    if (typeof document === 'undefined') return;
    var start = function () {
      var all = Array.prototype.slice.call(document.querySelectorAll('[data-artwork-exhibition]'));
      if (!all.length) return;

      /* Baked mounts: hydrate the markup that is already there. No fetch, no
       * re-render, no injectJsonLd — the JSON-LD is baked in <head> too. The
       * carousel reads its images off the baked data attributes. */
      var baked = all.filter(isBakedMount);
      var mounts = all.filter(function (m) { return !isBakedMount(m); });
      baked.forEach(function (mount) { hydrate(mount); });

      /* Unbaked mounts keep exactly today's behaviour. If every mount on the
       * page is baked, nothing below runs and the page makes no requests. */
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
    /* baking — still pure. ARTWORK_BAKE_PAGES is the single source of truth
     * for which pages get baked; jsonedit.html and dev-tools/build-artwork-
     * pages.js both read it from here rather than carrying a copy. */
    ARTWORK_BAKE_PAGES: ARTWORK_BAKE_PAGES,
    AW_REGION_KEYS: AW_REGION_KEYS,
    startMarker: startMarker,
    endMarker: endMarker,
    applyRegions: applyRegions,
    outsideRegions: outsideRegions,
    renderPageRegions: renderPageRegions,
    verifyArtworkPageHTML: verifyArtworkPageHTML,
    /* browser */
    isBakedMount: isBakedMount,
    hydrate: hydrate,
    attachImageData: attachImageData,
    openModal: openModal,
    closeModal: closeModal,
    autoInit: autoInit
  };
}));
