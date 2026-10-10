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
const byExternalId = new Map(people.map((person) => [person.id, person]));

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

function isTechnicalName(person) {
  const candidate = String(person.cardName || person.name || '').trim();
  return !candidate || candidate === person.id || /^I\d+$/i.test(candidate);
}

function displayNameFor(person) {
  if (!isTechnicalName(person)) return person.cardName || person.name;
  if (person.sex === 'F') return 'Неизвестная женщина';
  if (person.sex === 'M') return 'Неизвестный мужчина';
  return 'Неизвестный человек';
}

function sourceNameFor(person) {
  return isTechnicalName(person) ? displayNameFor(person) : (person.name || displayNameFor(person));
}

function parseFamilyDate(label) {
  const raw = String(label ?? '').trim();
  if (!raw) return undefined;
  if (/^\d{4}$/.test(raw)) return Number(raw);

  const months = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  const match = raw.match(/^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/i);
  if (match && months[match[2].toUpperCase()]) {
    return `${match[3]}-${months[match[2].toUpperCase()]}-${String(match[1]).padStart(2, '0')}`;
  }
  return raw;
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function buildPaths() {
  const pathsByExternal = new Map();
  const used = new Set();

  for (const person of [...people].sort((a, b) => numericExternalId(a.id) - numericExternalId(b.id))) {
    const { birthYear } = parseYears(person.years);
    const decade = decadeFor(birthYear);
    const displayName = displayNameFor(person);
    const baseSlug = slugify(displayName);
    let slug = baseSlug;
    let key = `${decade}/${slug}`;
    if (used.has(key)) {
      slug = `${baseSlug}-${person.id.toLowerCase()}`;
      key = `${decade}/${slug}`;
    }
    used.add(key);
    const ref = `${decade}/${slug}.md`;
    pathsByExternal.set(person.id, {
      decade,
      slug,
      ref,
      file: path.join(PEOPLE_ROOT, decade, `${slug}.md`),
      url: `/people/${decade}/${slug}/`,
    });
  }

  return pathsByExternal;
}

function buildRelations(pathsByExternal) {
  const parents = new Map();
  const partners = new Map();
  const children = new Map();

  for (const person of people) {
    parents.set(person.id, { father: undefined, mother: undefined, other: new Set() });
    partners.set(person.id, new Map());
    children.set(person.id, new Set());
  }

  for (const relation of family.families) {
    const relationPartners = relation.partners.filter((id) => byExternalId.has(id));
    const relationChildren = relation.children.filter((id) => byExternalId.has(id));
    const marriageDate = parseFamilyDate(relation.label);

    for (const partner of relationPartners) {
      for (const other of relationPartners) {
        if (partner === other) continue;
        const existing = partners.get(partner).get(other) ?? {};
        if (marriageDate !== undefined) existing.married = { date: marriageDate };
        partners.get(partner).set(other, existing);
      }
      for (const child of relationChildren) children.get(partner).add(child);
    }

    for (const child of relationChildren) {
      const target = parents.get(child);
      for (const parentId of relationPartners) {
        const parent = byExternalId.get(parentId);
        if (parent?.sex === 'M' && !target.father) target.father = parentId;
        else if (parent?.sex === 'F' && !target.mother) target.mother = parentId;
        else target.other.add(parentId);
      }
    }
  }

  const toRef = (externalId) => externalId ? pathsByExternal.get(externalId)?.ref : undefined;
  const result = new Map();

  for (const person of people) {
    const parentInfo = parents.get(person.id);
    result.set(person.id, {
      father: toRef(parentInfo.father),
      mother: toRef(parentInfo.mother),
      parents: [...parentInfo.other].map(toRef).filter(Boolean).sort(),
      partners: [...partners.get(person.id).entries()]
        .map(([externalId, meta]) => ({ person: toRef(externalId), ...meta }))
        .filter((item) => item.person)
        .sort((a, b) => a.person.localeCompare(b.person)),
      children: [...children.get(person.id)].map(toRef).filter(Boolean).sort(),
    });
  }

  return result;
}

function markdownName(value) {
  return String(value).replace(/([\\[\]])/g, '\\$1');
}

function nameByRef(ref, pathsByExternal) {
  for (const [externalId, route] of pathsByExternal) {
    if (route.ref !== ref) continue;
    return displayNameFor(byExternalId.get(externalId));
  }
  return ref;
}

function routeByRef(ref, pathsByExternal) {
  for (const route of pathsByExternal.values()) {
    if (route.ref === ref) return route.url;
  }
  return undefined;
}

function relationLinks(refs, pathsByExternal) {
  if (!refs.length) return '—';
  return refs.map((ref) => {
    const name = nameByRef(ref, pathsByExternal);
    const route = routeByRef(ref, pathsByExternal);
    return route ? `[${markdownName(name)}](${route})` : markdownName(name);
  }).join(', ');
}

function pushEvent(lines, key, event) {
  lines.push(`${key}:`);
  lines.push(`  known: ${event.known ? 'true' : 'false'}`);
  lines.push(event.date !== undefined ? `  date: ${typeof event.date === 'number' ? event.date : yamlString(event.date)}` : '  date: null');
  lines.push(event.place ? `  place: ${yamlString(event.place)}` : '  place: null');
}

function renderFrontmatter(person, relationInfo) {
  const { birthYear, deathYear } = parseYears(person.years);
  const displayName = displayNameFor(person);
  const sourceName = sourceNameFor(person);
  const lines = [
    '---',
    `title: ${yamlString(displayName)}`,
    `description: ${yamlString(person.years ? `${displayName}, ${person.years}` : displayName)}`,
    'entity: person',
    'importManaged: true',
    'name:',
    `  full: ${yamlString(sourceName)}`,
    `  display: ${yamlString(displayName)}`,
  ];

  if (person.birthSurname) lines.push(`  birth_last: ${yamlString(person.birthSurname)}`);
  if (person.marriedSurname) lines.push(`  married_last: ${yamlString(person.marriedSurname)}`);
  lines.push('  aliases: []');

  if (person.sex) lines.push(`sex: ${person.sex}`);
  if (person.photo) lines.push(`photo: ${yamlString(person.photo)}`);

  lines.push(relationInfo.father ? `father: ${yamlString(relationInfo.father)}` : 'father: null');
  lines.push(relationInfo.mother ? `mother: ${yamlString(relationInfo.mother)}` : 'mother: null');

  if (relationInfo.parents.length) {
    lines.push('parents:');
    for (const ref of relationInfo.parents) lines.push(`  - ${yamlString(ref)}`);
  }

  pushEvent(lines, 'born', { known: birthYear !== undefined, date: birthYear });
  pushEvent(lines, 'died', { known: person.deceased === true || deathYear !== undefined, date: deathYear });
  pushEvent(lines, 'buried', { known: false });

  if (relationInfo.partners.length) {
    lines.push('partners:');
    for (const partner of relationInfo.partners) {
      lines.push(`  - person: ${yamlString(partner.person)}`);
      if (partner.married) {
        lines.push('    married:');
        const date = partner.married.date;
        lines.push(`      date: ${typeof date === 'number' ? date : yamlString(date)}`);
      }
    }
  } else {
    lines.push('partners: []');
  }

  lines.push('occupation: []', 'residence: []', 'sources: []');
  lines.push(
    'external:',
    '  myheritage:',
    `    snapshot: ${yamlString(SNAPSHOT)}`,
    `    xref: ${yamlString(person.id)}`,
    '---',
  );

  return lines.join('\n');
}

function renderBody(person, relationInfo, pathsByExternal) {
  const lines = [];
  if (person.years) lines.push(`**Годы жизни:** ${person.years}`);
  if (person.birthSurname) lines.push(`**Фамилия при рождении:** ${person.birthSurname}`);
  if (person.marriedSurname && person.marriedSurname !== person.birthSurname) {
    lines.push(`**Фамилия после брака:** ${person.marriedSurname}`);
  }
  if (!isTechnicalName(person) && person.name && person.cardName && person.name !== person.cardName) {
    lines.push(`**Имя в исходных данных:** ${person.name}`);
  }

  const parentRefs = [relationInfo.father, relationInfo.mother, ...relationInfo.parents].filter(Boolean);
  const partnerRefs = relationInfo.partners.map((partner) => partner.person);

  if (lines.length) lines.push('');
  lines.push(
    '## Семья',
    '',
    `**Родители:** ${relationLinks(parentRefs, pathsByExternal)}`,
    '',
    `**Партнёры:** ${relationLinks(partnerRefs, pathsByExternal)}`,
    '',
    `**Дети:** ${relationLinks(relationInfo.children, pathsByExternal)}`,
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
  return existing.includes(`xref: ${yamlString(externalId)}`)
    && existing.includes('Сведения пока не добавлены.');
}

async function markdownFiles(directory) {
  if (!(await fileExists(directory))) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(full));
    else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) files.push(full);
  }
  return files;
}

async function removeStaleManagedPages(pathsByExternal) {
  const expected = new Map([...pathsByExternal].map(([externalId, route]) => [externalId, path.normalize(route.file)]));
  let removed = 0;
  for (const filePath of await markdownFiles(PEOPLE_ROOT)) {
    const content = await readFile(filePath, 'utf8');
    const xref = content.match(/xref:\s*["']?(I\d+)["']?/i)?.[1];
    if (!content.includes('importManaged: true') || !xref) continue;
    const expectedPath = expected.get(xref);
    if (!expectedPath || path.normalize(filePath) !== expectedPath) {
      await rm(filePath, { force: true });
      removed += 1;
    }
  }
  return removed;
}

const pathsByExternal = buildPaths();
const relations = buildRelations(pathsByExternal);
const mapping = {
  schema: 'myheritage-content-ref-mapping-2',
  source: family.source,
  snapshot: SNAPSHOT,
  people: Object.fromEntries(
    [...pathsByExternal.entries()]
      .sort(([a], [b]) => numericExternalId(a) - numericExternalId(b))
      .map(([externalId, route]) => [externalId, route.ref]),
  ),
};

const removed = await removeStaleManagedPages(pathsByExternal);
await mkdir(IMPORT_ROOT, { recursive: true });
await writeFile(MAPPING_PATH, `${JSON.stringify(mapping, null, 2)}\n`, 'utf8');

let written = 0;
let skipped = 0;
for (const person of people) {
  const route = pathsByExternal.get(person.id);
  const relationInfo = relations.get(person.id);

  await mkdir(path.dirname(route.file), { recursive: true });
  if (!(await canOverwriteImported(route.file, person.id))) {
    skipped += 1;
    continue;
  }

  const content = `${renderFrontmatter(person, relationInfo)}\n\n${renderBody(person, relationInfo, pathsByExternal)}\n`;
  await writeFile(route.file, content, 'utf8');
  written += 1;
}

console.log(`Imported ${written} people; skipped ${skipped} hand-managed records; removed ${removed} stale imported pages.`);
console.log(`Mapping contains ${Object.keys(mapping.people).length} external → content refs.`);
