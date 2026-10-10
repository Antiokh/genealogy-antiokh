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

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function canonicalRef(filePath) {
  return toPosix(path.relative(PEOPLE_ROOT, filePath));
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

function surnameFromDisplay(value) {
  const cleaned = String(value ?? '').trim().replace(/\s*\([^)]*\)\s*$/u, '').trim();
  if (!cleaned) return undefined;
  return cleanSurname(cleaned.split(/\s+/u).at(-1));
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
  if (/aya$/i.test(value)) return value.replace(/aya$/i, 'yy');
  if (/nyi$/i.test(value)) return value.replace(/nyi$/i, 'nyy');
  if (/(ova|eva|ina|yna)$/i.test(value)) return value.slice(0, -1);
  return value;
}

function canonicalLatinSurname(value) {
  return value.split('-').map(canonicalLatinPart).join('-');
}

function pluralRussianPart(value) {
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
    return { key: slugify(canonical), label: canonical, locale, localized: {} };
  }

  const canonical = canonicalRussianSurname(surname);
  const label = canonical.split('-').map(pluralRussianPart).join('-');
  return { key: slugify(canonical), label, locale, localized: {} };
}

function familyInfo(value) {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const label = value.trim();
    return label ? { key: slugify(label), label, locale: detectLocale(label), localized: {}, roles: [] } : undefined;
  }
  if (!value.key) return undefined;
  return {
    key: String(value.key),
    label: String(value.label || value.key),
    locale: value.locale || detectLocale(value.label || value.key),
    localized: value.localized ?? {},
    roles: Array.isArray(value.roles) ? value.roles.map(String) : [],
    inferred: value.inferred === true,
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

function addMembership(map, family, role, inferred = true) {
  if (!family?.key) return;
  const existing = map.get(family.key) ?? {
    ...family,
    roles: [],
    inferred,
  };
  if (role && !existing.roles.includes(role)) existing.roles.push(role);
  existing.inferred = existing.inferred && inferred;
  map.set(family.key, existing);
}

function partnerTarget(value) {
  return typeof value === 'string' ? value : value?.person;
}

function resolveRef(raw, fromRef, byRef) {
  if (!raw || typeof raw !== 'string') return undefined;
  let candidate = raw.trim().replace(/^\.\//, '').replace(/^people\//, '').replaceAll('\\', '/');
  if (byRef.has(candidate)) return candidate;
  if (!/\.mdx?$/i.test(candidate)) {
    if (byRef.has(`${candidate}.md`)) return `${candidate}.md`;
    if (byRef.has(`${candidate}.mdx`)) return `${candidate}.mdx`;
  }
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(fromRef), candidate));
  if (byRef.has(relative)) return relative;
  if (!/\.mdx?$/i.test(relative)) {
    if (byRef.has(`${relative}.md`)) return `${relative}.md`;
    if (byRef.has(`${relative}.mdx`)) return `${relative}.mdx`;
  }
  return undefined;
}

function familyYaml(families) {
  const lines = ['families:'];
  for (const family of families) {
    lines.push(`  - key: ${JSON.stringify(family.key)}`);
    lines.push(`    label: ${JSON.stringify(family.label)}`);
    lines.push(`    locale: ${family.locale}`);
    if (family.roles?.length) {
      lines.push('    roles:');
      for (const role of family.roles) lines.push(`      - ${role}`);
    }
    if (family.inferred === true) lines.push('    inferred: true');
    const localized = Object.entries(family.localized ?? {});
    if (localized.length) {
      lines.push('    localized:');
      for (const [locale, label] of localized.sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`      ${JSON.stringify(locale)}: ${JSON.stringify(label)}`);
      }
    }
  }
  return lines.join('\n');
}

const records = [];
const byRef = new Map();

for (const filePath of await walk(PEOPLE_ROOT)) {
  const content = await readFile(filePath, 'utf8');
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) continue;
  const data = YAML.parse(match[1]) ?? {};
  if (data.entity !== 'person' || data.importManaged !== true || !data.name || typeof data.name !== 'object') continue;

  const ref = canonicalRef(filePath);
  const display = data.name.display || data.name.full || data.title;
  const personLocale = data.name.locale || detectLocale(display);
  const memberships = new Map();

  addMembership(memberships, familyFromSurname(data.name.birth_last), 'birth');
  addMembership(memberships, familyFromSurname(data.name.last), 'current');
  if (data.name.married_last) {
    addMembership(memberships, familyFromSurname(data.name.married_last), 'current');
    addMembership(memberships, familyFromSurname(data.name.married_last), 'marriage');
  }
  addMembership(memberships, familyFromSurname(surnameFromDisplay(display)), 'current');

  // Preserve explicitly hand-managed memberships. Generated/inferred memberships are rebuilt each import.
  if (Array.isArray(data.families)) {
    for (const raw of data.families) {
      const existing = familyInfo(raw);
      if (!existing || existing.inferred) continue;
      addMembership(memberships, existing, undefined, false);
      for (const role of existing.roles) addMembership(memberships, existing, role, false);
    }
  }

  // The legacy singular family field on imported records was generated metadata; use it only as a fallback.
  if (!memberships.size && data.family) addMembership(memberships, familyInfo(data.family), 'current');

  const record = { filePath, content, match, data, ref, personLocale, memberships };
  records.push(record);
  byRef.set(ref, record);
}

// A woman can also belong to the current family group(s) of her male partner(s).
// This is navigation metadata, not a claim that every partner relation was a legal marriage.
for (const record of records) {
  if (record.data.sex !== 'F') continue;
  for (const rawPartner of record.data.partners ?? []) {
    const partnerRef = resolveRef(partnerTarget(rawPartner), record.ref, byRef);
    const partner = partnerRef ? byRef.get(partnerRef) : undefined;
    if (!partner || partner.data.sex !== 'M') continue;

    const current = [...partner.memberships.values()].filter((family) => family.roles.includes('current'));
    const inherited = current.length
      ? current
      : [...partner.memberships.values()].filter((family) => family.roles.includes('birth'));
    for (const family of inherited) addMembership(record.memberships, family, 'partner');
  }
}

const candidatesByKey = new Map();
for (const record of records) {
  for (const family of record.memberships.values()) {
    if (!candidatesByKey.has(family.key)) candidatesByKey.set(family.key, []);
    candidatesByKey.get(family.key).push({ ...family, personLocale: record.personLocale });
  }
}

const presentationByKey = new Map(
  [...candidatesByKey].map(([key, candidates]) => [key, choosePresentation(candidates)]),
);

let changed = 0;
let withoutFamily = 0;
let multipleFamilies = 0;

for (const record of records) {
  let frontmatter = record.match[1];

  if (!record.data.name.locale) {
    const display = record.data.name.display || record.data.name.full || record.data.title;
    frontmatter = frontmatter.replace(/^name:\s*\r?\n/m, `name:\n  locale: ${detectLocale(display)}\n`);
  }

  frontmatter = frontmatter
    .replace(/\nfamily:\s*\r?\n[\s\S]*?(?=\r?\nsex:)/m, '')
    .replace(/\nfamilies:\s*\r?\n[\s\S]*?(?=\r?\nsex:)/m, '');

  const families = [...record.memberships.values()]
    .map((membership) => ({
      ...(presentationByKey.get(membership.key) ?? membership),
      roles: [...new Set(membership.roles)].sort(),
      inferred: membership.inferred,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  if (!families.length) withoutFamily += 1;
  if (families.length > 1) multipleFamilies += 1;
  if (families.length) frontmatter = frontmatter.replace(/\nsex:/, `\n${familyYaml(families)}\nsex:`);

  const updated = record.content.slice(0, record.match.index)
    + `---\n${frontmatter}\n---`
    + record.content.slice(record.match.index + record.match[0].length);
  if (updated === record.content) continue;
  await writeFile(record.filePath, updated, 'utf8');
  changed += 1;
}

console.log(`Normalized families for ${changed} imported person record(s); ${multipleFamilies} have multiple family memberships; ${withoutFamily} have none.`);
