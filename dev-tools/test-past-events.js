#!/usr/bin/env node
/* ===========================================================================
 * Past Events — headless regression suite (Node + jsdom, no browser)
 *
 * Lives in /dev-tools — NOT /scripts, since /scripts is served to the public
 * and this is a dev-only tool (it pulls in jsdom, which nobody's browser
 * needs). It tests the real, served files in place: /scripts/past-events.js,
 * /past-events/index.html, /json/schema.json, and the editor.
 *
 *   node dev-tools/test-past-events.js
 *
 * Run from the repo root. Override any path with an environment variable if
 * your layout differs:
 *   PE_SCRIPT=path/to/past-events.js
 *   PE_SCHEMA=path/to/schema.json
 *   PE_INDEX=path/to/past-events/index.html
 *   PE_EDITOR=path/to/jsonedit.html
 *
 * Sections:
 *   A. syntax           — node --check on past-events.js and every <script>
 *                         block extracted from jsonedit.html
 *   B. raw HTML         — THE important one: does the un-executed index.html
 *                         actually contain every event, and every Performance
 *                         Night act, as real text and real <img src>?
 *   C. structured data  — JSON-LD validity, typing, no internal fields;
 *                         microdata nesting; itemprop="image" on every image;
 *                         and that the microdata and the JSON-LD assert the
 *                         SAME fields — Google reads both independently, so a
 *                         gap between them reports one event twice
 *   D. hydration        — jsdom against the baked page: filtering, sorting,
 *                         modal open/close, lightbox, #slug deep-linking
 *   E. diagnostics      — malformed events are named and isolated; clean data
 *                         gives a clean summary; hand-authored regions survive
 *   F. legacy data      — `performances`-shaped JSON still renders, and the
 *                         editor migrates it to `subEvent` with no user action
 *   G. drift            — the baked page and the live render agree
 * ======================================================================== */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');
const { JSDOM, VirtualConsole } = require('jsdom');

// dev-tools/ sits one level below the repo root; every default path below is
// resolved from there, matching where these files actually live in the repo.
const ROOT = path.join(__dirname, '..');
const SCRIPT_PATH = process.env.PE_SCRIPT || path.join(ROOT, 'scripts', 'past-events.js');
const SCHEMA_PATH = process.env.PE_SCHEMA || path.join(ROOT, 'json', 'schema.json');
const INDEX_PATH = process.env.PE_INDEX || path.join(ROOT, 'past-events', 'index.html');
const EDITOR_PATH = process.env.PE_EDITOR || path.join(ROOT, 'jsonedit.html');

[SCRIPT_PATH, SCHEMA_PATH, INDEX_PATH, EDITOR_PATH].forEach((p) => {
  if (!fs.existsSync(p)) {
    console.error('Cannot find ' + p);
    console.error('Run this from the repo root, or set PE_SCRIPT / PE_SCHEMA / PE_INDEX / PE_EDITOR.');
    process.exit(1);
  }
});

const P = require(SCRIPT_PATH);
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const INDEX = fs.readFileSync(INDEX_PATH, 'utf8');
const EDITOR = fs.readFileSync(EDITOR_PATH, 'utf8');
const SCRIPT = fs.readFileSync(SCRIPT_PATH, 'utf8');

/* ── tiny harness ──────────────────────────────────────────────────────── */
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

/* Text of the raw HTML with all tags removed — what a crawler that does not
 * execute JavaScript is left holding. */
function rawText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const PN = SCHEMA['@graph'].find((e) => P.isPerfNight(e));
const PAST = P.pastEventsOf(SCHEMA);

/* =======================================================================
 * A. Syntax
 * ==================================================================== */
section('A. Syntax');

function nodeCheck(source, label) {
  const tmp = path.join(os.tmpdir(), 'pe-check-' + Math.random().toString(36).slice(2) + '.js');
  fs.writeFileSync(tmp, source);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    ok('node --check ' + label, true);
  } catch (e) {
    ok('node --check ' + label, false, String(e.stderr || e.message).split('\n').slice(0, 4).join('\n      '));
  } finally { fs.unlinkSync(tmp); }
}

nodeCheck(SCRIPT, 'past-events.js');

const inlineScripts = [];
EDITOR.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (m, body) => {
  inlineScripts.push(body); return m;
});
ok('jsonedit.html has inline <script> blocks to check', inlineScripts.length > 0);
inlineScripts.forEach((body, i) => nodeCheck(body, `jsonedit.html <script> #${i + 1}`));

ok('jsonedit.html loads the shared renderer',
  /<script src="\/scripts\/past-events\.js"><\/script>/.test(EDITOR));

/* =======================================================================
 * B. Raw HTML — the whole point of the exercise
 * ==================================================================== */
section('B. Raw HTML (zero JavaScript executed)');

const TEXT = rawText(INDEX);

ok('index.html contains real <article class="event-card"> elements',
  (INDEX.match(/<article class="event-card/g) || []).length === PAST.length,
  `expected ${PAST.length}, found ${(INDEX.match(/<article class="event-card/g) || []).length}`);

let missingNames = [], missingDesc = [], missingImgs = [];
PAST.forEach((ev) => {
  if (!has(TEXT, rawText(ev.name))) missingNames.push(ev.name);
  const cardText = (P.isPerfNight(ev) && ev.previewDescription) ? ev.previewDescription : ev.description;
  if (cardText && !has(TEXT, rawText(cardText).slice(0, 70))) missingDesc.push(ev.name);
  (ev.images || []).forEach((im) => {
    if (im.src && !has(INDEX, 'src="' + im.src + '"')) missingImgs.push(ev.name + ' → ' + im.src);
  });
});
ok('every past event name is in the raw markup', missingNames.length === 0, missingNames.join(', '));
ok('every card description is in the raw markup', missingDesc.length === 0, missingDesc.join(', '));
ok('every event image has a real <img src> in the raw markup', missingImgs.length === 0, missingImgs.slice(0, 5).join(', '));

/* Performance Night acts — the strictest requirement in the brief. */
const acts = P.actsOf(PN);
ok('the Performance Night has acts to check', acts.length === 6, 'found ' + acts.length);
ok('Performance Night full description is baked (not just the preview)',
  has(TEXT, rawText(PN.description).slice(0, 80)));
ok('Performance Night preview description is on the condensed card',
  has(TEXT, rawText(PN.previewDescription).slice(0, 60)));

let actProblems = [];
acts.forEach((a, i) => {
  if (a.title && !has(TEXT, rawText(a.title))) actProblems.push(`act ${i + 1} title "${a.title}"`);
  if (a.description && !has(TEXT, rawText(a.description).slice(0, 70))) actProblems.push(`act ${i + 1} description`);
  (a.images || []).forEach((im) => {
    if (im.src && !has(INDEX, 'src="' + im.src + '"')) actProblems.push(`act ${i + 1} image ${im.src}`);
  });
});
ok('every Performance Night act title, description and image is in the raw markup',
  actProblems.length === 0, actProblems.join(', '));

ok('act markup is real content, not an empty JS-filled container',
  (INDEX.match(/class="pn-perf"/g) || []).length === acts.length);

ok('the act detail block is never marked with the HTML `hidden` attribute — ' +
  'some text-extraction/summarisation tools specifically strip [hidden] content, ' +
  'and this is exactly the content that must not be stripped',
  !/<div class="pn-detail[^"]*"[^>]*\shidden(\s|>)/.test(INDEX));

ok('"Slow Impulse" + a named act are both findable in one raw-text search',
  has(TEXT, 'Slow Impulse') && has(TEXT, 'Genia Isachenko') && has(TEXT, 'The London Community Laptop Orchestra'));

ok('the renderer\'s own verifier agrees the page is complete',
  P.verifyBakedHTML(INDEX, SCHEMA).ok,
  P.verifyBakedHTML(INDEX, SCHEMA).problems.slice(0, 3).join('; '));

ok('section counts are baked, not left at 0',
  !/<div class="section-count"[^>]*>0 Events<\/div>/.test(INDEX));

const page = P.renderPage(SCHEMA);
Object.keys(page.counts).forEach((k) => {
  ok(`baked ${k} count matches the data (${page.counts[k]})`,
    has(INDEX, `>${page.counts[k]} Event${page.counts[k] === 1 ? '' : 's'}<`));
});

ok('no event content depends on a fetch: index.html carries the JSON-LD too',
  /<script type="application\/ld\+json">/.test(INDEX));

/* =======================================================================
 * C. Structured data
 * ==================================================================== */
section('C. Structured data');

const ldRaw = INDEX.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
let LD = null;
/* Hoisted out of the `if (LD)` block below: the microdata checks further down
 * compare themselves against the JSON-LD, and a parity check is only meaningful
 * if it can see both representations at once. Stays [] if the JSON-LD failed to
 * parse, in which case that failure is already reported above. */
let LD_EVENTS = [];
try { LD = JSON.parse(ldRaw[1].replace(/<\\\//g, '</')); ok('baked JSON-LD parses', true); }
catch (e) { ok('baked JSON-LD parses', false, e.message); }

if (LD) {
  eq('JSON-LD @context', LD['@context'], 'https://schema.org');
  ok('JSON-LD is a @graph array', Array.isArray(LD['@graph']));

  const flat = JSON.stringify(LD);
  ['"sortOrder"', '"cardColor"', '"visible"', '"pastEvents"', '"previewDescription"',
    '"displayDate"', '"exhibition"', '"eventCompletedUrl"', '"performances"', '"creditText"']
    .forEach((f) => ok('JSON-LD is free of internal field ' + f, !has(flat, f)));

  const ldEvents = LD['@graph'].filter((n) => /Event$/.test(String(n['@type'])) && n.startDate);
  LD_EVENTS = ldEvents;
  ok('JSON-LD contains every baked event', ldEvents.length >= page.baked, `${ldEvents.length} vs ${page.baked}`);

  const ISO = /^\d{4}(-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?)?$/;
  const badDates = ldEvents.filter((e) => !ISO.test(String(e.startDate)) || (e.endDate && !ISO.test(String(e.endDate))));
  ok('every JSON-LD date is valid ISO-8601', badDates.length === 0,
    badDates.slice(0, 3).map((e) => e.name + ': ' + e.startDate).join('; '));

  // Every event whose displayDate carries a day+month must get a full date;
  // the rest keep the bare year rather than having a day invented for them.
  const parseable = PAST.filter((e) => /(\d{1,2})(st|nd|rd|th)?\s+[A-Za-z]+/.test(String(e.displayDate || '')));
  const dated = ldEvents.filter((e) => /^\d{4}-\d{2}-\d{2}/.test(String(e.startDate)));
  eq('dates are sharpened exactly where displayDate supports it', dated.length, parseable.length);
  const yearOnly = ldEvents.filter((e) => /^\d{4}$/.test(String(e.startDate)));
  ok('events with no usable displayDate keep a bare year, with no invented day',
    yearOnly.length === ldEvents.length - parseable.length,
    `${yearOnly.length} year-only vs ${ldEvents.length - parseable.length} expected`);

  const badStatus = ldEvents.filter((e) => e.eventStatus && !/EventScheduled|EventCancelled|EventPostponed|EventRescheduled|EventMovedOnline/.test(e.eventStatus));
  ok('eventStatus uses a real schema.org EventStatusType member', badStatus.length === 0,
    badStatus.slice(0, 2).map((e) => e.eventStatus).join('; '));

  const ldPn = ldEvents.find((e) => e.name === PN.name);
  ok('the Performance Night is a typed subEvent graph', !!ldPn && Array.isArray(ldPn.subEvent));
  if (ldPn && ldPn.subEvent) {
    eq('every act is present as a subEvent', ldPn.subEvent.length, P.actsOf(PN).length);
    ok('acts are typed PerformingArtsEvent',
      ldPn.subEvent.every((s) => s['@type'] === 'PerformingArtsEvent'));
    ok('acts carry a name and a superEvent back-reference',
      ldPn.subEvent.every((s) => s.name && s.superEvent && s.superEvent['@id']));
  }

  const withPerformer = ldEvents.filter((e) => e.performer);
  ok('performers are objects or @id references, never bare strings',
    withPerformer.every((e) => [].concat(e.performer).every((p) => p && typeof p === 'object')));

  const soloCreditTexts = SCHEMA['@graph'].filter((e) =>
    e.pastEvents && e.creditText && !/various|,|&|\band\b|\+/i.test(e.creditText));
  ok('the fixture actually has solo-name creditText entries to check', soloCreditTexts.length > 0);
  const mistyped = soloCreditTexts.filter((e) => {
    const n = ldEvents.find((x) => x.name === e.name);
    return n && n.performer && n.performer['@type'] !== 'Person';
  });
  ok('a single named individual credited via creditText is typed Person, not PerformingGroup',
    mistyped.length === 0,
    mistyped.map((e) => e.creditText).join(', '));

  const groupCredit = ldEvents.find((e) => e.performer && e.performer.name === 'Various Artists');
  ok('an actual collective credit ("Various Artists") is still typed PerformingGroup',
    !!groupCredit && groupCredit.performer['@type'] === 'PerformingGroup');

  /* Root Cause A. `location` is required by Google's Event validator, and an
   * event with neither a `location` object nor a `venue` string used to get
   * none at all — ~19 critical errors in Search Console. locationOf() now falls
   * back to the collective's own address, so this holds for every event
   * regardless of what anyone typed into the editor. */
  ok('every baked event has a location in JSON-LD', ldEvents.every((e) => !!e.location));

  const places = ldEvents.filter((e) => e.location);
  ok('every location is a typed Place',
    places.every((e) => e.location['@type'] === 'Place'),
    'venue is now schema.org location');
  ok('every JSON-LD location carries a name',
    places.every((e) => !!e.location.name));

  /* Acts inherit the parent night's location via actNode(); called out
   * separately because that inheritance is what silently produced a further 6
   * flagged items once the parent's own location was missing. */
  const ldActs = ldEvents.reduce((acc, e) => acc.concat(e.subEvent || []), []);
  ok('the fixture has JSON-LD acts to check', ldActs.length > 0);
  ok('every JSON-LD act inherits a location from its parent night',
    ldActs.every((a) => !!a.location));

  // A node is "defined" wherever it appears with an @type — including inline,
  // e.g. subEvent acts or the WebSite under isPartOf. A bare {"@id": …} is a
  // reference and must point at one of those.
  const defined = new Set();
  const refs = [];
  (function walk(n) {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (n['@id']) (n['@type'] ? defined : { add: () => refs.push(n['@id']) }).add(n['@id']);
    Object.keys(n).forEach((k) => walk(n[k]));
  })(LD['@graph']);
  const dangling = [...new Set(refs.filter((id) => !defined.has(id)))];
  ok('every @id reference resolves inside the graph', dangling.length === 0,
    dangling.slice(0, 4).join(', '));
}

/* Microdata in the baked cards */
const dom0 = new JSDOM(INDEX);
const doc0 = dom0.window.document;

const allCardImgs = [...doc0.querySelectorAll('.event-card .image-row:not(.pn-preview-row) img')];
ok('every image in a card row carries itemprop="image"',
  allCardImgs.length > 0 && allCardImgs.every((i) => i.getAttribute('itemprop') === 'image'),
  allCardImgs.filter((i) => i.getAttribute('itemprop') !== 'image').length + ' without');

const rowsOf3 = [...doc0.querySelectorAll('.event-card .image-row:not(.pn-preview-row)')]
  .filter((r) => r.querySelectorAll('img').length > 1);
ok('multi-image rows mark every image, not only the first',
  rowsOf3.length > 0 && rowsOf3.every((r) => [...r.querySelectorAll('img')].every((i) => i.hasAttribute('itemprop'))));

const performerNodes = [...doc0.querySelectorAll('[itemprop="performer"]')];
ok('performer credits exist as microdata', performerNodes.length > 0);
ok('every performer is a properly scoped Person/Organization container',
  performerNodes.every((n) => n.hasAttribute('itemscope') && /schema\.org\/(Person|Organization|PerformingGroup)/.test(n.getAttribute('itemtype') || '')),
  performerNodes.filter((n) => !n.hasAttribute('itemscope')).length + ' without itemscope');

ok('performer names sit inside the performer scope, not loose in the Event',
  performerNodes.every((n) => n.querySelector('[itemprop="name"]')));

const aboutNodes = [...doc0.querySelectorAll('[itemprop~="about"]')];
ok('exhibition tie-in is a scoped ExhibitionEvent, not a bare itemprop on a link',
  aboutNodes.length > 0 && aboutNodes.every((n) => n.hasAttribute('itemscope')));

const subEventNodes = [...doc0.querySelectorAll('[itemprop="subEvent"]')];
eq('acts are subEvent microdata inside the card', subEventNodes.length, P.actsOf(PN).length);
ok('act microdata sits inside the Performance Night card\'s own itemscope',
  subEventNodes.every((n) => n.closest('.event-card.pn-card')));

/* ── Microdata ↔ JSON-LD parity (Root Cause B) ─────────────────────────────
 * Google's Rich Results parser reads the JSON-LD and the inline microdata
 * independently, for the same real-world event. Whichever is less complete gets
 * reported as a second, broken copy of that event — which is what produced
 * every "same act appears twice, once clean, once with 2 critical + 5
 * non-critical issues" entry in Search Console.
 *
 * These compare microdata counts against the JSON-LD rather than against
 * hard-coded numbers, so they keep holding as events are added.
 *
 * The ExhibitionEvent series nodes ("BitRot", "Does Cloud Compute?") are in
 * ldEvents but are not cards — they are referenced series, rendered as a
 * scoped `about`/`superEvent` inside a card, not as an <article> of their own.
 * Excluded here so card-for-card comparisons line up. */
const ldCards = LD_EVENTS.filter((e) => String(e['@type']) !== 'ExhibitionEvent');
eq('the JSON-LD card nodes and the baked articles are the same population',
  ldCards.length, doc0.querySelectorAll('.event-card').length);

/* NOTE the `>` combinator. Each act now carries its own [itemprop="location"]
 * nested inside the card (.pn-detail → … → .pn-perf), so a descendant selector
 * would count cards *and* acts and over-report. The card's own location scope
 * is emitted as part of the meta block, which is the first direct child of the
 * <article> — so the DOM structure itself keeps the two apart, with no
 * :not()/closest() filtering needed. */
const cardLocationMeta = [...doc0.querySelectorAll('.event-card > [itemprop="location"]')];
eq('every card with a JSON-LD location also has it in microdata',
  cardLocationMeta.length, ldCards.filter((e) => e.location).length);
ok('every card location scope is a typed Place carrying a name',
  cardLocationMeta.every((n) => /schema\.org\/Place/.test(n.getAttribute('itemtype') || '') &&
    n.querySelector('[itemprop="name"]')));

const cardOrganizerMeta = [...doc0.querySelectorAll('.event-card > [itemprop="organizer"]')];
eq('every card with a JSON-LD organizer also has it in microdata',
  cardOrganizerMeta.length, ldCards.filter((e) => e.organizer).length);
ok('the card organizer is a scoped Organization with a name and url',
  cardOrganizerMeta.every((n) => n.hasAttribute('itemscope') &&
    /schema\.org\/Organization/.test(n.getAttribute('itemtype') || '') &&
    n.querySelector('[itemprop="name"]') && n.querySelector('[itemprop="url"]')));

/* `offers` is optional in Google's validator, unlike location — so the test is
 * parity, not presence. An event that genuinely had no ticketing must not have
 * one invented for it, and one that has an Offer in JSON-LD must not be missing
 * it from the microdata. */
const cardOffersMeta = [...doc0.querySelectorAll('.event-card > [itemprop="offers"]')];
eq('cards carry offers microdata exactly where the JSON-LD does — no more, no less',
  cardOffersMeta.length, ldCards.filter((e) => e.offers).length);
ok('the fixture has both kinds of event to make that meaningful',
  cardOffersMeta.length > 0 && cardOffersMeta.length < ldCards.length,
  cardOffersMeta.length + ' of ' + ldCards.length + ' cards have an offer');
ok('every offers scope is a typed Offer',
  cardOffersMeta.every((n) => /schema\.org\/Offer/.test(n.getAttribute('itemtype') || '')));

/* Per-act microdata used to carry name/performer/description/image and nothing
 * else, while the JSON-LD subEvent for the same act carried dates, status,
 * attendance mode and location. Each act now states its own. */
const actCount = P.actsOf(PN).length;
['eventStatus', 'eventAttendanceMode', 'startDate'].forEach((prop) => {
  eq('every act carries ' + prop + ' in its own microdata, not just JSON-LD',
    doc0.querySelectorAll('.pn-perf meta[itemprop="' + prop + '"]').length, actCount);
});
eq('every act carries its own location scope, not just JSON-LD',
  doc0.querySelectorAll('.pn-perf [itemprop="location"]').length, actCount);

/* acts intentionally carry no endDate in JSON-LD — see actNode(), which sets
 * only startDate on the subEvent node. The act microdata does emit endDate when
 * the night has one, so this direction is deliberately not a parity check:
 * microdata asserting more than the JSON-LD is not a validation error, and
 * widening actNode()'s output was out of scope. Not an oversight. */
const actEndDates = doc0.querySelectorAll('.pn-perf meta[itemprop="endDate"]').length;
ok('act endDate is present in microdata where the night has one (JSON-LD asserts none, by design)',
  actEndDates === 0 || actEndDates === actCount,
  actEndDates + ' of ' + actCount + ' acts — expected all or none, matching the parent night');

/* Fix A has to be a renderer fallback, not per-event data entry: the whole
 * point is that a newly-created event cannot silently lack a location again. */
ok('locationOf() falls back to a real named Place for an event with no location data',
  !!(P.locationOf({ name: 'Untitled', startDate: '2026' }) || {}).name);
ok('an explicit location still wins over the fallback',
  P.locationOf({ location: { '@type': 'Place', name: 'ANNEX by The Koppel Project' } }).name ===
    'ANNEX by The Koppel Project');
ok('a legacy `venue` string still wins over the fallback',
  P.locationOf({ venue: 'Somewhere Else' }).name === 'Somewhere Else');

/* =======================================================================
 * D. Hydration against the baked page
 * ==================================================================== */
section('D. Hydration (jsdom, baked HTML + past-events.js)');

function bootPage(hash) {
  const vc = new VirtualConsole();
  const dom = new JSDOM(INDEX, {
    url: 'https://phreaking.co.uk/past-events/' + (hash || ''),
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  dom.window.eval(SCRIPT);
  // jsdom is still parsing when we eval, so autoInit() registers a
  // DOMContentLoaded listener rather than running. Fire it, as a browser would.
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true }));
  return dom;
}

let dom = bootPage();
let doc = dom.window.document;
const W = dom.window;

ok('hydration does not re-create cards (no fetch needed)',
  doc.querySelectorAll('.event-card').length === PAST.length);
ok('hydration marks the document as JS-capable', doc.documentElement.classList.contains('js') ||
  doc.querySelectorAll('.pn-detail.pn-detail--stowed').length > 0);

/* filtering */
const talksBtn = doc.querySelector('.filter-btn[data-filter="talks"]');
talksBtn.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
ok('filter: clicking Talks hides the other sections',
  doc.querySelector('#section-talks').classList.contains('hidden') === false &&
  doc.querySelector('#section-workshops').classList.contains('hidden') === true);
eq('filter: aria-selected follows the active tab', talksBtn.getAttribute('aria-selected'), 'true');

doc.querySelector('.filter-btn[data-filter="all"]').dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
ok('filter: All restores every section',
  [...doc.querySelectorAll('.category-section')].every((s) => !s.classList.contains('hidden')));

/* sorting */
const stack = doc.querySelector('#section-talks .event-stack');
const keysOf = () => [...stack.children].map((c) => parseFloat(c.dataset.chronoKey));
const descending = keysOf();
ok('baked order is newest-first by default',
  descending.every((k, i) => i === 0 || descending[i - 1] >= k), JSON.stringify(descending));

const sortBtn = doc.getElementById('sort-btn');
sortBtn.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
const ascending = keysOf();
ok('sort: one click flips to oldest-first',
  ascending.every((k, i) => i === 0 || ascending[i - 1] <= k), JSON.stringify(ascending));
eq('sort: the button label follows', sortBtn.textContent.trim(), 'Sort: Oldest First ↑');
sortBtn.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
ok('sort: a second click returns to newest-first',
  JSON.stringify(keysOf()) === JSON.stringify(descending));

/* Performance Night modal */
const pnCard = doc.querySelector('.event-card.pn-card');
ok('the Performance Night card is present and focusable',
  pnCard && pnCard.getAttribute('role') === 'button' && pnCard.getAttribute('tabindex') === '0');
eq('condensed card shows the Performance Night badge',
  pnCard.querySelector('.event-type').textContent.trim(), 'Performance Night');
eq('condensed card keeps its per-card background', pnCard.style.background.replace(/\s/g, ''),
  'rgb(66,23,0)');
eq('condensed card shows three preview thumbnails',
  pnCard.querySelectorAll('.pn-preview-row img').length, 3);
ok('condensed card shows the preview description, not the full one',
  pnCard.querySelector('.event-description').textContent.trim().startsWith(PN.previewDescription.trim().slice(0, 40)));
ok('the detail block is baked inside the card and visually stowed for JS users',
  pnCard.querySelector('.pn-detail') && pnCard.querySelector('.pn-detail').classList.contains('pn-detail--stowed'));
ok('…via a CSS class, not the semantic `hidden` attribute some text extractors strip',
  !pnCard.querySelector('.pn-detail').hasAttribute('hidden'));

pnCard.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
let modal = doc.querySelector('.pn-modal');
ok('modal: opens on card click', modal && modal.getAttribute('aria-hidden') === 'false');
eq('modal: title', modal.querySelector('.pn-modal__title').textContent.trim(), PN.name);
eq('modal: badge', modal.querySelector('.pn-modal__label').textContent.trim(), 'Performance Night');
eq('modal: date top-right', modal.querySelector('.pn-modal__day').textContent.trim(), 'Sunday 12th July');
eq('modal: time top-right', modal.querySelector('.pn-modal__time').textContent.trim(), '18:00–22:00');
ok('modal: poster and description are laid out side by side',
  modal.querySelector('.pn-modal__intro .pn-modal__poster') && modal.querySelector('.pn-modal__intro .pn-modal__desc'));
ok('modal: shows the FULL description, not the preview',
  modal.querySelector('.pn-modal__desc').textContent.indexOf(PN.description.slice(0, 60)) !== -1);
eq('modal: every act is listed in order', modal.querySelectorAll('.pn-perf').length, P.actsOf(PN).length);
ok('modal: act titles/artists/descriptions/images are all there',
  P.actsOf(PN).every((a, i) => {
    const s = modal.querySelectorAll('.pn-perf')[i];
    return s.textContent.indexOf(a.title) !== -1 &&
      (!a.description || s.textContent.indexOf(a.description.trim().slice(0, 40)) !== -1) &&
      s.querySelectorAll('img').length === (a.images || []).length;
  }));
eq('modal: url gains the deep-link hash', dom.window.location.hash, '#slow-impulse');

modal.querySelector('.pn-modal__close').dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
eq('modal: closes on the close button', modal.getAttribute('aria-hidden'), 'true');
ok('modal: the detail block goes back into its card',
  pnCard.querySelector('.pn-detail') !== null && pnCard.querySelector('.pn-detail').classList.contains('pn-detail--stowed'));

pnCard.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
doc.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
eq('modal: closes on Escape', doc.querySelector('.pn-modal').getAttribute('aria-hidden'), 'true');

pnCard.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
eq('modal: opens from the keyboard', doc.querySelector('.pn-modal').getAttribute('aria-hidden'), 'false');
doc.querySelector('.pn-modal__backdrop').dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
eq('modal: backdrop click dismisses', doc.querySelector('.pn-modal').getAttribute('aria-hidden'), 'true');

/* lightbox */
const firstFigure = doc.querySelector('#section-talks .event-card .image-row figure');
firstFigure.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
const lb = doc.querySelector('.pc-lightbox');
eq('lightbox: opens from a card thumbnail', lb.getAttribute('aria-hidden'), 'false');
ok('lightbox: shows the full-size source',
  lb.querySelector('.pc-lightbox__img').getAttribute('src') === firstFigure.querySelector('img').dataset.full);
const shown = lb.querySelector('.pc-lightbox__img').getAttribute('src');
doc.querySelector('.pc-lightbox__next').dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
ok('lightbox: next advances', lb.querySelector('.pc-lightbox__img').getAttribute('src') !== shown);
doc.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
eq('lightbox: Escape closes', lb.getAttribute('aria-hidden'), 'true');

/* a Performance Night preview thumbnail opens the card, not the lightbox */
const dom2 = bootPage();
const doc2 = dom2.window.document;
doc2.querySelector('.pn-preview-row figure').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }));
eq('Performance Night preview thumbs open the modal, not the lightbox',
  doc2.querySelector('.pc-lightbox').getAttribute('aria-hidden'), 'true');
eq('…and the modal did open', doc2.querySelector('.pn-modal').getAttribute('aria-hidden'), 'false');

/* deep-linking */
const dom3 = bootPage('#slow-impulse');
eq('deep link /#slow-impulse opens that modal on load',
  dom3.window.document.querySelector('.pn-modal').getAttribute('aria-hidden'), 'false');

const dom4 = bootPage('#event-slow-impulse');
eq('deep link /#event-slow-impulse (the @id form) also opens it',
  dom4.window.document.querySelector('.pn-modal').getAttribute('aria-hidden'), 'false');

const dom5 = bootPage('#workshops');
ok('a filter hash still filters rather than being read as a slug',
  dom5.window.document.querySelector('#section-workshops').classList.contains('hidden') === false &&
  dom5.window.document.querySelector('#section-talks').classList.contains('hidden') === true);

/* other event types unchanged */
const dom6 = bootPage();
const doc6 = dom6.window.document;
['talks', 'workshops', 'performances', 'screenings'].forEach((k) => {
  const cards = doc6.querySelectorAll('#section-' + k + ' .event-card');
  ok(`${k}: cards render with badge, title and credit line`,
    cards.length > 0 && [...cards].every((c) =>
      c.querySelector('.event-type') && c.querySelector('h3') && c.querySelector('.event-credit')));
});
ok('non-Performance-Night cards are not clickable dialogs',
  [...doc6.querySelectorAll('.event-card:not(.pn-card)')].every((c) => !c.hasAttribute('role')));
ok('BitRot events still show the series tag',
  doc6.querySelectorAll('.event-series').length > 0);
ok('completed-event links survive', doc6.querySelectorAll('.event-link a').length > 0);

/* =======================================================================
 * E. Diagnostics
 * ==================================================================== */
section('E. Bake diagnostics');

function clone(o) { return JSON.parse(JSON.stringify(o)); }

const clean = P.renderPage(SCHEMA);
eq('a fully valid push bakes every event', clean.baked, PAST.length);
eq('…and skips none', clean.skipped, 0);
eq('…and reports no errors', clean.errors.length, 0);
ok('…and is not fatal', clean.fatal === null);

/* one deliberately broken event */
const broken = clone(SCHEMA);
const VICTIM_ID = 'https://phreaking.co.uk/past-events#event-cloud-watching';
const victim = broken['@graph'].find((e) => e['@id'] === VICTIM_ID);
ok('the diagnostics fixture targets a real event', !!victim, VICTIM_ID);
victim.name = '';
const brokenPage = P.renderPage(broken);
ok('a malformed event does not take the whole page down', brokenPage.fatal === null);
eq('…it is skipped', brokenPage.skipped, 1);
eq('…and everything else still bakes', brokenPage.baked, PAST.length - 1);
ok('…and the error names the specific event',
  brokenPage.errors.length > 0 && /event-cloud-watching|index/.test(brokenPage.errors[0]),
  brokenPage.errors[0]);
ok('…and the rest of the page is intact, not blanked',
  brokenPage.regions['pe-talks'].length > 1000 && has(brokenPage.regions['pe-workshops'], 'event-card'));

/* a broken act inside a Performance Night */
const brokenAct = clone(SCHEMA);
const bpn = brokenAct['@graph'].find((e) => P.isPerfNight(e));
bpn.subEvent = 'not an array';
const brokenActPage = P.renderPage(brokenAct);
ok('malformed act data is caught and named',
  brokenActPage.errors.some((e) => /Slow Impulse|slow-impulse/.test(e)),
  JSON.stringify(brokenActPage.errors.slice(0, 2)));

/* missing image src */
const noSrc = clone(SCHEMA);
noSrc['@graph'].find((e) => e.pastEvents && (e.images || []).length).images[0].src = '';
const noSrcPage = P.renderPage(noSrc);
ok('an image with no src is reported specifically',
  noSrcPage.errors.concat(noSrcPage.warnings).some((m) => /image 1/.test(m)),
  JSON.stringify(noSrcPage.errors.slice(0, 2)));

/* missing alt = warning only, still baked */
const noAlt = clone(SCHEMA);
const altVictim = noAlt['@graph'].find((e) => e.pastEvents && (e.images || []).length && e.images[0].alt);
altVictim.images[0].alt = '';
const noAltPage = P.renderPage(noAlt);
eq('a missing alt is a warning, not a skip', noAltPage.baked, PAST.length);
ok('…and it is still reported',
  noAltPage.warnings.some((w) => has(w, altVictim.name) && /alt/.test(w)));

/* alt-text coverage — every baked image must describe itself */
const altless = [];
PAST.forEach((ev) => {
  (ev.images || []).forEach((im, i) => {
    if (!String(im.alt || '').trim()) altless.push(`${ev.name} image ${i + 1}`);
  });
  P.actsOf(ev).forEach((a, ai) => {
    (a.images || []).forEach((im, i) => {
      if (!String(im.alt || '').trim()) altless.push(`${ev.name} act ${ai + 1} image ${i + 1}`);
    });
  });
});
ok('every image in schema.json carries alt text', altless.length === 0,
  altless.slice(0, 5).join(', '));
/* The lightbox shell's placeholder <img src="" alt=""> is excluded: it is
   empty until JS fills both attributes on open, so a blank alt is correct. */
const bakedImgs = [...doc0.querySelectorAll('.event-card img')];
const emptyAlt = bakedImgs.filter((i) => !String(i.getAttribute('alt') || '').trim());
ok('no baked card image ships an empty alt attribute', emptyAlt.length === 0,
  emptyAlt.length + ' empty of ' + bakedImgs.length);
ok('a clean push reports zero warnings',
  clean.warnings.length === 0, clean.warnings.slice(0, 3).join('; '));

/* near-duplicate description content — a warning, never an edit.
   Tested against a constructed fixture rather than real data: production
   schema.json should stay clean, so the check must not depend on an actual
   event being broken to prove it works. */
const dupFixture = clone(SCHEMA);
const dupTarget = dupFixture['@graph'].find((e) => e.pastEvents && e.description);
const dupOriginal = dupTarget.description;
dupTarget.description = dupOriginal +
  '\n\n' + dupOriginal.split(/[.!?]\s/).slice(0, 2).join('. ') + '.';
const dupPage = P.renderPage(dupFixture);
const dupWarnings = dupPage.warnings.filter((w) => /repeats itself/.test(w));
ok('a near-duplicate paragraph is caught even when it opens with the same words',
  dupWarnings.length === 1 && has(dupWarnings[0], dupTarget.name),
  JSON.stringify(dupWarnings));
ok('the duplicate-content check is a warning, not an error — it still bakes',
  dupPage.errors.every((e) => !/repeats itself/.test(e)) && dupPage.baked === PAST.length);
ok('the diagnostic never rewrites the description — the duplicate is baked verbatim',
  Object.values(dupPage.regions).join('').split(P.esc(dupOriginal.slice(0, 60))).length - 1 >= 1);

/* a paraphrase that merely shares a topic must NOT trip the check */
const paraFixture = clone(SCHEMA);
const paraTarget = paraFixture['@graph'].find((e) => e.pastEvents && e.description);
paraTarget.description = 'The session opened with a long discussion of networked sound and ' +
  'improvised electronics across several decades of practice in London.' +
  '\n\nAfterwards the group shared a meal and talked about funding, venues, ' +
  'and how difficult it has become to book affordable rehearsal rooms nearby.';
ok('two genuinely different paragraphs do not false-positive',
  P.renderPage(paraFixture).warnings.every((w) => !/repeats itself/.test(w)));

/* and the real dataset is clean */
ok('the committed schema.json has no duplicated descriptions left',
  clean.warnings.every((w) => !/repeats itself/.test(w)),
  clean.warnings.filter((w) => /repeats itself/.test(w)).join('; '));

/* total failure blocks the push */
const allBad = clone(SCHEMA);
allBad['@graph'].forEach((e) => { if (e.pastEvents) e.name = ''; });
ok('if nothing can be rendered the push is blocked outright',
  typeof P.renderPage(allBad).fatal === 'string');
ok('no @graph at all is fatal, not silent', typeof P.renderPage({}).fatal === 'string');

/* markers */
section('E2. The generator stays inside its markers');

const HAND = '<!-- HAND-AUTHORED CANARY: do not touch -->';
const seeded = INDEX
  .replace('<!-- PE:START:pe-talks -->', HAND + '\n<!-- PE:START:pe-talks -->')
  .replace('<!-- PE:END:pe-talks -->', '<!-- PE:END:pe-talks -->\n' + HAND)
  .replace('<!-- PE:START:pe-jsonld -->', HAND + '\n  <!-- PE:START:pe-jsonld -->');

const applied = P.applyRegions(seeded, clean.regions);
eq('no markers are reported missing', applied.missing.length, 0);
eq('hand-authored content adjacent to markers survives',
  (applied.html.match(/HAND-AUTHORED CANARY/g) || []).length, 3);
eq('everything outside the markers is byte-identical',
  P.outsideRegions(seeded), P.outsideRegions(applied.html));

['<title>Past Events — Phreaking Collective</title>', 'rel="canonical"', 'og:image',
  'data-sidebar-src', 'Archive summary for search engines', 'class="site-footer"',
  'pc-lightbox__caption', 'A growing archive of talks']
  .forEach((frag) => ok('hand-authored fragment preserved: ' + frag.slice(0, 40), has(applied.html, frag)));

const noMarkers = INDEX.replace(/<!-- PE:(START|END):pe-talks -->/g, '');
ok('missing markers are refused, not guessed at',
  P.applyRegions(noMarkers, clean.regions).missing.length > 0);

/* re-baking is stable */
const twice = P.applyRegions(P.applyRegions(INDEX, clean.regions).html, clean.regions).html;
eq('baking twice is idempotent', twice, P.applyRegions(INDEX, clean.regions).html);

/* verification catches a hollowed-out page */
const hollow = P.applyRegions(INDEX, Object.assign({}, clean.regions, { 'pe-performances': '' })).html;
ok('verifyBakedHTML catches content that silently vanished',
  !P.verifyBakedHTML(hollow, SCHEMA).ok);

/* =======================================================================
 * F. Legacy `performances` data
 * ==================================================================== */
section('F. Legacy data + migration');

const legacy = clone(SCHEMA);
const lpn = legacy['@graph'].find((e) => P.isPerfNight(e));
lpn.performances = P.actsOf(lpn).map((a) => ({
  title: a.title, artists: a.artists, description: a.description, images: a.images,
}));
delete lpn.subEvent;
lpn.label = 'experimental performance night';   // the legacy badge too

ok('the legacy badge is still recognised as a Performance Night', P.isPerfNight(lpn));
eq('legacy acts are read through the same accessor', P.actsOf(lpn).length, 6);

const legacyPage = P.renderPage(legacy);
eq('legacy-shaped JSON bakes without error', legacyPage.errors.length, 0);
const legacyHtml = legacyPage.regions['pe-performances'];
ok('legacy acts render identically',
  P.actsOf(lpn).every((a) => has(legacyHtml, P.esc(a.title))));
ok('legacy acts still emit subEvent microdata',
  (legacyHtml.match(/itemprop="subEvent"/g) || []).length === 6);
ok('legacy badge is displayed as the current "Performance Night" label',
  has(legacyHtml, '>Performance Night<'));

const legacyLd = legacyPage.jsonLd['@graph'].find((n) => n.name === lpn.name);
ok('legacy data still produces a typed subEvent graph',
  Array.isArray(legacyLd.subEvent) && legacyLd.subEvent.length === 6);
ok('the legacy `performances` key never reaches the JSON-LD',
  !has(JSON.stringify(legacyPage.jsonLd), '"performances"'));

/* the editor migrates it in memory, with no user action */
section('F2. Editor migration (jsdom)');

function bootEditor() {
  const vc = new VirtualConsole();
  const dom = new JSDOM(EDITOR, {
    url: 'https://phreaking.co.uk/jsonedit.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  // the editor loads /scripts/past-events.js by src, which jsdom will not fetch
  dom.window.eval(SCRIPT);
  return dom;
}

let ed;
try { ed = bootEditor(); ok('the editor boots headlessly', true); }
catch (e) { ok('the editor boots headlessly', false, e.message); }

if (ed) {
  const w = ed.window;
  // The editor's script declares its state with let/const, so it lives in the
  // global lexical scope rather than on `window`; reach it through eval.
  const run = (src) => w.eval(src);

  /* ── One definition of the collective's own address ──────────────────────
   * locationOf() falls back to homePlace() so no event can be published
   * without a location. The editor writes the same object into `location` when
   * the Venue field is cleared. Two literals would drift — and drift here is
   * invisible, because both halves would still validate while quietly
   * disagreeing about where the events happened. The editor therefore
   * delegates, and this asserts it. */
  ok('the editor takes HOME_VENUE from the shared renderer',
    run('HOME_VENUE') === P.HOME_VENUE, run('HOME_VENUE') + ' vs ' + P.HOME_VENUE);
  ok('the editor takes the home address from the shared renderer, not a second copy',
    JSON.stringify(run('homePlace()')) === JSON.stringify(P.homePlace()),
    JSON.stringify(run('homePlace()')));
  ok('jsonedit.html contains no second copy of the postal address',
    !/addressLocality/.test(EDITOR),
    'the editor should reach the address through PastEventsRender.homePlace()');

  w.__fixture = clone(legacy);
  run('data = __fixture; datasets.events = data; mode = "events";');

  let migrated = true;
  try { run('extractFromData();'); } catch (e) { migrated = false; }
  ok('extractFromData runs on load (no user action)', migrated);

  /* The whole point of this section: loading a file must not rewrite it.
   * Migration is detected here — surfaced to the person — but nothing in
   * `data` changes until they actually open the specific record. */
  const preOpen = run('data["@graph"].find(e => isPerfNight(e))');
  ok('loading legacy data does NOT migrate it — `performances` survives untouched',
    Array.isArray(preOpen.performances) && preOpen.performances.length === 6);
  ok('…and `subEvent` is not created on load', !('subEvent' in preOpen));
  eq('…and the legacy label is not rewritten on load', preOpen.label, 'experimental performance night');
  ok('a load-only session has nothing to push that a person did not touch',
    JSON.stringify(run('data["@graph"].find(e => isPerfNight(e))')) === JSON.stringify(preOpen));

  const summary = run('lastMigration');
  eq('the outstanding-migration count is detected correctly (acts)', summary.acts, 1);
  eq('the outstanding-migration count is detected correctly (labels)', summary.labels, 1);
  eq('…without needing to touch venues for this fixture', summary.venues, 0);

  /* Now simulate actually opening that one record — the real trigger. */
  const pnIndex = run('data["@graph"].findIndex(e => isPerfNight(e))');
  run(`curIdx = ${pnIndex}; buildForm();`);

  const ev = run('data["@graph"].find(e => isPerfNight(e))');
  ok('opening the record migrates `performances` to `subEvent`', Array.isArray(ev.subEvent));
  ok('…and the legacy key is removed', !('performances' in ev));
  eq('…with every act preserved', ev.subEvent.length, 6);
  ok('…renamed to the schema.org `name` field', ev.subEvent.every((a) => typeof a.name === 'string' && a.name));
  ok('…and typed', ev.subEvent.every((a) => a['@type'] === 'PerformingArtsEvent'));
  ok('…keeping every act image', ev.subEvent.every((a) => Array.isArray(a.images)));
  eq('the legacy badge is normalised, same touch-point as the acts', ev.label, 'Performance Night');

  /* A second, never-opened legacy record must stay exactly as it was —
   * this is the actual blast-radius guarantee, not just "migration works". */
  const untouched = clone(legacy);
  const secondPn = clone(untouched['@graph'].find((e) => P.isPerfNight(e)));
  secondPn['@id'] += '-2'; secondPn.name += ' (second)';
  untouched['@graph'].push(secondPn);
  w.__fixture2 = untouched;
  run('data = __fixture2; datasets.events = data; mode = "events"; extractFromData();');
  const untouchedIdx = run('data["@graph"].findIndex(e => isPerfNight(e))'); // the first one, index 0 of the two
  run(`curIdx = ${untouchedIdx}; buildForm();`);
  const openedOne = run('data["@graph"].filter(e => isPerfNight(e))[0]');
  const stillLegacy = run('data["@graph"].filter(e => isPerfNight(e))[1]');
  ok('opening one Performance Night migrates only that record',
    Array.isArray(openedOne.subEvent) && Array.isArray(stillLegacy.performances) && !('subEvent' in stillLegacy));

  /* slot addressing must survive the rename */
  ok('event-level image slots still resolve',
    !!run('slotImg(data["@graph"].find(e=>isPerfNight(e)&&Array.isArray(e.subEvent)), "0")'));
  ok('per-act image slots still resolve (p0-1)',
    !!run('slotImg(data["@graph"].find(e=>isPerfNight(e)&&Array.isArray(e.subEvent)), "p0-1")'));
  eq('slotOf still builds the documented shape', run('slotOf(1, 0)'), 'p0-1');
  eq('allSlots covers event + act images',
    run('allSlots(data["@graph"].find(e=>isPerfNight(e)&&Array.isArray(e.subEvent))).length'),
    (openedOne.images || []).length + openedOne.subEvent.reduce((n, a) => n + (a.images || []).length, 0));

  /* preview pane matches the baked output — reload the single-fixture case */
  run('data = __fixture; datasets.events = data; mode = "events"; extractFromData();');
  run(`curIdx = ${pnIndex}; buildForm();`); // preview renders whatever is in memory, so migrate first
  run('curIdx = null; renderStyle = "pe"; prevFilter = "all"; showHidden = false; renderPreview();');
  const frame = w.document.getElementById('prevFrame');
  ok('the preview pane renders real .event-card markup',
    frame.querySelectorAll('article.event-card').length > 0);
  ok('the preview pane uses the same Performance Night card structure',
    !!frame.querySelector('.event-card.pn-card .pn-preview-row'));
  ok('the preview pane bakes acts into the card too',
    frame.querySelectorAll('.event-card.pn-card .pn-perf').length === 6);
  ok('the preview pane carries the same microdata',
    !!frame.querySelector('[itemprop="subEvent"]') && !!frame.querySelector('[itemprop="performer"][itemscope]'));

  /* The preview must not merely look similar — it must be the same markup. */
  const previewPn = frame.querySelector('.event-card.pn-card');
  const bakedPn = doc0.querySelector('.event-card.pn-card');
  const stripEditorOnly = (html) => html
    .replace(/<span class="event-type" style="opacity:\.55[^<]*<\/span>/g, '')
    .replace(/ class="event-card pn-card[^"]*"/, ' class="event-card pn-card"')
    .replace(/\s+/g, ' ').trim();
  eq('the preview card is byte-identical to the baked card',
    stripEditorOnly(previewPn.outerHTML), stripEditorOnly(bakedPn.outerHTML));

  ok('the preview flags past-events state without changing the shared markup',
    previewPn.textContent.indexOf('Past Events') !== -1);

  /* the preview modal clones the baked detail, exactly as the live page does */
  run('pnExpanded.clear(); pnExpanded.add("slow-impulse"); renderPreview();');
  const ov = w.document.getElementById('prevOverlay');
  ok('the preview modal opens over the pane', !!ov.querySelector('.pn-modal'));
  eq('the preview modal uses the same shell classes as the live page',
    !!(ov.querySelector('.pn-modal__head') && ov.querySelector('.pn-modal__scroll') &&
      ov.querySelector('.pn-modal__intro') && ov.querySelector('.pn-modal__log')), true);
  eq('the preview modal lists every act', ov.querySelectorAll('.pn-perf').length, 6);
  ok('the preview modal shows the full description, not the preview one',
    ov.querySelector('.pn-modal__desc').textContent.indexOf(PN.description.slice(0, 50)) !== -1);
  eq('the preview modal head carries the badge',
    ov.querySelector('.pn-modal__label').textContent.trim(), 'Performance Night');

  run('pnExpanded.clear(); renderPreview();');
  eq('closing the preview modal empties the overlay',
    w.document.getElementById('prevOverlay').innerHTML.trim(), '');

  /* the other preview styles are untouched */
  ['dcc', 'minimal', 'cwsa', 'exh'].forEach((style) => {
    let threw = null;
    try { run(`renderStyle = "${style}"; renderPreview();`); } catch (e) { threw = e.message; }
    ok('preview style "' + style + '" still renders', threw === null, threw);
  });
  run('renderStyle = "pe"; renderPreview();');

  /* image sitemap must still list per-act images */
  const xml = run('buildImageSitemapXML(data, { galleries: [] })');
  ok('the image sitemap is untouched and still lists per-act images',
    has(xml, 'slow-impulse_genia-isachenko_1') && has(xml, '<image:image>'));
  ok('the image sitemap still covers /past-events/', has(xml, '/past-events/'));
}

/* =======================================================================
 * G. Drift between the baked page and the live render
 * ==================================================================== */
section('G. Drift');

const liveCards = {};
P.CATEGORY_KEYS.forEach((k) => { liveCards[k] = clean.regions['pe-' + k]; });

let drift = [];
P.CATEGORY_KEYS.forEach((k) => {
  const start = INDEX.indexOf('<!-- PE:START:pe-' + k + ' -->');
  const end = INDEX.indexOf('<!-- PE:END:pe-' + k + ' -->');
  const baked = INDEX.slice(start, end).replace('<!-- PE:START:pe-' + k + ' -->', '');
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  if (norm(baked) !== norm(liveCards[k])) drift.push(k);
});
ok('the committed index.html matches a fresh render of schema.json', drift.length === 0,
  'drifted sections: ' + drift.join(', '));

/* the fallback path and the baked path produce the same DOM */
const emptyShell = INDEX.replace(
  /(<!-- PE:START:pe-(talks|workshops|performances|screenings) -->)[\s\S]*?(<!-- PE:END:pe-\2 -->)/g,
  '$1$3');
ok('the stripped shell really has no cards', !/class="event-card/.test(emptyShell));

const fallbackDom = new JSDOM(emptyShell, {
  url: 'https://phreaking.co.uk/past-events/',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(),
});
fallbackDom.window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(SCHEMA) });
fallbackDom.window.eval(SCRIPT);

setTimeout(() => {
  const fdoc = fallbackDom.window.document;
  ok('the client-side fallback repopulates an unbaked page',
    fdoc.querySelectorAll('.event-card').length === PAST.length,
    'found ' + fdoc.querySelectorAll('.event-card').length);

  const normDom = (d) => [...d.querySelectorAll('.event-stack .event-card')]
    .map((c) => c.outerHTML.replace(/\s+/g, ' ').trim()).sort().join('\n');
  ok('fallback-rendered cards are identical to the baked ones',
    normDom(fdoc) === normDom(doc0),
    'the two paths cannot drift: they are the same function');

  /* ── done ── */
  console.log('\n' + '─'.repeat(64));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  • ' + f));
  }
  process.exit(failed ? 1 : 0);
}, 200);
