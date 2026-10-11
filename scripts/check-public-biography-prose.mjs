import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const PEOPLE_ROOT = path.resolve('src/content/docs/people');

async function walk(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.isFile() && /\.mdx?$/i.test(entry.name)) out.push(full);
  }
  return out;
}

function bodyOnly(content) {
  const match = content.match(/^---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return match ? content.slice(match[0].length) : content;
}

const forbidden = [
  ['frontmatter', /\bfrontmatter\b/iu],
  ['article/card self-reference', /\b(?:в\s+этой|в\s+данной)\s+карточк\w*/iu],
  ['main-text composition note', /\bв\s+основном\s+тексте\b/iu],
  ['structured-data commentary', /\bструктурированн\w*\s+(?:событ\w*|данн\w*)/iu],
  ['cross-card editorial note', /\bразнес\w*\s+(?:по|в)\s+[^.\n]{0,80}карточк\w*/iu],
  ['project-internal status note', /\bв\s+проекте\s+(?:отмеч\w*|сохран\w*|зафиксир\w*)/iu],
  ['project event-model note', /\bсобытийн\w*\s+модел\w*\s+проект\w*/iu],
  ['confidence bookkeeping', /\b(?:пониженн\w*|низк\w*)\s+уверенн\w*/iu],
  ['analytics/storage note', /\b(?:табличн\w*\s+аналитик\w*|для\s+[^.\n]{0,60}аналитик\w*)/iu],
  ['editorial omission rationale', /\bнецелесообразно\s+(?:механически\s+)?перечисл\w*/iu],
  ['source-strength bookkeeping', /\b(?:источников\w*|документальн\w*)\s+опор\w*/iu],
];

const violations = [];
for (const file of await walk(PEOPLE_ROOT)) {
  const body = bodyOnly(await readFile(file, 'utf8'));
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const [label, pattern] of forbidden) {
      if (pattern.test(lines[index])) {
        violations.push({
          file: path.relative(process.cwd(), file),
          line: index + 1,
          label,
          text: lines[index].trim(),
        });
      }
      pattern.lastIndex = 0;
    }
  }
}

if (violations.length) {
  console.error('Public biography prose contains repository/editorial meta-commentary:');
  for (const item of violations) {
    console.error(`- ${item.file}:${item.line} [${item.label}] ${item.text}`);
  }
  console.error('\nPerson-page Markdown bodies must contain only reader-facing biographical prose.');
  process.exit(1);
}

console.log('Public biography prose guard passed.');
