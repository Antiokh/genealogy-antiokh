import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const DOCS_ROOT = path.resolve('src/content/docs');
const PEOPLE_ROOT = path.join(DOCS_ROOT, 'people');
const MEDIA_ROOT = path.join(DOCS_ROOT, 'media');
const PLACES_ROOT = path.join(DOCS_ROOT, 'places');
const EVENTS_ROOT = path.join(DOCS_ROOT, 'events');
const SOURCES_ROOT = path.join(DOCS_ROOT, 'sources');
const OUTPUT_ROOT = path.resolve('public/generated');

async function walk(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await walk(full));
      else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) files.push(full);
    }
    return files;
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function parseFrontmatter(content, filePath) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${filePath}`);
  return YAML.parse(match[1]) ?? {};
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function refFor(root, filePath) {
  return toPosix(path.relative(root, filePath));
}

async function loadEntity(root, entity) {
  const map = new Map();
  for (const filePath of await walk(root)) {
    const data = parseFrontmatter(await readFile(filePath, 'utf8'), filePath);
    if (data.entity !== entity) continue;
    const ref = refFor(root, filePath);
    map.set(ref, { ref, filePath, data });
  }
  return map;
}

function subjectPerson(subject) {
  return typeof subject === 'string' ? subject : subject?.person;
}

function pageUrl(ref) {
  return `/media/${ref.replace(/\.(md|mdx)$/i, '')}/`;
}

const [people, media, places, events, sources] = await Promise.all([
  loadEntity(PEOPLE_ROOT, 'person'),
  loadEntity(MEDIA_ROOT, 'media'),
  loadEntity(PLACES_ROOT, 'place'),
  loadEntity(EVENTS_ROOT, 'event'),
  loadEntity(SOURCES_ROOT, 'source'),
]);

const errors = [];
const byPerson = {};
const byPlace = {};
const byEvent = {};
const records = [];

function pushIndex(index, key, ref) {
  if (!key) return;
  index[key] ??= [];
  if (!index[key].includes(ref)) index[key].push(ref);
}

for (const item of media.values()) {
  const { ref, data } = item;
  const subjects = Array.isArray(data.subjects) ? data.subjects : [];
  const personRefs = [];

  for (const subject of subjects) {
    const personRef = subjectPerson(subject);
    if (!personRef) continue;
    if (!people.has(personRef)) {
      errors.push(`${ref}: unresolved media subject ${JSON.stringify(personRef)}`);
      continue;
    }
    personRefs.push(personRef);
    pushIndex(byPerson, personRef, ref);
  }

  if (data.place) {
    if (!places.has(data.place)) errors.push(`${ref}: unresolved media place ${JSON.stringify(data.place)}`);
    else pushIndex(byPlace, data.place, ref);
  }

  for (const eventRef of data.eventRefs ?? []) {
    if (!events.has(eventRef)) errors.push(`${ref}: unresolved media event ${JSON.stringify(eventRef)}`);
    else pushIndex(byEvent, eventRef, ref);
  }

  if (data.source && !sources.has(data.source)) {
    errors.push(`${ref}: unresolved media source ${JSON.stringify(data.source)}`);
  }

  records.push({
    ref,
    url: pageUrl(ref),
    title: data.title,
    mediaType: data.mediaType ?? 'photo',
    image: typeof data.image === 'string' ? data.image : undefined,
    alt: data.alt,
    caption: data.caption,
    date: data.date,
    subjects: personRefs,
    place: data.place ?? null,
    eventRefs: data.eventRefs ?? [],
    source: data.source ?? null,
    photographer: data.photographer,
    credit: data.credit,
    rights: data.rights,
    license: data.license,
    originalUrl: data.originalUrl,
  });
}

// A same-basename `people/.../person.webp` portrait is convention-based and is
// deliberately outside the media graph. During transition, old `portrait: *.md`
// references still validate as media records; direct image overrides do not.
for (const [personRef, person] of people) {
  const portrait = person.data.portrait;
  if (typeof portrait !== 'string' || !/\.mdx?$/i.test(portrait)) continue;
  if (!media.has(portrait)) {
    errors.push(`${personRef}: unresolved legacy portrait media reference ${JSON.stringify(portrait)}`);
  }
}

for (const index of [byPerson, byPlace, byEvent]) {
  for (const refs of Object.values(index)) refs.sort();
}
records.sort((a, b) => a.ref.localeCompare(b.ref));

if (errors.length) {
  console.error(`Media validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

await mkdir(OUTPUT_ROOT, { recursive: true });
await writeFile(path.join(OUTPUT_ROOT, 'media.json'), `${JSON.stringify({
  schema: 'genealogy-media-1',
  summary: { media: records.length },
  media: records,
}, null, 2)}\n`, 'utf8');
await writeFile(path.join(OUTPUT_ROOT, 'media-index.json'), `${JSON.stringify({
  schema: 'genealogy-media-index-1',
  byPerson,
  byPlace,
  byEvent,
}, null, 2)}\n`, 'utf8');

console.log(`Built ${records.length} media record(s); indexed ${Object.keys(byPerson).length} people, ${Object.keys(byPlace).length} places, ${Object.keys(byEvent).length} events.`);
