import { Resvg } from '@resvg/resvg-js';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const PEOPLE_ROOT = path.resolve('src/content/docs/people');
const PUBLIC_ROOT = path.resolve('public');
const OUTPUT_ROOT = path.join(PUBLIC_ROOT, 'generated/og');
const PORTRAIT_ROOT = path.join(PUBLIC_ROOT, 'generated/portraits');
const CACHE_ROOT = path.resolve('node_modules/.astro/genealogy-og');
const WIDE_BACKGROUND = path.resolve('src/assets/og/family-tree-wide.jpg');
const SQUARE_BACKGROUND = path.resolve('src/assets/og/family-tree-square.jpg');

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
  if (value && typeof value === 'object' && Number.isFinite(value.year)) return Math.trunc(value.year);
  return undefined;
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

function mimeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    default: return 'application/octet-stream';
  }
}

async function dataUri(filePath) {
  const bytes = await readFile(filePath);
  return `data:${mimeFor(filePath)};base64,${bytes.toString('base64')}`;
}

async function resolvePortrait(personRef, data) {
  const stem = personRef.replace(/\.(md|mdx)$/i, '');
  for (const extension of ['.webp', '.jpg', '.jpeg', '.png']) {
    const candidate = path.join(PORTRAIT_ROOT, `${stem}${extension}`);
    if (await exists(candidate)) return dataUri(candidate);
  }

  if (typeof data.photo === 'string' && data.photo.startsWith('/')) {
    const candidate = path.join(PUBLIC_ROOT, data.photo.replace(/^\/+/, ''));
    if (await exists(candidate)) return dataUri(candidate);
  }

  return '';
}

function portraitMarkup(uri, x, y, width, height, clipId) {
  if (!uri) return '';
  return `
  <defs>
    <clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="24"/></clipPath>
  </defs>
  <rect x="${x - 7}" y="${y - 7}" width="${width + 14}" height="${height + 14}" rx="29" fill="#1a0e09" stroke="#c49a58" stroke-width="4"/>
  <image href="${uri}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`;
}

function wideSvg({ background, portrait, data }) {
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
      <stop offset="0" stop-color="#120907" stop-opacity="0.48"/>
      <stop offset="0.42" stop-color="#120907" stop-opacity="0.58"/>
      <stop offset="1" stop-color="#120907" stop-opacity="0.82"/>
    </linearGradient>
  </defs>
  <image href="${background}" x="0" y="0" width="1200" height="630" preserveAspectRatio="xMidYMid slice"/>
  <rect width="1200" height="630" fill="#160b07" opacity="0.30"/>
  <rect width="1200" height="630" fill="url(#shade)"/>
  ${portraitMarkup(portrait, 96, 122, 320, 386, 'portrait-wide')}
  <text x="${textX}" y="126" font-family="DejaVu Sans" font-size="25" font-weight="700" fill="#d4b170" letter-spacing="1.4">СЕМЕЙНАЯ ЭНЦИКЛОПЕДИЯ</text>
  ${text}
  ${years ? `<text x="${textX}" y="${yearsY}" font-family="DejaVu Sans" font-size="35" font-weight="500" fill="#d9bd89">${escapeXml(years)}</text>` : ''}
</svg>`;
}

function squareSvg({ background, portrait, data }) {
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
      <stop offset="0" stop-color="#120907" stop-opacity="0.46"/>
      <stop offset="0.38" stop-color="#120907" stop-opacity="0.60"/>
      <stop offset="1" stop-color="#120907" stop-opacity="0.84"/>
    </linearGradient>
  </defs>
  <image href="${background}" x="0" y="0" width="1080" height="1080" preserveAspectRatio="xMidYMid slice"/>
  <rect width="1080" height="1080" fill="#160b07" opacity="0.32"/>
  <rect width="1080" height="1080" fill="url(#shade-square)"/>
  ${portraitMarkup(portrait, 82, 330, 300, 390, 'portrait-square')}
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

const [wideBackground, squareBackground] = await Promise.all([
  dataUri(WIDE_BACKGROUND),
  dataUri(SQUARE_BACKGROUND),
]);

await rm(OUTPUT_ROOT, { recursive: true, force: true });

const defaultData = {
  title: 'Семейная энциклопедия',
  name: { display: 'Семейная энциклопедия' },
};
await renderCached(wideSvg({ background: wideBackground, portrait: '', data: defaultData }), path.join(OUTPUT_ROOT, 'index.png'));
await renderCached(squareSvg({ background: squareBackground, portrait: '', data: defaultData }), path.join(OUTPUT_ROOT, 'index-square.png'));

let generated = 0;
for (const filePath of await walk(PEOPLE_ROOT)) {
  const data = parseFrontmatter(await readFile(filePath, 'utf8'));
  if (data.entity !== 'person') continue;
  const personRef = toPosix(path.relative(PEOPLE_ROOT, filePath));
  const portrait = await resolvePortrait(personRef, data);
  const outputStem = personRef.replace(/\.(md|mdx)$/i, '');
  await renderCached(
    wideSvg({ background: wideBackground, portrait, data }),
    path.join(OUTPUT_ROOT, 'people', `${outputStem}.png`),
  );
  await renderCached(
    squareSvg({ background: squareBackground, portrait, data }),
    path.join(OUTPUT_ROOT, 'people', `${outputStem}-square.png`),
  );
  generated += 1;
}

console.log(`Generated OG images for ${generated} person record(s).`);
