/* Can We Start Again? — time-proportional festival timetable.
   Reads /json/schema.json, renders visible CWSA events into a Wed–Sun grid
   where each block is positioned/sized by its start + end time. Tapping a
   block jumps to that event's full card in the "All Events" list. */
(function () {
  var mount = document.getElementById('cwsa-timetable');
  if (!mount) return;

  // Festival runs Wed 8 – Sun 12 July 2026; columns keyed by day-of-month.
  var DAYS = [
    { date: 8,  abbr: 'Wed', label: '8 Jul' },
    { date: 9,  abbr: 'Thu', label: '9 Jul' },
    { date: 10, abbr: 'Fri', label: '10 Jul' },
    { date: 11, abbr: 'Sat', label: '11 Jul' },
    { date: 12, abbr: 'Sun', label: '12 Jul' }
  ];
  var PPM = 1.1;              // pixels per minute
  var DEFAULT_START = 11 * 60; // 11:00 fallback grid bounds
  var DEFAULT_END = 22 * 60;   // 22:00

  function labelClass(label) {
    var l = (label || '').toLowerCase();
    if (l === 'talk') return 'ttg-block--talk';
    if (l === 'workshop') return 'ttg-block--workshop';
    if (l === 'performance' || l.indexOf('performance') !== -1) return 'ttg-block--performance';
    if (l === 'screening') return 'ttg-block--screening';
    return 'ttg-block--event';
  }

  // Pull { dayIndex, start, end } out of a displayDate string.
  function parseWhen(displayDate) {
    if (!displayDate) return null;
    var dm = displayDate.match(/(\d{1,2})(?:st|nd|rd|th)\s+July/i);
    if (!dm) return null; // excludes non-July dates (e.g. June private view)
    var dayIndex = -1;
    for (var i = 0; i < DAYS.length; i++) {
      if (DAYS[i].date === parseInt(dm[1], 10)) { dayIndex = i; break; }
    }
    if (dayIndex === -1) return null;

    var tm = displayDate.match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/);
    if (!tm) return { dayIndex: dayIndex, start: null, end: null }; // all-day
    return {
      dayIndex: dayIndex,
      start: parseInt(tm[1], 10) * 60 + parseInt(tm[2], 10),
      end: parseInt(tm[3], 10) * 60 + parseInt(tm[4], 10)
    };
  }

  function fmt(min) {
    var h = Math.floor(min / 60), m = min % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // Greedy lane-packing for overlapping events within one day column.
  function packLanes(items) {
    items.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    var lanes = [];        // each lane holds the end time of its last event
    var clusterStart = 0;  // index of first event in the current overlap cluster
    var clusterEnd = -1;   // running max end within the cluster

    function flush(upto) {
      for (var k = clusterStart; k < upto; k++) items[k].lanes = lanes.length;
      lanes = [];
    }

    for (var i = 0; i < items.length; i++) {
      var ev = items[i];
      if (ev.start >= clusterEnd && lanes.length) { flush(i); clusterStart = i; }
      var placed = false;
      for (var j = 0; j < lanes.length; j++) {
        if (lanes[j] <= ev.start) { ev.lane = j; lanes[j] = ev.end; placed = true; break; }
      }
      if (!placed) { ev.lane = lanes.length; lanes.push(ev.end); }
      clusterEnd = Math.max(clusterEnd, ev.end);
    }
    flush(items.length);
    return items;
  }

  function jumpTo(idSlug) {
    var all = document.querySelector('.cwsa-filter-btn[data-filter="all"]');
    if (all && !all.classList.contains('active')) all.click(); // ensure not filtered out
    var el = document.getElementById('evt-' + idSlug);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('cwsa-card-flash');
    setTimeout(function () { el.classList.remove('cwsa-card-flash'); }, 1600);
  }

  function render(events) {
    var timed = [], allDay = [];
    events.forEach(function (ev) {
      var when = parseWhen(ev.displayDate);
      if (!when) return;
      ev._when = when;
      if (when.start == null) allDay.push(ev); else timed.push(ev);
    });

    if (!timed.length && !allDay.length) {
      mount.innerHTML = '<p class="cwsa-no-events">Timetable to be announced.</p>';
      return;
    }

    // Grid vertical bounds, snapped to whole hours.
    var gridStart = DEFAULT_START, gridEnd = DEFAULT_END;
    if (timed.length) {
      var mn = Infinity, mx = -Infinity;
      timed.forEach(function (e) { mn = Math.min(mn, e._when.start); mx = Math.max(mx, e._when.end); });
      gridStart = Math.floor(mn / 60) * 60;
      gridEnd = Math.ceil(mx / 60) * 60;
    }
    var totalMin = gridEnd - gridStart;
    var bodyH = totalMin * PPM;

    var tpl = 'grid-template-columns:52px repeat(5,minmax(0,1fr));';
    var html = '';

    // Day header row.
    html += '<div class="ttg-head" style="' + tpl + '">';
    html += '<div class="ttg-corner"></div>';
    DAYS.forEach(function (d) {
      html += '<div class="ttg-dayhead"><span class="ttg-dayabbr">' + d.abbr +
              '</span><span class="ttg-daydate">' + d.label + '</span></div>';
    });
    html += '</div>';

    // All-day band (only if any all-day events exist).
    if (allDay.length) {
      html += '<div class="ttg-allday" style="' + tpl + '">';
      html += '<div class="ttg-allday-label">All&nbsp;day</div>';
      DAYS.forEach(function (d, di) {
        html += '<div class="ttg-allday-cell">';
        allDay.filter(function (e) { return e._when.dayIndex === di; }).forEach(function (e) {
          var slug = (e['@id'] || '').split('#')[1] || '';
          html += '<button class="ttg-chip" data-slug="' + slug + '" title="' +
                  esc(e.name) + '">' + esc(e.name) + '</button>';
        });
        html += '</div>';
      });
      html += '</div>';
    }

    // Timed body: hour gutter + 5 day columns.
    html += '<div class="ttg-body" style="' + tpl + '">';
    // Gutter with hour labels.
    html += '<div class="ttg-gutter" style="height:' + bodyH + 'px">';
    for (var t = gridStart; t <= gridEnd; t += 60) {
      html += '<div class="ttg-hour" style="top:' + ((t - gridStart) * PPM) + 'px">' + fmt(t) + '</div>';
    }
    html += '</div>';

    // Hour gridlines as a repeating background on each column.
    var lineBg = 'background-image:repeating-linear-gradient(to bottom,' +
      'transparent 0,transparent ' + (60 * PPM - 1) + 'px,' +
      'var(--rule) ' + (60 * PPM - 1) + 'px,var(--rule) ' + (60 * PPM) + 'px);';

    DAYS.forEach(function (d, di) {
      html += '<div class="ttg-col" style="height:' + bodyH + 'px;' + lineBg + '">';
      var dayItems = timed.filter(function (e) { return e._when.dayIndex === di; })
        .map(function (e) { return { ev: e, start: e._when.start, end: e._when.end }; });
      packLanes(dayItems);
      dayItems.forEach(function (it) {
        var e = it.ev;
        var top = (it.start - gridStart) * PPM;
        var h = Math.max((it.end - it.start) * PPM, 24);
        var lanes = it.lanes || 1;
        var w = 100 / lanes;
        var left = it.lane * w;
        var slug = (e['@id'] || '').split('#')[1] || '';
        html += '<button class="ttg-block ' + labelClass(e.label) + '" data-slug="' + slug + '" ' +
          'style="top:' + top + 'px;height:' + h + 'px;left:calc(' + left + '% + 2px);' +
          'width:calc(' + w + '% - 4px)" ' +
          'title="' + esc(e.name) + ' — ' + fmt(it.start) + '–' + fmt(it.end) + '">' +
          '<span class="ttg-block-time">' + fmt(it.start) + '–' + fmt(it.end) + '</span>' +
          '<span class="ttg-block-title">' + esc(e.name) + '</span></button>';
      });
      html += '</div>';
    });
    html += '</div>';

    mount.innerHTML = html;

    mount.querySelectorAll('[data-slug]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var slug = btn.getAttribute('data-slug');
        if (slug) jumpTo(slug);
      });
    });

    renderLegend();
  }

  function renderLegend() {
    var el = document.getElementById('ttg-legend');
    if (!el) return;
    var items = [
      ['ttg-dot--talk', 'Talk'],
      ['ttg-dot--workshop', 'Workshop'],
      ['ttg-dot--performance', 'Performance'],
      ['ttg-dot--screening', 'Screening'],
      ['ttg-dot--event', 'Event']
    ];
    el.innerHTML = items.map(function (i) {
      return '<span class="ttg-legend-item"><span class="ttg-dot ' + i[0] + '"></span>' + i[1] + '</span>';
    }).join('');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  fetch('/json/schema.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var graph = data['@graph'] || [];
      var events = graph.filter(function (item) {
        return item.exhibition === 'can-we-start-again' && item.visible !== false;
      });
      render(events);
    })
    .catch(function () {
      mount.innerHTML = '<p class="cwsa-no-events">Timetable to be announced.</p>';
    });
})();
