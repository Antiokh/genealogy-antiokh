import { access } from 'node:fs/promises';
import path from 'node:path';

const requiredFiles = [
  'docs/Stitched Leather Family Tree Book Cover.webp',
  'docs/Emblematic Tree Leather Book Cover.webp',
  'public/tree/person-placeholder.svg',
];

for (const file of requiredFiles) {
  try {
    await access(path.resolve(file));
  } catch {
    console.error(`Missing OG render source: ${file}`);
    process.exit(1);
  }
}

console.log('OG render sources are present.');
