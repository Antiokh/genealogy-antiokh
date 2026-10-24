/**
 * Generate Shields-style public badges from the same validated records
 * consumed by the genealogy site. Run AFTER npm run build:data and astro build.
 * These are build artifacts, not manually maintained counts.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('dist');
const badgeDir = path.join(outputDir, 'badges');
const generatedDir = path.resolve('public/generated');

async function readDataset(name, collection) {
  const filePath = path.join(generatedDir, `${name}.json`);
  const data = JSON.parse(await readFile(filePath, 'utf8'));
  if (!Array.isArray(data[collection])) {
    throw new Error(`Missing ${collection} array in ${filePath}; refusing to emit a misleading badge.`);
  }
  return data[collection];
}

function renderBadge(label, value, color) {
  const text = String(value);
  // A little more room for Cyrillic labels; keep the same compact shape as RSLive.
  const labelWidth = Math.max(54, Math.round(label.length * 7.4 + 17));
  const valueWidth = Math.max(34, 16 + text.length * 7);
  const width = labelWidth + valueWidth;
  const title = `${label}: ${text}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${title}">
  <title>${title}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${width}" height="20" rx="3"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${width}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${Math.round(labelWidth / 2)}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${Math.round(labelWidth / 2)}" y="14">${label}</text>
    <text x="${labelWidth + Math.round(valueWidth / 2)}" y="15" fill="#010101" fill-opacity=".3">${text}</text>
    <text x="${labelWidth + Math.round(valueWidth / 2)}" y="14">${text}</text>
  </g>
</svg>
`;
}

const [people, events, places, media] = await Promise.all([
  readDataset('people', 'people'),
  readDataset('events', 'events'),
  readDataset('places', 'places'),
  readDataset('media', 'media'),
]);

// Media entries have a semantic mediaType; only photos are counted here.
// Absence of mediaType defaults to photo in build-media.mjs.
const photos = media.filter((record) => (record.mediaType ?? 'photo') === 'photo');

const counters = [
  { name: 'people', label: 'люди', count: people.length, color: '#0b7285' },
  { name: 'events', label: 'события', count: events.length, color: '#7048e8' },
  { name: 'places', label: 'места', count: places.length, color: '#2f9e44' },
  { name: 'photos', label: 'фото', count: photos.length, color: '#b07643' },
];

await mkdir(badgeDir, { recursive: true });
for (const badge of counters) {
  await writeFile(path.join(badgeDir, `${badge.name}.svg`), renderBadge(badge.label, badge.count, badge.color), 'utf8');
}

await writeFile(path.join(outputDir, 'site-stats.json'), JSON.stringify({
  schema: 1,
  countedFrom: 'public/generated/*.json',
  ...Object.fromEntries(counters.map(({ name, count }) => [name, count])),
}, null, 2) + '\n', 'utf8');

console.log('[badges] ' + counters.map(({ label, count }) => `${label}: ${count}`).join('; '));
