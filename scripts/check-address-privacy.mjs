import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('src/content/docs');
const patterns = [
  // Unit identifiers, including Russian and English forms.
  /(?:^|[^\p{L}])(?:кв\.?|квартир(?:а|е|у|ы|ой)|апартамент(?:ы|ах|е)?|apartment|apt\.?|suite|unit)\s*(?:(?:№|#|N)\s*)?\d+[\p{L}\d-]*/giu,
  /(?:^|[^\p{L}])(?:№|номер)\s*(?:квартир(?:ы|а|е)|апартамент(?:а|ов)?|suite|unit)\s*[:#№-]?\s*\d+[\p{L}\d-]*/giu,
  // Building entrance / floor / interior room identifiers (not building corps).
  /(?:^|[^\p{L}])(?:подъезд(?:а|е)?|этаж(?:е|а)?|комнат(?:а|ы|е|у)|entrance|floor)\s*(?:(?:№|#|N)\s*)?\d+[\p{L}\d-]*/giu,
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile() && /\.(md|mdx)$/i.test(entry.name)) yield full;
  }
}

const issues = [];
for (const file of walk(root)) {
  const content = readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        issues.push(path.relative(process.cwd(), file) + ':' + (i + 1));
        break;
      }
    }
  });
}
if (issues.length) {
  console.error('Residential address privacy check failed: addresses may disclose unit/room/entrance/floor numbers.');
  console.error('Remove the unit detail; only a building address is permitted:');
  issues.forEach((issue) => console.error(' - ' + issue));
  process.exit(1);
}
console.log('Address privacy check passed for published genealogy Markdown.');
