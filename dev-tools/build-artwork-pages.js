#!/usr/bin/env node
/* Bake artwork from schema.json + artists.json into each approved exhibition
 * page, using the same renderer the JSON editor runs on push and the live page
 * hydrates. Useful for CI / a one-off rebuild from the command line; the
 * editor does not need it.
 *
 * Lives in /dev-tools — NOT /scripts, since /scripts is served to the public
 * and this is a build-time tool. It requires the real, served renderer at
 * /scripts/artwork.js rather than a private copy, so there is exactly one
 * implementation to keep in sync — and it reads the page list from that same
 * file (ArtworkRender.ARTWORK_BAKE_PAGES) rather than declaring its own. To
 * add a page, edit that array in scripts/artwork.js; nothing here changes.
 *
 * ALL OR NOTHING: every page is rendered and verified BEFORE any file is
 * written. If one page fails, nothing is written at all — but every page's
 * result is still reported, so one run tells you the whole story rather than
 * stopping at the first failure.
 *
 * Usage (run from the repo root, or pass explicit paths):
 *   node dev-tools/build-artwork-pages.js [schema.json] [artists.json]
 */
const fs = require('fs');
const path = require('path');
const A = require(path.join(__dirname, '..', 'scripts', 'artwork.js'));

const ROOT = path.join(__dirname, '..');
const schemaPath = process.argv[2] || path.join('json', 'schema.json');
const artistsPath = process.argv[3] || path.join('json', 'artists.json');

const schemaData = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const artistsData = JSON.parse(fs.readFileSync(artistsPath, 'utf8'));

const results = [];
let failed = false;

// ── Pass 1: render, splice and verify every page. Writes nothing. ──────────
A.ARTWORK_BAKE_PAGES.forEach((cfg) => {
  const r = { cfg, problems: [], page: null, html: null, verified: 0 };
  results.push(r);

  const pagePath = path.isAbsolute(cfg.pagePath) ? cfg.pagePath : path.join(ROOT, cfg.pagePath);

  if (!fs.existsSync(pagePath)) {
    r.problems.push('file not found: ' + cfg.pagePath);
    failed = true;
    return;
  }

  const rendered = A.renderPageRegions(schemaData, artistsData, cfg);
  r.page = rendered;
  if (rendered.fatal) {
    r.problems.push(rendered.fatal);
    failed = true;
    return;
  }

  const before = fs.readFileSync(pagePath, 'utf8');
  const applied = A.applyRegions(before, rendered.regions);
  if (applied.missing.length) {
    r.problems.push('missing markers: ' + applied.missing.join(', '));
    failed = true;
    return;
  }

  // Nothing outside the markers may change — the page shell, the artists grid,
  // the events feed and the galleries are hand-authored or belong to another
  // renderer, and are not this generator's to touch.
  if (A.outsideRegions(before) !== A.outsideRegions(applied.html)) {
    r.problems.push('the generator would have altered hand-authored parts of the page');
    failed = true;
    return;
  }

  const check = A.verifyArtworkPageHTML(applied.html, rendered.list, rendered.ctx);
  r.verified = check.checked;
  if (!check.ok) {
    check.problems.forEach((p) => r.problems.push(p));
    failed = true;
    return;
  }

  r.html = applied.html;
  r.pageFsPath = pagePath;
});

// ── Report every page, passing or failing, before deciding anything. ───────
results.forEach((r) => {
  const p = r.page;
  if (r.problems.length) {
    console.error(`FAIL  ${r.cfg.pagePath}: ${r.problems.length} problem(s)`);
    r.problems.slice(0, 20).forEach((x) => console.error('    - ' + x));
    if (r.problems.length > 20) console.error(`    … and ${r.problems.length - 20} more`);
  } else {
    console.log(`OK    ${r.cfg.pagePath}: ${p.baked} artwork(s)` +
      (p.skipped ? `, ${p.skipped} skipped` : '') +
      `, verified ${r.verified} present in raw HTML`);
  }
  if (p) {
    p.errors.forEach((e) => console.error('    ! ' + e));
    p.warnings.forEach((w) => console.log('    ~ ' + w));
  }
});

if (failed) {
  console.error('\nFATAL: no pages were written — fix the problems above and run again.');
  process.exit(1);
}

// ── Pass 2: every page verified, so write them all. ───────────────────────
results.forEach((r) => fs.writeFileSync(r.pageFsPath, r.html));

const total = results.reduce((n, r) => n + r.page.baked, 0);
console.log(`\nBaked ${total} artwork(s) into ${results.length} page(s).`);
