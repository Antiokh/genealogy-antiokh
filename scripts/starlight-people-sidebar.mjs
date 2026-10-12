import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const PEOPLE_ROOT = path.resolve('src/content/docs/people');

const cyrillicMap = new Map(Object.entries({
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
  ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', ђ: 'dj', џ: 'dz', ѕ: 'dz', ѓ: 'gj', ќ: 'kj',
}));

function transliterate(value) {
  return [...String(value).toLowerCase()]
    .map((char) => cyrillicMap.get(char) ?? char)
    .join('')
    .replaceAll('ß', 'ss')
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'o')
    .replaceAll('ł', 'l');
}

export function genealogySortKey(value) {
  return transliterate(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function readFrontmatter(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const raw = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1];
  return raw ? (YAML.parse(raw) ?? {}) : {};
}

function nonEmptyString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function personSurname(data) {
  if (!data?.name || typeof data.name !== 'object') return '';
  return nonEmptyString(data.name.last)
    || nonEmptyString(data.name.birth_last)
    || nonEmptyString(data.name.married_last);
}

/**
 * Public navigation is intentionally narrower than the genealogy graph.
 *
 * Hard exclusions:
 * - import-managed records are implementation/import data, not catalog entries;
 * - records without a structured surname are too weakly identified for the menu.
 *
 * `public: false` is an explicit editorial opt-out. Existing curated records predate
 * the flag, so an omitted `public` value remains visible for backwards compatibility.
 * `public: true` documents publication intent but never overrides the two hard gates.
 */
export function isPublicCatalogPerson(data) {
  if (data?.entity !== 'person') return false;
  if (data.importManaged === true) return false;
  if (!personSurname(data)) return false;
  return data.public !== false;
}

function localizedName(data, locale) {
  if (!locale || !data.name || typeof data.name !== 'object') return undefined;
  return data.name.localized?.[locale];
}

function nameFromParts(name) {
  if (!name || typeof name !== 'object') return undefined;
  const parts = [name.first, name.middle || name.patronymic, name.last].filter(Boolean);
  return parts.length ? parts.join(' ') : name.display;
}

function personLabel(data, filePath) {
  if (data.name && typeof data.name === 'object') {
    const fio = nameFromParts(data.name);
    if (fio && data.name.first && data.name.last) return fio;
    if (data.name.display) return data.name.display;
    if (data.name.full) return data.name.full;
  }
  if (typeof data.name === 'string' && data.name.trim()) return data.name.trim();
  if (data.title) return String(data.title);
  return path.basename(filePath, path.extname(filePath));
}

function localePersonSortLabel(data, label, locale) {
  const local = localizedName(data, locale);
  if (local) return local.display || nameFromParts(local) || label;
  if (String(locale).toLowerCase().startsWith('ru')) return label;
  return genealogySortKey(label) || label;
}

function detectLocale(value) {
  const text = String(value ?? '');
  if (/[А-ЯЁа-яёІіЇїЄєҐґЈјЉљЊњЋћЂђЏџ]/u.test(text)) return 'ru';
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
  if (/aya$/i.test(value)) return value.replace(/aya$/i, 'yy');
  if (/nyi$/i.test(value)) return value.replace(/nyi$/i, 'nyy');
  if (/(ova|eva|ina|yna)$/i.test(value)) return value.slice(0, -1);
  return value;
}

function canonicalLatinSurname(value) {
  return value.split('-').map(canonicalLatinPart).join('-');
}

export function familyKeyFromSurname(rawSurname) {
  const surname = cleanSurname(rawSurname);
  if (!surname) return '';
  const canonical = detectLocale(surname) === 'ru'
    ? canonicalRussianSurname(surname)
    : canonicalLatinSurname(surname);
  return genealogySortKey(canonical).replace(/\s+/g, '-');
}

function aliasSurname(value) {
  const cleaned = cleanSurname(value);
  if (!cleaned) return '';
  const parts = cleaned.split(/\s+/u).filter(Boolean);
  return parts.length >= 2 ? cleanSurname(parts.at(-1)) : '';
}

function surnameCandidates(data) {
  if (!data?.name || typeof data.name !== 'object') return [];
  const candidates = [data.name.last, data.name.birth_last, data.name.married_last];

  for (const localized of Object.values(data.name.localized ?? {})) {
    if (!localized || typeof localized !== 'object') continue;
    candidates.push(localized.last, localized.birth_last, localized.married_last);
  }

  for (const alias of data.name.aliases ?? []) candidates.push(aliasSurname(alias));
  return [...new Set(candidates.map(cleanSurname).filter(Boolean))];
}

function normalizedSurnamePresentation(value) {
  return cleanSurname(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function familyMatchesPerson(family, data) {
  const candidates = surnameCandidates(data);
  if (!candidates.length) return false;

  const keys = new Set(candidates.map(familyKeyFromSurname).filter(Boolean));
  if (keys.has(family.key)) return true;

  const surnameForms = new Set(candidates.map(normalizedSurnamePresentation).filter(Boolean));
  const familyForms = [family.label, ...Object.values(family.localized ?? {})]
    .map(normalizedSurnamePresentation)
    .filter(Boolean);
  return familyForms.some((form) => surnameForms.has(form));
}

function familyInfo(value) {
  if (!value) return undefined;
  if (typeof value === 'string') {
    const label = value.trim();
    if (!label) return undefined;
    return {
      key: genealogySortKey(label) || label.toLowerCase(),
      label,
      locale: detectLocale(label),
      localized: {},
      roles: [],
      inferred: false,
    };
  }

  const key = String(value.key ?? '').trim();
  const label = String(value.label || key).trim();
  if (!key || !label) return undefined;
  return {
    key,
    label,
    locale: value.locale || detectLocale(label),
    localized: value.localized ?? {},
    roles: Array.isArray(value.roles) ? value.roles.map(String) : [],
    inferred: value.inferred === true,
  };
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

function isCoherentInferredFamily(family, record, byRef) {
  if (!family.inferred) return true;
  if (familyMatchesPerson(family, record.data)) return true;
  if (!family.roles.includes('partner')) return false;

  for (const rawPartner of record.data.partners ?? []) {
    const partnerRef = resolveRef(partnerTarget(rawPartner), record.ref, byRef);
    const partner = partnerRef ? byRef.get(partnerRef) : undefined;
    if (partner && familyMatchesPerson(family, partner.data)) return true;
  }
  return false;
}

function rawFamilyInfos(data) {
  const rawFamilies = Array.isArray(data.families) && data.families.length
    ? data.families
    : data.family
      ? [data.family]
      : [];
  const unique = new Map();
  for (const raw of rawFamilies) {
    const family = familyInfo(raw);
    if (!family) continue;
    if (!unique.has(family.key)) unique.set(family.key, family);
  }
  return [...unique.values()];
}

function familyInfos(record, byRef) {
  return rawFamilyInfos(record.data).filter((family) => isCoherentInferredFamily(family, record, byRef));
}

function collectPersonRecords(directory, relative = '') {
  const records = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const absolute = path.join(directory, entry.name);
    const nextRelative = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      records.push(...collectPersonRecords(absolute, nextRelative));
      continue;
    }
    if (!entry.isFile() || !/\.mdx?$/i.test(entry.name)) continue;
    if (/^index\.mdx?$/i.test(entry.name) && !relative) continue;

    const data = readFrontmatter(absolute);
    if (data.entity !== 'person') continue;
    const ref = nextRelative;
    const slug = nextRelative.replace(/\.mdx?$/i, '').replace(/\/index$/i, '');
    records.push({ data, ref, slug, filePath: absolute });
  }
  return records;
}

function loadPersonRecords() {
  const records = collectPersonRecords(PEOPLE_ROOT);
  return { records, byRef: new Map(records.map((record) => [record.ref, record])) };
}

export function publicFamilyMembershipIssues() {
  const { records, byRef } = loadPersonRecords();
  const issues = [];

  for (const record of records) {
    if (!isPublicCatalogPerson(record.data)) continue;
    for (const family of rawFamilyInfos(record.data)) {
      if (isCoherentInferredFamily(family, record, byRef)) continue;
      issues.push({
        slug: record.slug,
        filePath: record.filePath,
        key: family.key,
        label: family.label,
        roles: family.roles,
      });
    }
  }
  return issues;
}

function collectPersonPages(records, byRef) {
  const pages = [];
  for (const record of records) {
    if (!isPublicCatalogPerson(record.data)) continue;
    const families = familyInfos(record, byRef);
    const label = personLabel(record.data, record.filePath);
    pages.push({ families, label, slug: record.slug, data: record.data });
  }
  return pages;
}

function collator(locale) {
  try {
    const normalized = locale === 'und' || locale === 'und-Latn' ? 'en' : locale;
    return new Intl.Collator(normalized, { numeric: true, sensitivity: 'base' });
  } catch {
    return new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  }
}

function scriptBucket(label) {
  if (/[А-ЯЁа-яё]/u.test(label)) return 0;
  if (/[A-Za-z]/u.test(label)) return 1;
  return 2;
}

function compareFamilies(a, b) {
  const bucketDifference = scriptBucket(a.label) - scriptBucket(b.label);
  if (bucketDifference) return bucketDifference;
  const locale = scriptBucket(a.label) === 0 ? 'ru' : 'en';
  return collator(locale).compare(a.label, b.label);
}

function choosePresentation(variants) {
  const counts = new Map();
  for (const variant of variants) {
    const id = `${variant.locale}:${variant.label}`;
    const existing = counts.get(id) ?? { ...variant, count: 0 };
    existing.count += 1;
    counts.set(id, existing);
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || scriptBucket(a.label) - scriptBucket(b.label) || a.label.localeCompare(b.label))[0]
    ?? variants[0];
}

export function buildPeopleSidebar() {
  const grouped = new Map();
  const ungrouped = [];
  const { records, byRef } = loadPersonRecords();

  for (const page of collectPersonPages(records, byRef)) {
    if (!page.families.length) {
      ungrouped.push(page);
      continue;
    }

    for (const family of page.families) {
      // family.key is identity. A person can intentionally belong to several family keys.
      const id = family.key;
      if (!grouped.has(id)) grouped.set(id, { key: id, variants: [], pages: [] });
      const group = grouped.get(id);
      if (!group.pages.some((candidate) => candidate.slug === page.slug)) group.pages.push(page);
      if (!group.variants.some((variant) => variant.label === family.label && variant.locale === family.locale)) {
        group.variants.push(family);
      }
    }
  }

  const groups = [...grouped.values()]
    .map((group) => ({ ...group, ...choosePresentation(group.variants) }))
    .sort(compareFamilies)
    .map((group) => {
      const groupCollator = collator(group.locale);
      return {
        label: group.label,
        collapsed: true,
        items: group.pages
          .map((page) => ({
            ...page,
            sortLabel: localePersonSortLabel(page.data, page.label, group.locale),
          }))
          .sort((a, b) => groupCollator.compare(a.sortLabel, b.sortLabel) || groupCollator.compare(a.label, b.label))
          .map((page) => ({
            label: page.label,
            link: `/people/${page.slug}/`,
          })),
      };
    });

  if (ungrouped.length) {
    const fallbackCollator = collator('ru');
    groups.push({
      label: 'Без семейной группы',
      collapsed: true,
      items: ungrouped
        .sort((a, b) => fallbackCollator.compare(a.label, b.label))
        .map((page) => ({ label: page.label, link: `/people/${page.slug}/` })),
    });
  }

  return groups;
}
