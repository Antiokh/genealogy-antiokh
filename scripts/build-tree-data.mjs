import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const GRAPH_PATH = path.resolve('public/generated/genealogy.json');
const OUTPUT_PATH = path.resolve('public/generated/tree.json');

const graph = JSON.parse(await readFile(GRAPH_PATH, 'utf8'));
const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
const edges = Array.isArray(graph.edges) ? graph.edges : [];
const byRef = new Map(nodes.map((node) => [node.ref, node]));

function dateYear(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const match = value.match(/(?:^|\D)(\d{4})(?:\D|$)/);
    return match ? Number(match[1]) : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (Number.isFinite(value.year)) return Number(value.year);
  if (value.date !== undefined) return dateYear(value.date);
  if (value.text !== undefined) return dateYear(value.text);
  return undefined;
}

function yearsLabel(node) {
  const born = dateYear(node.born);
  const died = dateYear(node.died);
  if (born && died) return `${born}–${died}`;
  if (born) return `${born}–`;
  if (died) return `–${died}`;
  return '';
}

function relationDate(value) {
  if (!value) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value.date !== undefined) return relationDate(value.date);
  if (value.text) return String(value.text);
  if (value.year) return [value.day, value.month, value.year].filter(Boolean).join('.');
  return '';
}

function relationKnown(value) {
  if (!value) return false;
  if (typeof value === 'object' && value.known === false) return false;
  return true;
}

const people = nodes.map((node) => ({
  id: node.ref,
  url: node.url,
  name: node.displayName || node.title || node.ref,
  cardName: node.displayName || node.title || node.ref,
  birthSurname: node.name?.birth_last || node.name?.birthSurname || '',
  marriedSurname: node.name?.married_last || node.name?.marriedSurname || '',
  years: yearsLabel(node),
  sex: node.sex || '',
  deceased: node.died?.known === true || Boolean(dateYear(node.died)),
  photo: node.photo || '',
  component: node.component || null,
}));

const unionByKey = new Map();

function normalizedPartners(values) {
  return [...new Set(values.filter((ref) => byRef.has(ref)))].sort();
}

function ensureUnion(values) {
  const partners = normalizedPartners(values);
  if (!partners.length) return undefined;
  const key = partners.join('|');
  if (!unionByKey.has(key)) {
    unionByKey.set(key, {
      key,
      partners,
      children: new Set(),
      labels: new Set(),
      relation: {
        kind: 'parents',
        explicit: false,
        married: '',
        divorced: '',
      },
    });
  }
  return unionByKey.get(key);
}

for (const node of nodes) {
  const parents = normalizedPartners([node.father, node.mother, ...(node.parents || [])]);
  if (!parents.length) continue;
  ensureUnion(parents)?.children.add(node.ref);
}

for (const edge of edges) {
  if (edge.type !== 'partner') continue;
  const union = ensureUnion([edge.source, edge.target]);
  if (!union) continue;

  const married = relationDate(edge.married);
  const divorced = relationDate(edge.divorced);
  const marriedKnown = relationKnown(edge.married);
  const divorcedKnown = relationKnown(edge.divorced);

  union.relation = {
    kind: divorcedKnown ? 'divorced' : marriedKnown ? 'married' : 'partner',
    explicit: true,
    married,
    divorced,
  };

  if (married && divorced) union.labels.add(`${married}–${divorced}`);
  else if (married) union.labels.add(married);
  else if (divorced) union.labels.add(divorced);
}

const families = [...unionByKey.values()]
  .sort((a, b) => a.key.localeCompare(b.key))
  .map((union, index) => ({
    id: `U${String(index + 1).padStart(4, '0')}`,
    partners: union.partners,
    children: [...union.children].sort(),
    label: [...union.labels][0] || '',
    relation: union.relation,
  }));

const familyMembershipCount = new Map(people.map((person) => [person.id, 0]));
for (const family of families) {
  if (family.partners.length < 2) continue;
  for (const partner of family.partners) {
    familyMembershipCount.set(partner, (familyMembershipCount.get(partner) || 0) + 1);
  }
}

const errors = [];
for (const family of families) {
  for (const ref of [...family.partners, ...family.children]) {
    if (!byRef.has(ref)) errors.push(`${family.id}: unresolved person ${ref}`);
  }
}
for (const node of nodes) {
  const parents = normalizedPartners([node.father, node.mother, ...(node.parents || [])]);
  if (!parents.length) continue;
  const matching = families.find((family) => family.partners.length === parents.length
    && family.partners.every((ref, index) => ref === parents[index]));
  if (!matching?.children.includes(node.ref)) {
    errors.push(`${node.ref}: missing canonical parent union`);
  }
}
if (errors.length) {
  console.error(`Tree data validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const output = {
  schema: 'genealogy-tree-2',
  sourceGraph: graph.schema,
  summary: {
    people: people.length,
    families: families.length,
    parentFamilies: families.filter((family) => family.children.length > 0).length,
    partnerOnlyFamilies: families.filter((family) => family.children.length === 0 && family.partners.length > 1).length,
    multiPartnerPeople: [...familyMembershipCount.values()].filter((count) => count > 1).length,
    components: graph.summary?.components ?? graph.components?.length ?? 0,
  },
  people,
  families,
};

await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Built tree data: ${output.summary.people} people, ${output.summary.families} unions, ${output.summary.multiPartnerPeople} people in multiple partner unions.`);
