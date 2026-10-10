import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const PEOPLE_ROOT = path.resolve('src/content/docs/people');
const PATRONYMIC_RE = /^[А-ЯЁ][А-ЯЁа-яё-]*(?:ович|евич|ич|овна|евна|ична|инична)$/iu;

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

function splitDocument(content) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;
  return {
    rawFrontmatter: match[1],
    body: content.slice(match[0].length),
  };
}

function patronymicFrom(fullName) {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return undefined;
  const index = parts.findIndex((part, i) => i > 0 && i < parts.length - 1 && PATRONYMIC_RE.test(part));
  if (index < 0) return undefined;
  return { first: parts[0], middle: parts[index] };
}

function displaySurname(data) {
  const current = String(data.name?.display || data.title || '').trim().split(/\s+/).filter(Boolean);
  const currentLast = current.at(-1);
  return data.name?.married_last || data.name?.birth_last || data.name?.last || currentLast;
}

let changed = 0;
for (const filePath of await walk(PEOPLE_ROOT)) {
  const content = await readFile(filePath, 'utf8');
  const document = splitDocument(content);
  if (!document) continue;

  const data = YAML.parse(document.rawFrontmatter) ?? {};
  if (data.entity !== 'person' || data.importManaged !== true || !data.name || typeof data.name !== 'object') continue;

  const extracted = patronymicFrom(data.name.full);
  if (!extracted) continue;

  const last = displaySurname(data);
  const display = [extracted.first, extracted.middle, last].filter(Boolean).join(' ');
  if (!display) continue;

  const alreadyCurrent = data.name.first === extracted.first
    && data.name.middle === extracted.middle
    && data.name.last === last
    && data.name.display === display
    && data.title === display;
  if (alreadyCurrent) continue;

  data.name.first = extracted.first;
  data.name.middle = extracted.middle;
  if (last) data.name.last = last;
  data.name.display = display;
  data.title = display;

  if (typeof data.description === 'string') {
    const suffix = data.description.match(/,\s*(.+)$/)?.[1];
    data.description = suffix ? `${display}, ${suffix}` : display;
  }

  const frontmatter = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  await writeFile(filePath, `---\n${frontmatter}\n---\n${document.body}`, 'utf8');
  changed += 1;
}

console.log(`Enriched ${changed} person record(s) with explicit middle/patronymic names.`);
