import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const PEOPLE_ROOT = path.resolve('src/content/docs/people');
const PUBLIC_ROOT = path.resolve('public');
const OUTPUT_ROOT = path.join(PUBLIC_ROOT, 'generated/og');
const GENERATED_PEOPLE = path.join(PUBLIC_ROOT, 'generated/people.json');
const PORTRAIT_ROOT = path.join(PUBLIC_ROOT, 'generated/portraits');
const CACHE_ROOT = path.resolve('node_modules/.astro/genealogy-og');
const REMOTE_CACHE_ROOT = path.join(CACHE_ROOT, 'remote');
const WIDE_BACKGROUND = path.resolve('docs/Stitched Leather Family Tree Book Cover.webp');
const SQUARE_BACKGROUND = path.resolve('docs/Emblematic Tree Leather Book Cover.webp');

function toPosix(value) {
  return value.split(path.sep).join('/');
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

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

function parseFrontmatter(content) {
  const raw = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1];
  return raw ? (YAML.parse(raw) ?? {}) : {};
}

function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function wrapText(value, maxChars, maxLines = 2) {
  const words = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = `${last.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
  }
  return lines;
}

function yearOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const match = value.match(/(?:^|\D)(\d{4})(?:\D|$)/);
    return match ? Number(match[1]) : undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (Number.isFinite(value.year)) return Math.trunc(value.year);
  if (value.date !== undefined) return yearOf(value.date);
  if (value.text !== undefined) return yearOf(value.text);
  return undefined;
}

function isDeceased(data) {
  return data.died?.known === true || Boolean(yearOf(data.died));
}

function lifeYears(data) {
  const born = yearOf(data.born?.date ?? data.born);
  const died = yearOf(data.died?.date ?? data.died);
  if (born && died) return `${born}–${died}`;
  if (born) return `${born}–`;
  if (died) return `† ${died}`;
  return '';
}

function personName(data) {
  const name = data.name && typeof data.name === 'object' ? data.name : {};
  const surname = typeof name.last === 'string' ? name.last.trim() : '';
  const given = [name.first, name.middle || name.patronymic]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim())
    .join(' ');
  const display = [name.display, name.full, data.title]
    .find((value) => typeof value === 'string' && value.trim())?.trim() || 'Семейная энциклопедия';
  return { surname, given, display };
}

function pngDataUri(bytes) {
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function parseDataUri(value) {
  const match = String(value).match(/^data:[^;,]+;base64,(.+)$/s);
  return match ? Buffer.from(match[1], 'base64') : undefined;
}

async function fetchRemoteBytes(url) {
  const digest = createHash('sha256').update(url).digest('hex');
  const cachePath = path.join(REMOTE_CACHE_ROOT, digest);
  if (await exists(cachePath)) return readFile(cachePath);

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8',
        'user-agent': 'genealogy-library-og-builder/1.0',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) throw new Error('empty response');
    await mkdir(REMOTE_CACHE_ROOT, { recursive: true });
    await writeFile(cachePath, bytes);
    return bytes;
  } catch (error) {
    console.warn(`OG portrait fetch skipped for ${url}: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

async function bytesForImage(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const image = value.trim();
  if (image.startsWith('data:')) return parseDataUri(image);
  if (/^https?:\/\//i.test(image)) return fetchRemoteBytes(image);
  if (image.startsWith('/')) {
    const candidate = path.join(PUBLIC_ROOT, image.replace(/^\/+/, ''));
    if (await exists(candidate)) return readFile(candidate);
  }
  return undefined;
}

async function projectedPeople() {
  if (!(await exists(GENERATED_PEOPLE))) return new Map();
  const data = JSON.parse(await readFile(GENERATED_PEOPLE, 'utf8'));
  return new Map((data.people ?? []).map((person) => [person.ref, person]));
}

async function resolvePortraitBytes(personRef, data, projected) {
  const projectedPhoto = projected?.photo;
  if (typeof projectedPhoto === 'string' && projectedPhoto.trim()) {
    const bytes = await bytesForImage(projectedPhoto);
    if (bytes) return bytes;
  }

  const stem = personRef.replace(/\.(md|mdx)$/i, '');
  for (const extension of ['.webp', '.jpg', '.jpeg', '.png']) {
    const generated = path.join(PORTRAIT_ROOT, `${stem}${extension}`);
    if (await exists(generated)) return readFile(generated);

    const source = path.join(PEOPLE_ROOT, `${stem}${extension}`);
    if (await exists(source)) return readFile(source);
  }

  if (typeof data.photo === 'string') return bytesForImage(data.photo);
  return undefined;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function rasterPortrait(bytes, width, height, { deceased = false } = {}) {
  let image = sharp(bytes, { failOn: 'none' }).rotate();
  const metadata = await image.metadata();
  if (metadata.width && metadata.height) {
    const sourceRatio = metadata.width / metadata.height;
    const targetRatio = width / height;
    if (sourceRatio > targetRatio) {
      const cropWidth = Math.max(1, Math.round(metadata.height * targetRatio));
      const left = Math.round(clamp(metadata.width * 0.5 - cropWidth / 2, 0, metadata.width - cropWidth));
      image = image.extract({ left, top: 0, width: cropWidth, height: metadata.height });
    } else if (sourceRatio < targetRatio) {
      const cropHeight = Math.max(1, Math.round(metadata.width / targetRatio));
      const top = Math.round(clamp(metadata.height * 0.35 - cropHeight / 2, 0, metadata.height - cropHeight));
      image = image.extract({ left: 0, top, width: metadata.width, height: cropHeight });
    }
  }
  image = image.resize(width, height, { fit: 'fill' });

  if (deceased) image = image.grayscale();
  return image.png().toBuffer();
}

async function rasterBackground(filePath, width, height) {
  return sharp(await readFile(filePath), { failOn: 'none' })
    .rotate()
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .modulate({ brightness: 0.82, saturation: 0.78 })
    .png()
    .toBuffer();
}

function portraitMarkup(uri, x, y, width, height, clipId, deceased) {
  if (!uri) return '';
  const ribbonWidth = Math.round(width * 0.86);
  const ribbonHeight = Math.max(30, Math.round(width * 0.10));
  const ribbonX = Math.round(x + width * 0.46);
  const ribbonY = Math.round(y + height * 0.88);
  const ribbonCx = Math.round(ribbonX + ribbonWidth / 2);
  const ribbonCy = Math.round(ribbonY + ribbonHeight / 2);

  return `
  <defs>
    <clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="24"/></clipPath>
  </defs>
  <rect x="${x - 7}" y="${y - 7}" width="${width + 14}" height="${height + 14}" rx="29" fill="#1a0e09" stroke="#c49a58" stroke-width="4"/>
  <g clip-path="url(#${clipId})">
    <image href="${uri}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="none"/>
    ${deceased ? `<rect x="${ribbonX}" y="${ribbonY}" width="${ribbonWidth}" height="${ribbonHeight}" rx="${Math.round(ribbonHeight / 2)}" fill="#090909" opacity="0.97" transform="rotate(-42 ${ribbonCx} ${ribbonCy})"/>` : ''}
  </g>`;
}

function wideSvg({ background, portrait, data, deceased = false }) {
  const { surname, given, display } = personName(data);
  const years = lifeYears(data);
  const hasPortrait = Boolean(portrait);
  const textX = hasPortrait ? 505 : 128;
  const titleLines = surname
    ? [surname, ...wrapText(given, hasPortrait ? 21 : 31, 2)]
    : wrapText(display, hasPortrait ? 22 : 34, 3);
  const firstSize = surname ? 58 : 54;
  const otherSize = surname ? 42 : 48;
  const lineHeights = titleLines.map((_, index) => index === 0 ? 68 : 54);
  let y = titleLines.length <= 2 ? 270 : 235;
  const text = titleLines.map((line, index) => {
    const size = index === 0 ? firstSize : otherSize;
    const weight = index === 0 ? 750 : 600;
    const markup = `<text x="${textX}" y="${y}" font-family="DejaVu Sans" font-size="${size}" font-weight="${weight}" fill="#fff4df">${escapeXml(line)}</text>`;
    y += lineHeights[index];
    return markup;
  }).join('\n  ');
  const yearsY = y + 12;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#120907" stop-opacity="0.34"/>
      <stop offset="0.42" stop-color="#120907" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#120907" stop-opacity="0.86"/>
    </linearGradient>
  </defs>
  <image href="${background}" x="0" y="0" width="1200" height="630" preserveAspectRatio="none"/>
  <rect width="1200" height="630" fill="#160b07" opacity="0.20"/>
  <rect width="1200" height="630" fill="url(#shade)"/>
  ${portraitMarkup(portrait, 122, 122, 320, 386, 'portrait-wide', deceased)}
  <text x="${textX}" y="126" font-family="DejaVu Sans" font-size="25" font-weight="700" fill="#d4b170" letter-spacing="1.4">СЕМЕЙНАЯ ЭНЦИКЛОПЕДИЯ</text>
  ${text}
  ${years ? `<text x="${textX}" y="${yearsY}" font-family="DejaVu Sans" font-size="35" font-weight="500" fill="#d9bd89">${escapeXml(years)}</text>` : ''}
</svg>`;
}

function squareSvg({ background, portrait, data, deceased = false }) {
  const { surname, given, display } = personName(data);
  const years = lifeYears(data);
  const hasPortrait = Boolean(portrait);
  const textX = hasPortrait ? 454 : 92;
  const titleLines = surname
    ? [surname, ...wrapText(given, hasPortrait ? 18 : 29, 2)]
    : wrapText(display, hasPortrait ? 19 : 29, 3);
  let y = titleLines.length <= 2 ? 465 : 418;
  const text = titleLines.map((line, index) => {
    const size = index === 0 ? 64 : 45;
    const markup = `<text x="${textX}" y="${y}" font-family="DejaVu Sans" font-size="${size}" font-weight="${index === 0 ? 750 : 600}" fill="#fff4df">${escapeXml(line)}</text>`;
    y += index === 0 ? 76 : 58;
    return markup;
  }).join('\n  ');
  const yearsY = y + 18;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="shade-square" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#120907" stop-opacity="0.32"/>
      <stop offset="0.38" stop-color="#120907" stop-opacity="0.57"/>
      <stop offset="1" stop-color="#120907" stop-opacity="0.86"/>
    </linearGradient>
  </defs>
  <image href="${background}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="none"/>
  <rect width="1080" height="1080" fill="#160b07" opacity="0.22"/>
  <rect width="1080" height="1080" fill="url(#shade-square)"/>
  ${portraitMarkup(portrait, 106, 330, 300, 390, 'portrait-square', deceased)}
  <text x="${textX}" y="250" font-family="DejaVu Sans" font-size="24" font-weight="700" fill="#d4b170" letter-spacing="1.2">СЕМЕЙНАЯ ЭНЦИКЛОПЕДИЯ</text>
  ${text}
  ${years ? `<text x="${textX}" y="${yearsY}" font-family="DejaVu Sans" font-size="36" font-weight="500" fill="#d9bd89">${escapeXml(years)}</text>` : ''}
</svg>`;
}

async function renderCached(svg, outputPath) {
  const digest = createHash('sha256').update(svg).digest('hex');
  const cachePath = path.join(CACHE_ROOT, `${digest}.png`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(CACHE_ROOT, { recursive: true });
  if (!(await exists(cachePath))) {
    const png = new Resvg(svg, {
      font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
    }).render().asPng();
    await writeFile(cachePath, png);
  }
  await copyFile(cachePath, outputPath);
}

const [wideBackgroundBytes, squareBackgroundBytes, projectedByRef] = await Promise.all([
  rasterBackground(WIDE_BACKGROUND, 1200, 630),
  rasterBackground(SQUARE_BACKGROUND, 1080, 1080),
  projectedPeople(),
]);
const wideBackground = pngDataUri(wideBackgroundBytes);
const squareBackground = pngDataUri(squareBackgroundBytes);

await rm(OUTPUT_ROOT, { recursive: true, force: true });

const defaultData = {
  title: 'Семейная энциклопедия',
  name: { display: 'Семейная энциклопедия' },
};
await renderCached(wideSvg({ background: wideBackground, portrait: '', data: defaultData }), path.join(OUTPUT_ROOT, 'index.png'));
await renderCached(squareSvg({ background: squareBackground, portrait: '', data: defaultData }), path.join(OUTPUT_ROOT, 'index-square.png'));

let generated = 0;
let resolvedPortraits = 0;
for (const filePath of await walk(PEOPLE_ROOT)) {
  const data = parseFrontmatter(await readFile(filePath, 'utf8'));
  if (data.entity !== 'person') continue;
  const personRef = toPosix(path.relative(PEOPLE_ROOT, filePath));
  const projected = projectedByRef.get(personRef);
  const deceased = isDeceased(data);
  const portraitBytes = await resolvePortraitBytes(personRef, data, projected);
  let widePortrait = '';
  let squarePortrait = '';

  if (portraitBytes) {
    resolvedPortraits += 1;
    const [widePortraitBytes, squarePortraitBytes] = await Promise.all([
      rasterPortrait(portraitBytes, 320, 386, { deceased }),
      rasterPortrait(portraitBytes, 300, 390, { deceased }),
    ]);
    widePortrait = pngDataUri(widePortraitBytes);
    squarePortrait = pngDataUri(squarePortraitBytes);
  }

  const outputStem = personRef.replace(/\.(md|mdx)$/i, '');

  await renderCached(
    wideSvg({ background: wideBackground, portrait: widePortrait, data, deceased }),
    path.join(OUTPUT_ROOT, 'people', `${outputStem}.png`),
  );
  await renderCached(
    squareSvg({ background: squareBackground, portrait: squarePortrait, data, deceased }),
    path.join(OUTPUT_ROOT, 'people', `${outputStem}-square.png`),
  );
  generated += 1;
}

console.log(`Generated OG images for ${generated} person record(s); resolved ${resolvedPortraits} portrait(s).`);
