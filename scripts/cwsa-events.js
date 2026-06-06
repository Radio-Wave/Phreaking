(function () {
  var filterBtns = document.querySelectorAll('.cwsa-filter-btn');
  var listEl = document.getElementById('cwsa-events-list');
  if (!listEl) return;

  var allCards = [];

  function applyFilter(filter) {
    filterBtns.forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    allCards.forEach(function (card) {
      var label = card.dataset.label || '';
      card.hidden = filter !== 'all' && label !== filter;
    });
  }

  filterBtns.forEach(function (btn) {
    btn.addEventListener('click', function () { applyFilter(btn.dataset.filter); });
  });

  function buildCard(event, persons) {
    var performer = event.performer;
    var performerNames = [];
    if (performer) {
      var ids = Array.isArray(performer)
        ? performer.map(function (p) { return p['@id']; })
        : [performer['@id']];
      ids.forEach(function (id) {
        var p = persons[id];
        if (p) performerNames.push(p.name);
      });
    }

    var card = document.createElement('article');
    card.className = 'cwsa-event-card';
    card.dataset.label = event.label || '';

    var img = event.images && event.images.length > 0 ? event.images[0] : null;
    var poster = img
      ? '<img src="' + img.src + '" alt="' + (img.alt || event.name + ' poster') + '" loading="lazy">'
      : 'Event<br>Poster';

    var label = event.label
      ? '<span class="cwsa-event-label">' + event.label + '</span>'
      : '';

    var date = event.displayDate
      ? '<p class="cwsa-event-date">' + event.displayDate + '</p>'
      : '';

    var credits = performerNames.length
      ? '<p class="cwsa-event-date">' + performerNames.join(', ') + '</p>'
      : '';

    var desc = event.description
      ? '<p class="cwsa-event-desc">' + event.description + '</p>'
      : '';

    var link = '';
    if (event.url && event.url !== '' && event.eventCompletedUrl !== '') {
      var href = event.eventCompletedUrl || event.url;
      link = '<div class="cwsa-event-link"><a href="' + href + '">Booking Link</a></div>';
    }

    card.innerHTML =
      '<div class="cwsa-event-body">' +
        label +
        '<h3 class="cwsa-event-title">' + event.name + '</h3>' +
        date +
        credits +
        desc +
        link +
      '</div>' +
      '<div class="cwsa-event-poster">' + poster + '</div>';

    return card;
  }

  fetch('/json/schema.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var graph = data['@graph'] || [];

      var persons = {};
      graph.forEach(function (item) {
        if (item['@id']) persons[item['@id']] = item;
      });

      var events = graph.filter(function (item) {
        return item.exhibition === 'can-we-start-again';
      });

      events.sort(function (a, b) {
        return (a.sortOrder || 999) - (b.sortOrder || 999);
      });

      listEl.innerHTML = '';

      if (events.length === 0) {
        listEl.innerHTML = '<p class="cwsa-no-events">Events to be announced.</p>';
        return;
      }

      events.forEach(function (event) {
        var card = buildCard(event, persons);
        allCards.push(card);
        listEl.appendChild(card);
      });
    })
    .catch(function () {
      listEl.innerHTML = '<p class="cwsa-no-events">Events to be announced.</p>';
    });
})();
