(function () {
  var typeBtns = document.querySelectorAll('[data-filter-group="type"] .cwsa-filter-btn');
  var dayBtns = document.querySelectorAll('[data-filter-group="day"] .cwsa-filter-btn');
  var listEl = document.getElementById('cwsa-events-list');
  if (!listEl) return;

  var allCards = [];
  var dayGroups = [];
  var eventsData = [];
  var personsMap = {};

  // "Wednesday 8th July — 19:30–20:30" -> { day: "Wednesday 8th July", time: "19:30–20:30" }
  function splitDisplayDate(dd) {
    var parts = (dd || '').split('—');
    return { day: parts[0].trim(), time: (parts[1] || '').trim() };
  }

  var MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };

  // Derive a chronological sort key from a displayDate string, e.g.
  // "Wednesday 8th July — 19:30–20:30" -> 7 * 100000 + 8 * 1000 + (19*60+30).
  // Events order by month, then day-of-month, then start time. Anything we
  // can't parse sorts to the end so it never scrambles the dated events.
  function chronoKey(displayDate) {
    var dd = displayDate || '';
    var dm = dd.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/);
    if (!dm) return Infinity;
    var day = parseInt(dm[1], 10);
    var month = MONTHS[dm[2].slice(0, 3).toLowerCase()];
    if (!month) return Infinity;
    var tm = dd.match(/(\d{1,2}):(\d{2})/);
    var startMin = tm ? parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10) : 0;
    return month * 100000 + day * 1000 + startMin;
  }

  function performerNames(event) {
    var performer = event.performer;
    var names = [];
    if (performer) {
      var ids = Array.isArray(performer)
        ? performer.map(function (p) { return p['@id']; })
        : [performer['@id']];
      ids.forEach(function (id) {
        var p = personsMap[id];
        if (p) names.push(p.name);
      });
    }
    return names;
  }

  var activeType = 'all';
  var activeDay = 'all';

  // Show a card only when it matches both the type and day filters.
  function applyFilters() {
    allCards.forEach(function (card) {
      var typeOk = activeType === 'all' || (card.dataset.label || '') === activeType;
      var dayOk = activeDay === 'all' || (card.dataset.day || '') === activeDay;
      card.hidden = !(typeOk && dayOk);
    });
    // Hide a day heading when every event under it is filtered out.
    dayGroups.forEach(function (group) {
      var anyVisible = group.cards.some(function (card) { return !card.hidden; });
      group.heading.hidden = !anyVisible;
    });
  }

  typeBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      activeType = btn.dataset.filter;
      typeBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
      applyFilters();
    });
  });

  dayBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      activeDay = btn.dataset.day;
      dayBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
      applyFilters();
    });
  });

  /* ---------------------------------------------------------------
     Event detail modal — opens when a card is clicked, flicks
     between the currently visible (filtered) events.
  --------------------------------------------------------------- */
  var modal = document.createElement('div');
  modal.className = 'cwsa-modal';
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML =
    '<div class="cwsa-modal__backdrop" data-close></div>' +
    '<button class="cwsa-modal__arrow cwsa-modal__arrow--prev" aria-label="Previous event">&#8592;</button>' +
    '<button class="cwsa-modal__arrow cwsa-modal__arrow--next" aria-label="Next event">&#8594;</button>' +
    '<article class="cwsa-modal__card" role="dialog" aria-modal="true" aria-label="Event details">' +
      '<header class="cwsa-modal__head">' +
        '<div class="cwsa-modal__headline">' +
          '<span class="cwsa-modal__label"></span>' +
          '<h3 class="cwsa-modal__title"></h3>' +
        '</div>' +
        '<div class="cwsa-modal__when">' +
          '<span class="cwsa-modal__day"></span>' +
          '<span class="cwsa-modal__time"></span>' +
        '</div>' +
        '<button class="cwsa-modal__close" aria-label="Close event details">[x]</button>' +
      '</header>' +
      '<div class="cwsa-modal__scroll">' +
        '<figure class="cwsa-modal__poster"></figure>' +
        '<div class="cwsa-modal__ticket"></div>' +
        '<p class="cwsa-modal__performers"></p>' +
        '<div class="cwsa-modal__desc"></div>' +
      '</div>' +
      '<footer class="cwsa-modal__foot">' +
        '<span class="cwsa-modal__counter" aria-live="polite"></span>' +
        '<span class="cwsa-modal__hint" aria-hidden="true">&#8592; &#8594; / swipe to browse &middot; esc to close</span>' +
      '</footer>' +
    '</article>';
  document.body.appendChild(modal);

  var modalCard   = modal.querySelector('.cwsa-modal__card');
  var mLabel      = modal.querySelector('.cwsa-modal__label');
  var mTitle      = modal.querySelector('.cwsa-modal__title');
  var mDay        = modal.querySelector('.cwsa-modal__day');
  var mTime       = modal.querySelector('.cwsa-modal__time');
  var mPoster     = modal.querySelector('.cwsa-modal__poster');
  var mTicket     = modal.querySelector('.cwsa-modal__ticket');
  var mPerformers = modal.querySelector('.cwsa-modal__performers');
  var mDesc       = modal.querySelector('.cwsa-modal__desc');
  var mCounter    = modal.querySelector('.cwsa-modal__counter');
  var mClose      = modal.querySelector('.cwsa-modal__close');
  var mPrev       = modal.querySelector('.cwsa-modal__arrow--prev');
  var mNext       = modal.querySelector('.cwsa-modal__arrow--next');
  var mScroll     = modal.querySelector('.cwsa-modal__scroll');

  var currentIdx = -1;
  var lastFocused = null;

  function visibleIndices() {
    var idxs = [];
    allCards.forEach(function (card) {
      if (!card.hidden) idxs.push(parseInt(card.dataset.index, 10));
    });
    return idxs.length ? idxs : eventsData.map(function (_, i) { return i; });
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fullImage(event) {
    var img = event.images && event.images.length > 0 ? event.images[0] : null;
    if (!img) return null;
    var src = img.full || img.src;
    return src ? { src: src, alt: img.alt || event.name + ' poster' } : null;
  }

  function preload(index) {
    var img = fullImage(eventsData[index]);
    if (img) { var pre = new Image(); pre.src = img.src; }
  }

  function openModal(index) {
    var event = eventsData[index];
    if (!event) return;
    currentIdx = index;

    modalCard.dataset.label = event.label || '';
    mLabel.textContent = event.label || '';
    mLabel.hidden = !event.label;
    mTitle.textContent = event.name || '';

    var when = splitDisplayDate(event.displayDate);
    mDay.textContent = when.day;
    mTime.textContent = when.time;

    // Poster — always the full-resolution jpeg, never the webp thumb
    mPoster.innerHTML = '';
    var img = fullImage(event);
    if (img) {
      var el = document.createElement('img');
      el.src = img.src;
      el.alt = img.alt;
      mPoster.appendChild(el);
      mPoster.classList.remove('cwsa-modal__poster--empty');
    } else {
      mPoster.classList.add('cwsa-modal__poster--empty');
      mPoster.innerHTML = '<span>poster<br>loading&hellip;</span>';
    }

    // Ticket link
    mTicket.innerHTML = '';
    var href = event.eventCompletedUrl || event.url || '';
    if (href !== '') {
      var a = document.createElement('a');
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = '[ ' + (event.eventCompletedUrlLabel || 'Booking Link') + ' ↗ ]';
      mTicket.appendChild(a);
    }

    var names = performerNames(event);
    mPerformers.textContent = names.length ? 'w/ ' + names.join(', ') : '';
    mPerformers.hidden = names.length === 0;

    // Description — respect blank-line paragraph breaks in the JSON
    mDesc.innerHTML = '';
    (event.description || '').split(/\n\s*\n/).forEach(function (para) {
      if (!para.trim()) return;
      var p = document.createElement('p');
      p.textContent = para.trim();
      mDesc.appendChild(p);
    });

    var idxs = visibleIndices();
    var pos = idxs.indexOf(index);
    mCounter.textContent = 'evt ' + pad(pos + 1) + ' / ' + pad(idxs.length);

    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('cwsa-modal-open');
    mScroll.scrollTop = 0;
    mClose.focus();

    // Preload neighbours for snappy flicking
    if (idxs.length > 1) {
      preload(idxs[(pos + 1) % idxs.length]);
      preload(idxs[(pos - 1 + idxs.length) % idxs.length]);
    }
  }

  function closeModal() {
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('cwsa-modal-open');
    currentIdx = -1;
    if (lastFocused) { lastFocused.focus(); lastFocused = null; }
  }

  function step(dir) {
    var idxs = visibleIndices();
    if (!idxs.length) return;
    var pos = idxs.indexOf(currentIdx);
    if (pos === -1) pos = 0;
    openModal(idxs[(pos + dir + idxs.length) % idxs.length]);
  }

  mClose.addEventListener('click', closeModal);
  mPrev.addEventListener('click', function () { step(-1); });
  mNext.addEventListener('click', function () { step(1); });
  modal.addEventListener('click', function (e) {
    if (e.target.hasAttribute('data-close')) closeModal();
  });

  document.addEventListener('keydown', function (e) {
    if (modal.getAttribute('aria-hidden') === 'true') return;
    if (e.key === 'Escape') closeModal();
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
    // Keep tab focus inside the dialog
    if (e.key === 'Tab') {
      var focusables = modal.querySelectorAll('button, a[href]');
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  });

  var touchX = 0;
  mScroll.addEventListener('touchstart', function (e) {
    touchX = e.touches[0].clientX;
  }, { passive: true });
  mScroll.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 48) step(dx < 0 ? 1 : -1);
  }, { passive: true });

  /* --------------------------------------------------------------- */

  function buildCard(event, index) {
    var names = performerNames(event);

    var card = document.createElement('article');
    card.className = 'cwsa-event-card';
    card.dataset.label = event.label || '';
    // Weekday key (Wed/Thu/Fri/Sat/Sun) for the day filter, from the displayDate.
    card.dataset.day = splitDisplayDate(event.displayDate).day.slice(0, 3);
    card.dataset.index = index;
    var idSlug = (event['@id'] || '').split('#')[1];
    if (idSlug) card.id = 'evt-' + idSlug;

    var img = event.images && event.images.length > 0 ? event.images[0] : null;
    var poster = img && img.src
      ? '<img src="' + img.src + '" alt="' + (img.alt || event.name + ' poster') + '" loading="lazy">'
      : 'Event<br>Poster';

    var label = event.label
      ? '<span class="cwsa-event-label">' + event.label + '</span>'
      : '';

    var timeStr = splitDisplayDate(event.displayDate).time;
    var time = timeStr
      ? '<p class="cwsa-event-time">' + timeStr + '</p>'
      : '';

    var credits = names.length
      ? '<p class="cwsa-event-date">' + names.join(', ') + '</p>'
      : '';

    var desc = event.description
      ? '<p class="cwsa-event-desc">' + event.description + '</p>'
      : '';

    var link = '';
    var href = event.eventCompletedUrl || event.url || '';
    if (href !== '') {
      var linkLabel = event.eventCompletedUrlLabel || 'Booking Link';
      link = '<div class="cwsa-event-link"><a href="' + href + '" target="_blank" rel="noopener">' + linkLabel + '</a></div>';
    }

    card.innerHTML =
      '<div class="cwsa-event-body">' +
        label +
        '<h3 class="cwsa-event-title">' + event.name + '</h3>' +
        time +
        credits +
        desc +
        link +
        '<span class="cwsa-event-more" aria-hidden="true">[ + open ]</span>' +
      '</div>' +
      '<div class="cwsa-event-poster">' + poster + '</div>';

    // Whole card opens the detail view; inline booking links still work
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-haspopup', 'dialog');
    card.setAttribute('aria-label', event.name + ' — open event details');
    card.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      lastFocused = card;
      openModal(index);
    });
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        lastFocused = card;
        openModal(index);
      }
    });

    return card;
  }

  fetch('/json/schema.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var graph = data['@graph'] || [];

      graph.forEach(function (item) {
        if (item['@id']) personsMap[item['@id']] = item;
      });

      var events = graph.filter(function (item) {
        return item.exhibition === 'can-we-start-again' && item.visible !== false;
      });

      // Sort chronologically off the actual dates in displayDate, so the list
      // stays in real date/time order without a hand-maintained sortOrder.
      events.sort(function (a, b) {
        return chronoKey(a.displayDate) - chronoKey(b.displayDate);
      });

      eventsData = events;
      listEl.innerHTML = '';

      if (events.length === 0) {
        listEl.innerHTML = '<p class="cwsa-no-events">Events to be announced.</p>';
        return;
      }

      var currentDay = null;
      var currentGroup = null;
      events.forEach(function (event, index) {
        var day = splitDisplayDate(event.displayDate).day;
        if (day !== currentDay) {
          currentDay = day;
          var heading = document.createElement('h3');
          heading.className = 'cwsa-day-heading';
          heading.textContent = day;
          listEl.appendChild(heading);
          currentGroup = { heading: heading, cards: [] };
          dayGroups.push(currentGroup);
        }

        var card = buildCard(event, index);
        allCards.push(card);
        if (currentGroup) currentGroup.cards.push(card);
        listEl.appendChild(card);
      });
    })
    .catch(function () {
      listEl.innerHTML = '<p class="cwsa-no-events">Events to be announced.</p>';
    });
})();
