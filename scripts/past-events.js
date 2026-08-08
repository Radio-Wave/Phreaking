/* ===========================================================================
 * Past Events — shared renderer + hydration
 * ===========================================================================
 *
 * WHY THIS FILE IS SHAPED LIKE THIS
 *
 * This page used to be built entirely in the browser: fetch /json/schema.json,
 * then create every card with JavaScript. The raw HTML the server sent
 * contained no event content at all, so any crawler that does not execute JS
 * (which is most of the ones behind AI answer engines) saw an empty archive.
 *
 * Now there is exactly ONE renderer, and it produces strings:
 *
 *   • The JSON editor (jsonedit.html) calls renderPage() when a user pushes to
 *     GitHub, splices the resulting markup into index.html between HTML
 *     markers, and pushes index.html alongside schema.json. The served HTML
 *     therefore contains every talk, workshop, performance, screening — and
 *     every Performance Night act — as real text and real <img> tags.
 *
 *   • This file, on the live page, HYDRATES that markup: it attaches filters,
 *     sorting, the lightbox and the Performance Night modal to cards that are
 *     already in the DOM. With JS disabled the page still shows everything.
 *
 *   • If a deploy ever ships an index.html without baked content, hydrate()
 *     falls back to fetching schema.json and running the same renderPage()
 *     client-side. Same function, same strings — the two paths cannot drift,
 *     and verifyBakedHTML() checks that claim from the data side.
 *
 * The Performance Night modal does not rebuild anything: it MOVES the baked
 * .pn-detail node out of the card and into the dialog, then moves it back on
 * close. What a crawler reads and what a visitor sees are the same nodes.
 * =========================================================================== */

(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PastEventsRender = api;
  if (typeof document !== 'undefined' && !(root && root.__PE_NO_AUTO_INIT__)) {
    api.autoInit();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var SITE_ORIGIN = 'https://phreaking.co.uk';
  var PAGE_URL = SITE_ORIGIN + '/past-events/';

  /* ── Category mapping ──────────────────────────────────────────────────────
   * The JSON editor writes `PerformingArtsEvent` for performances (the
   * schema.org type); `PerformanceEvent` is kept as an alias so older entries
   * still map — there is real historical data using it. SocialEvent is also
   * offered by the editor, so it is bucketed rather than silently dropped. */
  var CATEGORY_BY_TYPE = {
    Event: { key: 'talks', badge: 'Talk', sectionId: 'section-talks', heading: 'Talks' },
    EducationEvent: { key: 'workshops', badge: 'Workshop', sectionId: 'section-workshops', heading: 'Workshops' },
    PerformingArtsEvent: { key: 'performances', badge: 'Performance', sectionId: 'section-performances', heading: 'Performances' },
    PerformanceEvent: { key: 'performances', badge: 'Performance', sectionId: 'section-performances', heading: 'Performances' },
    SocialEvent: { key: 'performances', badge: 'Event', sectionId: 'section-performances', heading: 'Performances' },
    ScreeningEvent: { key: 'screenings', badge: 'Screening', sectionId: 'section-screenings', heading: 'Screenings' }
  };

  var CATEGORY_KEYS = ['talks', 'workshops', 'performances', 'screenings'];
  var SECTION_ID = {
    talks: 'section-talks', workshops: 'section-workshops',
    performances: 'section-performances', screenings: 'section-screenings'
  };
  var SINGULAR_CATEGORY = { talks: 'talk', workshops: 'workshop', performances: 'performance', screenings: 'screening' };

  /* `PerformanceEvent` is not a real schema.org type; `PerformingArtsEvent` is.
   * The alias is preserved on the way IN (see CATEGORY_BY_TYPE) and normalised
   * on the way OUT, so the JSON-LD we publish validates. */
  var SCHEMA_TYPE_ALIAS = { PerformanceEvent: 'PerformingArtsEvent' };

  /* schema.org/EventStatusType has exactly five members. The live data carries
   * `EventPastdue`, which is not one of them and fails Rich Results validation.
   * A past event that happened as announced is EventScheduled. */
  var VALID_EVENT_STATUS = [
    'https://schema.org/EventCancelled',
    'https://schema.org/EventMovedOnline',
    'https://schema.org/EventPostponed',
    'https://schema.org/EventRescheduled',
    'https://schema.org/EventScheduled'
  ];
  var DEFAULT_EVENT_STATUS = 'https://schema.org/EventScheduled';
  var DEFAULT_ATTENDANCE_MODE = 'https://schema.org/OfflineEventAttendanceMode';

  /* ── Performance Night ─────────────────────────────────────────────────────
   * A performance event badged "Performance Night" carries a list of acts, each
   * with its own title, artists, description and images. Older data used the
   * badge "experimental performance night" and stored the acts under
   * `performances`; both are still read. New data is written as `subEvent`. */
  var PN_BADGE = 'Performance Night';
  var PN_ALIASES = ['performance night', 'experimental performance night'];

  /* The collective's own name: when an event's location is just "us", the venue
   * is not worth repeating in the credit line (it is already the organiser). */
  var HOME_VENUE = 'Phreaking Collective';

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  /* Marker names used to bound generated regions inside index.html. */
  var REGION_KEYS = [
    'pe-jsonld',
    'pe-talks', 'pe-workshops', 'pe-performances', 'pe-screenings',
    'pe-count-talks', 'pe-count-workshops', 'pe-count-performances', 'pe-count-screenings'
  ];

  /* ========================================================================
   * 1. Small pure helpers
   * ==================================================================== */

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function slugify(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  }

  function itemType(item) {
    var t = item && item['@type'];
    return Array.isArray(t) ? t[0] : t;
  }

  function eventCategory(ev) {
    return CATEGORY_BY_TYPE[itemType(ev)] || null;
  }

  function isPerfNight(ev) {
    return !!ev && PN_ALIASES.indexOf(String((ev && ev.label) || '').trim().toLowerCase()) !== -1;
  }

  function absUrl(p) {
    if (!p) return '';
    return /^https?:/i.test(p) ? p : SITE_ORIGIN + (String(p).charAt(0) === '/' ? p : '/' + p);
  }

  /* ── Acts: `subEvent` (current) or `performances` (legacy) ─────────────────
   * Returns a normalised, read-only view. Nothing here mutates the source, so
   * the live page renders legacy JSON exactly as it renders migrated JSON. */
  function rawActs(ev) {
    if (!ev) return [];
    if (Array.isArray(ev.subEvent)) return ev.subEvent;
    if (Array.isArray(ev.performances)) return ev.performances;
    return [];
  }

  /* `index` is the act's position in the stored array, which is what the image
   * "slot" scheme ('p0-1' = act 0, image 1) addresses. It survives the fact
   * that empty placeholder blocks are dropped from the rendered list. */
  function normaliseAct(p, index) {
    if (!p || typeof p !== 'object') return null;
    return {
      title: (p.name != null && p.name !== '') ? p.name : (p.title || ''),
      artists: (typeof p.performer === 'string' && p.performer !== '') ? p.performer : (p.artists || ''),
      description: p.description || '',
      images: Array.isArray(p.images) ? p.images : [],
      index: index
    };
  }

  /* Acts worth rendering — an entirely empty block (the editor always keeps one
   * blank block in the form) is skipped, matching the previous behaviour. */
  function actsOf(ev) {
    var out = [];
    rawActs(ev).forEach(function (p, i) {
      var a = normaliseAct(p, i);
      if (!a) return;
      if (a.title || a.artists || a.description || a.images.length) out.push(a);
    });
    return out;
  }

  /* ── Venue / location ──────────────────────────────────────────────────────
   * `venue` was a plain string; it is now a schema.org Place under `location`.
   * Both are read. The name is only shown in the credit line when it is an
   * actual external venue — every event carries location "Phreaking Collective"
   * as its default, and repeating that after the organiser credit would be
   * noise (and a visible change to cards that render fine today). */
  function locationOf(ev) {
    if (!ev) return null;
    if (ev.location && typeof ev.location === 'object' && ev.location.name) return ev.location;
    if (typeof ev.location === 'string' && ev.location) return { '@type': 'Place', name: ev.location };
    if (typeof ev.venue === 'string' && ev.venue) return { '@type': 'Place', name: ev.venue };
    return null;
  }

  function displayVenue(ev) {
    var loc = locationOf(ev);
    if (!loc || !loc.name) return '';
    return String(loc.name).trim() === HOME_VENUE ? '' : String(loc.name);
  }

  /* ── Dates ────────────────────────────────────────────────────────────────
   * Chronological sort key from displayDate ("Friday 16th January — 18:00"),
   * falling back to the startDate year so an undated event still lands in the
   * right year, ahead of anything dated later that same year. */
  function chronoKey(ev) {
    var year = parseInt(ev.startDate, 10) || 0;
    var dd = ev.displayDate || '';
    var dm = dd.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/);
    if (!dm) return year * 1000000;
    var day = parseInt(dm[1], 10);
    var month = MONTHS[dm[2].slice(0, 3).toLowerCase()];
    if (!month) return year * 1000000;
    var tm = dd.match(/(\d{1,2}):(\d{2})/);
    var quarterHours = tm ? Math.floor((parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10)) / 15) : 0;
    return year * 1000000 + month * 10000 + day * 100 + quarterHours;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function normaliseTime(t) {
    var m = String(t).match(/(\d{1,2}):(\d{2})/);
    if (!m) return '00:00';
    return pad2(parseInt(m[1], 10)) + ':' + m[2];
  }

  /* ISO-8601 start/end built from the most accurate data that actually exists.
   * "2026" + "Sunday 12th July — 18:00–22:00" gives 2026-07-12T18:00; with no
   * day/month in displayDate it stays the bare year rather than inventing one
   * (a fabricated 2026-01-01 would be a lie, and a confidently wrong date is
   * worse for an archive than a vague one). Times are local to the venue and
   * carry no offset, which is valid ISO-8601 and honest about what we know. */
  function isoDatesFor(ev) {
    var yearM = String(ev.startDate || '').match(/\d{4}/) || String(ev.displayDate || '').match(/\d{4}/);
    var year = yearM ? yearM[0] : '';
    if (!year) return { start: '', end: '' };

    var endYearM = String(ev.endDate || '').match(/\d{4}/);
    var endYear = endYearM ? endYearM[0] : year;

    var dd = String(ev.displayDate || '');
    var dm = dd.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/);
    var month = dm ? MONTHS[dm[2].slice(0, 3).toLowerCase()] : null;
    if (!dm || !month) {
      return { start: year, end: endYear !== year ? endYear : '' };
    }

    var day = parseInt(dm[1], 10);
    if (!(day >= 1 && day <= 31)) return { start: year, end: endYear !== year ? endYear : '' };
    var date = year + '-' + pad2(month) + '-' + pad2(day);

    var times = dd.match(/\d{1,2}:\d{2}/g) || [];
    if (!times.length) return { start: date, end: '' };

    var startISO = date + 'T' + normaliseTime(times[0]);
    if (!times[1]) return { start: startISO, end: '' };

    var endISO = date + 'T' + normaliseTime(times[1]);
    if (endISO <= startISO) {
      /* A night that runs past midnight ends on the following day. */
      var d = new Date(Date.UTC(+year, month - 1, day + 1));
      endISO = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
        'T' + normaliseTime(times[1]);
    }
    return { start: startISO, end: endISO };
  }

  /* "Friday 12th June — 19:00–23:00" → { day: 'Friday 12th June', time: '19:00–23:00' } */
  function splitDisplayDate(dd) {
    var s = String(dd || '').trim();
    if (!s) return { day: '', time: '' };
    var tm = s.match(/\d{1,2}:\d{2}(?:\s*[–—-]\s*\d{1,2}:\d{2})?/);
    if (!tm) return { day: s, time: '' };
    return {
      day: s.slice(0, tm.index).replace(/[\s,–—-]+$/, '').trim(),
      time: tm[0].replace(/\s+/g, '')
    };
  }

  /* ========================================================================
   * 2. Rendering context (people + exhibitions referenced by @id)
   * ==================================================================== */

  function buildContext(data) {
    var graph = (data && data['@graph']) || [];
    var personsMap = {};
    var exhMap = {};
    graph.forEach(function (item) {
      if (!item || !item['@id']) return;
      var t = item['@type'];
      var types = Array.isArray(t) ? t : [t];
      if (types.indexOf('Person') !== -1 ||
        (types.indexOf('Organization') !== -1 && item['@id'] !== SITE_ORIGIN + '/#phreaking')) {
        personsMap[item['@id']] = item;
      }
      if (types.indexOf('ExhibitionEvent') !== -1) {
        var slug = String(item['@id']).split('#')[1];
        if (slug) exhMap[slug] = item;
      }
    });
    return { personsMap: personsMap, exhMap: exhMap, graph: graph };
  }

  function pastEventsOf(data) {
    return ((data && data['@graph']) || []).filter(function (item) {
      return item && item.pastEvents === true && item.visible !== false;
    });
  }

  function performerRefs(ev) {
    var performer = ev && ev.performer;
    if (!performer) return [];
    return (Array.isArray(performer) ? performer : [performer])
      .map(function (p) { return p && p['@id']; })
      .filter(Boolean);
  }

  /* ========================================================================
   * 3. Markup generation — pure string functions, no DOM
   * ==================================================================== */

  /* A `creditText` string has no @id to look up an actual @type, so its type
   * has to be inferred from the text itself. Defaulting to Person and only
   * promoting to PerformingGroup on real evidence of multiple people or an
   * explicit collective — rather than the reverse — matches how the data
   * actually skews: most creditText entries here are one named individual
   * (an event without a proper Person/Organization record yet), and only a
   * few ("Various Artists") are genuinely groups. This is a heuristic, not a
   * lookup: a one-word brand/studio name that is actually a duo (nothing in
   * the string signals that) will still be inferred as Person. The precise
   * fix for a specific name is the same one used everywhere else in this
   * file — give it a real Person/Organization entry with an @id, so its type
   * comes from data instead of a guess. */
  function creditTextType(text) {
    var t = String(text || '').trim();
    if (!t) return 'Person';
    if (/\b(various artists|collective|ensemble|orchestra|company|theatre|theater|crew)\b/i.test(t)) return 'PerformingGroup';
    if (/&|\+|,|\band\b/i.test(t)) return 'PerformingGroup';
    return 'Person';
  }

  /* Linked performer credits, each wrapped in its own Person itemscope. The old
   * markup applied itemprop="name"/"url" with no containing scope, which made
   * them properties of the Event itself rather than of a Person. */
  function creditHTML(ev, personsMap) {
    var ids = performerRefs(ev);
    if (ids.length) {
      var parts = ids.map(function (id) {
        var p = personsMap[id];
        if (!p) return '';
        var types = Array.isArray(p['@type']) ? p['@type'] : [p['@type']];
        var scope = types.indexOf('Organization') !== -1 ? 'Organization' : 'Person';
        var inner = p.url
          ? '<a href="' + esc(p.url) + '" target="_blank" rel="noreferrer" class="inline-link" itemprop="url">' +
            '<span itemprop="name">' + esc(p.name) + '</span></a>'
          : '<span itemprop="name">' + esc(p.name) + '</span>';
        return '<span itemprop="performer" itemscope itemtype="https://schema.org/' + scope + '">' + inner + '</span>';
      }).filter(Boolean);
      if (parts.length) return parts.join(' &amp; ');
    }
    return ev.creditText
      ? '<span itemprop="performer" itemscope itemtype="https://schema.org/' + creditTextType(ev.creditText) + '">' +
        '<span itemprop="name">' + esc(ev.creditText) + '</span></span>'
      : '';
  }

  /* opts.imgs     — override the image list (defaults to the event's own)
   * opts.cls      — extra class on the row
   * opts.label    — aria-label for the row
   * opts.preview  — render as plain figures rather than lightbox buttons; used
   *                 for the condensed Performance Night strip, where a click
   *                 should open the card instead of the lightbox
   * Every image in a row now carries itemprop="image" (it used to be only the
   * first), scoped to whatever itemscope encloses the row — the Event for a
   * card row, the act's PerformingArtsEvent for an act row. */
  /* opts.slotFor / opts.imgSrc let the JSON editor swap in a locally converted
   * blob URL for an image that has not been pushed yet. On the live/baked path
   * both are absent and the image's own paths are used, so the generated markup
   * is byte-identical either way. */
  function imageRowHTML(ev, opts) {
    opts = opts || {};
    var imgs = opts.imgs || ev.images || [];
    if (!imgs.length) return '';
    var label = opts.label || 'Photos from ' + esc(ev.name);
    var resolve = opts.imgSrc || null;
    var items = imgs.map(function (img, i) {
      var slot = opts.slotFor ? opts.slotFor(i) : String(i);
      var src = (resolve && resolve(ev, slot, 'src')) || img.src;
      var full = (resolve && resolve(ev, slot, 'full')) || img.full || img.src;
      var caption = (img.alt || '') + (img.credit ? ' Photo: ' + img.credit + '.' : '');
      var figure = '<figure>' +
        '<img src="' + esc(src) + '" data-full="' + esc(full) + '" alt="' + esc(img.alt || '') + '"' +
        (img.altHtml ? ' data-caption-html="' + esc(img.altHtml) + '"' : '') +
        ' loading="lazy" decoding="async" itemprop="image">' +
        '<figcaption class="sr-only">' + esc(caption) + '</figcaption>' +
        '</figure>';
      return opts.preview
        ? '<div role="listitem">' + figure + '</div>'
        : '<button type="button" role="listitem" aria-label="View photo ' + (i + 1) + ' of ' +
          esc(opts.ofName || ev.name) + '">' + figure + '</button>';
    }).join('');
    return '<div class="image-row' + (opts.cls ? ' ' + opts.cls : '') + '" role="list" aria-label="' + label + '">' +
      items + '</div>';
  }

  /* Condensed Performance Night strip: the event poster followed by the lead
   * image of the first acts, so the card matches every other card at rest. */
  function pnPreviewImages(ev) {
    var out = [];
    var own = ev.images || [];
    if (own.length) out.push({ img: own[0], slot: '0' });
    actsOf(ev).forEach(function (p) {
      if (out.length >= 3) return;
      var im = (p.images || [])[0];
      if (im) out.push({ img: im, slot: 'p' + p.index + '-0' });
    });
    own.slice(1).forEach(function (im, i) {
      if (out.length < 3) out.push({ img: im, slot: String(i + 1) });
    });
    return out.slice(0, 3);
  }

  /* The performance log — one section per act, each its own subEvent itemscope
   * with its own lightbox gallery. This is baked into the card (hidden) and
   * moved into the modal on open; it is never rebuilt from JSON at view time. */
  function performanceLogHTML(ev, imgSrc) {
    var blocks = actsOf(ev);
    if (!blocks.length) return '<p class="pn-empty">Details for this night are being added.</p>';
    return blocks.map(function (p, i) {
      var title = p.title || 'Untitled';
      return '<section class="pn-perf" itemprop="subEvent" itemscope itemtype="https://schema.org/PerformingArtsEvent">' +
        '<div class="pn-perf-n">Performance ' + (i + 1) + '</div>' +
        '<h4 class="pn-perf-title" itemprop="name">' + esc(title) + '</h4>' +
        (p.artists
          ? '<div class="pn-perf-artists" itemprop="performer" itemscope itemtype="https://schema.org/' +
            creditTextType(p.artists) + '">' +
            '<span itemprop="name">' + esc(p.artists) + '</span></div>'
          : '') +
        (p.description ? '<p class="pn-perf-desc" itemprop="description">' + esc(p.description) + '</p>' : '') +
        imageRowHTML(ev, {
          imgs: p.images || [],
          label: 'Photos of ' + esc(title) + ' at ' + esc(ev.name),
          ofName: title,
          imgSrc: imgSrc,
          slotFor: function (j) { return 'p' + p.index + '-' + j; }
        }) +
        '</section>';
    }).join('\n');
  }

  /* The full-detail block: poster + description + every act. Baked into the
   * card with `hidden`, revealed inside the modal (and by the no-JS stylesheet
   * in index.html, so a visitor without JavaScript reads it in place). */
  function pnDetailHTML(ev, slug, imgSrc) {
    var poster = (ev.images || [])[0];
    var posterSrc = poster
      ? ((imgSrc && (imgSrc(ev, '0', 'full') || imgSrc(ev, '0', 'src'))) || poster.full || poster.src)
      : '';
    var paras = String(ev.description || '')
      .split(/\n{2,}/)
      .filter(function (t) { return t.trim(); })
      .map(function (t) { return '<p>' + esc(t.trim()) + '</p>'; })
      .join('');
    var intro = (paras || poster)
      ? '<div class="pn-modal__intro">' +
        (poster
          ? '<figure class="pn-modal__poster"><img src="' + esc(posterSrc) + '" alt="' +
            esc(poster.alt || '') + '" loading="lazy" decoding="async"></figure>'
          : '') +
        '<div class="pn-modal__desc">' + paras + '</div>' +
        '</div>'
      : '';
    return '<div class="pn-detail pn-detail--stowed" id="detail-' + esc(slug) + '" data-pn-detail="' + esc(slug) + '">' +
      (intro ? '\n  ' + intro : '') +
      '\n  <div class="pn-modal__log">\n  ' + performanceLogHTML(ev, imgSrc) + '\n  </div>' +
      '\n</div>';
  }

  function normaliseEventStatus(v) {
    var s = String(v || '');
    return VALID_EVENT_STATUS.indexOf(s) !== -1 ? s : DEFAULT_EVENT_STATUS;
  }

  function schemaTypeFor(ev) {
    var t = itemType(ev) || 'Event';
    return SCHEMA_TYPE_ALIAS[t] || t;
  }

  /* ── One card ────────────────────────────────────────────────────────────
   * Returns the exact <article> markup that is written into index.html and,
   * on the fallback path, injected into the DOM. Visually and interactively
   * identical to what the old DOM-building version produced. */
  function renderCardHTML(ev, ctx) {
    var cat = eventCategory(ev);
    var exh = ctx.exhMap[ev.exhibition];
    var credit = creditHTML(ev, ctx.personsMap);
    var year = ev.startDate || '';
    var showSeries = ev.exhibition === 'bitrot' && exh;
    var pn = isPerfNight(ev);
    var evSlug = slugify(ev.name);
    var idSlug = String(ev['@id'] || '').split('#')[1] || '';
    if (idSlug && idSlug.indexOf('event-') !== 0) idSlug = 'event-' + idSlug;
    var titleId = 'title-' + (idSlug || evSlug);
    var iso = isoDatesFor(ev);
    var when = splitDisplayDate(ev.displayDate);
    var loc = locationOf(ev);
    var venue = pn ? displayVenue(ev) : '';

    var attrs = [
      'class="event-card' + (pn ? ' pn-card' : '') +
        ((ctx.cardClass && ctx.cardClass(ev)) ? ' ' + ctx.cardClass(ev) : '') + '"',
      'data-chrono-key="' + esc(String(chronoKey(ev))) + '"',
      'data-category="' + esc(cat.key) + '"'
    ];
    if (idSlug) attrs.push('id="' + esc(idSlug) + '"');
    attrs.push('itemscope');
    attrs.push('itemtype="https://schema.org/' + esc(schemaTypeFor(ev)) + '"');
    attrs.push('aria-labelledby="' + esc(titleId) + '"');
    if (pn) {
      attrs.push('data-slug="' + esc(evSlug) + '"');
      attrs.push('data-pn-day="' + esc(when.day || ev.startDate || '') + '"');
      attrs.push('data-pn-time="' + esc(when.time) + '"');
      if (ev.cardColor) {
        attrs.push('data-pn-color="' + esc(ev.cardColor) + '"');
        attrs.push('style="background:' + esc(ev.cardColor) + '"');
      }
      attrs.push('role="button"');
      attrs.push('tabindex="0"');
      attrs.push('aria-haspopup="dialog"');
    }

    var creditLine = (credit || year || venue)
      ? '<strong>' + (credit || 'Phreaking Collective') + '</strong>' +
        (year ? ' — ' + esc(year) : '') + (venue ? ' — ' + esc(venue) : '') + '<br>'
      : '';

    /* The exhibition tie-in as a properly scoped ExhibitionEvent rather than a
     * bare itemprop on an anchor with no containing scope. */
    var partOf = exh
      ? 'Part of <strong><span itemprop="about superEvent" itemscope itemtype="https://schema.org/ExhibitionEvent">' +
        '<meta itemprop="name" content="' + esc(exh.name) + '">' +
        '<a href="' + esc(exh.url) + '" target="_blank" rel="noreferrer" class="inline-link" itemprop="url">' +
        esc(exh.name) + '</a></span></strong>'
      : '';

    var nBlocks = pn ? actsOf(ev).length : 0;
    var hint = pn
      ? '<div class="pn-hint"><span class="pn-hint-chev">&#8599;</span>' +
        '<span class="pn-hint-text">View ' + nBlocks + ' performance' + (nBlocks === 1 ? '' : 's') + '</span></div>'
      : '';

    /* When a shorter previewDescription is shown on the card, the structured
     * description must still be the full one. */
    var usePreview = pn && !!ev.previewDescription;
    var cardText = usePreview ? ev.previewDescription : (ev.description || '');
    var descAttr = usePreview ? 'itemprop="disambiguatingDescription"' : 'itemprop="description"';
    var fullDescMeta = usePreview
      ? '<meta itemprop="description" content="' + esc(ev.description || '') + '">'
      : '';

    var meta =
      '<meta itemprop="eventStatus" content="' + esc(normaliseEventStatus(ev.eventStatus)) + '">' +
      '<meta itemprop="eventAttendanceMode" content="' + esc(ev.eventAttendanceMode || DEFAULT_ATTENDANCE_MODE) + '">' +
      (iso.start ? '<meta itemprop="startDate" content="' + esc(iso.start) + '">' : '') +
      (iso.end ? '<meta itemprop="endDate" content="' + esc(iso.end) + '">' : '') +
      (loc
        ? '<span itemprop="location" itemscope itemtype="https://schema.org/Place">' +
          '<meta itemprop="name" content="' + esc(loc.name) + '">' +
          (loc.address && loc.address.addressLocality
            ? '<span itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">' +
              '<meta itemprop="addressLocality" content="' + esc(loc.address.addressLocality) + '">' +
              (loc.address.addressCountry
                ? '<meta itemprop="addressCountry" content="' + esc(loc.address.addressCountry) + '">' : '') +
              '</span>'
            : '') +
          '</span>'
        : '') +
      fullDescMeta;

    var body = [
      '<div class="event-top">' +
        '<div class="event-meta">' +
          '<span class="event-type" aria-label="Event type: ' + (pn ? PN_BADGE : esc(cat.badge)) + '">' +
            (pn ? PN_BADGE : esc(cat.badge)) + '</span>' +
          ((ctx.afterBadge && ctx.afterBadge(ev)) || '') +
          '<div>' +
            '<h3 id="' + esc(titleId) + '" itemprop="name">' + esc(ev.name) + '</h3>' +
            '<div class="event-credit">' + creditLine + partOf + '</div>' +
          '</div>' +
        '</div>' +
        (showSeries
          ? '<div class="event-series" aria-label="Exhibition: ' + esc(exh.name) + ', ' + esc(year) + '">' +
            '<a href="' + esc(exh.url) + '" target="_blank" rel="noreferrer" class="inline-link">' +
            esc(exh.name) + '</a> / ' + esc(year) + '</div>'
          : '') +
      '</div>',
      '<p class="event-description" ' + descAttr + '>' + esc(cardText) + '</p>',
      pn
        ? (function () {
            var previews = pnPreviewImages(ev);
            return imageRowHTML(ev, {
              imgs: previews.map(function (x) { return x.img; }),
              slotFor: function (i) { return previews[i].slot; },
              imgSrc: ctx.imgSrc,
              cls: 'pn-preview-row', preview: true,
              label: 'Preview photos from ' + esc(ev.name)
            });
          }())
        : imageRowHTML(ev, { imgSrc: ctx.imgSrc }),
      ev.eventCompletedUrl
        ? '<p class="event-link"><a href="' + esc(ev.eventCompletedUrl) + '" target="_blank" rel="noreferrer">' +
          esc(ev.eventCompletedUrlLabel || 'Event Completed') + '</a></p>'
        : '',
      hint,
      pn ? pnDetailHTML(ev, evSlug, ctx.imgSrc) : ''
    ].filter(Boolean);

    /* One logical block per line: this markup is machine-generated but it lands
     * in a file people read and review, so it should stay skimmable. */
    return '<article ' + attrs.join(' ') + '>\n  ' +
      [meta].concat(body).join('\n  ') +
      '\n</article>';
  }

  function countHTML(key, n) {
    var noun = SINGULAR_CATEGORY[key] || 'event';
    return '<div class="section-count" aria-label="' + n + ' ' + noun + ' event' + (n === 1 ? '' : 's') + '">' +
      n + ' Event' + (n === 1 ? '' : 's') + '</div>';
  }

  /* ========================================================================
   * 4. Per-event validation
   * ==================================================================== */

  /* Flags a description that says the same thing twice — a paragraph copied
   * verbatim, or a later paragraph that closely paraphrases an earlier one
   * (e.g. a draft left in alongside its edited replacement, which can start
   * with entirely different words while covering the same ground). Compares
   * paragraphs pairwise by the overlap of their significant words (Jaccard on
   * words of length >=4, so common short words like "the"/"and" don't drive a
   * false match) — a plain prefix comparison misses paraphrases that open
   * differently, which is exactly the real case this exists to catch.
   * Deliberately just a warning at a conservative threshold: this never
   * rewrites or trims anyone's copy, only names the problem so it can be
   * fixed by hand, and a merely-related pair of paragraphs should not trip it. */
  function firstDuplicateParagraph(description) {
    var paras = String(description).split(/\n{2,}|\n/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (paras.length < 2) return null;
    var wordSets = paras.map(function (p) {
      var words = p.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 4; });
      return { words: words, set: new Set(words) };
    });
    for (var i = 0; i < paras.length; i++) {
      if (wordSets[i].words.length < 12) continue;    // too short for overlap to mean much
      for (var j = 0; j < i; j++) {
        if (wordSets[j].words.length < 12) continue;
        var shared = 0;
        wordSets[i].set.forEach(function (w) { if (wordSets[j].set.has(w)) shared++; });
        var smaller = Math.min(wordSets[i].set.size, wordSets[j].set.size);
        if (smaller > 0 && shared / smaller >= 0.6) return paras[i];
      }
    }
    return null;
  }

  function describe(ev, index) {
    var name = (ev && ev.name) ? String(ev.name) : '';
    var id = (ev && ev['@id']) ? (String(ev['@id']).split('#')[1] || String(ev['@id'])) : '';
    if (name && id) return '"' + name + '" (' + id + ')';
    if (name) return '"' + name + '"';
    if (id) return '(' + id + ')';
    return '@graph entry #' + index;
  }

  /* Returns { errors, warnings }. An error means the event cannot produce
   * trustworthy markup and is skipped; a warning means it is baked but
   * something about it should be fixed. */
  function validateEvent(ev, index) {
    var errors = [];
    var warnings = [];

    if (!ev || typeof ev !== 'object') {
      return { errors: ['@graph entry #' + index + ' is not an object'], warnings: warnings };
    }
    var who = describe(ev, index);

    if (!ev.name || !String(ev.name).trim()) errors.push(who + ' has no name — it cannot be rendered or linked');
    if (!eventCategory(ev)) {
      errors.push(who + ' has an unrecognised @type "' + (itemType(ev) || 'none') +
        '" — it belongs to no section (expected one of ' + Object.keys(CATEGORY_BY_TYPE).join(', ') + ')');
    }
    if (!ev['@id']) warnings.push(who + ' has no @id — its card gets no stable anchor');

    if (ev.images != null && !Array.isArray(ev.images)) {
      errors.push(who + ' has an "images" field that is not an array');
    } else {
      (ev.images || []).forEach(function (img, i) {
        if (!img || typeof img !== 'object') {
          errors.push(who + ' image ' + (i + 1) + ' is not an object');
        } else if (!img.src) {
          errors.push(who + ' image ' + (i + 1) + ' has no src — it would bake an empty <img>');
        } else if (!img.alt || !String(img.alt).trim()) {
          warnings.push(who + ' image ' + (i + 1) + ' has no alt text');
        }
      });
    }

    if (!ev.description || !String(ev.description).trim()) {
      warnings.push(who + ' has no description — its card will carry no body text for search engines to read');
    } else {
      var dupPara = firstDuplicateParagraph(ev.description);
      if (dupPara) {
        warnings.push(who + ' description repeats itself — a paragraph starting "' +
          dupPara.slice(0, 50) + (dupPara.length > 50 ? '…' : '') +
          '" appears more than once (near-verbatim). This bakes fine, but wastes ' +
          'the space a search snippet or an AI summary has to work with — worth trimming by hand.');
      }
    }
    if (!ev.startDate && !ev.displayDate) warnings.push(who + ' has no startDate or displayDate');

    if (isPerfNight(ev)) {
      var raw = (ev.subEvent != null) ? ev.subEvent : ev.performances;
      if (raw != null && !Array.isArray(raw)) {
        errors.push(who + ' is a Performance Night but its act list is not an array');
      } else {
        var acts = rawActs(ev);
        if (!actsOf(ev).length) {
          warnings.push(who + ' is a Performance Night with no acts filled in — its detail view will be empty');
        }
        acts.forEach(function (p, i) {
          var label = who + ' act ' + (i + 1);
          if (!p || typeof p !== 'object') { errors.push(label + ' is not an object'); return; }
          var a = normaliseAct(p);
          if (!(a.title || a.artists || a.description || a.images.length)) return; /* blank placeholder block */
          if (!a.title) warnings.push(label + ' has no title — it will render as "Untitled"');
          if (p.images != null && !Array.isArray(p.images)) {
            errors.push(label + ' has an "images" field that is not an array');
            return;
          }
          a.images.forEach(function (img, j) {
            if (!img || typeof img !== 'object') errors.push(label + ' image ' + (j + 1) + ' is not an object');
            else if (!img.src) errors.push(label + ' image ' + (j + 1) + ' has no src');
            else if (!img.alt || !String(img.alt).trim()) warnings.push(label + ' image ' + (j + 1) + ' has no alt text');
          });
        });
      }
    }

    return { errors: errors, warnings: warnings };
  }

  /* ========================================================================
   * 5. Content signature — an independent second derivation of what the
   *    markup is supposed to contain, used to verify the baked HTML.
   * ==================================================================== */

  function eventSignature(ev) {
    return {
      slug: slugify(ev.name),
      name: String(ev.name || ''),
      description: String(ev.description || ''),
      cardText: String((isPerfNight(ev) && ev.previewDescription) ? ev.previewDescription : (ev.description || '')),
      isPerfNight: isPerfNight(ev),
      category: (eventCategory(ev) || {}).key || '',
      imageSrcs: (ev.images || []).map(function (i) { return i && i.src; }).filter(Boolean),
      acts: actsOf(ev).map(function (a) {
        return {
          title: a.title,
          artists: a.artists,
          description: a.description,
          imageSrcs: a.images.map(function (i) { return i && i.src; }).filter(Boolean)
        };
      })
    };
  }

  /* ========================================================================
   * 6. Whole-page generation
   * ==================================================================== */

  /* renderPage(data) → everything the editor needs to write index.html.
   *
   *   regions   — marker key → markup
   *   order     — category key → array of slugs, newest first
   *   baked/skipped/errors/warnings — the diagnostics surfaced after a push
   *   fatal     — set when nothing usable could be produced (blocks the push)
   */
  function renderPage(data) {
    var result = {
      regions: {}, counts: {}, order: {}, cards: {},
      baked: 0, skipped: 0, errors: [], warnings: [], fatal: null, signatures: [], jsonLd: null
    };

    if (!data || typeof data !== 'object' || !Array.isArray(data['@graph'])) {
      result.fatal = 'The loaded JSON has no "@graph" array — nothing can be generated.';
      return result;
    }

    var ctx = buildContext(data);
    var graph = data['@graph'];
    var buckets = { talks: [], workshops: [], performances: [], screenings: [] };
    var seenSlugs = {};

    graph.forEach(function (ev, index) {
      if (!ev || ev.pastEvents !== true || ev.visible === false) return;

      var v = validateEvent(ev, index);
      v.warnings.forEach(function (w) { result.warnings.push(w); });

      if (v.errors.length) {
        v.errors.forEach(function (e) { result.errors.push(e); });
        result.skipped++;
        return;
      }

      var cat = eventCategory(ev);
      var slug = slugify(ev.name);
      if (seenSlugs[slug]) {
        result.warnings.push(describe(ev, index) + ' shares the slug "' + slug + '" with another event — ' +
          'a deep link to #' + slug + ' will only ever open the first one');
      }
      seenSlugs[slug] = true;

      var html;
      try {
        html = renderCardHTML(ev, ctx);
      } catch (err) {
        result.errors.push(describe(ev, index) + ' could not be rendered: ' + (err && err.message ? err.message : err));
        result.skipped++;
        return;
      }

      buckets[cat.key].push({ slug: slug, html: html, key: chronoKey(ev) });
      result.signatures.push(eventSignature(ev));
      result.baked++;
    });

    CATEGORY_KEYS.forEach(function (key) {
      /* Newest first, matching the sort button's initial label. */
      buckets[key].sort(function (a, b) { return b.key - a.key; });
      result.counts[key] = buckets[key].length;
      result.order[key] = buckets[key].map(function (c) { return c.slug; });
      result.cards[key] = buckets[key].map(function (c) { return c.html; });
      result.regions['pe-' + key] = buckets[key].map(function (c) { return c.html; }).join('\n');
      result.regions['pe-count-' + key] = countHTML(key, buckets[key].length);
    });

    try {
      result.jsonLd = buildJsonLd(data, ctx);
    } catch (err) {
      result.fatal = 'Structured data (JSON-LD) could not be generated: ' + (err && err.message ? err.message : err);
      return result;
    }
    /* Written on one line: it is machine output living inside markers, so a
     * single-line diff is easier to skim than 2,600 reindented ones — and it
     * keeps ~35KB off every page load. */
    result.regions['pe-jsonld'] =
      '<script type="application/ld+json">' +
      JSON.stringify(result.jsonLd).replace(/<\//g, '<\\/') +
      '</script>';

    var candidates = pastEventsOf(data).length;
    if (candidates > 0 && result.baked === 0) {
      result.fatal = 'All ' + candidates + ' past events failed validation — refusing to publish an empty archive.';
    }

    return result;
  }

  /* ========================================================================
   * 7. JSON-LD — a purpose-built document, not a dump of the editor's JSON
   * ==================================================================== */

  function cleanPerson(p) {
    var types = Array.isArray(p['@type']) ? p['@type'] : [p['@type']];
    var out = {
      '@type': types.indexOf('Organization') !== -1 ? 'Organization' : 'Person',
      '@id': p['@id'],
      name: p.name
    };
    if (p.url) { out.url = p.url; out.sameAs = p.url; }
    if (p.jobTitle) out.jobTitle = p.jobTitle;
    if (p.description) out.description = p.description;
    return out;
  }

  function cleanPlace(loc) {
    var out = { '@type': 'Place', name: loc.name };
    if (loc.address && typeof loc.address === 'object') {
      var a = { '@type': 'PostalAddress' };
      ['streetAddress', 'addressLocality', 'postalCode', 'addressRegion', 'addressCountry'].forEach(function (k) {
        if (loc.address[k]) a[k] = loc.address[k];
      });
      if (Object.keys(a).length > 1) out.address = a;
    }
    return out;
  }

  function actNode(ev, act, i) {
    var base = String(ev['@id'] || (SITE_ORIGIN + '/past-events#event-' + slugify(ev.name)));
    var node = {
      '@type': 'PerformingArtsEvent',
      '@id': base + '-act-' + (i + 1),
      name: act.title || 'Untitled'
    };
    if (act.artists) node.performer = { '@type': creditTextType(act.artists), name: act.artists };
    if (act.description) node.description = String(act.description).trim();
    var imgs = act.images.map(function (im) { return absUrl(im.full || im.src); }).filter(Boolean);
    if (imgs.length) node.image = imgs;
    var loc = locationOf(ev);
    if (loc) node.location = cleanPlace(loc);
    var iso = isoDatesFor(ev);
    if (iso.start) node.startDate = iso.start;
    node.eventStatus = normaliseEventStatus(ev.eventStatus);
    node.eventAttendanceMode = ev.eventAttendanceMode || DEFAULT_ATTENDANCE_MODE;
    if (ev['@id']) node.superEvent = { '@id': ev['@id'] };
    return node;
  }

  /* Internal-only editor fields with no schema.org meaning. Kept as an explicit
   * list so the intent is legible, and asserted by the test suite: nothing on
   * this list may appear anywhere in the published JSON-LD.
   *   sortOrder, cardColor, visible, pastEvents  — editor bookkeeping
   *   label, exhibition, displayDate             — presentation strings
   *   previewDescription, creditText             — card copy
   *   performances, subEvent (raw), images       — remodelled below
   *   eventCompletedUrl(+Label), linkLabel,
   *   nameHtml, exhibitionCategory, venue        — site chrome / superseded */
  var INTERNAL_FIELDS = [
    'sortOrder', 'cardColor', 'visible', 'pastEvents', 'label', 'exhibition',
    'displayDate', 'creditText', 'previewDescription', 'performances',
    'eventCompletedUrl', 'eventCompletedUrlLabel', 'linkLabel',
    'nameHtml', 'exhibitionCategory', 'venue', 'altHtml', 'src', 'full'
  ];

  function buildJsonLd(data, ctx) {
    ctx = ctx || buildContext(data);
    var graph = (data && data['@graph']) || [];
    var org = graph.filter(function (i) { return i && i['@id'] === SITE_ORIGIN + '/#phreaking'; })[0];
    var events = [];
    var usedPersonIds = {};
    var usedExhIds = {};

    pastEventsOf(data).forEach(function (ev, index) {
      if (validateEvent(ev, index).errors.length) return;

      var iso = isoDatesFor(ev);
      var node = {
        '@type': schemaTypeFor(ev),
        '@id': ev['@id'] || (SITE_ORIGIN + '/past-events#event-' + slugify(ev.name)),
        name: String(ev.name)
      };
      if (ev.description) node.description = String(ev.description).trim();
      if (iso.start) node.startDate = iso.start;
      if (iso.end) node.endDate = iso.end;
      node.eventStatus = normaliseEventStatus(ev.eventStatus);
      node.eventAttendanceMode = ev.eventAttendanceMode || DEFAULT_ATTENDANCE_MODE;

      var loc = locationOf(ev);
      if (loc) node.location = cleanPlace(loc);

      /* Every event lives on this one page: URL fragments are never sent to
       * the server and are folded into the base URL at indexing time, so each
       * event's canonical URL is the page itself. */
      node.url = PAGE_URL;

      if (org) node.organizer = { '@id': org['@id'] };

      var perfIds = performerRefs(ev).filter(function (id) { return !!ctx.personsMap[id]; });
      if (perfIds.length) {
        perfIds.forEach(function (id) { usedPersonIds[id] = true; });
        node.performer = perfIds.length === 1
          ? { '@id': perfIds[0] }
          : perfIds.map(function (id) { return { '@id': id }; });
      } else if (ev.creditText) {
        node.performer = { '@type': creditTextType(ev.creditText), name: String(ev.creditText) };
      }

      var imgs = (ev.images || []).map(function (im) { return absUrl(im.full || im.src); }).filter(Boolean);
      if (imgs.length) node.image = imgs;

      var exh = ctx.exhMap[ev.exhibition];
      if (exh) {
        usedExhIds[exh['@id']] = true;
        /* Both relationships are true and both were being asserted before:
         * `about` (this event is *about* the exhibition's subject) is the one
         * the page has always carried, `superEvent` is the structural one. */
        node.about = { '@id': exh['@id'] };
        node.superEvent = { '@id': exh['@id'] };
      }

      if (ev.keywords) node.keywords = String(ev.keywords);

      if (ev.offers && typeof ev.offers === 'object') {
        var o = { '@type': 'Offer' };
        if (ev.offers.price != null) o.price = String(ev.offers.price);
        if (ev.offers.priceCurrency) o.priceCurrency = ev.offers.priceCurrency;
        if (ev.offers.availability) o.availability = ev.offers.availability;
        /* validFrom has to be a real date, not the bare year the editor stores. */
        if (iso.start) o.validFrom = iso.start;
        o.url = ev.eventCompletedUrl || PAGE_URL;
        node.offers = o;
      }

      if (isPerfNight(ev)) {
        var acts = actsOf(ev);
        if (acts.length) node.subEvent = acts.map(function (a, i) { return actNode(ev, a, i); });
      }

      events.push(node);
    });

    var nodes = [];

    var pageNode = {
      '@type': 'CollectionPage',
      '@id': PAGE_URL + '#page',
      url: PAGE_URL,
      name: 'Past Events — Phreaking Collective',
      description: 'Archive of talks, workshops, performances and screenings organised by Phreaking Collective in London, 2025–2026.',
      inLanguage: 'en-GB',
      isPartOf: {
        '@type': 'WebSite', '@id': SITE_ORIGIN + '/#website',
        url: SITE_ORIGIN + '/', name: 'Phreaking Collective'
      },
      mainEntity: {
        '@type': 'ItemList',
        name: 'Past Events',
        numberOfItems: events.length,
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        itemListElement: events.map(function (e, i) {
          return { '@type': 'ListItem', position: i + 1, item: { '@id': e['@id'] } };
        })
      }
    };
    if (org) pageNode.publisher = { '@id': org['@id'] };
    nodes.push(pageNode);

    if (org) {
      var orgNode = { '@type': 'Organization', '@id': org['@id'], name: org.name };
      if (org.url) orgNode.url = org.url;
      if (org.logo) orgNode.logo = org.logo;
      if (org.sameAs) orgNode.sameAs = org.sameAs;
      if (org.description) orgNode.description = org.description;
      nodes.push(orgNode);
    }

    Object.keys(usedExhIds).forEach(function (id) {
      var exh = graph.filter(function (i) { return i && i['@id'] === id; })[0];
      if (!exh) return;
      var e = { '@type': 'ExhibitionEvent', '@id': exh['@id'], name: exh.name };
      if (exh.url) e.url = exh.url;
      var ei = isoDatesFor(exh);
      if (ei.start) e.startDate = ei.start;
      if (exh.location) e.location = cleanPlace(exh.location);
      if (Array.isArray(exh.about) && exh.about.length) e.keywords = exh.about.join(', ');
      if (org) e.organizer = { '@id': org['@id'] };
      nodes.push(e);
    });

    Object.keys(usedPersonIds).forEach(function (id) {
      if (ctx.personsMap[id]) nodes.push(cleanPerson(ctx.personsMap[id]));
    });

    return { '@context': 'https://schema.org', '@graph': nodes.concat(events) };
  }

  /* ========================================================================
   * 8. Splicing generated regions into index.html
   * ==================================================================== */

  function startMarker(key) { return '<!-- PE:START:' + key + ' -->'; }
  function endMarker(key) { return '<!-- PE:END:' + key + ' -->'; }

  /* String-level, marker-bounded replacement. Deliberately NOT a DOM parse and
   * reserialise: that would silently rewrite hand-authored markup (attribute
   * quoting, void elements, <marquee>) all over the page. Splicing between
   * markers touches only the generator's own territory, by construction. */
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

      /* Preserve the indentation the start marker sits on, so the file stays
       * readable in a diff. */
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

  /* Everything outside the generated regions must survive a bake byte-for-byte.
   * This blanks each region so two versions of the file can be compared. */
  function outsideRegions(htmlText, keys) {
    var out = String(htmlText);
    (keys || REGION_KEYS).forEach(function (key) {
      var s = startMarker(key);
      var e = endMarker(key);
      var si = out.indexOf(s);
      var ei = out.indexOf(e);
      if (si === -1 || ei === -1 || ei < si) return;
      out = out.slice(0, si + s.length) + '\u0000' + key + '\u0000' + out.slice(ei);
    });
    return out;
  }

  /* ========================================================================
   * 9. Verification — does the generated HTML really contain the content?
   *
   * This does not compare the generator's output to itself (that would always
   * pass). It re-derives what each event should contain straight from the JSON
   * and looks for it in the markup, which is what actually matters: a crawler
   * reading the raw response has to find this text.
   * ==================================================================== */

  function textOf(s) {
    return String(s || '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ').trim();
  }

  function stripTags(html) {
    return textOf(String(html).replace(/<[^>]*>/g, ' '));
  }

  /* verifyBakedHTML(html, data) → { ok, problems[], checked }
   * Pure string work, so it runs identically in the browser (as the editor's
   * pre-push sanity check) and in Node (as a test). */
  function verifyBakedHTML(htmlText, data) {
    var html = String(htmlText);
    var text = stripTags(html);
    var problems = [];
    var checked = 0;

    pastEventsOf(data).forEach(function (ev, index) {
      if (validateEvent(ev, index).errors.length) return;
      var sig = eventSignature(ev);
      var who = describe(ev, index);
      checked++;

      if (text.indexOf(textOf(sig.name)) === -1) {
        problems.push(who + ': name missing from the generated HTML');
      }
      if (sig.cardText && text.indexOf(textOf(sig.cardText).slice(0, 60)) === -1) {
        problems.push(who + ': card description missing from the generated HTML');
      }
      if (sig.isPerfNight && sig.description &&
          text.indexOf(textOf(sig.description).slice(0, 60)) === -1) {
        problems.push(who + ': full description missing from the baked detail block');
      }
      sig.imageSrcs.forEach(function (src) {
        if (html.indexOf('src="' + esc(src) + '"') === -1) {
          problems.push(who + ': image ' + src + ' has no <img src> in the generated HTML');
        }
      });
      sig.acts.forEach(function (a, i) {
        var label = who + ' act ' + (i + 1);
        if (a.title && text.indexOf(textOf(a.title)) === -1) problems.push(label + ': title missing');
        if (a.artists && text.indexOf(textOf(a.artists)) === -1) problems.push(label + ': artists missing');
        if (a.description && text.indexOf(textOf(a.description).slice(0, 60)) === -1) {
          problems.push(label + ': description missing');
        }
        a.imageSrcs.forEach(function (src) {
          if (html.indexOf('src="' + esc(src) + '"') === -1) problems.push(label + ': image ' + src + ' missing');
        });
      });
    });

    return { ok: problems.length === 0, problems: problems, checked: checked };
  }

  /* ========================================================================
   * 10. Live page — hydration
   * ==================================================================== */

  var VALID_FILTERS = ['talks', 'workshops', 'performances', 'screenings'];
  var PN_CARDS = {};       /* slug → card element */
  var pnModal = null;
  var pnLastFocus = null;
  var pnOpenDetail = null;
  var pnOpenCard = null;

  function stacks() {
    return {
      talks: document.querySelector('#section-talks .event-stack'),
      workshops: document.querySelector('#section-workshops .event-stack'),
      performances: document.querySelector('#section-performances .event-stack'),
      screenings: document.querySelector('#section-screenings .event-stack')
    };
  }

  function hasBakedContent() {
    return !!document.querySelector('.event-stack .event-card');
  }

  function sortStack(stack, descending) {
    if (!stack) return;
    var cards = Array.prototype.slice.call(stack.children);
    cards.sort(function (a, b) {
      var ka = parseFloat(a.dataset.chronoKey) || 0;
      var kb = parseFloat(b.dataset.chronoKey) || 0;
      return descending ? kb - ka : ka - kb;
    });
    cards.forEach(function (card) { stack.appendChild(card); });
  }

  function updateCount(sectionId, n) {
    var section = document.getElementById(sectionId);
    if (!section) return;
    var count = section.querySelector('.section-count');
    if (!count) return;
    var noun = SINGULAR_CATEGORY[section.dataset.category] || 'event';
    count.textContent = n + ' Event' + (n === 1 ? '' : 's');
    count.setAttribute('aria-label', n + ' ' + noun + ' event' + (n === 1 ? '' : 's'));
  }

  /* Fallback only: index.html shipped without baked cards, so build them here
   * from the same renderer the editor uses. Nothing about the DOM differs. */
  function injectFromData(data) {
    var page = renderPage(data);
    if (page.fatal) { console.error('Past Events:', page.fatal); return page; }
    var st = stacks();
    CATEGORY_KEYS.forEach(function (key) {
      if (!st[key]) return;
      st[key].innerHTML = page.regions['pe-' + key] || '';
      updateCount(SECTION_ID[key], page.counts[key] || 0);
    });
    if (page.jsonLd && !document.querySelector('script[type="application/ld+json"][data-pe]')) {
      var s = document.createElement('script');
      s.type = 'application/ld+json';
      s.setAttribute('data-pe', '1');
      s.textContent = JSON.stringify(page.jsonLd);
      document.head.appendChild(s);
    }
    page.errors.forEach(function (e) { console.warn('Past Events:', e); });
    return page;
  }

  function indexPnCards() {
    PN_CARDS = {};
    Array.prototype.slice.call(document.querySelectorAll('.event-card.pn-card')).forEach(function (card) {
      var slug = card.dataset.slug;
      if (slug) PN_CARDS[slug] = card;
    });
  }

  function ensurePnModal() {
    if (pnModal) return pnModal;
    pnModal = document.createElement('div');
    pnModal.className = 'pn-modal';
    pnModal.setAttribute('aria-hidden', 'true');
    pnModal.setAttribute('role', 'dialog');
    pnModal.setAttribute('aria-modal', 'true');
    pnModal.setAttribute('aria-labelledby', 'pn-modal-title');
    pnModal.innerHTML =
      '<div class="pn-modal__backdrop"></div>' +
      '<div class="pn-modal__card" role="document">' +
        '<div class="pn-modal__head">' +
          '<div class="pn-modal__headline">' +
            '<span class="pn-modal__label"></span>' +
            '<h2 class="pn-modal__title" id="pn-modal-title"></h2>' +
          '</div>' +
          '<div class="pn-modal__when">' +
            '<span class="pn-modal__day"></span>' +
            '<span class="pn-modal__time"></span>' +
          '</div>' +
          '<button type="button" class="pn-modal__close" aria-label="Close">[ &times; ]</button>' +
        '</div>' +
        '<div class="pn-modal__scroll"></div>' +
      '</div>';
    document.body.appendChild(pnModal);

    pnModal.querySelector('.pn-modal__close').addEventListener('click', function () { closePnModal(true); });
    pnModal.querySelector('.pn-modal__backdrop').addEventListener('click', function () { closePnModal(true); });
    /* clicking the padding around the card also dismisses */
    pnModal.addEventListener('click', function (e) { if (e.target === pnModal) closePnModal(true); });
    return pnModal;
  }

  function pnModalIsOpen() {
    return !!pnModal && pnModal.getAttribute('aria-hidden') === 'false';
  }

  /* Opens the dialog around the card's own baked detail block. The nodes are
   * moved, not copied and not regenerated — there is only ever one copy of an
   * act's text in the document, and it is the copy the crawler read. */
  function openPnModal(slug, writeUrl) {
    var card = PN_CARDS[slug];
    if (!card) return;
    var detail = card.querySelector('[data-pn-detail]');
    if (!detail) return;
    if (pnOpenDetail && pnOpenDetail !== detail) restoreDetail();

    var modal = ensurePnModal();
    var h3 = card.querySelector('h3');
    modal.querySelector('.pn-modal__label').textContent = PN_BADGE;
    modal.querySelector('.pn-modal__title').textContent = h3 ? h3.textContent : '';
    modal.querySelector('.pn-modal__day').textContent = card.dataset.pnDay || '';
    modal.querySelector('.pn-modal__time').textContent = card.dataset.pnTime || '';
    modal.querySelector('.pn-modal__card').style.background = card.dataset.pnColor || '';
    modal.dataset.slug = slug;

    var scroll = modal.querySelector('.pn-modal__scroll');
    scroll.appendChild(detail);
    detail.classList.remove('pn-detail--stowed');
    pnOpenDetail = detail;
    pnOpenCard = card;

    pnLastFocus = document.activeElement;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('pn-modal-open');
    scroll.scrollTop = 0;
    modal.querySelector('.pn-modal__close').focus();
    pnSizePoster();
    var posterImg = modal.querySelector('.pn-modal__poster img');
    if (posterImg) posterImg.addEventListener('load', pnSizePoster, { once: true });
    if (writeUrl) window.history.pushState(null, '', '#' + slug);
  }

  /* Put the detail block back where it was baked, hidden again. */
  function restoreDetail() {
    if (pnOpenDetail && pnOpenCard) {
      pnOpenDetail.classList.add('pn-detail--stowed');
      pnOpenCard.appendChild(pnOpenDetail);
    }
    pnOpenDetail = null;
    pnOpenCard = null;
  }

  function closePnModal(writeUrl) {
    restoreDetail();
    if (!pnModal || pnModal.getAttribute('aria-hidden') === 'true') return;
    pnModal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('pn-modal-open');
    delete pnModal.dataset.slug;
    if (pnLastFocus && pnLastFocus.focus) pnLastFocus.focus();
    pnLastFocus = null;
    if (writeUrl) window.history.pushState(null, '', window.location.pathname);
  }

  /* The poster height is driven by the description block: CSS can't measure a
   * sibling, so it's set here and kept in step on resize and once the image
   * loads. Starts at 500px, then tracks the description 1:1 once the text is
   * taller than that, capped so it can't outgrow the viewport. */
  var PN_POSTER_MIN = 500;
  function pnSizePoster() {
    if (!pnModalIsOpen()) return;
    var desc = pnModal.querySelector('.pn-modal__desc');
    var fig = pnModal.querySelector('.pn-modal__poster');
    if (!fig) return;
    if (window.innerWidth <= 760) { fig.style.height = ''; return; }
    var textH = desc ? desc.getBoundingClientRect().height : 0;
    var target = Math.max(textH, PN_POSTER_MIN);
    var cap = Math.max(PN_POSTER_MIN, window.innerHeight * 0.72);
    fig.style.height = Math.round(Math.min(target, cap)) + 'px';
  }

  function hydrate() {
    var filterButtons = document.querySelectorAll('.filter-btn:not(.sort-btn)');
    var sections = document.querySelectorAll('.category-section');
    var pill = document.querySelector('.filter-pill');
    var sortBtn = document.getElementById('sort-btn');

    indexPnCards();

    function movePill(button) {
      if (!button || !pill) return;
      var parentRect = button.parentElement.getBoundingClientRect();
      var rect = button.getBoundingClientRect();
      pill.style.width = rect.width + 'px';
      pill.style.height = rect.height + 'px';
      pill.style.transform = 'translateX(' + (rect.left - parentRect.left) + 'px)';
    }

    function setFilter(filter, updateUrl) {
      Array.prototype.forEach.call(filterButtons, function (btn) {
        var active = btn.dataset.filter === filter;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active);
      });
      if (filter === 'all') {
        Array.prototype.forEach.call(sections, function (section) { section.classList.remove('hidden'); });
      } else {
        Array.prototype.forEach.call(sections, function (section) {
          section.classList.toggle('hidden', section.dataset.category !== filter);
        });
      }
      movePill(document.querySelector('.filter-btn[data-filter="' + filter + '"]'));
      if (updateUrl) {
        window.history.pushState(null, '', filter === 'all' ? window.location.pathname : '#' + filter);
      }
    }

    Array.prototype.forEach.call(filterButtons, function (button) {
      button.addEventListener('click', function () { setFilter(button.dataset.filter, true); });
    });

    /* ── Performance Night: open the modal ─────────────────────────────────
     * The hash does double duty here: it already carries the active filter
     * (#talks, #performances…), so an event slug is only treated as an event
     * when it isn't one of the filter names. */
    Object.keys(PN_CARDS).forEach(function (slug) {
      var card = PN_CARDS[slug];
      card.addEventListener('click', function (e) {
        if (e.target.closest('a')) return;                            /* links keep their behaviour */
        if (e.target.closest('.image-row:not(.pn-preview-row)')) return;
        openPnModal(slug, true);
      });
      card.addEventListener('keydown', function (e) {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPnModal(slug, true);
        }
      });
    });

    function applyHashFilter() {
      var raw = '';
      try { raw = decodeURIComponent(window.location.hash.replace('#', '')); } catch (err) { raw = ''; }
      if (raw && VALID_FILTERS.indexOf(raw) !== -1) { closePnModal(false); setFilter(raw, false); return; }

      /* Accept both /#event-name and /#event-event-name, since @id values in
       * schema.json already carry the "event-" prefix. */
      var slug = '';
      if (raw) {
        if (PN_CARDS[slugify(raw)]) slug = slugify(raw);
        else if (PN_CARDS[slugify(raw.replace(/^event-/, ''))]) slug = slugify(raw.replace(/^event-/, ''));
      }
      setFilter('all', false);
      if (!slug) { closePnModal(false); return; }
      if (pnModal && pnModal.dataset.slug === slug && pnModalIsOpen()) return;
      openPnModal(slug, false);
    }

    applyHashFilter();
    window.addEventListener('hashchange', applyHashFilter);
    window.addEventListener('popstate', applyHashFilter);
    window.addEventListener('resize', function () {
      movePill(document.querySelector('.filter-btn.active'));
      pnSizePoster();
    });

    var isDescending = true;  /* matches the "newest first" order the generator bakes */
    if (sortBtn) {
      sortBtn.addEventListener('click', function () {
        isDescending = !isDescending;
        sortBtn.textContent = isDescending ? 'Sort: Newest First ↓' : 'Sort: Oldest First ↑';
        Array.prototype.forEach.call(document.querySelectorAll('.event-stack'), function (stack) {
          sortStack(stack, isDescending);
        });
      });
    }

    /* ── Lightbox ─────────────────────────────────────────────────────────
     * Rebuilt on demand. Act images now live in the DOM at all times (baked,
     * hidden inside their card), so the gallery skips anything that isn't
     * currently visible — otherwise arrow-key navigation would wander into
     * acts belonging to a night nobody has opened. */
    var galleryImages = [];
    function refreshGallery() {
      galleryImages = Array.prototype.slice
        .call(document.querySelectorAll('.image-row:not(.pn-preview-row) img'))
        .filter(function (img) { return !img.closest('[hidden]'); });
    }
    refreshGallery();

    var lightbox = document.querySelector('.pc-lightbox');
    if (!lightbox) return;
    var lightboxImg = document.querySelector('.pc-lightbox__img');
    var lightboxCaption = document.querySelector('.pc-lightbox__caption');
    var closeBtn = document.querySelector('.pc-lightbox__close');
    var prevBtn = document.querySelector('.pc-lightbox__prev');
    var nextBtn = document.querySelector('.pc-lightbox__next');
    var currentIndex = 0;

    function openLightbox(index) {
      currentIndex = index;
      var img = galleryImages[currentIndex];
      if (!img) return;
      lightboxImg.src = img.dataset.full || img.src;
      lightboxImg.alt = img.alt;
      /* Performance images carry a rich caption ("Act, <em>Event Name</em> 2026")
       * generated by the editor; plain images fall back to their alt text. */
      if (img.dataset.captionHtml) lightboxCaption.innerHTML = img.dataset.captionHtml;
      else lightboxCaption.textContent = img.alt;
      lightbox.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    }
    function closeLightbox() {
      lightbox.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }
    function updateLightbox(direction) {
      if (galleryImages.length === 0) return;
      currentIndex = (currentIndex + direction + galleryImages.length) % galleryImages.length;
      openLightbox(currentIndex);
    }

    /* Delegated so images revealed by the modal are picked up automatically */
    document.addEventListener('click', function (e) {
      var fig = e.target.closest('.image-row:not(.pn-preview-row) figure');
      if (!fig) return;
      var img = fig.querySelector('img');
      refreshGallery();
      var index = galleryImages.indexOf(img);
      if (index >= 0) openLightbox(index);
    });
    closeBtn.addEventListener('click', closeLightbox);
    nextBtn.addEventListener('click', function () { updateLightbox(1); });
    prevBtn.addEventListener('click', function () { updateLightbox(-1); });
    lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', function (e) {
      if (lightbox.getAttribute('aria-hidden') === 'false') {
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowRight') updateLightbox(1);
        if (e.key === 'ArrowLeft') updateLightbox(-1);
        return;
      }
      /* Escape falls through to the Performance Night modal once the lightbox
       * above it has been dismissed */
      if (e.key === 'Escape' && pnModalIsOpen()) closePnModal(true);
    });
  }

  function initPastEvents() {
    if (hasBakedContent()) { hydrate(); return; }

    /* No baked content — index.html was deployed without a generator run.
     * Fall back to the old behaviour so the page is never blank. */
    console.warn('Past Events: no pre-rendered cards found in index.html; falling back to ' +
      'client-side rendering. Re-push from the JSON editor to restore the static build.');
    fetch('/json/schema.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { injectFromData(data); hydrate(); })
      .catch(function (err) { console.error('Failed to load past events:', err); });
  }

  function autoInit() {
    if (typeof document === 'undefined') return;
    /* Only take over a page that actually is the Past Events archive, so the
     * JSON editor can load this file purely for its renderer. */
    if (!document.getElementById('section-talks')) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initPastEvents, { once: true });
    } else {
      initPastEvents();
    }
  }

  /* ========================================================================
   * 11. Public API
   * ==================================================================== */

  return {
    /* constants */
    PN_BADGE: PN_BADGE,
    PN_ALIASES: PN_ALIASES,
    CATEGORY_BY_TYPE: CATEGORY_BY_TYPE,
    CATEGORY_KEYS: CATEGORY_KEYS,
    REGION_KEYS: REGION_KEYS,
    INTERNAL_FIELDS: INTERNAL_FIELDS,
    SITE_ORIGIN: SITE_ORIGIN,
    PAGE_URL: PAGE_URL,

    /* data helpers */
    esc: esc,
    slugify: slugify,
    itemType: itemType,
    eventCategory: eventCategory,
    isPerfNight: isPerfNight,
    actsOf: actsOf,
    rawActs: rawActs,
    locationOf: locationOf,
    displayVenue: displayVenue,
    chronoKey: chronoKey,
    isoDatesFor: isoDatesFor,
    splitDisplayDate: splitDisplayDate,
    pastEventsOf: pastEventsOf,
    buildContext: buildContext,

    /* generation */
    renderCardHTML: renderCardHTML,
    renderPage: renderPage,
    buildJsonLd: buildJsonLd,
    applyRegions: applyRegions,
    outsideRegions: outsideRegions,
    startMarker: startMarker,
    endMarker: endMarker,

    /* diagnostics */
    validateEvent: validateEvent,
    eventSignature: eventSignature,
    verifyBakedHTML: verifyBakedHTML,
    describeEvent: describe,

    /* live page */
    hydrate: hydrate,
    autoInit: autoInit,
    initPastEvents: initPastEvents,
    injectFromData: injectFromData,
    openPnModal: openPnModal,
    closePnModal: closePnModal,
    pnModalIsOpen: pnModalIsOpen,
    sortStack: sortStack
  };
});
