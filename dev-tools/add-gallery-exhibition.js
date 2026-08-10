#!/usr/bin/env node
/* One-off: add an `exhibition` field to each gallery in json/galleries.json.
 *
 * WHY
 * The artwork feature needs to know which gallery/galleries an exhibition's
 * images live in, so that "pick an existing image" can filter to the right
 * ones and a fresh upload can land in the right thumbDir/fullDir. Nothing in
 * galleries.json said that: galleries are keyed by their own id ("dccep",
 * "bitrot-show") with no link back to an exhibition key.
 *
 * That mapping is DATA, not code — putting it in a const inside jsonedit.html
 * would mean adding a gallery for a new show requires an editor release. So it
 * goes in the file, once, here.
 *
 * Note that an exhibition may legitimately have MORE THAN ONE gallery: BitRot
 * has both bitrot-show and bitrot-events. Nothing forces a canonical gallery
 * per exhibition — the artwork form's target-gallery picker lists every
 * gallery matching the exhibition and lets the person choose.
 *
 * Galleries that aren't tied to an exhibition (mixed-signals, open-projector
 * are recurring event series, not shows) get `exhibition: null` explicitly,
 * rather than being left undefined — so a future reader can tell "no
 * exhibition" from "nobody has filled this in yet".
 *
 * Idempotent: a gallery that already has the field is left alone.
 *
 * Usage (from the repo root):
 *   node dev-tools/add-gallery-exhibition.js [galleries.json]
 */
const fs = require('fs');
const path = require('path');

const galPath = process.argv[2] || path.join('json', 'galleries.json');

const MAP = {
  'dccep': 'does-cloud-compute',
  'bitrot-show': 'bitrot',
  'bitrot-events': 'bitrot',
  'can-we-start-again': 'can-we-start-again',
  'mixed-signals': null,     /* recurring session series, not an exhibition */
  'open-projector': null,    /* recurring screening series, not an exhibition */
};

const data = JSON.parse(fs.readFileSync(galPath, 'utf8'));
if (!Array.isArray(data.galleries)) { console.error('FATAL: no galleries array'); process.exit(1); }

let set = 0, kept = 0;
const unknown = [];

data.galleries.forEach((g) => {
  if (Object.prototype.hasOwnProperty.call(g, 'exhibition')) { kept++; return; }
  if (!Object.prototype.hasOwnProperty.call(MAP, g.id)) { unknown.push(g.id); return; }
  /* Insert after `short` so the field reads near the other identity fields
   * rather than being tacked on after the images array. */
  const rebuilt = {};
  Object.keys(g).forEach((k) => {
    rebuilt[k] = g[k];
    if (k === 'short') rebuilt.exhibition = MAP[g.id];
  });
  if (!Object.prototype.hasOwnProperty.call(rebuilt, 'exhibition')) rebuilt.exhibition = MAP[g.id];
  Object.keys(rebuilt).forEach((k) => { delete g[k]; });
  Object.assign(g, rebuilt);
  set++;
});

if (unknown.length) {
  console.error('FATAL: galleries not in the map — add them and re-run: ' + unknown.join(', '));
  process.exit(1);
}

fs.writeFileSync(galPath, JSON.stringify(data, null, 2) + '\n');
console.log(`Set exhibition on ${set} gallery/galleries (${kept} already had it).`);
