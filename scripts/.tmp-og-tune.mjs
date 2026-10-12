import { readFile, writeFile, unlink } from 'node:fs/promises';

const path = new URL('./build-og-images.mjs', import.meta.url);
let source = await readFile(path, 'utf8');
source = source
  .replace('const ribbonHeight = Math.max(15, Math.round(width * 0.05));', 'const ribbonHeight = Math.max(30, Math.round(width * 0.10));')
  .replace('const ribbonX = Math.round(x + width * 0.34);', 'const ribbonX = Math.round(x + width * 0.46);')
  .replace('const ribbonY = Math.round(y + height * 0.79);', 'const ribbonY = Math.round(y + height * 0.88);')
  .replace("portraitMarkup(portrait, 96, 122, 320, 386, 'portrait-wide', deceased)", "portraitMarkup(portrait, 122, 122, 320, 386, 'portrait-wide', deceased)")
  .replace("portraitMarkup(portrait, 82, 330, 300, 390, 'portrait-square', deceased)", "portraitMarkup(portrait, 106, 330, 300, 390, 'portrait-square', deceased)");
await writeFile(path, source);
await unlink(new URL(import.meta.url));
