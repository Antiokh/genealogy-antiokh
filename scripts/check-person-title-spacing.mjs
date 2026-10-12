import { readFile } from 'node:fs/promises';

const path = new URL('../src/components/GenealogyPageTitle.astro', import.meta.url);
const source = await readFile(path, 'utf8');
const titleBlock = source.match(/<h1 class="person-name-heading">[\s\S]*?<\/h1>/)?.[0];

if (!titleBlock) {
  console.error('Could not find the person-name heading in GenealogyPageTitle.astro.');
  process.exit(1);
}

if (!titleBlock.includes("{surname && ' '}")) {
  console.error('Person title must render an explicit text-space between surname and given name so Pagefind/metadata do not concatenate them.');
  process.exit(1);
}

console.log('Person title spacing check passed.');
