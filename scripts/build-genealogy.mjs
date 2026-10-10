import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const PEOPLE_ROOT = path.resolve('src/content/docs/people');
const OUTPUT_ROOT = path.resolve('public/generated');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function parseFrontmatter(content, filePath) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${filePath}`);
  return YAML.parse(match[1]) ?? {};
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function canonicalRef(filePath) {
  return toPosix(path.relative(PEOPLE_ROOT, filePath));
}

function pageUrl(ref) {
  return `/people/${ref.replace(/\.(md|mdx)$/i, '')}/`;
}

function displayName(data, ref) {
  if (typeof data.name === 'string' && data.name.trim()) return data.displayName || data.name;
  if (data.name && typeof data.name === 'object') {
    if (data.name.display) return data.name.display;
    if (data.name.full) return data.name.full;
    const pieces = [data.name.first, data.name.middle || data.name.patronymic, data.name.last].filter(Boolean);
    if (pieces.length) return pieces.join(' ');
  }
  return data.displayName || data.title || ref;
}

function normalizedName(data) {
  if (data.name && typeof data.name === 'object') return data.name;
  return {
    full: typeof data.name === 'string' ? data.name : data.title,
    display: data.displayName || data.title,
    birth_last: data.birthSurname,
    married_last: data.marriedSurname,
    aliases: [],
  };
}

function normalizedEvent(primary, legacy, deceased = false) {
  if (primary && typeof primary === 'object') return primary;
  if (legacy && typeof legacy === 'object') {
    const date = Object.keys(legacy).length ? legacy : undefined;
    return date ? { date } : undefined;
  }
  if (deceased) return { known: true };
  return undefined;
}

function partnerTarget(value) {
  return typeof value === 'string' ? value : value?.person;
}

function partnerMetadata(value) {
  if (typeof value === 'string') return {};
  return {
    ...(value?.married ? { married: value.married } : {}),
    ...(value?.divorced ? { divorced: value.divorced } : {}),
  };
}

const files = await walk(PEOPLE_ROOT);
const people = [];

for (const filePath of files) {
  const data = parseFrontmatter(await readFile(filePath, 'utf8'), filePath);
  if (data.entity !== 'person') continue;
  const ref = canonicalRef(filePath);
  people.push({
    ref,
    filePath,
    url: pageUrl(ref),
    data,
  });
}

people.sort((a, b) => a.ref.localeCompare(b.ref));

const byRef = new Map(people.map((person) => [person.ref, person]));
const byLegacyId = new Map(
  people
    .filter((person) => typeof person.data.id === 'string')
    .map((person) => [person.data.id, person.ref]),
);

function resolveRef(raw, fromRef) {
  if (!raw || typeof raw !== 'string') return undefined;
  if (byLegacyId.has(raw)) return byLegacyId.get(raw);

  let candidate = raw.trim().replace(/^\.\//, '').replace(/^people\//, '');
  candidate = candidate.replaceAll('\\', '/');

  if (byRef.has(candidate)) return candidate;
  if (!/\.mdx?$/i.test(candidate)) {
    if (byRef.has(`${candidate}.md`)) return `${candidate}.md`;
    if (byRef.has(`${candidate}.mdx`)) return `${candidate}.mdx`;
  }

  // Also accept truly relative refs while authoring, but canonical output remains people-root-relative.
  const fromDirectory = path.posix.dirname(fromRef);
  const relativeCandidate = path.posix.normalize(path.posix.join(fromDirectory, candidate));
  if (byRef.has(relativeCandidate)) return relativeCandidate;
  if (!/\.mdx?$/i.test(relativeCandidate)) {
    if (byRef.has(`${relativeCandidate}.md`)) return `${relativeCandidate}.md`;
    if (byRef.has(`${relativeCandidate}.mdx`)) return `${relativeCandidate}.mdx`;
  }

  return undefined;
}

const errors = [];
const records = new Map();

for (const person of people) {
  const { data, ref } = person;
  const rawParents = Array.isArray(data.parents) ? data.parents : [];
  const rawPartners = Array.isArray(data.partners) ? data.partners : [];

  const resolvedParents = [];
  for (const raw of rawParents) {
    const target = resolveRef(raw, ref);
    if (!target) errors.push(`${ref}: unresolved parent reference ${JSON.stringify(raw)}`);
    else resolvedParents.push(target);
  }

  let father = data.father ? resolveRef(data.father, ref) : undefined;
  let mother = data.mother ? resolveRef(data.mother, ref) : undefined;
  if (data.father && !father) errors.push(`${ref}: unresolved father reference ${JSON.stringify(data.father)}`);
  if (data.mother && !mother) errors.push(`${ref}: unresolved mother reference ${JSON.stringify(data.mother)}`);

  const partners = [];
  for (const raw of rawPartners) {
    const targetRaw = partnerTarget(raw);
    const target = resolveRef(targetRaw, ref);
    if (!target) {
      errors.push(`${ref}: unresolved partner reference ${JSON.stringify(targetRaw)}`);
      continue;
    }
    partners.push({ person: target, ...partnerMetadata(raw) });
  }

  records.set(ref, {
    ref,
    url: person.url,
    title: data.title || displayName(data, ref),
    name: normalizedName(data),
    displayName: displayName(data, ref),
    sex: data.sex,
    photo: data.photo,
    born: normalizedEvent(data.born, data.birth),
    died: normalizedEvent(data.died, data.death, data.deceased === true),
    buried: data.buried,
    occupation: data.occupation ?? [],
    residence: data.residence ?? [],
    sources: data.sources ?? [],
    external: data.external ?? {},
    legacyId: data.id,
    father,
    mother,
    parents: [...new Set(resolvedParents)],
    partners,
    children: [],
    siblings: [],
    connected: false,
    component: null,
  });
}

// Infer father/mother from the transitional generic parents array when sex makes it unambiguous.
for (const record of records.values()) {
  for (const parentRef of record.parents) {
    const parent = records.get(parentRef);
    if (!parent) continue;
    if (!record.father && parent.sex === 'M') record.father = parentRef;
    else if (!record.mother && parent.sex === 'F') record.mother = parentRef;
  }

  const canonicalParents = [record.father, record.mother, ...record.parents].filter(Boolean);
  record.parents = [...new Set(canonicalParents)];
}

const edgeMap = new Map();
const adjacency = new Map([...records.keys()].map((ref) => [ref, new Set()]));

function addEdge(edge) {
  if (!edge.source || !edge.target || edge.source === edge.target) {
    if (edge.source === edge.target) errors.push(`${edge.source}: self-reference is not allowed`);
    return;
  }
  const key = edge.type === 'partner'
    ? `${edge.type}:${[edge.source, edge.target].sort().join('|')}`
    : `${edge.type}:${edge.source}|${edge.target}|${edge.role ?? ''}`;
  if (!edgeMap.has(key)) edgeMap.set(key, edge);
  adjacency.get(edge.source)?.add(edge.target);
  adjacency.get(edge.target)?.add(edge.source);
}

for (const record of records.values()) {
  if (record.father) addEdge({ source: record.father, target: record.ref, type: 'parent', role: 'father' });
  if (record.mother) addEdge({ source: record.mother, target: record.ref, type: 'parent', role: 'mother' });

  for (const parentRef of record.parents) {
    if (parentRef === record.father || parentRef === record.mother) continue;
    addEdge({ source: parentRef, target: record.ref, type: 'parent', role: 'parent' });
  }

  for (const partner of record.partners) {
    const [source, target] = [record.ref, partner.person].sort();
    addEdge({ source, target, type: 'partner', ...partnerMetadata(partner) });
  }
}

for (const edge of edgeMap.values()) {
  if (edge.type !== 'parent') continue;
  records.get(edge.source)?.children.push(edge.target);
}

for (const record of records.values()) {
  record.children = [...new Set(record.children)].sort();
  const siblings = new Set();
  for (const parentRef of record.parents) {
    for (const childRef of records.get(parentRef)?.children ?? []) {
      if (childRef !== record.ref) siblings.add(childRef);
    }
  }
  record.siblings = [...siblings].sort();
  record.connected = (adjacency.get(record.ref)?.size ?? 0) > 0;
}

const connectedRefs = [...records.values()].filter((record) => record.connected).map((record) => record.ref);
const visited = new Set();
const components = [];

for (const start of connectedRefs) {
  if (visited.has(start)) continue;
  const queue = [start];
  const members = [];
  visited.add(start);

  while (queue.length) {
    const current = queue.shift();
    members.push(current);
    for (const next of adjacency.get(current) ?? []) {
      if (!records.get(next)?.connected || visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  members.sort();
  components.push({ members });
}

components.sort((a, b) => b.members.length - a.members.length || a.members[0].localeCompare(b.members[0]));
components.forEach((component, index) => {
  component.id = `C${String(index + 1).padStart(3, '0')}`;
  component.size = component.members.length;
  for (const ref of component.members) records.get(ref).component = component.id;
});

if (errors.length) {
  console.error(`Genealogy validation failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const allPeople = [...records.values()].map((record) => ({
  ...record,
  partners: record.partners.sort((a, b) => a.person.localeCompare(b.person)),
}));

const visualPeople = allPeople.filter((record) => record.connected);
const visualRefs = new Set(visualPeople.map((record) => record.ref));
const visualEdges = [...edgeMap.values()].filter((edge) => visualRefs.has(edge.source) && visualRefs.has(edge.target));

const peopleOutput = {
  schema: 'genealogy-people-1',
  summary: {
    people: allPeople.length,
    connected: visualPeople.length,
    unconnected: allPeople.length - visualPeople.length,
  },
  people: allPeople,
};

const genealogyOutput = {
  schema: 'genealogy-graph-1',
  summary: {
    people: visualPeople.length,
    edges: visualEdges.length,
    components: components.length,
  },
  nodes: visualPeople,
  edges: visualEdges,
  components,
};

await mkdir(OUTPUT_ROOT, { recursive: true });
await writeFile(path.join(OUTPUT_ROOT, 'people.json'), `${JSON.stringify(peopleOutput, null, 2)}\n`, 'utf8');
await writeFile(path.join(OUTPUT_ROOT, 'genealogy.json'), `${JSON.stringify(genealogyOutput, null, 2)}\n`, 'utf8');

console.log(`Built ${allPeople.length} people: ${visualPeople.length} connected, ${allPeople.length - visualPeople.length} unconnected.`);
console.log(`Visual graph: ${visualEdges.length} edges in ${components.length} connected component(s).`);
