#!/usr/bin/env node
/* One-off: create the first VisualArtwork records in json/schema.json from the
 * DCCeP gallery images that already exist in json/galleries.json.
 *
 * WHY THIS EXISTS AT ALL
 * The 21 images in the `dccep` gallery already ARE the artwork documentation,
 * and their captions already carry "Title - Artist" for every work in the show.
 * Re-uploading those files through the editor to create artwork records would
 * put a second copy of every image in the repo and break the rule that the
 * gallery is the single source of truth for an image. So the first nine
 * artwork records are built by REFERENCE to the images that are already there.
 *
 * Lives in /dev-tools because it is a build-time migration, not something the
 * editor needs — same reasoning as build-past-events.js.
 *
 * It is idempotent: an artwork whose @id already exists is left alone, so a
 * second run after someone has edited descriptions in the editor is safe.
 *
 * Usage (from the repo root):
 *   node dev-tools/backfill-dccep-artwork.js [schema.json] [galleries.json]
 */
const fs = require('fs');
const path = require('path');

const schemaPath = process.argv[2] || path.join('json', 'schema.json');
const galPath = process.argv[3] || path.join('json', 'galleries.json');

const EXH = 'does-cloud-compute';
const EXH_SHORT = 'dccep';
const GALLERY_ID = 'dccep';
const PAGE = '/does-cloud-compute-ever-precipitate/';

/* Caption → artist @id. Written out rather than derived, because two of the
 * gallery captions spell the artist differently from the artists.json record
 * ("Lyra Robbinson" vs "Lyra Robinson"; "David Lazar" vs "David Lazăr"), and a
 * fuzzy match that silently picks the wrong Person is worse than a table
 * somebody can read. The registry spelling wins — the caption is not edited
 * here, because galleries.json owns its own captions. */
const ARTIST_ID = (slug) => `https://phreaking.co.uk/#artist-${slug}-${EXH_SHORT}`;

const WORKS = [
  { title: 'I Live There, With You',  artists: ['xach'],              files: ['DDCeP-04', 'DDCeP-05'] },
  { title: 'I Potato, Self Portrait', artists: ['nikos'],             files: ['DDCeP-06', 'DDCeP-07'] },
  { title: 'Joy',                     artists: ['lyra'],              files: ['DDCeP-08', 'DDCeP-09'] },
  { title: 'Master in Training',      artists: ['yunzhi'],            files: ['DDCeP-18', 'DDCeP-19'] },
  { title: 'Window',                  artists: ['robin'],             files: ['DDCeP-10', 'DDCeP-13'] },
  { title: 'Bottled Up',              artists: ['jack'],              files: ['DDCeP-11', 'DDCeP-12'] },
  { title: 'Recursive Wait',          artists: ['david'],             files: ['DDCeP-14', 'DDCeP-15'] },
  { title: 'Angel Duster',            artists: ['dylan'],             files: ['DDCeP-16', 'DDCeP-21'] },
  /* The multi-artist case. This is why artist is stored the same way performer
   * is — one object when there is one, an array when there are more. */
  { title: 'Precipitation Network',   artists: ['phoenix', 'jasmine'], files: ['DDCeP-17', 'DDCeP-20'] },
];

/* DDCeP-01/02/03 are wide installation shots of the room, not works. They stay
 * gallery-only and get no artwork record. */

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const basename = (p) => String(p || '').split('/').pop().replace(/\.[^.]+$/, '');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const gals = JSON.parse(fs.readFileSync(galPath, 'utf8'));

const gal = (gals.galleries || []).find((g) => g.id === GALLERY_ID);
if (!gal) { console.error(`FATAL: gallery "${GALLERY_ID}" not found in ${galPath}`); process.exit(1); }

const byBase = new Map();
(gal.images || []).forEach((im) => byBase.set(basename(im.src), im));

if (!Array.isArray(schema['@graph'])) { console.error('FATAL: schema has no @graph array'); process.exit(1); }

const existing = new Set(schema['@graph'].map((n) => n && n['@id']).filter(Boolean));
let added = 0, skipped = 0;
const problems = [];

WORKS.forEach((w, i) => {
  const id = `https://phreaking.co.uk/#artwork-${slugify(w.title)}-${EXH_SHORT}`;
  if (existing.has(id)) { skipped++; return; }

  const images = w.files.map((f) => {
    const im = byBase.get(f);
    if (!im) { problems.push(`${w.title}: no gallery image "${f}"`); return null; }
    /* src/full/alt are copied from the gallery entry, and `gallery` records
     * WHERE they came from. The copy is a cache, not a fork: the editor
     * re-syncs it from galleries.json every time Artwork mode loads, so an alt
     * text fixed in Gallery mode reaches the artwork card without anyone
     * having to touch the artwork record. The pointer is what's authoritative. */
    return { src: im.src, full: im.full || im.src, alt: im.alt || '', gallery: GALLERY_ID, galleryRef: f };
  }).filter(Boolean);

  const refs = w.artists.map((a) => ({ '@id': ARTIST_ID(a) }));

  schema['@graph'].push({
    '@type': 'VisualArtwork',
    '@id': id,
    name: w.title,
    exhibition: EXH,
    /* Single object when there is one artist, array when there are more —
     * matching setPerformerIds()'s existing shape exactly. */
    artist: refs.length === 1 ? refs[0] : refs,
    sortOrder: i + 1,
    /* Resolved page paths, not exhibition keys — this is what lets an artwork
     * be cross-listed onto the homepage later without a second lookup table. */
    visibleOn: [PAGE],
    /* dateCreated deliberately absent: it falls back to the exhibition node's
     * own startDate ("2026") at render time. Only set it here if a work was
     * actually made in a different year. */
    description: '',
    artForm: '',
    artMedium: '',
    width: '',
    height: '',
    url: '',
    linkLabel: '',
    keywords: [],
    sameAs: [],
    images,
    visible: true,
  });
  added++;
});

/* Cross-check every artist reference against artists.json if it's sitting next
 * to the schema, so a typo in the table above fails loudly here rather than
 * rendering as an artwork attributed to a raw URL on the live page. */
const artistsPath = path.join(path.dirname(schemaPath), 'artists.json');
if (fs.existsSync(artistsPath)) {
  const artists = JSON.parse(fs.readFileSync(artistsPath, 'utf8'));
  const ids = new Set((artists['@graph'] || []).map((a) => a['@id']));
  schema['@graph'].forEach((n) => {
    if (!n || n['@type'] !== 'VisualArtwork') return;
    const refs = Array.isArray(n.artist) ? n.artist : (n.artist ? [n.artist] : []);
    refs.forEach((r) => { if (!ids.has(r['@id'])) problems.push(`${n.name}: artist not in artists.json — ${r['@id']}`); });
  });
}

if (problems.length) {
  console.error('FATAL: refusing to write, unresolved references:');
  problems.forEach((p) => console.error('  - ' + p));
  process.exit(1);
}

fs.writeFileSync(schemaPath, JSON.stringify(schema, null, 2) + '\n');
console.log(`Back-filled ${added} artwork record(s) into ${schemaPath} (${skipped} already present).`);
