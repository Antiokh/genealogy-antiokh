import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const PEOPLE_ROOT = path.resolve('src/content/docs/people');
const RECONCILIATION_PATH = path.resolve('imports/myheritage-2026/reconciled-relations.json');
const MAPPING_PATH = path.resolve('imports/myheritage-2026/mapping.json');

function toPosix(value) {
  return value.split(path.sep).join('/');
}

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

function parseDocument(content) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/);
  if (!match) throw new Error('Missing frontmatter');
  return {
    data: YAML.parse(match[1]) ?? {},
    body: content.slice(match[0].length).replace(/^\r?\n/, ''),
  };
}

function renderDocument(data, body) {
  return `---\n${YAML.stringify(data, { lineWidth: 0 }).trimEnd()}\n---\n\n${body.trimStart()}`;
}

function partnerTarget(value) {
  return typeof value === 'string' ? value : value?.person;
}

function mergePartners(existing = [], additions = []) {
  const merged = new Map();
  for (const value of existing) {
    const person = partnerTarget(value);
    if (person) merged.set(person, value);
  }
  for (const value of additions) {
    const person = partnerTarget(value);
    if (!person) continue;
    const previous = merged.get(person);
    if (typeof previous === 'object' && typeof value === 'object') merged.set(person, { ...previous, ...value });
    else merged.set(person, value);
  }
  return [...merged.values()];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function relationLinks(refs, byRef) {
  if (!refs.length) return '—';
  return refs.map((ref) => {
    const record = byRef.get(ref);
    const title = String(record?.data?.title ?? ref).replace(/([\\[\]])/g, '\\$1');
    const route = `/people/${ref.replace(/\.(md|mdx)$/i, '')}/`;
    return `[${title}](${route})`;
  }).join(', ');
}

function replaceFamilyLine(body, label, value) {
  const pattern = new RegExp(`^\\*\\*${label}:\\*\\*.*$`, 'm');
  return pattern.test(body) ? body.replace(pattern, `**${label}:** ${value}`) : body;
}

async function loadRecords() {
  const byRef = new Map();
  const byXref = new Map();
  for (const filePath of await walk(PEOPLE_ROOT)) {
    const ref = toPosix(path.relative(PEOPLE_ROOT, filePath));
    const content = await readFile(filePath, 'utf8');
    const document = parseDocument(content);
    const record = { ref, filePath, ...document };
    byRef.set(ref, record);
    const xref = document.data?.external?.myheritage?.xref;
    if (xref) byXref.set(String(xref), record);
  }
  return { byRef, byXref };
}

const reconciliation = JSON.parse(await readFile(RECONCILIATION_PATH, 'utf8'));
let { byRef, byXref } = await loadRecords();
let changed = 0;

for (const override of reconciliation.overrides ?? []) {
  const mappedRef = reconciliation.mapping?.[override.xref];
  const record = byXref.get(override.xref) ?? (mappedRef ? byRef.get(mappedRef) : undefined);
  if (!record) throw new Error(`Cannot resolve reconciliation target ${override.xref}`);

  if (Object.hasOwn(override, 'father')) record.data.father = override.father;
  if (Object.hasOwn(override, 'mother')) record.data.mother = override.mother;
  if (override.partners) record.data.partners = mergePartners(record.data.partners, override.partners);
  if (override.sources) record.data.sources = unique([...(record.data.sources ?? []), ...override.sources]);

  await writeFile(record.filePath, renderDocument(record.data, record.body), 'utf8');
  changed += 1;
}

const mapping = JSON.parse(await readFile(MAPPING_PATH, 'utf8'));
mapping.people = { ...(mapping.people ?? {}), ...(reconciliation.mapping ?? {}) };
mapping.people = Object.fromEntries(Object.entries(mapping.people).sort(([a], [b]) => {
  const an = Number(a.match(/\d+$/)?.[0] ?? Number.MAX_SAFE_INTEGER);
  const bn = Number(b.match(/\d+$/)?.[0] ?? Number.MAX_SAFE_INTEGER);
  return an - bn || a.localeCompare(b);
}));
await writeFile(MAPPING_PATH, `${JSON.stringify(mapping, null, 2)}\n`, 'utf8');

({ byRef, byXref } = await loadRecords());
const childrenByRef = new Map([...byRef.keys()].map((ref) => [ref, []]));
for (const record of byRef.values()) {
  const parents = unique([record.data.father, record.data.mother, ...(record.data.parents ?? [])]);
  for (const parent of parents) childrenByRef.get(parent)?.push(record.ref);
}

for (const ref of reconciliation.refreshFamilySections ?? []) {
  const record = byRef.get(ref);
  if (!record) throw new Error(`Cannot refresh family section for ${ref}`);
  const parents = unique([record.data.father, record.data.mother, ...(record.data.parents ?? [])]);
  const partners = unique((record.data.partners ?? []).map(partnerTarget));
  const children = unique(childrenByRef.get(ref) ?? []).sort();
  let body = record.body;
  body = replaceFamilyLine(body, 'Родители', relationLinks(parents, byRef));
  body = replaceFamilyLine(body, 'Партнёры', relationLinks(partners, byRef));
  body = replaceFamilyLine(body, 'Дети', relationLinks(children, byRef));
  if (body !== record.body) {
    await writeFile(record.filePath, renderDocument(record.data, body), 'utf8');
    changed += 1;
  }
}

console.log(`Applied reconciled genealogy relations (${changed} file update(s)).`);
