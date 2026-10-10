import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const DOCS_ROOT = path.resolve('src/content/docs');
const PEOPLE_ROOT = path.join(DOCS_ROOT, 'people');
const EVENTS_ROOT = path.join(DOCS_ROOT, 'events');
const PLACES_ROOT = path.join(DOCS_ROOT, 'places');
const SOURCES_ROOT = path.join(DOCS_ROOT, 'sources');
const OUTPUT_ROOT = path.resolve('public/generated');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function parseFrontmatter(content) {
  const raw = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1];
  return raw ? (YAML.parse(raw) ?? {}) : {};
}

function refFor(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function routeFor(kind, ref) {
  return `/${kind}/${ref.replace(/\.mdx?$/i, '')}/`;
}

async function loadRecords(root, entity) {
  const records = new Map();
  for (const filePath of await walk(root)) {
    const data = parseFrontmatter(await readFile(filePath, 'utf8'));
    if (data.entity !== entity || data.draft === true) continue;
    const ref = refFor(root, filePath);
    records.set(ref, { ref, filePath, data });
  }
  return records;
}

function validateRef(ref, records, owner, kind, errors) {
  if (!records.has(ref)) errors.push(`${owner}: broken ${kind} reference ${ref}`);
}

function validateOptionalRef(ref, records, owner, kind, errors) {
  if (typeof ref === 'string' && ref.trim()) validateRef(ref, records, owner, kind, errors);
}

const [people, events, places, sources] = await Promise.all([
  loadRecords(PEOPLE_ROOT, 'person'),
  loadRecords(EVENTS_ROOT, 'event'),
  loadRecords(PLACES_ROOT, 'place'),
  loadRecords(SOURCES_ROOT, 'source'),
]);

const errors = [];

for (const person of people.values()) {
  validateOptionalRef(person.data.born?.place, places, person.ref, 'birth place', errors);
  validateOptionalRef(person.data.died?.place, places, person.ref, 'death place', errors);
  validateOptionalRef(person.data.buried?.place, places, person.ref, 'burial place', errors);
  for (const residence of person.data.residence ?? []) {
    validateOptionalRef(residence?.place, places, person.ref, 'residence place', errors);
  }
  for (const ref of person.data.sources ?? []) validateRef(ref, sources, person.ref, 'source', errors);
}

for (const event of events.values()) {
  for (const ref of event.data.participants ?? []) validateRef(ref, people, event.ref, 'person', errors);
  for (const ref of event.data.places ?? []) validateRef(ref, places, event.ref, 'place', errors);
  for (const ref of event.data.sources ?? []) validateRef(ref, sources, event.ref, 'source', errors);
  for (const item of event.data.provenance ?? []) {
    if (item?.source) validateRef(item.source, sources, event.ref, 'provenance source', errors);
  }
}

for (const place of places.values()) {
  validateOptionalRef(place.data.parent, places, place.ref, 'parent place', errors);
  for (const ref of place.data.sources ?? []) validateRef(ref, sources, place.ref, 'source', errors);

  const geo = place.data.geo;
  if (!geo) continue;
  if (!Number.isFinite(geo.latitude) || geo.latitude < -90 || geo.latitude > 90) {
    errors.push(`${place.ref}: invalid latitude`);
  }
  if (!Number.isFinite(geo.longitude) || geo.longitude < -180 || geo.longitude > 180) {
    errors.push(`${place.ref}: invalid longitude`);
  }
}

if (errors.length) {
  throw new Error(`Event/place validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
}

const eventRows = [...events.values()]
  .sort((a, b) => a.ref.localeCompare(b.ref))
  .map(({ ref, data }) => ({
    ref,
    url: routeFor('events', ref),
    title: data.title,
    description: data.description ?? null,
    kind: data.kind ?? null,
    date: data.date ?? null,
    endDate: data.endDate ?? null,
    importance: data.importance ?? 'standard',
    timeline: data.timeline !== false,
    participants: data.participants ?? [],
    places: data.places ?? [],
    sources: data.sources ?? [],
    provenance: data.provenance ?? [],
  }));

const placeRows = [...places.values()]
  .sort((a, b) => a.ref.localeCompare(b.ref))
  .map(({ ref, data }) => ({
    ref,
    url: routeFor('places', ref),
    title: data.title,
    label: data.label ?? data.title,
    kind: data.kind ?? null,
    country: data.country ?? null,
    aliases: data.aliases ?? [],
    historicalNames: data.historicalNames ?? [],
    geo: data.geo ?? null,
    sources: data.sources ?? [],
    external: data.external ?? {},
  }));

const features = [];
const perPerson = {};
for (const event of eventRows) {
  for (const placeRef of event.places) {
    const place = places.get(placeRef);
    if (!place?.data.geo) continue;
    const feature = {
      type: 'Feature',
      id: `${event.ref}#${placeRef}`,
      geometry: {
        type: 'Point',
        coordinates: [place.data.geo.longitude, place.data.geo.latitude],
      },
      properties: {
        eventRef: event.ref,
        eventUrl: event.url,
        eventTitle: event.title,
        kind: event.kind,
        date: event.date,
        endDate: event.endDate,
        placeRef,
        placeLabel: place.data.label ?? place.data.title,
        precision: place.data.geo.precision ?? null,
        participants: event.participants,
      },
    };
    features.push(feature);
    for (const personRef of event.participants) {
      perPerson[personRef] ??= [];
      perPerson[personRef].push(feature);
    }
  }
}

await mkdir(OUTPUT_ROOT, { recursive: true });
await Promise.all([
  writeFile(path.join(OUTPUT_ROOT, 'events.json'), `${JSON.stringify({ schema: 'genealogy-events-1', events: eventRows }, null, 2)}\n`, 'utf8'),
  writeFile(path.join(OUTPUT_ROOT, 'places.json'), `${JSON.stringify({ schema: 'genealogy-places-1', places: placeRows }, null, 2)}\n`, 'utf8'),
  writeFile(path.join(OUTPUT_ROOT, 'places.geojson'), `${JSON.stringify({ type: 'FeatureCollection', features }, null, 2)}\n`, 'utf8'),
  writeFile(path.join(OUTPUT_ROOT, 'person-place-events.json'), `${JSON.stringify({ schema: 'genealogy-person-place-events-1', people: Object.fromEntries(Object.entries(perPerson).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`, 'utf8'),
]);

console.log(`Compiled ${eventRows.length} event(s), ${placeRows.length} place(s), ${features.length} georeferenced event-place feature(s).`);
