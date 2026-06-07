(function () {
  var hostedEl = document.getElementById('exhibitions-hosted');
  var featuredEl = document.getElementById('exhibitions-featured');
  if (!hostedEl && !featuredEl) return;

  function buildSection(exhibition) {
    var href = exhibition.url || '#';
    var nameHtml = exhibition.nameHtml || exhibition.name;
    var label = exhibition.name + ' gallery';
    var linkLabel = exhibition.linkLabel || exhibition.name;
    var images = exhibition.images || [];

    var figures = images.map(function (img) {
      return '<figure class="pc-item"><a href="' + href + '"><img src="' + img.src + '" alt="' + img.alt + '" loading="lazy"></a></figure>';
    }).join('');

    return (
      '<h3 class="section-subtitle">' + nameHtml + '</h3>\n' +
      '<section class="pc-gallery three-wide" aria-label="' + label + '">\n' +
      '<div class="pc-grid">' + figures + '</div>\n' +
      '</section>\n' +
      '<div class="copy">\n' +
      '<p>' + exhibition.description + '</p>\n' +
      '<p class="eyebrow"><a class="exhibitions-link" href="' + href + '">View the full ' + linkLabel + ' page ↗</a></p>\n' +
      '</div>'
    );
  }

  fetch('/json/schema.json')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var graph = data['@graph'] || [];

      var hosted = graph.filter(function (item) {
        return item.exhibitionCategory === 'hosted' && item.visible !== false;
      });
      var featured = graph.filter(function (item) {
        return item.exhibitionCategory === 'featured' && item.visible !== false;
      });

      hosted.sort(function (a, b) { return (a.sortOrder || 999) - (b.sortOrder || 999); });
      featured.sort(function (a, b) { return (a.sortOrder || 999) - (b.sortOrder || 999); });

      if (hostedEl && hosted.length) {
        hostedEl.innerHTML = hosted.map(buildSection).join('\n<hr>\n');
      }
      if (featuredEl && featured.length) {
        featuredEl.innerHTML = featured.map(buildSection).join('\n<hr>\n');
      }
    });
})();
