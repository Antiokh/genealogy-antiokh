import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

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

function readTitle(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  const raw = frontmatter.match(/^title:\s*(.*?)\s*$/m)?.[1]?.trim();
  if (!raw) return path.basename(filePath, path.extname(filePath));

  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      // Fall through to a simple unquote for hand-authored YAML.
    }
  }
  if (raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1).replaceAll("''", "'");
  return raw.replace(/\s+#.*$/, '').trim();
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

    const title = readTitle(absolute);
    let slug = nextRelative.replace(/\.mdx?$/i, '');
    slug = slug.replace(/\/index$/i, '');
    const [section] = slug.split('/');
    pages.push({
      section,
      title,
      slug,
      sortKey: genealogySortKey(title),
    });
  }
  return pages;
}

function compareSections(a, b) {
  if (a === 'unknown') return b === 'unknown' ? 0 : 1;
  if (b === 'unknown') return -1;
  const aYear = Number.parseInt(a, 10);
  const bYear = Number.parseInt(b, 10);
  if (Number.isFinite(aYear) && Number.isFinite(bYear) && aYear !== bYear) return aYear - bYear;
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

const keyCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const labelCollator = new Intl.Collator(['ru', 'en'], { numeric: true, sensitivity: 'base' });

export function buildPeopleSidebar() {
  const grouped = new Map();
  for (const page of collectPersonPages(PEOPLE_ROOT)) {
    if (!grouped.has(page.section)) grouped.set(page.section, []);
    grouped.get(page.section).push(page);
  }

  return [...grouped.keys()].sort(compareSections).map((section) => ({
    label: section === 'unknown' ? 'Год рождения неизвестен' : section,
    collapsed: false,
    items: grouped.get(section)
      .sort((a, b) => keyCollator.compare(a.sortKey, b.sortKey) || labelCollator.compare(a.title, b.title))
      .map((page) => ({
        label: page.title,
        link: `/people/${page.slug}/`,
      })),
  }));
}
