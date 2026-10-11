import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = 'src/content/docs/people';

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(full));
    else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function splitFrontmatter(content) {
  if (!content.startsWith('---\n')) return undefined;
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) return undefined;
  return {
    frontmatter: content.slice(0, end + 5),
    body: content.slice(end + 5),
  };
}

function stripDerivedSummary(content) {
  const parts = splitFrontmatter(content);
  if (!parts || !/\bentity:\s*person\b/.test(parts.frontmatter)) return content;

  const biographyIndex = parts.body.indexOf('## Биография');
  if (biographyIndex < 0) return content;

  const prefix = parts.body.slice(0, biographyIndex);
  const familyIndex = prefix.indexOf('## Семья');
  if (familyIndex < 0) return content;

  const looksGenerated = /\*\*(?:Годы жизни|Дата рождения|Место рождения|Фамилия при рождении|Фамилия после брака|Родители|Партнёры|Супруг|Дети|Брат|Сестра):\*\*/.test(prefix)
    || /\bimportManaged:\s*true\b/.test(parts.frontmatter);
  if (!looksGenerated) return content;

  const biography = parts.body.slice(biographyIndex).replace(/^\s+/, '');
  return `${parts.frontmatter}\n${biography}`;
}

let changed = 0;
for (const file of await markdownFiles(ROOT)) {
  const before = await readFile(file, 'utf8');
  const after = stripDerivedSummary(before);
  if (after === before) continue;
  await writeFile(file, after, 'utf8');
  changed += 1;
}

console.log(`Removed frontmatter-derived summary blocks from ${changed} person pages.`);
