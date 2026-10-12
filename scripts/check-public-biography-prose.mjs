import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = 'src/content/docs/people';

const forbidden = [
  {
    id: 'technical-representation',
    test: /\b(?:frontmatter|yaml|schema|structured field|structured data|mapping|import\w*|renderer|data model|residence|events?\/|place card)\b/iu,
  },
  {
    id: 'genealogy-technical-markers',
    test: /(?<![\p{L}\p{N}_])(?:GEDCOM|XREF|_UID|Record Match|NAME\s*\/\/|[IF]\d{5,})(?![\p{L}\p{N}_])/u,
  },
  {
    id: 'placeholder-biography',
    test: /(?<![\p{L}\p{N}_])Сведения\s+пока\s+не\s+добавлены\.?(?![\p{L}\p{N}_])/iu,
  },
  {
    id: 'article-or-card-self-reference',
    test: /(?<![\p{L}\p{N}_])(?:стать|карточк|страниц)[\p{L}-]*(?![\p{L}\p{N}_])[^.\n]{0,90}(?<![\p{L}\p{N}_])(?:содерж|опис|состоит|построен|построена|включ|охватыва|обознач)/iu,
  },
  {
    id: 'family-record-self-reference',
    test: /(?<![\p{L}\p{N}_])(?:семейн[\p{L}-]*\s+карточк[\p{L}-]*|семейн[\p{L}-]*\s+описан[\p{L}-]*)[^.\n]{0,100}(?:обознач|указ|содерж|назван)/iu,
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
    id: 'identity-reconstruction-workflow',
    test: /(?<![\p{L}\p{N}_])(?:имя|отчество|связь)\s+восстановлен[\p{L}-]*(?![\p{L}\p{N}_])/iu,
  },
  {
    id: 'canonical-bookkeeping',
    test: /(?<![\p{L}\p{N}_])(?:каноническ[\p{L}-]*[^.\n]{0,60}(?:год|дат[\p{L}-]*|пол[\p{L}-]*|дерев[\p{L}-]*|запис[\p{L}-]*|связ[\p{L}-]*)|(?:год|дат[\p{L}-]*|пол[\p{L}-]*|дерев[\p{L}-]*|запис[\p{L}-]*|связ[\p{L}-]*)[^.\n]{0,60}каноническ[\p{L}-]*)(?![\p{L}\p{N}_])/iu,
  },
  {
    id: 'structured-bookkeeping',
    test: /(?<![\p{L}\p{N}_])структурно\s+(?:сохран|запис|внес)[\p{L}-]*(?![\p{L}\p{N}_])/iu,
  },
  {
    id: 'research-state-bookkeeping',
    test: /(?<![\p{L}\p{N}_])(?:в\s+текущ(?:ей\s+реконструкции|ем\s+наборе\s+источников)|структурированн[\p{L}-]*\s+пол[\p{L}-]*|отдельн[\p{L}-]*\s+задач[\p{L}-]*\s+архивного\s+поиска|сохраня[\p{L}-]*\s+отдельно\s+от\s+документально\s+подтвержд[\p{L}-]*)(?![\p{L}\p{N}_])/iu,
  },
  {
    id: 'normalization-workflow',
    test: /(?<![\p{L}\p{N}_])(?:нормализовать|нормализац[\p{L}-]*|нормализован[\p{L}-]*)[^.\n]{0,80}(?:карт|мест|назван)[\p{L}-]*(?![\p{L}\p{N}_])/iu,
  },
  {
    id: 'editorial-datation',
    test: /(?<![\p{L}\p{N}_])(?:(?:год|дат[\p{L}-]*)[^.\n]{0,70}(?:внес[её]н|записан|сохран[её]н)[\p{L}-]*|(?:внес[её]н|записан|сохран[её]н)[\p{L}-]*[^.\n]{0,70}(?:год|дат[\p{L}-]*))(?![\p{L}\p{N}_])/iu,
  },
  {
    id: 'research-workflow',
    test: /(?<![\p{L}\p{N}_])(?:требует (?:дополнительной|отдельной )?архивной проверки|требует дополнительной проверки|для дальнейшей архивной проверки|предмет дальнейшего поиска|поиск продолжается|должн[\p{L}-]* сверяться|ещё предстоит (?:найти|установить|проверить|уточнить)|пока не (?:найден|найдена|найдено|установлен|установлена|подтверждён|подтверждена|нормализован|нормализована))(?![\p{L}\p{N}_])/iu,
  },
  {
    id: 'publication-audit',
    test: /(?<![\p{L}\p{N}_])(?:на момент проверки страницы|для семейного архива отдельно (?:интерес|важ)|не используются как замена документальным источникам|сохран[\p{L}-]* без выбора)(?![\p{L}\p{N}_])/iu,
  },
  {
    id: 'confidence-bookkeeping',
    test: /(?<![\p{L}\p{N}_])(?:уровень уверенности|базовая уверенность|confidence|reconciliation|сверка источников)(?![\p{L}\p{N}_])/iu,
  },
];

const regressionCases = [
  ['placeholder-biography', 'Сведения пока не добавлены.'],
  ['genealogy-technical-markers', 'Имя восстановлено из Record Match в GEDCOM.'],
  ['family-record-self-reference', 'В семейной карточке профессия обозначена как архитектор.'],
  ['identity-reconstruction-workflow', 'Отчество восстановлено по родственной связи.'],
  ['canonical-bookkeeping', '1944 сохранён как канонический год смерти.'],
  ['structured-bookkeeping', 'Структурно сохранено только место рождения.'],
  ['research-state-bookkeeping', 'Сведения не вынесены в структурированное поле карточки.'],
  ['research-state-bookkeeping', 'Семейная версия в текущей реконструкции отвергается.'],
  ['research-state-bookkeeping', 'Документ в текущем наборе источников не извлечён.'],
  ['research-state-bookkeeping', 'Это остаётся отдельной задачей архивного поиска.'],
  ['normalization-workflow', 'Название нельзя нормализовать на карте без источника.'],
  ['editorial-datation', '1942 год внесён как датировка из автобиографии.'],
  ['research-workflow', 'Версия требует отдельной архивной проверки.'],
  ['publication-audit', 'На момент проверки страницы было 68 произведений.'],
];

const allowedCases = [
  'Источники расходятся в датировке смерти.',
  'Точный год рождения по имеющимся источникам неизвестен.',
  'Воспоминания содержат две версии обстоятельств смерти.',
  '[Михаил Курочкин](/people/unknown/mikhail-kurochkin-i500151/)',
];

for (const [id, text] of regressionCases) {
  const rule = forbidden.find((item) => item.id === id);
  if (!rule?.test.test(text)) {
    throw new Error(`Public biography prose regression case is not covered: ${id}: ${text}`);
  }
}

for (const text of allowedCases) {
  const matched = forbidden.find((item) => item.test.test(text));
  if (matched) {
    throw new Error(`Public biography prose allowed case is blocked by ${matched.id}: ${text}`);
  }
}

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
