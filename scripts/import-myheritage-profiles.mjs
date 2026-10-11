import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const repoRoot = process.cwd();
const sourceRoot = process.env.MYHERITAGE_EXPORT_ROOT
  ? path.resolve(process.env.MYHERITAGE_EXPORT_ROOT)
  : path.join(repoRoot, '_source', 'obsidian', 'antiokh', 'Work Ideas', 'MyHeritage Exporter');
const rawPeopleRoot = path.join(sourceRoot, 'myheritage-export-userscript', 'raw', 'people');
const cdpExportPath = path.join(sourceRoot, 'myheritage-export-cdp', 'export.json');
const peopleRoot = path.join(repoRoot, 'src', 'content', 'docs', 'people');
const placesRoot = path.join(repoRoot, 'src', 'content', 'docs', 'places');
const reportPath = path.join(repoRoot, 'imports', 'myheritage-2026', 'profile-import-report.json');
const SOURCE_REF = 'myheritage-extended-export-2026-10-11.md';

const MONTHS = new Map([
  ['jan', 1], ['january', 1], ['feb', 2], ['february', 2], ['mar', 3], ['march', 3],
  ['apr', 4], ['april', 4], ['may', 5], ['jun', 6], ['june', 6], ['jul', 7], ['july', 7],
  ['aug', 8], ['august', 8], ['sep', 9], ['sept', 9], ['september', 9], ['oct', 10], ['october', 10],
  ['nov', 11], ['november', 11], ['dec', 12], ['december', 12],
]);

async function walk(directory) {
  const out = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function splitDocument(content) {
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;
  return { rawFrontmatter: match[1], body: content.slice(match[0].length) };
}

function cleanText(value) {
  if (value == null) return '';
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ', ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&lrm;|&rlm;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
}

function isTechnicalUnknown(body = {}) {
  const first = cleanText(body.firstName);
  const last = cleanText(body.lastName);
  const name = cleanText(body.name || `${first} ${last}`);
  return /^unknown(?:\s+(?:person|man|woman))?$/i.test(name)
    || /^неизвестн(?:ый мужчина|ая женщина)$/i.test(name)
    || (!first && !last)
    || (/^unknown$/i.test(first) && !last);
}

function xrefFromProfileId(profileId) {
  const n = Number(profileId);
  return Number.isFinite(n) ? `I${String(n - 1_000_000).padStart(6, '0')}` : null;
}

function isoDate(value) {
  const text = cleanText(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const dmy = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  const mdy = text.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  const match = dmy || mdy;
  if (!match) return null;
  const day = Number(dmy ? match[1] : match[2]);
  const monthName = String(dmy ? match[2] : match[1]).toLowerCase();
  const year = Number(match[3]);
  const month = MONTHS.get(monthName);
  if (!month || !year || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateYear(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === 'string') return Number(value.match(/\b(\d{4})\b/)?.[1]) || null;
  if (value && typeof value === 'object') return Number(value.year) || dateYear(value.date) || null;
  return null;
}

function shouldUsePreciseDate(current, candidate) {
  if (!candidate) return false;
  if (current == null || current === '') return true;
  if (typeof current === 'number') return Number(candidate.slice(0, 4)) === current;
  if (typeof current === 'string' && /^\d{4}$/.test(current)) return candidate.startsWith(`${current}-`);
  if (current && typeof current === 'object' && current.year && !current.month && !current.day) return Number(candidate.slice(0, 4)) === Number(current.year);
  return false;
}

function normalisePlaceKey(value) {
  return cleanText(value)
    .toLocaleLowerCase('ru')
    .replace(/ё/g, 'е')
    .replace(/\b(?:gorod|city of|city|oblast|region|russian federation|russia|serbia)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const placeAliasFallback = new Map([
  ['moscow', 'moscow.md'], ['москва', 'moscow.md'],
  ['tula', 'tula.md'], ['тула', 'tula.md'],
  ['belgrade', 'belgrade.md'], ['beograd', 'belgrade.md'], ['белград', 'belgrade.md'],
  ['saratov', 'saratov.md'], ['саратов', 'saratov.md'],
  ['tashkent', 'tashkent.md'], ['ташкент', 'tashkent.md'],
  ['novosibirsk', 'novosibirsk.md'], ['новосибирск', 'novosibirsk.md'],
  ['voronezh', 'voronezh.md'], ['воронеж', 'voronezh.md'],
  ['valdai', 'valdai.md'], ['валдай', 'valdai.md'],
]);

const placeIndex = new Map(placeAliasFallback);
for (const file of (await walk(placesRoot)).filter((item) => /\.mdx?$/i.test(item))) {
  const content = await readFile(file, 'utf8');
  const doc = splitDocument(content);
  if (!doc) continue;
  const data = YAML.parse(doc.rawFrontmatter) ?? {};
  const ref = path.relative(placesRoot, file).split(path.sep).join('/');
  for (const candidate of [data.title, data.name, data.label, ...(data.aliases || [])]) {
    const key = normalisePlaceKey(candidate);
    if (key && !placeIndex.has(key)) placeIndex.set(key, ref);
  }
}

function resolvePlace(value) {
  const label = cleanText(value);
  if (!label) return { place: null, placeLabel: undefined };
  const fullKey = normalisePlaceKey(label);
  let place = placeIndex.get(fullKey) || null;
  if (!place) {
    const first = cleanText(label.split(',')[0]);
    place = placeIndex.get(normalisePlaceKey(first)) || null;
  }
  if (!place) {
    for (const [alias, ref] of placeIndex) {
      if (alias.length >= 4 && fullKey.includes(alias)) {
        place = ref;
        break;
      }
    }
  }
  return { place, placeLabel: label };
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function safeLivingResidence(place) {
  const value = cleanText(place);
  if (!value) return '';
  if (/\d|\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|ул\.?|улица|дом|д\.|кв\.?|квартира|корпус)\b/iu.test(value)) return '';
  return value;
}

function selfFacts(body, profileId) {
  return (Array.isArray(body.facts) ? body.facts : []).filter((fact) => {
    const individualId = Number(fact?.individualId);
    if (!Number.isFinite(individualId)) return true;
    return individualId === Number(profileId);
  });
}

function biographyFacts(body, profileId) {
  const isAlive = body.isAlive !== false;
  const allowed = new Set(['OCCU', 'EDUC', 'GRAD', 'MILI', 'IMMI', 'EMIG', 'NATU', 'RESI']);
  const out = [];
  for (const fact of selfFacts(body, profileId)) {
    const type = String(fact?.type || '').toUpperCase();
    if (!allowed.has(type)) continue;
    let place = cleanText(fact.place);
    if (type === 'RESI' && isAlive) place = safeLivingResidence(place);
    const content = cleanText(fact.content || fact.additionalContent);
    const date = cleanText(fact.date) || (fact.year ? String(fact.year) : '');
    if (!content && !place && !date) continue;
    const titleMap = {
      OCCU: 'Работа / занятие', EDUC: 'Образование', GRAD: 'Окончание обучения', MILI: 'Военная служба',
      IMMI: 'Иммиграция', EMIG: 'Эмиграция', NATU: 'Гражданство', RESI: 'Место жительства',
    };
    out.push({ type, title: titleMap[type] || cleanText(fact.title) || type, date, content, place });
  }
  return out;
}

function renderFactLine(fact) {
  const details = uniqueStrings([fact.date, fact.content, fact.place]);
  return `- **${fact.title}:** ${details.join(' — ')}`;
}

function partnerRef(entry) {
  return typeof entry === 'string' ? entry : entry?.person;
}

function profileIdFromRef(ref, peopleByRef) {
  const person = peopleByRef.get(ref);
  const xref = person?.xref;
  const match = String(xref || '').match(/^I(\d+)$/i);
  return match ? 1_000_000 + Number(match[1]) : null;
}

const peopleByXref = new Map();
const peopleByRef = new Map();
for (const file of (await walk(peopleRoot)).filter((item) => /\.mdx?$/i.test(item))) {
  const content = await readFile(file, 'utf8');
  const doc = splitDocument(content);
  if (!doc) continue;
  const data = YAML.parse(doc.rawFrontmatter) ?? {};
  if (data.entity !== 'person') continue;
  const xref = data.external?.myheritage?.xref;
  const ref = path.relative(peopleRoot, file).split(path.sep).join('/');
  const record = { file, ref, xref, data, body: doc.body, content };
  peopleByRef.set(ref, record);
  if (xref) peopleByXref.set(String(xref), record);
}

let cdpExport = { people: {} };
try {
  cdpExport = JSON.parse(await readFile(cdpExportPath, 'utf8'));
} catch {
  // The userscript raw profiles are sufficient for this importer.
}

const rawFiles = (await readdir(rawPeopleRoot)).filter((name) => name.endsWith('.json')).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const report = {
  generatedAt: new Date().toISOString(),
  source: sourceRoot,
  rawProfiles: rawFiles.length,
  cdpPeople: Object.keys(cdpExport.people || {}).length,
  changed: [],
  skippedTechnicalUnknown: [],
  skippedNotInGenealogy: [],
  skippedCurated: [],
};

for (const rawName of rawFiles) {
  const payload = JSON.parse(await readFile(path.join(rawPeopleRoot, rawName), 'utf8'));
  const body = payload?.body || {};
  const profileId = Number(rawName.match(/^(\d+)_/)?.[1]);
  if (!Number.isFinite(profileId)) continue;
  if (isTechnicalUnknown(body)) {
    report.skippedTechnicalUnknown.push(profileId);
    continue;
  }

  const xref = xrefFromProfileId(profileId);
  const person = xref ? peopleByXref.get(xref) : null;
  if (!person) {
    report.skippedNotInGenealogy.push({ profileId, name: cleanText(body.name) });
    continue;
  }
  if (person.data.importManaged !== true) {
    report.skippedCurated.push({ profileId, ref: person.ref });
    continue;
  }

  const data = person.data;
  const changes = [];
  const rawBirth = isoDate(body.birthDate);
  const rawDeath = isoDate(body.deathDate);
  if (!data.born || typeof data.born !== 'object') data.born = {};
  if (shouldUsePreciseDate(data.born.date, rawBirth)) {
    data.born.date = rawBirth;
    data.born.known = true;
    changes.push(`birth date ${rawBirth}`);
  }
  if (body.birthPlace && !data.born.placeLabel) {
    const resolved = resolvePlace(body.birthPlace);
    if (resolved.place && !data.born.place) data.born.place = resolved.place;
    data.born.placeLabel = resolved.placeLabel;
    changes.push(`birth place ${resolved.placeLabel}`);
  } else if (body.birthPlace && !data.born.place) {
    const resolved = resolvePlace(body.birthPlace);
    if (resolved.place) {
      data.born.place = resolved.place;
      if (!data.born.placeLabel) data.born.placeLabel = resolved.placeLabel;
      changes.push(`birth place ${resolved.placeLabel}`);
    }
  }

  if (body.isAlive === false || rawDeath) {
    if (!data.died || typeof data.died !== 'object') data.died = {};
    if (shouldUsePreciseDate(data.died.date, rawDeath)) {
      data.died.date = rawDeath;
      data.died.known = true;
      changes.push(`death date ${rawDeath}`);
    }
    if (body.deathPlace && !data.died.placeLabel) {
      const resolved = resolvePlace(body.deathPlace);
      if (resolved.place && !data.died.place) data.died.place = resolved.place;
      data.died.placeLabel = resolved.placeLabel;
      changes.push(`death place ${resolved.placeLabel}`);
    }
  }

  const occupations = [];
  for (const fact of selfFacts(body, profileId)) {
    if (String(fact?.type || '').toUpperCase() !== 'OCCU') continue;
    const occupation = cleanText(fact.content || fact.additionalContent);
    if (occupation) occupations.push(occupation);
  }
  const mergedOccupations = uniqueStrings([...(data.occupation || []), ...occupations]);
  if (mergedOccupations.length !== (data.occupation || []).length) {
    data.occupation = mergedOccupations;
    changes.push(`${mergedOccupations.length - (person.data.occupation || []).length} occupation(s)`);
  }

  if (Array.isArray(data.partners)) {
    for (let i = 0; i < data.partners.length; i += 1) {
      const ref = partnerRef(data.partners[i]);
      const targetProfileId = profileIdFromRef(ref, peopleByRef);
      if (!targetProfileId) continue;
      const relationFacts = selfFacts(body, profileId).filter((fact) => Number(fact?.relativeIndividualId) === targetProfileId);
      const marriage = relationFacts.find((fact) => String(fact?.type || '').toUpperCase() === 'MARR');
      const divorce = relationFacts.find((fact) => String(fact?.type || '').toUpperCase() === 'DIV');
      const current = typeof data.partners[i] === 'string' ? { person: ref } : { ...data.partners[i] };
      const marriedDate = isoDate(marriage?.date);
      const divorcedDate = isoDate(divorce?.date);
      if (marriedDate && shouldUsePreciseDate(current.married?.date, marriedDate)) {
        current.married = { ...(current.married || {}), known: true, date: marriedDate };
        changes.push(`marriage ${ref} ${marriedDate}`);
      }
      if (divorcedDate && shouldUsePreciseDate(current.divorced?.date, divorcedDate)) {
        current.divorced = { ...(current.divorced || {}), known: true, date: divorcedDate };
        changes.push(`divorce ${ref} ${divorcedDate}`);
      }
      data.partners[i] = current;
    }
  }

  data.sources = uniqueStrings([...(data.sources || []), SOURCE_REF]);
  data.external = data.external && typeof data.external === 'object' ? data.external : {};
  data.external.myheritage = data.external.myheritage && typeof data.external.myheritage === 'object' ? data.external.myheritage : {};
  data.external.myheritage.extendedSnapshot = String(payload.capturedAt || '2026-10-11').slice(0, 10);
  data.external.myheritage.profileId = profileId;

  const usefulFacts = biographyFacts(body, profileId);
  let bodyText = person.body;
  const placeholder = /## Биография\s*\r?\n\s*Сведения пока не добавлены\.?\s*$/m;
  if (placeholder.test(bodyText) && (usefulFacts.length || rawBirth || body.birthPlace)) {
    const lines = [];
    if (rawBirth || body.birthPlace) {
      const details = uniqueStrings([rawBirth || cleanText(body.birthDate), cleanText(body.birthPlace)]);
      if (details.length) lines.push(`- **Рождение:** ${details.join(' — ')}`);
    }
    lines.push(...usefulFacts.slice(0, 12).map(renderFactLine));
    const bio = `## Биография\n\nПо расширенной выгрузке MyHeritage:\n\n${lines.join('\n')}\n\nИсточник: [MyHeritage extended export, 11 October 2026](/sources/myheritage-extended-export-2026-10-11/).`;
    bodyText = bodyText.replace(placeholder, bio);
    changes.push(`${lines.length} biography fact(s)`);
  }

  if (!changes.length && data.sources.includes(SOURCE_REF) && data.external.myheritage.extendedSnapshot) {
    // Provenance-only writes still matter: the extended snapshot was checked.
    changes.push('extended MyHeritage provenance');
  }

  const frontmatter = YAML.stringify(data, { lineWidth: 0 }).trimEnd();
  await writeFile(person.file, `---\n${frontmatter}\n---\n${bodyText}`, 'utf8');
  report.changed.push({ profileId, ref: person.ref, changes });
}

await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`MyHeritage profiles: ${rawFiles.length} raw profiles; enriched ${report.changed.length} managed people.`);
console.log(`Skipped ${report.skippedCurated.length} curated people, ${report.skippedTechnicalUnknown.length} technical unknowns, ${report.skippedNotInGenealogy.length} profiles not present in genealogy-library.`);
