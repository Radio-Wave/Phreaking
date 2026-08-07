#!/usr/bin/env node
/* Bake schema.json into index.html using the same renderer the JSON editor
 * runs on push. Useful for CI / a one-off rebuild from the command line;
 * the editor does not need it.
 *
 * Lives in /dev-tools — NOT /scripts, since /scripts is served to the public
 * and this is a build-time tool. It requires the real, served renderer at
 * /scripts/past-events.js rather than a private copy, so there is exactly one
 * implementation to keep in sync.
 *
 * Usage (run from the repo root, or pass explicit paths):
 *   node dev-tools/build-past-events.js [schema.json] [past-events/index.html]
 */
const fs = require('fs');
const path = require('path');
const P = require(path.join(__dirname, '..', 'scripts', 'past-events.js'));

const schemaPath = process.argv[2] || path.join('json', 'schema.json');
const pagePath = process.argv[3] || path.join('past-events', 'index.html');

const data = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const page = P.renderPage(data);

if (page.fatal) {
  console.error('FATAL: ' + page.fatal);
  process.exit(1);
}

const before = fs.readFileSync(pagePath, 'utf8');
const applied = P.applyRegions(before, page.regions);

if (applied.missing.length) {
  console.error('FATAL: missing markers in ' + pagePath + ': ' + applied.missing.join(', '));
  process.exit(1);
}

const check = P.verifyBakedHTML(applied.html, data);
if (!check.ok) {
  console.error('FATAL: generated HTML is missing content:');
  check.problems.slice(0, 20).forEach((p) => console.error('  - ' + p));
  process.exit(1);
}

fs.writeFileSync(pagePath, applied.html);

console.log(`Baked ${page.baked} events into ${pagePath} (${page.skipped} skipped).`);
console.log('  counts: ' + JSON.stringify(page.counts));
console.log(`  verified ${check.checked} events present in raw HTML`);
if (page.errors.length) {
  console.log(`  ${page.errors.length} error(s):`);
  page.errors.forEach((e) => console.log('    ! ' + e));
}
if (page.warnings.length) {
  console.log(`  ${page.warnings.length} warning(s):`);
  page.warnings.forEach((w) => console.log('    ~ ' + w));
}
