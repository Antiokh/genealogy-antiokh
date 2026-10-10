import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const PEOPLE_ROOT = path.resolve('src/content/docs/people');
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

function refFor(filePath) {
  return path.relative(PEOPLE_ROOT, filePath).split(path.sep).join('/');
}

function frontmatter(content) {
  const raw = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1];
  return raw ? (YAML.parse(raw) ?? {}) : {};
}

const metadata = new Map();
for (const filePath of await walk(PEOPLE_ROOT)) {
  const data = frontmatter(await readFile(filePath, 'utf8'));
  if (data.entity !== 'person') continue;
  const families = Array.isArray(data.families)
    ? data.families
    : data.family
      ? [data.family]
      : [];
  metadata.set(refFor(filePath), { families });
}

async function augment(filename, arrayKey) {
  const filePath = path.join(OUTPUT_ROOT, filename);
  const data = JSON.parse(await readFile(filePath, 'utf8'));
  data[arrayKey] = data[arrayKey].map((person) => ({
    ...person,
    ...(metadata.get(person.ref) ?? {}),
  }));
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

await augment('people.json', 'people');
await augment('genealogy.json', 'nodes');
console.log(`Attached frontmatter metadata to ${metadata.size} generated person record(s).`);
