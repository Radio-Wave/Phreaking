(() => {
  const grid = document.querySelector('[data-op-archive-grid]');
  if (!grid) return;

  const nav = document.querySelector('[data-op-archive-nav]');
  const src = grid.getAttribute('data-op-archive-src') || '../json/open-projector-archive.json';

  const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);

  const isPlaceholder = (value) => {
    const v = String(value ?? '').trim();
    return v === '' || v === '--' || /didn'?t get your details/i.test(v);
  };

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i;

  const linkify = (token) => {
    const clean = token.replace(/[),.]+$/, '');
    const trailing = token.slice(clean.length);
    if (/^https?:\/\//i.test(clean)) {
      return `<a href="${escapeHtml(clean)}" target="_blank" rel="noreferrer">${escapeHtml(clean)}</a>${escapeHtml(trailing)}`;
    }
    if (EMAIL_RE.test(clean)) {
      return `<a href="mailto:${escapeHtml(clean)}">${escapeHtml(clean)}</a>${escapeHtml(trailing)}`;
    }
    if (DOMAIN_RE.test(clean)) {
      return `<a href="https://${escapeHtml(clean)}" target="_blank" rel="noreferrer">${escapeHtml(clean)}</a>${escapeHtml(trailing)}`;
    }
    return escapeHtml(token);
  };

  const renderCell = (value) => {
    if (isPlaceholder(value)) return '<span class="op-archive-empty">&mdash;</span>';
    return String(value).trim().split(/\s+/).map(linkify).join(' ');
  };

  const renderRow = (presenter) => `
              <tr>
                <td class="col-number"><span class="op-archive-tag">${presenter.number ?? ''}</span></td>
                <td>${renderCell(presenter.name)}</td>
                <td>${renderCell(presenter.project)}</td>
                <td>${renderCell(presenter.link)}</td>
                <td>${renderCell(presenter.socials)}</td>
              </tr>`;

  const renderEvent = (event) => {
    const rows = (event.presenters || []).map(renderRow).join('');
    grid.innerHTML = `
        <table class="op-archive-table">
          <thead>
            <tr>
              <th class="col-number">No.</th>
              <th>Presenter</th>
              <th>Project</th>
              <th>Link</th>
              <th>Socials</th>
            </tr>
          </thead>
          <tbody>${rows}
          </tbody>
        </table>`;
  };

  const wantedId = () => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('archive');
    return raw == null ? null : Number(raw);
  };

  fetch(src)
    .then((resp) => {
      if (!resp.ok) throw new Error(`Archive fetch failed: ${resp.status}`);
      return resp.json();
    })
    .then((data) => {
      const events = (data.events || []).slice().sort((a, b) => a.id - b.id);
      if (!events.length) throw new Error('No archive events found.');

      const requested = wantedId();
      let active = events.find((e) => e.id === requested) || events[events.length - 1];

      const select = (event, push) => {
        active = event;
        renderEvent(event);
        if (nav) {
          nav.querySelectorAll('button').forEach((btn) => {
            const on = Number(btn.dataset.eventId) === event.id;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
          });
        }
        if (push) {
          const url = new URL(window.location);
          url.searchParams.set('archive', event.id);
          window.history.replaceState({}, '', url);
        }
      };

      if (nav) {
        nav.innerHTML = events
          .map(
            (e) =>
              `<button type="button" role="tab" data-event-id="${e.id}">${escapeHtml(e.label)}<span class="op-archive-date">${escapeHtml(e.date)}</span></button>`
          )
          .join('');
        nav.querySelectorAll('button').forEach((btn) => {
          btn.addEventListener('click', () => {
            const event = events.find((e) => e.id === Number(btn.dataset.eventId));
            if (event) select(event, true);
          });
        });
      }

      select(active, false);
    })
    .catch((err) => {
      console.error(err);
      grid.innerHTML = '<p>Unable to load the archive right now.</p>';
    });
})();
