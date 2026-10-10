import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { family } from '../demos/anton-family/data.js';

const PEOPLE_ROOT = 'src/content/docs/people';
const IMPORT_ROOT = 'imports/myheritage-2026';
const MAPPING_PATH = path.join(IMPORT_ROOT, 'mapping.json');
const SNAPSHOT = '2026-09-10';

const cyrillicMap = new Map(Object.entries({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
}));

function isImportablePerson(person) {
  return String(person.name ?? '').trim().toLowerCase() !== 'unassociated photos';
}

const people = family.people.filter(isImportablePerson);

function transliterate(value) {
  return [...String(value).toLowerCase()]
    .map((char) => cyrillicMap.get(char) ?? char)
    .join('');
}

function slugify(value) {
  return transliterate(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'person';
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function parseYear(value) {
  const match = String(value ?? '').trim().match(/^\d{4}$/);
  return match ? Number(match[0]) : undefined;
}

function parseYears(years = '') {
  const parts = String(years).split(/[–—-]/, 2).map((part) => part.trim());
  return {
    birthYear: parseYear(parts[0]),
    deathYear: parseYear(parts[1]),
  };
}

function decadeFor(year) {
  if (!year) return 'unknown';
  const start = Math.floor(year / 10) * 10;
  return `${start}-${start + 9}`;
}

function numericExternalId(id) {
  const match = String(id).match(/(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function canonicalNumber(id) {
  const match = String(id).match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function isTechnicalName(person) {
  const candidate = String(person.cardName || person.name || '').trim();
  return !candidate || candidate === person.id || /^I\d+$/i.test(candidate);
}

function displayNameFor(person, canonicalId) {
  if (!isTechnicalName(person)) return person.cardName || person.name;
  if (person.sex === 'F') return `Неизвестная (${canonicalId})`;
  if (person.sex === 'M') return `Неизвестный (${canonicalId})`;
  return `Неизвестный человек (${canonicalId})`;
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadMapping() {
  if (!(await fileExists(MAPPING_PATH))) {
    return {
      schema: 'myheritage-snapshot-mapping-1',
      source: family.source,
      snapshot: SNAPSHOT,
      people: {},
    };
  }
  return JSON.parse(await readFile(MAPPING_PATH, 'utf8'));
}

function ensurePersonIds(mapping) {
  for (const [externalId] of Object.entries(mapping.people)) {
    if (!people.some((person) => person.id === externalId)) delete mapping.people[externalId];
  }

  const sortedPeople = [...people].sort(
    (a, b) => numericExternalId(a.id) - numericExternalId(b.id) || a.id.localeCompare(b.id),
  );
  let next = Math.max(0, ...Object.values(mapping.people).map(canonicalNumber)) + 1;
  for (const person of sortedPeople) {
    if (!mapping.people[person.id]) {
      mapping.people[person.id] = `P${String(next).padStart(6, '0')}`;
      next += 1;
    }
  }
}

function buildRelations(mapping) {
  const known = new Set(people.map((person) => person.id));
  const parents = new Map();
  const partners = new Map();
  const children = new Map();

  for (const person of people) {
    parents.set(person.id, new Set());
    partners.set(person.id, new Set());
    children.set(person.id, new Set());
  }

  for (const relation of family.families) {
    const relationPartners = relation.partners.filter((id) => known.has(id));
    const relationChildren = relation.children.filter((id) => known.has(id));

    for (const partner of relationPartners) {
      for (const other of relationPartners) {
        if (other !== partner) partners.get(partner).add(other);
      }
      for (const child of relationChildren) children.get(partner).add(child);
    }

    for (const child of relationChildren) {
      for (const parent of relationPartners) parents.get(child).add(parent);
    }
  }

  const toCanonical = (set) => [...set]
    .map((externalId) => mapping.people[externalId])
    .filter(Boolean)
    .sort();

  return {
    parents: new Map([...parents].map(([id, set]) => [id, toCanonical(set)])),
    partners: new Map([...partners].map(([id, set]) => [id, toCanonical(set)])),
    children: new Map([...children].map(([id, set]) => [id, toCanonical(set)])),
  };
}

function buildPaths(mapping) {
  const pathsByExternal = new Map();
  const used = new Set();

  for (const person of [...people].sort((a, b) => numericExternalId(a.id) - numericExternalId(b.id))) {
    const { birthYear } = parseYears(person.years);
    const decade = decadeFor(birthYear);
    const canonicalId = mapping.people[person.id];
    const displayName = displayNameFor(person, canonicalId);
    const baseSlug = slugify(displayName);
    let slug = baseSlug;
    let key = `${decade}/${slug}`;
    if (used.has(key)) {
      slug = `${baseSlug}-${canonicalId.toLowerCase()}`;
      key = `${decade}/${slug}`;
    }
    used.add(key);
    pathsByExternal.set(person.id, {
      decade,
      slug,
      file: path.join(PEOPLE_ROOT, decade, `${slug}.md`),
      url: `/people/${decade}/${slug}/`,
    });
  }

  return pathsByExternal;
}

function markdownName(value) {
  return String(value).replace(/([\\[\]])/g, '\\$1');
}

function relationLinks(canonicalIds, peopleByCanonical, pathsByExternal, mapping) {
  if (!canonicalIds.length) return '—';
  const externalByCanonical = new Map(Object.entries(mapping.people).map(([external, canonical]) => [canonical, external]));
  return canonicalIds.map((canonicalId) => {
    const person = peopleByCanonical.get(canonicalId);
    const externalId = externalByCanonical.get(canonicalId);
    const route = externalId ? pathsByExternal.get(externalId)?.url : undefined;
    const name = person ? displayNameFor(person, canonicalId) : canonicalId;
    return route ? `[${markdownName(name)}](${route})` : markdownName(name);
  }).join(', ');
}

function renderFrontmatter(person, canonicalId, relations) {
  const { birthYear, deathYear } = parseYears(person.years);
  const displayName = displayNameFor(person, canonicalId);
  const sourceName = isTechnicalName(person) ? displayName : (person.name || displayName);
  const lines = [
    '---',
    `title: ${yamlString(displayName)}`,
    `description: ${yamlString(person.years ? `${displayName}, ${person.years}` : displayName)}`,
    'entity: person',
    'importManaged: true',
    `id: ${canonicalId}`,
    `name: ${yamlString(sourceName)}`,
    `displayName: ${yamlString(displayName)}`,
  ];

  if (person.birthSurname) lines.push(`birthSurname: ${yamlString(person.birthSurname)}`);
  if (person.marriedSurname) lines.push(`marriedSurname: ${yamlString(person.marriedSurname)}`);
  if (person.photo) lines.push(`photo: ${yamlString(person.photo)}`);
  if (typeof person.deceased === 'boolean') lines.push(`deceased: ${person.deceased}`);
  if (person.sex) lines.push(`sex: ${person.sex}`);

  if (birthYear) lines.push('birth:', `  year: ${birthYear}`);
  if (deathYear) lines.push('death:', `  year: ${deathYear}`);

  const renderArray = (key, values) => {
    if (!values.length) {
      lines.push(`${key}: []`);
      return;
    }
    lines.push(`${key}:`);
    for (const value of values) lines.push(`  - ${value}`);
  };

  renderArray('parents', relations.parents);
  renderArray('partners', relations.partners);
  lines.push('sources: []');
  lines.push(
    'external:',
    '  myheritage:',
    `    snapshot: ${yamlString(SNAPSHOT)}`,
    `    xref: ${yamlString(person.id)}`,
    '---',
  );

  return lines.join('\n');
}

function renderBody(person, canonicalId, relationIds, peopleByCanonical, pathsByExternal, mapping) {
  const lines = [];
  if (person.years) lines.push(`**Годы жизни:** ${person.years}`);
  if (person.birthSurname) lines.push(`**Фамилия при рождении:** ${person.birthSurname}`);
  if (person.marriedSurname && person.marriedSurname !== person.birthSurname) {
    lines.push(`**Фамилия после брака:** ${person.marriedSurname}`);
  }
  if (!isTechnicalName(person) && person.name && person.cardName && person.name !== person.cardName) {
    lines.push(`**Имя в исходных данных:** ${person.name}`);
  }

  if (lines.length) lines.push('');
  lines.push(
    '## Семья',
    '',
    `**Родители:** ${relationLinks(relationIds.parents, peopleByCanonical, pathsByExternal, mapping)}`,
    '',
    `**Партнёры:** ${relationLinks(relationIds.partners, peopleByCanonical, pathsByExternal, mapping)}`,
    '',
    `**Дети:** ${relationLinks(relationIds.children, peopleByCanonical, pathsByExternal, mapping)}`,
    '',
    '## Биография',
    '',
    'Сведения пока не добавлены.',
  );
  return lines.join('\n');
}

async function canOverwriteImported(filePath, externalId) {
  if (!(await fileExists(filePath))) return true;
  const existing = await readFile(filePath, 'utf8');
  if (existing.includes('importManaged: true')) return true;
  if (existing.includes('draft: true') && existing.includes(`xref: ${externalId}`)) return true;
  return existing.includes(`snapshot: ${yamlString(SNAPSHOT)}`)
    && existing.includes(`xref: ${yamlString(externalId)}`)
    && existing.includes('Сведения пока не добавлены.');
}

async function markdownFiles(directory) {
  if (!(await fileExists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
  }
  return files;
}

async function removeStaleManagedPages(pathsByExternal) {
  const expected = new Map([...pathsByExternal].map(([externalId, route]) => [externalId, path.normalize(route.file)]));
  let removed = 0;
  for (const filePath of await markdownFiles(PEOPLE_ROOT)) {
    const content = await readFile(filePath, 'utf8');
    const xref = content.match(/xref:\s*["']?(I\d+)["']?/i)?.[1];
    const isSnapshotImport = content.includes('myheritage:') && content.includes(SNAPSHOT) && xref;
    if (!isSnapshotImport) continue;
    const expectedPath = expected.get(xref);
    if (!expectedPath || path.normalize(filePath) !== expectedPath) {
      await rm(filePath, { force: true });
      removed += 1;
    }
  }
  return removed;
}

const mapping = await loadMapping();
ensurePersonIds(mapping);
const relations = buildRelations(mapping);
const pathsByExternal = buildPaths(mapping);
const peopleByCanonical = new Map(
  people.map((person) => [mapping.people[person.id], person]),
);

const removed = await removeStaleManagedPages(pathsByExternal);
await mkdir(IMPORT_ROOT, { recursive: true });
await writeFile(MAPPING_PATH, `${JSON.stringify(mapping, null, 2)}\n`, 'utf8');

let written = 0;
let skipped = 0;
const unresolvedReferences = new Set();
const knownExternalIds = new Set(people.map((person) => person.id));
for (const relation of family.families) {
  for (const id of [...relation.partners, ...relation.children]) {
    if (!knownExternalIds.has(id)) unresolvedReferences.add(id);
  }
}

for (const person of people) {
  const canonicalId = mapping.people[person.id];
  const route = pathsByExternal.get(person.id);
  const relationIds = {
    parents: relations.parents.get(person.id) ?? [],
    partners: relations.partners.get(person.id) ?? [],
    children: relations.children.get(person.id) ?? [],
  };

  await mkdir(path.dirname(route.file), { recursive: true });
  if (!(await canOverwriteImported(route.file, person.id))) {
    skipped += 1;
    continue;
  }

  const content = `${renderFrontmatter(person, canonicalId, relationIds)}\n\n${renderBody(
    person,
    canonicalId,
    relationIds,
    peopleByCanonical,
    pathsByExternal,
    mapping,
  )}\n`;
  await writeFile(route.file, content, 'utf8');
  written += 1;
}

console.log(`Imported ${written} people; skipped ${skipped} hand-managed records; removed ${removed} stale imported pages.`);
console.log(`Mapping contains ${Object.keys(mapping.people).length} stable person IDs.`);
if (unresolvedReferences.size) {
  console.warn(`Family data references ${unresolvedReferences.size} people absent from the importable snapshot: ${[...unresolvedReferences].sort().join(', ')}`);
}
