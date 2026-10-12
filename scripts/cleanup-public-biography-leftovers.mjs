import { readFile, writeFile } from 'node:fs/promises';

const path = 'src/content/docs/people/1980-1989/anton-nazarov.md';
const raw = await readFile(path, 'utf8');
const next = raw.replace(
  '[Экспорт MyHeritage: Антон Назаров, I500001 / 1500001](/sources/myheritage-anton-nazarov-export/)',
  '[Экспорт MyHeritage: Антон Назаров](/sources/myheritage-anton-nazarov-export/)',
);

if (next !== raw) {
  await writeFile(path, next, 'utf8');
  console.log('Removed internal MyHeritage IDs from Anton source label.');
} else {
  console.log('Anton source label already clean.');
}
