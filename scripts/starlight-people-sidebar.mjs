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

function familyInfo(data) {
  if (!data.family) return undefined;
  if (typeof data.family === 'string') {
    const label = data.family.trim();
    if (!label) return undefined;
    return {
      key: genealogySortKey(label) || label.toLowerCase(),
      label,
      locale: detectLocale(label),
      localized: {},
    };
  }

  const key = String(data.family.key ?? '').trim();
  const label = String(data.family.label || key).trim();
  if (!key || !label) return undefined;
  return {
    key,
    label,
    locale: data.family.locale || detectLocale(label),
    localized: data.family.localized ?? {},
  };
}

function collectPersonPages(directory, relative = '') {
  const pages = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const absolute = path.join(directory, entry.name);
    const nextRelative = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      pages.push(...collectPersonPages(absolute, nextRelative));
      continue;
    }
    if (!entry.isFile() || !/\.mdx?$/i.test(entry.name)) continue;
    if (/^index\.mdx?$/i.test(entry.name) && !relative) continue;

    const data = readFrontmatter(absolute);
    if (data.entity !== 'person') continue;
    const slug = nextRelative.replace(/\.mdx?$/i, '').replace(/\/index$/i, '');
    const family = familyInfo(data);
    const label = personLabel(data, absolute);
    pages.push({ family, label, slug, data });
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
  const latin = variants.find((variant) => /[A-Za-z]/u.test(variant.label) && !/[А-ЯЁа-яё]/u.test(variant.label));
  return latin ?? variants[0];
}

export function buildPeopleSidebar() {
  const grouped = new Map();
  const ungrouped = [];

  for (const page of collectPersonPages(PEOPLE_ROOT)) {
    if (!page.family) {
      ungrouped.push(page);
      continue;
    }

    // family.key is identity. Locale and label are presentation metadata and must not split one family.
    const id = page.family.key;
    if (!grouped.has(id)) grouped.set(id, { key: id, variants: [], pages: [] });
    const group = grouped.get(id);
    group.pages.push(page);
    if (!group.variants.some((variant) => variant.label === page.family.label && variant.locale === page.family.locale)) {
      group.variants.push(page.family);
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
