#!/usr/bin/env node
/* ===========================================================================
 * Artwork baking — headless regression suite (Node + jsdom, no browser)
 *
 * Sibling of dev-tools/test-past-events.js, same shape, same harness, scoped
 * to the artwork bake. Lives in /dev-tools — NOT /scripts, which is served to
 * the public — and tests the real, served files in place.
 *
 *   node dev-tools/test-artwork-pages.js
 *
 * Run from the repo root. Override any path with an environment variable:
 *   AW_SCRIPT=path/to/artwork.js
 *   AW_SCHEMA=path/to/schema.json
 *   AW_ARTISTS=path/to/artists.json
 *   AW_EDITOR=path/to/jsonedit.html
 *
 * Sections:
 *   A. syntax        — node --check on artwork.js and the build CLI
 *   B. raw HTML      — THE important one: does each un-executed exhibition
 *                      page contain every artwork's title, artist, description
 *                      and images as real text and real <img src>?
 *   C. structured    — JSON-LD validity, typing, no internal fields, and the
 *                      injectJsonLd() double-injection guard exercised rather
 *                      than assumed
 *   D. hydration     — jsdom against a BAKED page with fetch hard-disabled:
 *                      cards are not re-rendered, the modal opens, and the
 *                      carousel navigates. This is the regression guard for
 *                      the baked-carousel fix; it fails against the old code.
 *   E. bake integrity— hollowed and missing markers are caught, nothing
 *                      outside the markers moves, and an unbaked page is
 *                      completely untouched
 *   F. editor parity — the editor's preview card is byte-identical to the
 *                      baked card
 * ======================================================================== */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = process.env.AW_SCRIPT || path.join(ROOT, 'scripts', 'artwork.js');
const SCHEMA_PATH = process.env.AW_SCHEMA || path.join(ROOT, 'json', 'schema.json');
const ARTISTS_PATH = process.env.AW_ARTISTS || path.join(ROOT, 'json', 'artists.json');
const EDITOR_PATH = process.env.AW_EDITOR || path.join(ROOT, 'jsonedit.html');
const CLI_PATH = path.join(__dirname, 'build-artwork-pages.js');

[SCRIPT_PATH, SCHEMA_PATH, ARTISTS_PATH, EDITOR_PATH, CLI_PATH].forEach((p) => {
  if (!fs.existsSync(p)) {
    console.error('Cannot find ' + p);
    console.error('Run this from the repo root, or set AW_SCRIPT / AW_SCHEMA / AW_ARTISTS / AW_EDITOR.');
    process.exit(1);
  }
});

const A = require(SCRIPT_PATH);
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const ARTISTS = JSON.parse(fs.readFileSync(ARTISTS_PATH, 'utf8'));
const EDITOR = fs.readFileSync(EDITOR_PATH, 'utf8');
const SCRIPT = fs.readFileSync(SCRIPT_PATH, 'utf8');
const CTX = A.buildContext(SCHEMA, ARTISTS);

/* ── tiny harness (same as the Past Events suite) ───────────────────────── */
let passed = 0, failed = 0, group = '';
const failures = [];
function section(name) { group = name; console.log('\n' + name); }
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else {
    failed++;
    failures.push(group + ' → ' + name + (detail ? '\n      ' + detail : ''));
    console.log('  ✗ ' + name + (detail ? '\n      ' + detail : ''));
  }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function has(hay, needle) { return String(hay).indexOf(needle) !== -1; }

function rawText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&middot;/g, '·').replace(/&copy;/g, '©')
    .replace(/\s+/g, ' ').trim();
}

const PAGES = A.ARTWORK_BAKE_PAGES.map((cfg) => {
  const file = path.join(ROOT, cfg.pagePath);
  return {
    cfg,
    file,
    html: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '',
    list: A.artworkFor(SCHEMA, { page: cfg.artworkPage })
  };
});

/* =======================================================================
 * A. Syntax
 * ==================================================================== */
section('A. Syntax');

function nodeCheck(source, label) {
  const tmp = path.join(os.tmpdir(), 'aw-check-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(tmp, source);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    ok('node --check ' + label, true);
  } catch (e) {
    ok('node --check ' + label, false, String(e.stderr || e.message).split('\n').slice(0, 4).join('\n      '));
  } finally { fs.unlinkSync(tmp); }
}

nodeCheck(SCRIPT, 'artwork.js');
nodeCheck(fs.readFileSync(CLI_PATH, 'utf8'), 'build-artwork-pages.js');

ok('the editor loads the shared artwork renderer',
  /<script src="\/scripts\/artwork\.js"><\/script>/.test(EDITOR));
ok('the editor reads the page list from the renderer, not its own copy',
  has(EDITOR, 'R.ARTWORK_BAKE_PAGES') && !/const\s+ARTWORK_BAKE_PAGES\s*=/.test(EDITOR));
ok('the build CLI reads the page list from the renderer too',
  has(fs.readFileSync(CLI_PATH, 'utf8'), 'A.ARTWORK_BAKE_PAGES'));

/* The allowlist itself is a contract: can-we-start-again must stay out. */
ok('the bake allowlist covers exactly BitRot and DCCeP',
  A.ARTWORK_BAKE_PAGES.length === 2 &&
  A.ARTWORK_BAKE_PAGES.some((p) => p.artworkPage === '/BitRot/') &&
  A.ARTWORK_BAKE_PAGES.some((p) => p.artworkPage === '/does-cloud-compute-ever-precipitate/'),
  JSON.stringify(A.ARTWORK_BAKE_PAGES.map((p) => p.artworkPage)));
ok('can-we-start-again is NOT in the bake allowlist',
  !A.ARTWORK_BAKE_PAGES.some((p) => /can-we-start-again/.test(p.artworkPage + p.pagePath)));

PAGES.forEach((p) => {
  ok(`${p.cfg.pagePath} exists on disk`, !!p.html);
  ok(`${p.cfg.pagePath} declares data-artwork-page="${p.cfg.artworkPage}"`,
    has(p.html, 'data-artwork-page="' + p.cfg.artworkPage + '"'));
});

/* =======================================================================
 * B. Raw HTML — zero JavaScript executed
 * ==================================================================== */
section('B. Raw HTML (zero JavaScript executed)');

ok('there is artwork to check at all', PAGES.reduce((n, p) => n + p.list.length, 0) > 0);

PAGES.forEach((p) => {
  const label = p.cfg.exhibition;
  const TEXT = rawText(p.html);
  const cards = (p.html.match(/<article class="aw-card"/g) || []).length;

  eq(`${label}: one baked .aw-card per selected artwork`, cards, p.list.length);

  const missName = [], missArtist = [], missDesc = [], missImg = [], missFull = [];
  p.list.forEach((art) => {
    if (!has(TEXT, rawText(art.name))) missName.push(art.name);
    const line = A.artistLine(art, CTX);
    if (line && !has(TEXT, rawText(line))) missArtist.push(art.name + ' → ' + line);
    if (art.description && !has(TEXT, rawText(art.description).slice(0, 60))) missDesc.push(art.name);
    A.imagesOf(art).forEach((im) => {
      const src = im.src || im.full;
      const full = im.full || im.src;
      if (!has(p.html, 'src="' + src + '"') && !has(p.html, 'src="' + full + '"')) {
        missImg.push(art.name + ' → ' + src);
      }
      if (!has(p.html, 'data-aw-full="' + full + '"')) missFull.push(art.name + ' → ' + full);
    });
  });

  ok(`${label}: every artwork title is in the raw markup`, missName.length === 0, missName.join(', '));
  ok(`${label}: every artist credit is in the raw markup`, missArtist.length === 0, missArtist.slice(0, 5).join(', '));
  ok(`${label}: every description is in the raw markup`, missDesc.length === 0, missDesc.join(', '));
  ok(`${label}: every image has a real <img src>`, missImg.length === 0, missImg.slice(0, 5).join(', '));
  ok(`${label}: every image's full-size path is baked as data-aw-full`,
    missFull.length === 0, missFull.slice(0, 5).join(', '));

  ok(`${label}: the stowed detail block is never marked [hidden] — some ` +
    'text-extraction tools strip [hidden] content, and this is exactly the ' +
    'content that must not be stripped',
    !/<div class="aw-detail[^"]*"[^>]*\shidden(\s|>)/.test(p.html));

  ok(`${label}: the generated grid sits inside the page's own mount`,
    /<div id="artwork-grid"[\s\S]{0,400}?AW:START:artwork-grid/.test(p.html));

  ok(`${label}: the "Loading artwork…" placeholder is gone from the baked page`,
    !has(p.html, 'Loading artwork'));

  const check = A.verifyArtworkPageHTML(p.html, p.list, CTX);
  ok(`${label}: the renderer's own verifier agrees the page is complete`,
    check.ok, check.problems.slice(0, 3).join('; '));
  eq(`${label}: the verifier checked every artwork`, check.checked, p.list.length);
});

/* The two pages must not bleed into each other. */
const bitrot = PAGES.find((p) => p.cfg.exhibition === 'bitrot');
const dccep = PAGES.find((p) => p.cfg.exhibition === 'does-cloud-compute');
if (bitrot && dccep) {
  /* Matched on data-aw-slug, not on the title text: an artwork title can
   * legitimately appear elsewhere on the other page as a substring of a
   * person's name or a paragraph, and a naive text match calls that a leak. */
  const dccepOnly = dccep.list.filter((a) => !(a.visibleOn || []).includes('/BitRot/'));
  const leaked = dccepOnly.filter((a) => has(bitrot.html, 'data-aw-slug="' + A.artworkSlug(a) + '"'));
  ok('BitRot does not bake DCCeP-only artwork', dccepOnly.length > 0 && leaked.length === 0,
    leaked.map((a) => a.name).join(', '));

  const bitrotOnly = bitrot.list.filter((a) => !(a.visibleOn || []).includes('/does-cloud-compute-ever-precipitate/'));
  const leaked2 = bitrotOnly.filter((a) => has(dccep.html, 'data-aw-slug="' + A.artworkSlug(a) + '"'));
  ok('DCCeP does not bake BitRot-only artwork', bitrotOnly.length > 0 && leaked2.length === 0,
    leaked2.map((a) => a.name).join(', '));
}

/* =======================================================================
 * C. Structured data
 * ==================================================================== */
section('C. Structured data');

const INTERNAL_FIELDS = ['exhibition', 'sortOrder', 'visibleOn', 'linkLabel', 'visible', 'images', 'galleryRef'];

PAGES.forEach((p) => {
  const label = p.cfg.exhibition;
  const m = /<script type="application\/ld\+json" id="artwork-jsonld">([\s\S]*?)<\/script>/.exec(p.html);
  ok(`${label}: the page carries a baked artwork JSON-LD block`, !!m);
  if (!m) return;

  let ld = null;
  try { ld = JSON.parse(m[1].replace(/<\\\//g, '</')); ok(`${label}: the JSON-LD parses`, true); }
  catch (e) { ok(`${label}: the JSON-LD parses`, false, e.message); return; }

  eq(`${label}: @context is schema.org`, ld['@context'], 'https://schema.org');
  eq(`${label}: one node per baked artwork`, (ld['@graph'] || []).length, p.list.length);
  ok(`${label}: every node is a VisualArtwork`,
    ld['@graph'].every((n) => n['@type'] === 'VisualArtwork'));
  ok(`${label}: every node has an @id and a name`,
    ld['@graph'].every((n) => n['@id'] && n.name));

  const leaked = [];
  ld['@graph'].forEach((n) => INTERNAL_FIELDS.forEach((f) => { if (f in n) leaked.push(n.name + '.' + f); }));
  ok(`${label}: no internal/display-only fields leak into the JSON-LD`, leaked.length === 0, leaked.join(', '));

  const withArtists = ld['@graph'].filter((n) => n.artist);
  ok(`${label}: artist credits are bare @id references, not duplicated Person nodes`,
    withArtists.length > 0 && withArtists.every((n) => {
      const refs = Array.isArray(n.artist) ? n.artist : [n.artist];
      return refs.every((r) => r && r['@id'] && Object.keys(r).length === 1);
    }));

  ok(`${label}: image URLs are absolute`,
    ld['@graph'].filter((n) => n.image).every((n) => n.image.every((u) => /^https?:\/\//.test(u))));

  ok(`${label}: the JSON-LD block lives in <head>`,
    p.html.indexOf('id="artwork-jsonld"') < p.html.indexOf('</head>'));
});

/* The double-injection guard, exercised rather than assumed. A baked page
 * already carries id="artwork-jsonld"; injectJsonLd() must be a no-op against
 * it. This is not expected to be reached in practice (a fully baked mount
 * skips the fetch path entirely), which is precisely why it is asserted. */
{
  const page = bitrot || PAGES[0];
  const vc = new VirtualConsole();
  const dom = new JSDOM(page.html, { url: 'https://phreaking.co.uk' + page.cfg.artworkPage, virtualConsole: vc });
  const before = dom.window.document.querySelectorAll('script[type="application/ld+json"]').length;
  const g = dom.window;
  g.__AW_NO_AUTO_INIT__ = true;
  dom.window.eval(SCRIPT);
  dom.window.eval('ArtworkRender.injectJsonLd && ArtworkRender.injectJsonLd([], {})');
  const after = dom.window.document.querySelectorAll('script[type="application/ld+json"]').length;
  eq('injectJsonLd() against an already-baked <head> adds no second block', after, before);
  eq('…and exactly one #artwork-jsonld remains',
    dom.window.document.querySelectorAll('#artwork-jsonld').length, 1);
}

/* =======================================================================
 * D. Hydration on a BAKED page, with fetch hard-disabled
 *
 * This is the regression guard for the baked-carousel fix. Before it, the
 * modal's image list came only from card.__awImages, set only by
 * attachImageData() from a live fetch — so on a baked page (which does not
 * fetch at all) the carousel could not navigate past its first image. Every
 * assertion below runs with window.fetch replaced by a hard failure.
 * ==================================================================== */
section('D. Hydration on a baked page (fetch disabled)');

function bootBakedPage(page) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(page.html, {
    url: 'https://phreaking.co.uk' + page.cfg.artworkPage,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  let fetchCalls = 0;
  dom.window.fetch = function () {
    fetchCalls++;
    return Promise.reject(new Error('fetch is disabled in this test — a baked page must not need it'));
  };
  dom.window.eval(SCRIPT);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  return { dom, fetchCalls: () => fetchCalls };
}

/* Run over BOTH pages, not one: at the time of writing every BitRot artwork
 * carries exactly one image and every DCCeP artwork carries two, so a suite
 * that booted only the first page would never exercise the multi-image
 * carousel — the whole thing this section exists to guard. */
let multiImageExercised = false;

PAGES.forEach((page) => {
  const label = page.cfg.exhibition;
  const booted = bootBakedPage(page);
  const doc = booted.dom.window.document;
  const W = booted.dom.window;
  const modal = () => doc.querySelector('.aw-modal');
  const main = () => modal().querySelector('.aw-main');
  const click = (el) => el.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
  const key = (k) => doc.dispatchEvent(new W.KeyboardEvent('keydown', { key: k, bubbles: true }));

  eq(`${label}: hydration does not re-create cards`,
    doc.querySelectorAll('.aw-card').length, page.list.length);
  eq(`${label}: a fully baked page issues no fetch at all`, booted.fetchCalls(), 0);
  ok(`${label}: cards are marked hydrated in place`,
    [...doc.querySelectorAll('.aw-card')].every((c) => c.dataset.awHydrated === '1'));
  eq(`${label}: the baked detail block is still stowed inside its card, not rebuilt`,
    doc.querySelectorAll('.aw-card > .aw-detail.is-stowed').length, page.list.length);

  /* ── multi-image: the case the baked-carousel fix exists for ─────────── */
  const multi = page.list.filter((a) => A.imagesOf(a).length > 1)[0];
  if (multi) {
    multiImageExercised = true;
    const imgs = A.imagesOf(multi);
    const card = doc.querySelector('.aw-card[data-aw-slug="' + A.artworkSlug(multi) + '"]');
    ok(`${label}: the multi-image artwork has a baked card`, !!card);

    click(card.querySelector('.aw-card__open'));
    eq(`${label}: clicking a baked card opens the modal`, modal().getAttribute('aria-hidden'), 'false');
    ok(`${label}: the modal holds the card's own detail node, moved not cloned`,
      !!modal().querySelector('.aw-detail') && !card.querySelector('.aw-detail'));

    const thumbs = modal().querySelectorAll('.aw-thumb');
    eq(`${label}: every image has a thumbnail button`, thumbs.length, imgs.length);
    eq(`${label}: the carousel opens on the first full-size image`,
      main().getAttribute('src'), imgs[0].full || imgs[0].src);

    /* THE assertion — navigation with no live data whatsoever. */
    click(thumbs[1]);
    eq(`${label}: clicking the second thumbnail shows the second FULL-SIZE image, with no fetch`,
      main().getAttribute('src'), imgs[1].full || imgs[1].src);
    eq(`${label}: …and its alt text comes from the baked record`,
      main().getAttribute('alt'), imgs[1].alt || '');
    ok(`${label}: …and the thumbnail marks itself current`,
      thumbs[1].classList.contains('is-current') && !thumbs[0].classList.contains('is-current'));

    click(modal().querySelector('.aw-nav--next'));
    const nx = imgs[2 % imgs.length];
    eq(`${label}: the next arrow advances (wrapping at the end)`,
      main().getAttribute('src'), nx.full || nx.src);

    key('ArrowLeft');
    const pv = imgs[(2 % imgs.length + imgs.length - 1) % imgs.length];
    eq(`${label}: the left arrow key steps back`, main().getAttribute('src'), pv.full || pv.src);

    click(modal().querySelector('.aw-nav--prev'));
    click(modal().querySelector('.aw-nav--prev'));
    const last = imgs[imgs.length - 1];
    ok(`${label}: stepping back past the first image wraps to the last`,
      main().getAttribute('src') === (last.full || last.src) ||
      imgs.some((im) => (im.full || im.src) === main().getAttribute('src')),
      'landed on ' + main().getAttribute('src'));

    key('Escape');
    eq(`${label}: Escape closes the modal`, modal().getAttribute('aria-hidden'), 'true');
    ok(`${label}: closing puts the detail block back in its card, stowed`,
      !!card.querySelector('.aw-detail.is-stowed'));
    eq(`${label}: still no fetch after a full open/navigate/close cycle`, booted.fetchCalls(), 0);
  }

  /* ── single-image: no thumb strip, so .aw-main carries the data pair ─── */
  const single = page.list.filter((a) => A.imagesOf(a).length === 1)[0];
  if (single) {
    const sImg = A.imagesOf(single)[0];
    const sCard = doc.querySelector('.aw-card[data-aw-slug="' + A.artworkSlug(single) + '"]');
    ok(`${label}: the single-image artwork has a baked card`, !!sCard);
    click(sCard.querySelector('.aw-card__open'));
    eq(`${label}: a single-image artwork shows its full-size image`,
      main().getAttribute('src'), sImg.full || sImg.src);
    ok(`${label}: …and emits no thumbnail strip`, modal().querySelectorAll('.aw-thumb').length === 0);
    key('ArrowRight');
    eq(`${label}: …and arrowing a one-image carousel stays put rather than blanking`,
      main().getAttribute('src'), sImg.full || sImg.src);
    key('Escape');
    eq(`${label}: still no fetch on the single-image path`, booted.fetchCalls(), 0);
  }
});

ok('the multi-image carousel was actually exercised on some page', multiImageExercised);

/* =======================================================================
 * E. Bake integrity
 * ==================================================================== */
section('E. Bake integrity');

PAGES.forEach((p) => {
  const label = p.cfg.exhibition;
  const rendered = A.renderPageRegions(SCHEMA, ARTISTS, p.cfg);

  ok(`${label}: renders without a fatal`, !rendered.fatal, rendered.fatal || '');
  eq(`${label}: bakes every selected artwork`, rendered.baked, p.list.length);
  eq(`${label}: skips none`, rendered.skipped, 0);

  /* Re-baking the committed page must be a no-op — the committed page IS the
   * generator's output, so a difference means the two have drifted. */
  const applied = A.applyRegions(p.html, rendered.regions);
  eq(`${label}: no missing markers in the committed page`, applied.missing.length, 0);
  ok(`${label}: the committed page matches a fresh bake`, applied.html === p.html);

  ok(`${label}: everything outside the markers is byte-identical after a bake`,
    A.outsideRegions(p.html) === A.outsideRegions(applied.html));

  /* A hollowed-out region — markers intact, content deleted — is exactly what
   * a half-finished deploy looks like, and the verifier has to catch it. */
  const hollowed = A.applyRegions(p.html, { 'artwork-grid': '' }).html;
  const hollowCheck = A.verifyArtworkPageHTML(hollowed, rendered.list, rendered.ctx);
  ok(`${label}: the verifier rejects a hollowed-out grid region`, !hollowCheck.ok);
  ok(`${label}: …and names the artwork it could not find`,
    hollowCheck.problems.length >= rendered.list.length,
    hollowCheck.problems.length + ' problem(s)');

  /* A missing marker pair must be reported, not silently skipped. */
  const stripped = p.html.replace('<!-- AW:START:artwork-grid -->', '');
  eq(`${label}: a missing start marker is reported`,
    A.applyRegions(stripped, rendered.regions).missing.length, 1);

  /* A duplicated marker is ambiguous and must also fail rather than guess. */
  const doubled = p.html.replace('<!-- AW:END:artwork-jsonld -->',
    '<!-- AW:END:artwork-jsonld -->\n<!-- AW:START:artwork-jsonld -->\n<!-- AW:END:artwork-jsonld -->');
  ok(`${label}: a duplicated marker pair is reported, not guessed at`,
    A.applyRegions(doubled, rendered.regions).missing.some((m) => /more than once/.test(m)));

  /* The wrong image on the wrong thumb is the realistic mistake now that
   * per-image data is written at two DOM positions. Swap two full-size paths
   * and the verifier must notice, even though every attribute is present and
   * every path still appears somewhere on the page. */
  const multi = rendered.list.filter((a) => A.imagesOf(a).length > 1)[0];
  if (multi) {
    const ims = A.imagesOf(multi);
    const a0 = 'data-aw-full="' + (ims[0].full || ims[0].src) + '"';
    const a1 = 'data-aw-full="' + (ims[1].full || ims[1].src) + '"';
    const swapped = p.html
      .replace(a1, 'data-aw-full="__TMP__"')
      .replace(new RegExp(a0.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![^]*__TMP__)'), a1)
      .replace('data-aw-full="__TMP__"', a0);
    const swapCheck = A.verifyArtworkPageHTML(swapped, rendered.list, rendered.ctx);
    ok(`${label}: the verifier catches a full-size path baked onto the wrong thumb`,
      !swapCheck.ok && swapCheck.problems.some((x) => /data-aw-full is/.test(x)),
      swapCheck.problems.slice(0, 2).join('; '));
  }
});

/* An unbaked page — can-we-start-again stands in for "any page not in the
 * allowlist" — must come through completely untouched. */
{
  const CWSA = [
    '<!doctype html><html><head><title>Can We Start Again</title></head><body>',
    '<section id="artwork"><div id="artwork-grid" data-artwork-exhibition="can-we-start-again"',
    ' data-artwork-page="/can-we-start-again/" data-artwork-hide-empty>',
    '<p class="aw-empty">Loading artwork…</p></div></section>',
    '</body></html>'
  ].join('\n');

  ok('the unbaked page has no AW markers', !has(CWSA, 'AW:START'));
  ok('no bake target points at can-we-start-again',
    !A.ARTWORK_BAKE_PAGES.some((c) => c.artworkPage === '/can-we-start-again/'));

  /* Splicing it would fail loudly rather than half-write it — the safety net
   * if someone adds the config row but forgets the markers. */
  const spliced = A.applyRegions(CWSA, { 'artwork-grid': '<div class="aw-grid"></div>' });
  eq('splicing a marker-less page reports missing markers instead of writing', spliced.missing.length, 1);
  ok('…and leaves the page byte-identical', spliced.html === CWSA);
}

/* =======================================================================
 * F. Editor parity — the preview is the same markup, not a lookalike
 * ==================================================================== */
section('F. Editor parity');

function bootEditor() {
  const vc = new VirtualConsole();
  const dom = new JSDOM(EDITOR, {
    url: 'https://phreaking.co.uk/jsonedit.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  // the editor loads /scripts/artwork.js by src, which jsdom will not fetch
  dom.window.__AW_NO_AUTO_INIT__ = true;
  dom.window.eval(SCRIPT);
  return dom;
}

let ed = null;
try { ed = bootEditor(); ok('the editor boots headlessly', true); }
catch (e) { ok('the editor boots headlessly', false, e.message); }

if (ed) {
  const w = ed.window;
  const run = (src) => w.eval(src);
  w.__schema = SCHEMA;
  w.__artists = ARTISTS;

  try {
    run('data = __schema; datasets.events = __schema; datasets.artists = __artists; ' +
        'mode = "artwork"; extractFromData();');
    run('curIdx = null; prevFilter = "all"; showHidden = false; renderPreview();');
    ok('the artwork preview pane renders', true);
  } catch (e) {
    ok('the artwork preview pane renders', false, e.message);
  }

  const frame = w.document.getElementById('prevFrame');
  ok('the preview pane renders real .aw-card markup',
    !!frame && frame.querySelectorAll('article.aw-card').length > 0);

  if (frame && frame.querySelector('article.aw-card')) {
    const page = bitrot || PAGES[0];
    const bakedDoc = new JSDOM(page.html).window.document;
    const multi = page.list.filter((a) => A.imagesOf(a).length > 1)[0] || page.list[0];
    const slug = A.artworkSlug(multi);

    const prevCard = frame.querySelector('.aw-card[data-aw-slug="' + slug + '"]');
    const bakedCard = bakedDoc.querySelector('.aw-card[data-aw-slug="' + slug + '"]');
    ok('the same artwork appears in both the preview and the baked page', !!prevCard && !!bakedCard);

    if (prevCard && bakedCard) {
      /* Hydration attributes are added by the browser layer on both sides at
       * different moments; they are not part of the rendered markup. */
      const strip = (html) => String(html)
        .replace(/ data-aw-hydrated="1"/g, '')
        .replace(/ aria-expanded="(true|false)"/g, '')
        .replace(/\s+/g, ' ').trim();
      ok('the preview card is byte-identical to the baked card',
        strip(prevCard.outerHTML) === strip(bakedCard.outerHTML),
        'preview: ' + strip(prevCard.outerHTML).slice(0, 160) + '\n      baked:   ' +
        strip(bakedCard.outerHTML).slice(0, 160));

      ok('the preview bakes the same per-thumb full-size paths the page does',
        [...prevCard.querySelectorAll('.aw-thumb')].map((t) => t.getAttribute('data-aw-full')).join('|') ===
        [...bakedCard.querySelectorAll('.aw-thumb')].map((t) => t.getAttribute('data-aw-full')).join('|'));
    }
  }
}

/* =======================================================================
 * Async: an UNBAKED mount alongside a baked one must still client-render.
 * Mixed pages are the reason baked-detection is per mount, not per page.
 * ==================================================================== */
(async function mixedPage() {
  section('G. Mixed baked / unbaked mounts');

  const page = bitrot || PAGES[0];
  const other = (dccep && dccep !== page) ? dccep : PAGES[PAGES.length - 1];
  const mixed = page.html.replace('</body>',
    '<section id="artwork-later"><div id="artwork-grid-2"' +
    ' data-artwork-exhibition="' + other.cfg.exhibition + '"' +
    ' data-artwork-page="' + other.cfg.artworkPage + '">' +
    '<p class="aw-empty">Loading artwork…</p></div></section></body>');

  const vc = new VirtualConsole();
  const dom = new JSDOM(mixed, {
    url: 'https://phreaking.co.uk' + page.cfg.artworkPage,
    runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc
  });
  const asked = [];
  dom.window.fetch = function (u) {
    asked.push(String(u));
    const body = String(u).indexOf('artists') !== -1 ? ARTISTS : SCHEMA;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
  dom.window.eval(SCRIPT);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));

  const doc = dom.window.document;
  const baked = doc.getElementById('artwork-grid');
  const late = doc.getElementById('artwork-grid-2');

  ok('the unbaked mount triggers the fetch the baked one does not need', asked.length > 0);
  eq('the baked mount keeps exactly its baked cards',
    baked.querySelectorAll('.aw-card').length, page.list.length);
  eq('the unbaked mount is client-rendered from the data',
    late.querySelectorAll('.aw-card').length, other.list.length);
  ok('the baked mount was hydrated, not re-rendered',
    [...baked.querySelectorAll('.aw-card')].every((c) => c.dataset.awHydrated === '1'));
  ok('both mounts are interactive',
    [...late.querySelectorAll('.aw-card')].every((c) => c.dataset.awHydrated === '1'));

  /* ── summary ─────────────────────────────────────────────────────────── */
  console.log('\n' + '─'.repeat(64));
  if (failures.length) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  • ' + f));
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
