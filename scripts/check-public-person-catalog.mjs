import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { buildPeopleSidebar, isPublicCatalogPerson, personSurname } from './starlight-people-sidebar.mjs';

const peopleRoot = path.resolve('src/content/docs/people');

function readFrontmatter(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const raw = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1];
  return raw ? (YAML.parse(raw) ?? {}) : {};
}

function collectPeople(directory, relative = '') {
  const people = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const absolute = path.join(directory, entry.name);
    const nextRelative = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      people.push(...collectPeople(absolute, nextRelative));
      continue;
    }
    if (!entry.isFile() || !/\.mdx?$/i.test(entry.name)) continue;
    if (/^index\.mdx?$/i.test(entry.name) && !relative) continue;
    const data = readFrontmatter(absolute);
    if (data.entity !== 'person') continue;
    const slug = nextRelative.replace(/\.mdx?$/i, '').replace(/\/index$/i, '');
    people.push({ data, slug, filePath: absolute });
  }
  return people;
}

function sidebarLinks(items, links = new Set()) {
  for (const item of items) {
    if (item?.link) links.add(item.link);
    if (Array.isArray(item?.items)) sidebarLinks(item.items, links);
  }
  return links;
}

const behaviorCases = [
  {
    label: 'curated surname is listed by legacy default',
    data: { entity: 'person', importManaged: false, name: { last: 'Назаров' } },
    expected: true,
  },
  {
    label: 'public true documents publication intent',
    data: { entity: 'person', public: true, importManaged: false, name: { last: 'Назаров' } },
    expected: true,
  },
  {
    label: 'public false suppresses an otherwise eligible person',
    data: { entity: 'person', public: false, importManaged: false, name: { last: 'Назаров' } },
    expected: false,
  },
  {
    label: 'import-managed records never enter public navigation',
    data: { entity: 'person', public: true, importManaged: true, name: { last: 'Назаров' } },
    expected: false,
  },
  {
    label: 'surname-less records never enter public navigation',
    data: { entity: 'person', public: true, importManaged: false, name: { first: 'Игорь' } },
    expected: false,
  },
  {
    label: 'birth surname counts as a surname',
    data: { entity: 'person', importManaged: false, name: { birth_last: 'Курочкина' } },
    expected: true,
  },
];

const errors = [];
for (const test of behaviorCases) {
  const actual = isPublicCatalogPerson(test.data);
  if (actual !== test.expected) errors.push(`${test.label}: expected ${test.expected}, got ${actual}`);
}

if (personSurname({ name: { last: '  Буш  ' } }) !== 'Буш') {
  errors.push('personSurname must trim the structured surname');
}

const actualLinks = sidebarLinks(buildPeopleSidebar());
for (const person of collectPeople(peopleRoot)) {
  const link = `/people/${person.slug}/`;
  const expected = isPublicCatalogPerson(person.data);
  const actual = actualLinks.has(link);
  if (actual !== expected) {
    errors.push(`${path.relative(process.cwd(), person.filePath)}: sidebar=${actual}, expected=${expected}`);
  }
}

if (errors.length) {
  console.error(`Public person catalog check failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Public person catalog check passed: ${actualLinks.size} listed person page(s).`);
