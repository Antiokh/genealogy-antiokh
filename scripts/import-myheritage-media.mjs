import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const sourceRoot = process.env.MYHERITAGE_EXPORT_ROOT
  ? path.resolve(process.env.MYHERITAGE_EXPORT_ROOT)
  : path.join(repoRoot, '_source', 'obsidian', 'antiokh', 'Work Ideas', 'MyHeritage Exporter');

const userscriptRoot = path.join(sourceRoot, 'myheritage-export-userscript');
const cdpRoot = path.join(sourceRoot, 'myheritage-export-cdp');
const peopleRoot = path.join(repoRoot, 'src', 'content', 'docs', 'people');
const mediaRoot = path.join(repoRoot, 'src', 'content', 'docs', 'media', 'myheritage');
const reportPath = path.join(repoRoot, 'imports', 'myheritage-2026', 'media-import-report.json');

const manifest = JSON.parse(await fs.readFile(path.join(userscriptRoot, 'manifest.json'), 'utf8'));
const photos = JSON.parse(await fs.readFile(path.join(cdpRoot, 'photos.json'), 'utf8'));

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function cleanTitle(value) {
  const text = String(value ?? '').trim();
  if (!text || /^new\.jpg$/i.test(text)) return '';
  return text;
}

function personXrefFromOwner(ownerId) {
  const n = Number(ownerId);
  if (!Number.isFinite(n)) return null;
  return `I${String(n - 1_000_000).padStart(6, '0')}`;
}

const peopleByXref = new Map();
for (const file of (await walk(peopleRoot)).filter((file) => file.endsWith('.md'))) {
  const text = await fs.readFile(file, 'utf8');
  const xref = text.match(/\bxref:\s*["']?(I\d+)["']?/i)?.[1];
  if (!xref) continue;
  const title = text.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.replace(/^['"]|['"]$/g, '') || path.basename(file, '.md');
  const ref = path.relative(peopleRoot, file).split(path.sep).join('/');
  peopleByXref.set(xref, { ref, title });
}

const photoIdToLocal = manifest.photoIdToLocal || {};
const groups = new Map();
const invalidManifestMappings = [];

for (const [photoId, outputs] of Object.entries(photoIdToLocal)) {
  // pack_myheritage.py intentionally stores photoIdToLocal as id -> list[str]:
  // one MyHeritage photo ID can point at more than one distinct payload.
  const locals = Array.isArray(outputs) ? outputs : [outputs];
  for (const local of locals) {
    if (typeof local !== 'string') {
      invalidManifestMappings.push({ photoId: String(photoId), value: local });
      continue;
    }

    const basename = path.basename(local);
    if (!basename.toLowerCase().endsWith('.webp')) continue;

    if (!groups.has(basename)) groups.set(basename, new Set());
    groups.get(basename).add(String(photoId));
  }
}

await fs.rm(mediaRoot, { recursive: true, force: true });
await fs.mkdir(mediaRoot, { recursive: true });
await fs.mkdir(path.dirname(reportPath), { recursive: true });

const unresolvedOwners = new Set();
const unresolvedPhotoIds = new Set();
const imported = [];
let jpegBytes = 0;
let webpBytesComparable = 0;
let comparablePayloads = 0;
let webpSmaller = 0;
let jpegSmallerOrEqual = 0;

for (const [webpBasename, photoIdSet] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
  const photoIds = [...photoIdSet].sort((a, b) => Number(a) - Number(b));
  const sourceWebp = path.join(userscriptRoot, 'photos', webpBasename);
  try {
    await fs.access(sourceWebp);
  } catch {
    for (const id of photoIds) unresolvedPhotoIds.add(id);
    continue;
  }

  const canonicalId = path.basename(webpBasename, '.webp');
  const targetStem = `photo-${canonicalId}`;
  const targetWebp = path.join(mediaRoot, `${targetStem}.webp`);
  await fs.copyFile(sourceWebp, targetWebp);

  const subjectMap = new Map();
  const metadataEntries = [];
  for (const photoId of photoIds) {
    const meta = photos[photoId];
    if (!meta) {
      unresolvedPhotoIds.add(photoId);
      continue;
    }
    metadataEntries.push(meta);
    for (const ownerId of meta.owners || []) {
      const xref = personXrefFromOwner(ownerId);
      const person = xref ? peopleByXref.get(xref) : null;
      if (!person) {
        unresolvedOwners.add(String(ownerId));
        continue;
      }
      subjectMap.set(person.ref, person);
    }
  }

  const subjects = [...subjectMap.values()].sort((a, b) => a.ref.localeCompare(b.ref));
  const canonicalMeta = photos[canonicalId] || metadataEntries[0] || null;
  const metadataTitle = cleanTitle(canonicalMeta?.metadata?.title) || metadataEntries.map((entry) => cleanTitle(entry?.metadata?.title)).find(Boolean) || '';
  const displayTitle = metadataTitle
    || (subjects.length === 1 ? `${subjects[0].title} — фотография` : `MyHeritage photo ${canonicalId}`);
  const originalUrl = canonicalMeta?.originalUrl || metadataEntries.map((entry) => entry?.originalUrl).find(Boolean) || '';

  const subjectYaml = subjects.length
    ? `subjects:\n${subjects.map((person) => `  - person: ${yamlString(person.ref)}`).join('\n')}\n`
    : '';

  const md = `---\ntitle: ${yamlString(displayTitle)}\nentity: media\nmediaType: photo\nimage: ${yamlString(`./${targetStem}.webp`)}\nalt: ${yamlString(displayTitle)}\ncaption: ${yamlString(displayTitle)}\n${subjectYaml}${originalUrl ? `originalUrl: ${yamlString(originalUrl)}\n` : ''}credit: ${yamlString('MyHeritage export 2026-10-11')}\nsidebar:\n  hidden: true\n---\n\nИмпортировано из MyHeritage. Source photo IDs: ${photoIds.join(', ')}.\n`;
  await fs.writeFile(path.join(mediaRoot, `${targetStem}.md`), md, 'utf8');

  const webpSize = (await fs.stat(targetWebp)).size;
  const jpegCandidate = [canonicalMeta, ...metadataEntries].find((entry) => entry?.downloaded && Number.isFinite(Number(entry?.size)));
  if (jpegCandidate) {
    const jpg = Number(jpegCandidate.size);
    jpegBytes += jpg;
    webpBytesComparable += webpSize;
    comparablePayloads += 1;
    if (webpSize < jpg) webpSmaller += 1;
    else jpegSmallerOrEqual += 1;
  }

  imported.push({
    file: `src/content/docs/media/myheritage/${targetStem}.md`,
    image: `src/content/docs/media/myheritage/${targetStem}.webp`,
    sourcePhotoIds: photoIds,
    subjects: subjects.map((person) => person.ref),
    webpBytes: webpSize,
    jpegBytes: jpegCandidate ? Number(jpegCandidate.size) : null,
  });
}

const allWebpBytes = imported.reduce((sum, item) => sum + item.webpBytes, 0);
const savingsBytes = jpegBytes - webpBytesComparable;
const report = {
  generatedAt: new Date().toISOString(),
  source: 'Antiokh/obsidian/antiokh/Work Ideas/MyHeritage Exporter',
  manifestMappings: {
    photoIds: Object.keys(photoIdToLocal).length,
    uniqueWebpPayloads: groups.size,
    invalid: invalidManifestMappings,
  },
  webp: {
    quality: manifest.imageQuality ?? null,
    backend: manifest.imageBackend ?? null,
    uniquePayloadsInManifest: manifest.counts?.uniqueImagePayloads ?? null,
    importedPayloads: imported.length,
    importedBytes: allWebpBytes,
  },
  jpegVsWebpComparable: {
    payloads: comparablePayloads,
    jpegBytes,
    webpBytes: webpBytesComparable,
    savingsBytes,
    savingsPercent: jpegBytes ? Number(((savingsBytes / jpegBytes) * 100).toFixed(2)) : null,
    webpSmaller,
    jpegSmallerOrEqual,
  },
  unresolvedOwners: [...unresolvedOwners].sort((a, b) => Number(a) - Number(b)),
  unresolvedPhotoIds: [...unresolvedPhotoIds].sort((a, b) => Number(a) - Number(b)),
  imported,
};

await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`Manifest: ${report.manifestMappings.photoIds} photo IDs -> ${report.manifestMappings.uniqueWebpPayloads} unique WebP payloads.`);
console.log(`Imported ${imported.length} unique WebP media payloads.`);
console.log(`Mapped ${new Set(imported.flatMap((item) => item.subjects)).size} people as subjects.`);
console.log(`Comparable JPEG/WebP payloads: ${comparablePayloads}.`);
if (jpegBytes) {
  console.log(`JPEG ${jpegBytes} bytes -> WebP ${webpBytesComparable} bytes (${report.jpegVsWebpComparable.savingsPercent}% saved).`);
}
console.log(`Invalid manifest mappings: ${invalidManifestMappings.length}; unresolved owners: ${report.unresolvedOwners.length}; unresolved photo IDs: ${report.unresolvedPhotoIds.length}.`);