import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const personPath = path.resolve('src/content/docs/people/1880-1889/vladimir-bush.md');
const mediaDir = path.resolve('src/content/docs/media/1880-1889');
const mediaPath = path.join(mediaDir, 'vladimir-bush-portrait.md');
const portraitRef = '1880-1889/vladimir-bush-portrait.md';
const personRef = '1880-1889/vladimir-bush.md';

let person = await readFile(personPath, 'utf8');
const photoMatch = person.match(/^photo:\s*["']?(https?:\/\/[^"'\n]+)["']?\s*$/m);
if (!photoMatch) throw new Error('Vladimir Bush legacy photo URL was not found.');
const remoteUrl = photoMatch[1];

await mkdir(mediaDir, { recursive: true });

const media = `---\ntitle: "Владимир Владимирович Буш — портрет"\nentity: media\nmediaType: photo\nimage: "${remoteUrl}"\nalt: "Владимир Владимирович Буш"\ncaption: "Владимир Владимирович Буш"\nsubjects:\n  - person: "${personRef}"\noriginalUrl: "${remoteUrl}"\ncredit: "MyHeritage snapshot 2026-09-10"\nsidebar:\n  hidden: true\n---\n\nПортрет Владимира Владимировича Буша. Пока используется внешний импортный URL; media-record позволяет заменить его локальным файлом без изменения карточки человека или галерей.\n`;
await writeFile(mediaPath, media, 'utf8');

if (!/^portrait:/m.test(person)) {
  person = person.replace(photoMatch[0], `${photoMatch[0]}\nportrait: "${portraitRef}"`);
  await writeFile(personPath, person, 'utf8');
}

console.log(`Linked remote media ${portraitRef} from ${personRef}; CDN materialization remains intentionally separate.`);
