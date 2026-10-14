import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const partsDir = path.join(root, 'src', 'assets', 'favicon');
const outputPath = path.join(root, 'public', 'favicon.svg');
const expectedSha256 = '23ec4b3108e3a4c1423178964b13e614ecc06bc6f58a6cfe778bac2f9a1309f8';

const partNames = (await readdir(partsDir))
  .filter((name) => /^part-\d+\.b64$/.test(name))
  .sort();

if (!partNames.length) throw new Error('No favicon source parts found.');

const encoded = (await Promise.all(
  partNames.map((name) => readFile(path.join(partsDir, name), 'utf8')),
)).join('');
const svg = gunzipSync(Buffer.from(encoded, 'base64'));
const actualSha256 = createHash('sha256').update(svg).digest('hex');

if (actualSha256 !== expectedSha256) {
  throw new Error(`Favicon checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, svg);
console.log(`Generated public/favicon.svg (${svg.length} bytes, sha256 ${actualSha256})`);
