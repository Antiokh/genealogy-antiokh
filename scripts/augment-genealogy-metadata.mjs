import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const PEOPLE_ROOT = path.resolve('src/content/docs/people');
const MEDIA_ROOT = path.resolve('src/content/docs/media');
const OUTPUT_ROOT = path.resolve('public/generated');
const PORTRAIT_OUTPUT_ROOT = path.join(OUTPUT_ROOT, 'portraits');

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

function refFor(filePath) {
  return toPosix(path.relative(PEOPLE_ROOT, filePath));
}

function mediaRefFor(filePath) {
  return toPosix(path.relative(MEDIA_ROOT, filePath));
}

function frontmatter(content) {
  const raw = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1];
  return raw ? (YAML.parse(raw) ?? {}) : {};
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isRemoteOrPublicUrl(value) {
  return /^(?:https?:|data:|\/)/i.test(value);
}

function normalizeLegacyMediaRef(value) {
  if (typeof value !== 'string') return undefined;
  let ref = value.trim().replace(/^\.\//, '').replace(/^media\//, '').replaceAll('\\', '/');
  if (!/\.mdx?$/i.test(ref)) ref = `${ref}.md`;
  return ref;
}

async function copyPortraitAsset(sourcePath, personRef) {
  const extension = path.extname(sourcePath).toLowerCase() || '.webp';
  const relativeTarget = personRef.replace(/\.(md|mdx)$/i, extension);
  const targetPath = path.join(PORTRAIT_OUTPUT_ROOT, relativeTarget);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
  return `/generated/portraits/${toPosix(relativeTarget)}`;
}

async function resolveLocalOrRemoteImage(value, ownerFilePath, personRef) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const image = value.trim();
  if (isRemoteOrPublicUrl(image)) return image;

  const sourcePath = path.resolve(path.dirname(ownerFilePath), image);
  if (!(await fileExists(sourcePath))) return undefined;
  return copyPortraitAsset(sourcePath, personRef);
}

const legacyMedia = new Map();
if (await fileExists(MEDIA_ROOT)) {
  for (const filePath of await walk(MEDIA_ROOT)) {
    const data = frontmatter(await readFile(filePath, 'utf8'));
    if (data.entity !== 'media') continue;
    legacyMedia.set(mediaRefFor(filePath), { filePath, data });
  }
}

await rm(PORTRAIT_OUTPUT_ROOT, { recursive: true, force: true });

let projectedPortraits = 0;
const metadata = new Map();
for (const filePath of await walk(PEOPLE_ROOT)) {
  const data = frontmatter(await readFile(filePath, 'utf8'));
  if (data.entity !== 'person') continue;

  const ref = refFor(filePath);
  const families = Array.isArray(data.families)
    ? data.families
    : data.family
      ? [data.family]
      : [];

  const explicitPortrait = typeof data.portrait === 'string' ? data.portrait.trim() : undefined;
  const explicitPortraitIsLegacyMedia = explicitPortrait && /\.mdx?$/i.test(explicitPortrait);

  let photo;

  const conventionalPortraitPath = filePath.replace(/\.(md|mdx)$/i, '.webp');
  if (await fileExists(conventionalPortraitPath)) {
    photo = await copyPortraitAsset(conventionalPortraitPath, ref);
  }

  if (!photo && explicitPortrait && !explicitPortraitIsLegacyMedia) {
    photo = await resolveLocalOrRemoteImage(explicitPortrait, filePath, ref);
  }

  if (!photo && explicitPortraitIsLegacyMedia) {
    const mediaRef = normalizeLegacyMediaRef(explicitPortrait);
    const media = mediaRef ? legacyMedia.get(mediaRef) : undefined;
    if (media?.data.image) {
      photo = await resolveLocalOrRemoteImage(media.data.image, media.filePath, ref);
    }
  }

  if (!photo && typeof data.photo === 'string' && data.photo.trim()) {
    photo = data.photo.trim();
  }

  if (photo && photo !== data.photo) projectedPortraits += 1;

  metadata.set(ref, {
    families,
    ...(data.portrait ? { portrait: data.portrait } : {}),
    ...(photo ? { photo } : {}),
  });
}

async function augment(filename, arrayKey) {
  const filePath = path.join(OUTPUT_ROOT, filename);
  const data = JSON.parse(await readFile(filePath, 'utf8'));
  data[arrayKey] = data[arrayKey].map((person) => ({
    ...person,
    ...(metadata.get(person.ref) ?? {}),
  }));
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

await augment('people.json', 'people');
await augment('genealogy.json', 'nodes');
console.log(`Attached frontmatter metadata to ${metadata.size} generated person record(s).`);
console.log(`Projected ${projectedPortraits} person portrait(s) for generated tree data.`);
