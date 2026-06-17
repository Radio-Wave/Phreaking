(() => {
  const grid = document.querySelector('[data-signals-grid]');
  if (!grid) return;

  const nav = document.querySelector('[data-signals-nav]');
  const src = grid.getAttribute('data-signals-src') || '../json/signals.json';

  const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[ch]);

  const idFor = (title) =>
    'signals-' + String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-title';

  const labelFor = (session) =>
    session.current ? 'This session' : String(session.id);

  const renderRow = (link, index) => `
              <tr>
                <td class="col-number"><span class="signals-tag">${index + 1}</span></td>
                <td><a href="${escapeHtml(link.url)}" target="_blank" rel="noreferrer">${escapeHtml(link.label)}</a></td>
                <td>${escapeHtml(link.note)}</td>
              </tr>`;

  const renderPanel = (panel) => {
    const titleId = idFor(panel.title);
    const rows = (panel.links || []).map(renderRow).join('');
    return `
        <article class="signals-panel" aria-labelledby="${titleId}">
          <h2 id="${titleId}">${escapeHtml(panel.title)}</h2>
          <p>${escapeHtml(panel.description)}</p>
          <table class="signals-table">
            <thead>
              <tr>
                <th class="col-number">No.</th>
                <th class="col-link">Link</th>
                <th>Use / Notes</th>
              </tr>
            </thead>
            <tbody>${rows}
            </tbody>
          </table>
        </article>`;
  };

  const renderSession = (session) => {
    grid.innerHTML = (session.panels || []).map(renderPanel).join('');
  };

  const wantedId = () => {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('session');
    return raw == null ? null : Number(raw);
  };

  fetch(src)
    .then((resp) => {
      if (!resp.ok) throw new Error(`Signals fetch failed: ${resp.status}`);
      return resp.json();
    })
    .then((data) => {
      const sessions = (data.sessions || []).slice().sort((a, b) => a.id - b.id);
      if (!sessions.length) throw new Error('No signals sessions found.');

      const requested = wantedId();
      let active =
        sessions.find((s) => s.id === requested) ||
        sessions.find((s) => s.current) ||
        sessions[sessions.length - 1];

      const select = (session, push) => {
        active = session;
        renderSession(session);
        if (nav) {
          nav.querySelectorAll('button').forEach((btn) => {
            const on = Number(btn.dataset.sessionId) === session.id;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
          });
        }
        if (push) {
          const url = new URL(window.location);
          url.searchParams.set('session', session.id);
          window.history.replaceState({}, '', url);
        }
      };

      if (nav) {
        nav.innerHTML = sessions
          .map(
            (s) =>
              `<button type="button" role="tab" data-session-id="${s.id}">${escapeHtml(labelFor(s))}</button>`
          )
          .join('');
        nav.querySelectorAll('button').forEach((btn) => {
          btn.addEventListener('click', () => {
            const session = sessions.find((s) => s.id === Number(btn.dataset.sessionId));
            if (session) select(session, true);
          });
        });
      }

      select(active, false);
    })
    .catch((err) => {
      console.error(err);
      grid.innerHTML = '<p>Unable to load resources right now.</p>';
    });
})();
