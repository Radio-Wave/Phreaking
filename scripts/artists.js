(function () {
  var grid = document.getElementById('artists-grid');
  if (!grid) return;

  var exhibition = grid.dataset.exhibition;
  if (!exhibition) return;

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildCard(artist) {
    var link = '';
    if (artist.url && artist.linkLabel) {
      link =
        '<div class="artist-link">' +
          '<br>more at: ' +
          '<a href="' + esc(artist.url) + '" target="_blank" rel="noopener">' +
            esc(artist.linkLabel) +
          '</a>' +
        '</div>';
    }

    return (
      '<div class="artist-card">' +
        '<h3>' + esc(artist.name) + '</h3>' +
        '<p>' + esc(artist.description || '') + '</p>' +
        link +
      '</div>'
    );
  }

  // Build a crawlable JSON-LD @graph from the artist records, dropping the
  // display-only helper fields (exhibition, linkLabel, sortOrder) that are not
  // part of the schema.org vocabulary.
  function injectStructuredData(artists) {
    if (document.getElementById('artists-jsonld')) return;

    var graph = artists.map(function (a) {
      var node = {};
      Object.keys(a).forEach(function (key) {
        if (key === 'exhibition' || key === 'linkLabel' || key === 'sortOrder') return;
        node[key] = a[key];
      });
      return node;
    });

    var script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = 'artists-jsonld';
    script.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': graph
    });
    document.head.appendChild(script);
  }

  fetch('/json/artists.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var artists = (data['@graph'] || [])
        .filter(function (a) { return a.exhibition === exhibition; })
        .sort(function (a, b) { return (a.sortOrder || 999) - (b.sortOrder || 999); });

      if (artists.length === 0) {
        grid.innerHTML = '<p>Artists to be announced.</p>';
        return;
      }

      grid.innerHTML = artists.map(buildCard).join('');
      injectStructuredData(artists);
    })
    .catch(function () {
      grid.innerHTML = '<p>Artists to be announced.</p>';
    });
})();
