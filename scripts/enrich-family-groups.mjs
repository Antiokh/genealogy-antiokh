import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const PEOPLE_ROOT = path.resolve('src/content/docs/people');

const cyrillicMap = new Map(Object.entries({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
}));

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
    .replace(/^-+|-+$/g, '') || 'family';
}

function detectLocale(value) {
  return /[А-ЯЁа-яё]/u.test(value) ? 'ru' : 'en';
}

function cleanSurname(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim();
}

function masculineRussianPart(value) {
  if (/ская$/iu.test(value)) return value.replace(/ская$/iu, 'ский');
  if (/цкая$/iu.test(value)) return value.replace(/цкая$/iu, 'цкий');
  if (/ёва$/iu.test(value)) return value.replace(/а$/iu, '');
  if (/(ова|ева|ина|ына)$/iu.test(value)) return value.replace(/а$/iu, '');
  if (/ая$/iu.test(value)) return value.replace(/ая$/iu, 'ый');
  if (/яя$/iu.test(value)) return value.replace(/яя$/iu, 'ий');
  return value;
}

function canonicalRussianSurname(value) {
  return value.split('-').map(masculineRussianPart).join('-');
}

function pluralRussianPart(value) {
  if (/цкий$/iu.test(value)) return value.replace(/цкий$/iu, 'цкие');
  if (/ский$/iu.test(value)) return value.replace(/ский$/iu, 'ские');
  if (/ый$/iu.test(value)) return value.replace(/ый$/iu, 'ые');
  if (/ий$/iu.test(value)) return value.replace(/ий$/iu, 'ие');
  if (/ой$/iu.test(value)) return value.replace(/ой$/iu, 'ые');
  if (/[оеиуюэя]$/iu.test(value)) return value;
  if (/[гкхжчшщц]$/iu.test(value)) return `${value}и`;
  return `${value}ы`;
}

function familyFromSurname(rawSurname) {
  const surname = cleanSurname(rawSurname);
  if (!surname) return undefined;
  const locale = detectLocale(surname);
  if (locale !== 'ru') {
    return { key: slugify(surname), label: surname, locale };
  }

  const canonical = canonicalRussianSurname(surname);
  const label = canonical.split('-').map(pluralRussianPart).join('-');
  return { key: slugify(canonical), label, locale };
}

let changed = 0;
let skipped = 0;
for (const filePath of await walk(PEOPLE_ROOT)) {
  const content = await readFile(filePath, 'utf8');
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) continue;
  const data = YAML.parse(match[1]) ?? {};
  if (data.entity !== 'person' || data.importManaged !== true || data.family) continue;
  if (!data.name || typeof data.name !== 'object') continue;

  // Prefer the current/married surname for the default navigation group.
  // This is only a default: family is independent metadata and can be edited by hand.
  const surname = data.name.married_last || data.name.last || data.name.birth_last;
  const family = familyFromSurname(surname);
  if (!family) {
    skipped += 1;
    continue;
  }

  const familyYaml = [
    'family:',
    `  key: ${JSON.stringify(family.key)}`,
    `  label: ${JSON.stringify(family.label)}`,
    `  locale: ${family.locale}`,
  ].join('\n');

  const updatedFrontmatter = match[1].replace(/\nsex:/, `\n${familyYaml}\nsex:`);
  if (updatedFrontmatter === match[1]) {
    skipped += 1;
    continue;
  }

  const updated = content.slice(0, match.index) + `---\n${updatedFrontmatter}\n---` + content.slice(match.index + match[0].length);
  await writeFile(filePath, updated, 'utf8');
  changed += 1;
}

console.log(`Added family grouping to ${changed} imported person record(s); ${skipped} had no safe surname default.`);
