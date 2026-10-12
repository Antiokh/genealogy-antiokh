import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./build-og-images.mjs', import.meta.url), 'utf8');

const required = [
  "docs/Stitched Leather Family Tree Book Cover.webp",
  "docs/Emblematic Tree Leather Book Cover.webp",
  "import sharp from 'sharp'",
  'function isDeceased(data)',
  "fill=\"#090909\"",
  'image = image.grayscale()',
  'projectedPeople()',
];

const missing = required.filter((needle) => !source.includes(needle));
if (missing.length) {
  console.error('OG portrait/theme rule regression detected:');
  for (const needle of missing) console.error(`- missing ${needle}`);
  process.exit(1);
}

console.log('OG portrait/theme rule check passed.');
