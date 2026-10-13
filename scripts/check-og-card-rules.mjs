import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./build-og-images.mjs', import.meta.url), 'utf8');

const required = [
  "docs/Stitched Leather Family Tree Book Cover.webp",
  "docs/Emblematic Tree Leather Book Cover.webp",
  "import sharp from 'sharp'",
  'function isDeceased(data)',
  "fill=\"#090909\"",
  'image = image.grayscale()',
  'async function resolvePortraitBytes(personRef)',
  "path.join(PEOPLE_ROOT, `${stem}.webp`)",
  'const portraitBytes = await resolvePortraitBytes(personRef);',
  'if (portraitBytes) {',
  "let widePortrait = '';",
  "let squarePortrait = '';",
];

const forbidden = [
  'PORTRAIT_PLACEHOLDER',
  'placeholderBytes',
  'portraitBytes ||',
  'placeholder: isPlaceholder',
  'fetchRemoteBytes',
  'REMOTE_CACHE_ROOT',
  'projectedPeople()',
  'projected?.photo',
  'data.photo',
  'PORTRAIT_ROOT',
  'GENERATED_PEOPLE',
  'await fetch(',
];

const missing = required.filter((needle) => !source.includes(needle));
const presentForbidden = forbidden.filter((needle) => source.includes(needle));
if (missing.length || presentForbidden.length) {
  console.error('OG portrait/theme rule regression detected:');
  for (const needle of missing) console.error(`- missing ${needle}`);
  for (const needle of presentForbidden) console.error(`- forbidden ${needle}`);
  process.exit(1);
}

console.log('OG portrait/theme rule check passed.');
