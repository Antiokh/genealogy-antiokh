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
  const text = String(value ?? '');
  if (/[А-ЯЁа-яё]/u.test(text)) return 'ru';
  if (/[A-Za-zÀ-ž]/u.test(text)) return 'und-Latn';
  return 'und';
}

function cleanSurname(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s*\([^)]*\)\s*$/u, '')
    .trim();
}

function masculineRussianPart(value) {
  if (/цкая$/iu.test(value)) return value.replace(/цкая$/iu, 'цкий');
  if (/ская$/iu.test(value)) return value.replace(/ская$/iu, 'ский');
  if (/ёва$/iu.test(value)) return value.replace(/а$/iu, '');
  if (/(ова|ева|ина|ына)$/iu.test(value)) return value.replace(/а$/iu, '');
  if (/ая$/iu.test(value)) return value.replace(/ая$/iu, 'ый');
  if (/яя$/iu.test(value)) return value.replace(/яя$/iu, 'ий');
  return value;
}

function canonicalRussianSurname(value) {
  return value.split('-').map(masculineRussianPart).join('-');
}

function canonicalLatinPart(value) {
  if (/tskaya$/i.test(value)) return value.replace(/tskaya$/i, 'tskiy');
  if (/skaya$/i.test(value)) return value.replace(/skaya$/i, 'skiy');
  if (/(ova|eva|ina|yna)$/i.test(value)) return value.slice(0, -1);
  return value;
}

function canonicalLatinSurname(value) {
  return value.split('-').map(canonicalLatinPart).join('-');
}

function pluralRussianPart(value) {
  // Russian surnames ending in -их/-ых do not acquire another plural ending.
  if (/(их|ых)$/iu.test(value)) return value;
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
    const canonical = canonicalLatinSurname(surname);
    return { key: slugify(canonical), label: canonical, locale };
  }

  const canonical = canonicalRussianSurname(surname);
  const label = canonical.split('-').map(pluralRussianPart).join('-');
  return { key: slugify(canonical), label, locale };
}

function existingFamily(data) {
  if (!data.family) return undefined;
  if (typeof data.family === 'string') {
    const label = data.family.trim();
    return label ? { key: slugify(label), label, locale: detectLocale(label), localized: {} } : undefined;
  }
  if (!data.family.key) return undefined;
  return {
    key: String(data.family.key),
    label: String(data.family.label || data.family.key),
    locale: data.family.locale || detectLocale(data.family.label || data.family.key),
    localized: data.family.localized ?? {},
  };
}

function localeClass(locale) {
  if (String(locale).toLowerCase().startsWith('ru')) return 'ru';
  if (String(locale).toLowerCase().includes('latn') || String(locale).toLowerCase().startsWith('en')) return 'latn';
  return 'other';
}

function choosePresentation(candidates) {
  const variantCounts = new Map();
  const personLocaleCounts = { ru: 0, latn: 0, other: 0 };

  function addVariant(locale, label) {
    if (!locale || !label) return;
    const key = `${locale}:${label}`;
    const previous = variantCounts.get(key) ?? { locale, label, count: 0 };
    previous.count += 1;
    variantCounts.set(key, previous);
  }

  for (const candidate of candidates) {
    personLocaleCounts[localeClass(candidate.personLocale)] += 1;
    addVariant(candidate.locale, candidate.label);
    for (const [locale, label] of Object.entries(candidate.localized ?? {})) addVariant(locale, label);
  }

  const variants = [...variantCounts.values()];
  const preferredClass = personLocaleCounts.ru >= personLocaleCounts.latn ? 'ru' : 'latn';
  const preferred = variants
    .filter((variant) => localeClass(variant.locale) === preferredClass)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0];
  const primary = preferred
    ?? variants.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0]
    ?? candidates[0];

  const bestByLocale = new Map();
  for (const variant of variants) {
    if (variant.locale === primary.locale && variant.label === primary.label) continue;
    const existing = bestByLocale.get(variant.locale);
    if (!existing || variant.count > existing.count) bestByLocale.set(variant.locale, variant);
  }

  return {
    key: candidates[0].key,
    label: primary.label,
    locale: primary.locale,
    localized: Object.fromEntries([...bestByLocale].map(([locale, variant]) => [locale, variant.label])),
  };
}

function familyYaml(family) {
  const lines = [
    'family:',
    `  key: ${JSON.stringify(family.key)}`,
    `  label: ${JSON.stringify(family.label)}`,
    `  locale: ${family.locale}`,
  ];
  const localized = Object.entries(family.localized ?? {});
  if (localized.length) {
    lines.push('  localized:');
    for (const [locale, label] of localized.sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`    ${JSON.stringify(locale)}: ${JSON.stringify(label)}`);
    }
  }
  return lines.join('\n');
}

const records = [];
const candidatesByKey = new Map();
let withoutSurname = 0;

for (const filePath of await walk(PEOPLE_ROOT)) {
  const content = await readFile(filePath, 'utf8');
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) continue;
  const data = YAML.parse(match[1]) ?? {};
  if (data.entity !== 'person' || data.importManaged !== true || !data.name || typeof data.name !== 'object') continue;

  const display = data.name.display || data.name.full || data.title;
  const personLocale = data.name.locale || detectLocale(display);
  const surname = data.name.married_last || data.name.last || data.name.birth_last;
  // Snapshot-imported family values are generated defaults, so recalculate them from the current surname.
  // A hand-managed record can set family independently and is not touched by this importer enrichment.
  const family = familyFromSurname(surname) || existingFamily(data);
  if (!family) withoutSurname += 1;
  else {
    if (!candidatesByKey.has(family.key)) candidatesByKey.set(family.key, []);
    candidatesByKey.get(family.key).push({ ...family, personLocale });
  }

  records.push({ filePath, content, match, data, family });
}

const presentationByKey = new Map(
  [...candidatesByKey].map(([key, candidates]) => [key, choosePresentation(candidates)]),
);

let changed = 0;
for (const record of records) {
  let frontmatter = record.match[1];
  let touched = false;

  if (!record.data.name.locale) {
    const display = record.data.name.display || record.data.name.full || record.data.title;
    const locale = detectLocale(display);
    frontmatter = frontmatter.replace(/^name:\s*\r?\n/m, `name:\n  locale: ${locale}\n`);
    touched = true;
  }

  // Family is navigation metadata. Rebuild only this generated block; it stays independent from name.last.
  frontmatter = frontmatter.replace(/\nfamily:\s*\r?\n[\s\S]*?\r?\n(?=sex:)/m, '\n');
  if (record.family) {
    const presentation = presentationByKey.get(record.family.key) ?? record.family;
    frontmatter = frontmatter.replace(/\nsex:/, `\n${familyYaml(presentation)}\nsex:`);
    touched = true;
  }

  if (!touched) continue;
  const updated = record.content.slice(0, record.match.index)
    + `---\n${frontmatter}\n---`
    + record.content.slice(record.match.index + record.match[0].length);
  if (updated === record.content) continue;
  await writeFile(record.filePath, updated, 'utf8');
  changed += 1;
}

console.log(`Normalized name locale/family metadata for ${changed} imported person record(s); ${withoutSurname} had no safe surname default.`);
