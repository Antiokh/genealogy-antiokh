import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = 'src/content/docs/people';

const forbidden = [
  {
    id: 'technical-representation',
    test: /\b(?:frontmatter|yaml|schema|structured field|structured data|mapping|import\w*|renderer|data model|residence|events?\/|place card)\b/iu,
  },
  {
    id: 'article-or-card-self-reference',
    test: /(?<![\p{L}\p{N}_])(?:стать|карточк|страниц)[\p{L}-]*(?![\p{L}\p{N}_])[^.\n]{0,90}(?<![\p{L}\p{N}_])(?:содерж|опис|состоит|построен|построена|включ|охватыва)/iu,
  },
  {
    id: 'editorial-placement',
    test: /(?<![\p{L}\p{N}_])(?:сохранено|сохранён|сохранена|сохраняется|вынесено|перенесено|разнесено|размещено|оставлено)(?![\p{L}\p{N}_])[^.\n]{0,110}(?:(?:для|ради)\s+(?:аналитик|таблиц)|(?:в|по)\s+(?:frontmatter|yaml|карточ|таблиц|структур|отдельн)|(?:ниже|отдельно))/iu,
  },
  {
    id: 'editorial-selection',
    test: /(?<![\p{L}\p{N}_])(?:нецелесообразно|не будем|не следует|в статье|в карточке)(?![\p{L}\p{N}_])[^.\n]{0,120}(?<![\p{L}\p{N}_])(?:перечисл|повтор|размещ|сохраня|привод)/iu,
  },
  {
    id: 'composition-commentary',
    test: /(?<![\p{L}\p{N}_])(?:материал статьи|структура статьи|состав статьи|наполнение статьи)(?![\p{L}\p{N}_])/iu,
  },
  {
    id: 'research-workflow',
    test: /(?<![\p{L}\p{N}_])(?:требует дополнительной проверки|требует архивной проверки|предмет дальнейшего поиска|поиск продолжается|ещё предстоит (?:найти|установить|проверить|уточнить)|пока не (?:найден|найдена|найдено|установлен|установлена|подтверждён|подтверждена|нормализован|нормализована))(?![\p{L}\p{N}_])/iu,
  },
  {
    id: 'confidence-bookkeeping',
    test: /(?<![\p{L}\p{N}_])(?:уровень уверенности|базовая уверенность|confidence|reconciliation|сверка источников)(?![\p{L}\p{N}_])/iu,
  },
];

/** Return all Markdown and MDX files under a directory. */
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

/** Return the person-page body and its character offset, or null for non-person Markdown. */
function publicPersonBody(content) {
  if (!content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---\n', 4);
  if (end < 0) return null;
  const frontmatter = content.slice(4, end);
  if (!/(?:^|\n)entity:\s*["']?person["']?\s*(?:\n|$)/i.test(frontmatter)) return null;
  const offset = end + 5;
  return { body: content.slice(offset), offset };
}

/** Convert a zero-based character index into a one-based source line number. */
function lineNumber(content, index) {
  return content.slice(0, index).split('\n').length;
}

const violations = [];

for (const file of await markdownFiles(ROOT)) {
  const raw = await readFile(file, 'utf8');
  const published = publicPersonBody(raw);
  if (!published) continue;
  const { body, offset } = published;

  for (const rule of forbidden) {
    const flags = rule.test.flags.includes('g') ? rule.test.flags : `${rule.test.flags}g`;
    const regex = new RegExp(rule.test.source, flags);
    for (const match of body.matchAll(regex)) {
      violations.push({
        file,
        line: lineNumber(raw, offset + (match.index ?? 0)),
        rule: rule.id,
        text: match[0].replace(/\s+/g, ' ').slice(0, 180),
      });
    }
  }
}

if (violations.length) {
  console.error('Public biography prose contains internal editorial/meta commentary:');
  for (const item of violations) {
    console.error(`- ${item.file}:${item.line} [${item.rule}] ${item.text}`);
  }
  process.exit(1);
}

console.log('Public biography prose check passed.');
