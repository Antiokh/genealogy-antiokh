#!/usr/bin/env node

import { access, copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

const PEOPLE_ROOT = path.resolve('src/content/docs/people');
const MEDIA_ROOT = path.resolve('src/content/docs/media/myheritage');
const REPORT_PATH = path.resolve('imports/myheritage-2026/portrait-attachment-report.json');

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walk(root, test) {
  if (!(await exists(root))) return [];
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full, test));
    else if (entry.isFile() && test(full)) out.push(full);
  }
  return out;
}

function frontmatter(content) {
  const raw = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1];
  return raw ? (YAML.parse(raw) ?? {}) : {};
}

function posix(value) {
  return value.split(path.sep).join('/');
}

function personRef(filePath) {
  return posix(path.relative(PEOPLE_ROOT, filePath));
}

function mediaRef(filePath) {
  return `myheritage/${path.basename(filePath)}`;
}

function numericPhotoId(filePath) {
  const m = path.basename(filePath).match(/photo-(\d+)/i);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

const BAD_PORTRAIT = /\b(?:burial|grave|tomb|headstone|cemetery|document|certificate)\b|могил|захорон|кладбищ|свидетельств|документ/i;
const STRONG_PORTRAIT = /\b(?:face|portrait|profile|avatar)\b|портрет|аватар|лицо/i;
const SOFT_PORTRAIT = /\bnew(?:\.jpg)?\b|improved|colorized|colourized|реставр|улучш|цветн/i;

function candidateScore(candidate) {
  const label = `${candidate.title ?? ''} ${candidate.caption ?? ''}`.trim();
  if (BAD_PORTRAIT.test(label)) return -1000;
  let score = 0;
  if (STRONG_PORTRAIT.test(label)) score += 100;
  if (candidate.subjectCount === 1) score += 50;
  if (SOFT_PORTRAIT.test(label)) score += 15;
  return score;
}

const people = new Map();
for (const filePath of await walk(PEOPLE_ROOT, (p) => /\.mdx?$/i.test(p))) {
  const data = frontmatter(await readFile(filePath, 'utf8'));
  if (data.entity !== 'person') continue;
  people.set(personRef(filePath), { filePath, data });
}

const candidatesByPerson = new Map();
for (const filePath of await walk(MEDIA_ROOT, (p) => /\.mdx?$/i.test(p))) {
  const data = frontmatter(await readFile(filePath, 'utf8'));
  if (data.entity !== 'media' || data.mediaType !== 'photo' || typeof data.image !== 'string') continue;

  const imagePath = path.resolve(path.dirname(filePath), data.image);
  if (!(await exists(imagePath))) continue;
  const subjects = Array.isArray(data.subjects)
    ? data.subjects.map((subject) => subject?.person).filter((ref) => typeof ref === 'string' && people.has(ref))
    : [];
  if (!subjects.length) continue;

  for (const ref of subjects) {
    const candidate = {
      media: mediaRef(filePath),
      imagePath,
      title: data.title ?? '',
      caption: data.caption ?? '',
      subjectCount: subjects.length,
      photoId: numericPhotoId(filePath),
    };
    const list = candidatesByPerson.get(ref) ?? [];
    list.push(candidate);
    candidatesByPerson.set(ref, list);
  }
}

const attached = [];
const skippedExisting = [];
const skippedExplicit = [];
const rejectedOnly = [];
const noCandidate = [];

for (const [ref, person] of [...people.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const target = person.filePath.replace(/\.mdx?$/i, '.webp');
  if (await exists(target)) {
    skippedExisting.push(ref);
    continue;
  }

  // Any explicit portrait field is editorial intent. Never override it here.
  if (typeof person.data.portrait === 'string' && person.data.portrait.trim()) {
    skippedExplicit.push({ person: ref, portrait: person.data.portrait.trim() });
    continue;
  }

  const candidates = candidatesByPerson.get(ref) ?? [];
  if (!candidates.length) {
    noCandidate.push(ref);
    continue;
  }

  const ranked = candidates
    .map((candidate) => ({ ...candidate, score: candidateScore(candidate) }))
    .sort((a, b) => b.score - a.score || a.photoId - b.photoId || a.media.localeCompare(b.media));
  const chosen = ranked.find((candidate) => candidate.score > -1000);
  if (!chosen) {
    rejectedOnly.push({ person: ref, media: ranked.map((candidate) => candidate.media) });
    continue;
  }

  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(chosen.imagePath, target);
  attached.push({
    person: ref,
    portrait: posix(path.relative(PEOPLE_ROOT, target)),
    sourceMedia: chosen.media,
    sourceTitle: chosen.title,
    score: chosen.score,
    bytes: (await stat(target)).size,
    alternatives: ranked.length - 1,
  });
  console.log(`Attached ${ref} <- ${chosen.media}${chosen.title ? ` (${chosen.title})` : ''}`);
}

await mkdir(path.dirname(REPORT_PATH), { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  strategy: 'local MyHeritage media subjects -> same-basename person WebP',
  rules: {
    preserveExistingSameBasenamePortrait: true,
    preserveExplicitPortraitField: true,
    rejectTitlePattern: BAD_PORTRAIT.source,
    preferTitlePattern: STRONG_PORTRAIT.source,
    preferSingleSubject: true,
    tieBreak: 'lowest MyHeritage photo ID',
  },
  counts: {
    people: people.size,
    peopleWithMediaCandidates: candidatesByPerson.size,
    attached: attached.length,
    skippedExisting: skippedExisting.length,
    skippedExplicit: skippedExplicit.length,
    rejectedOnly: rejectedOnly.length,
    noCandidate: noCandidate.length,
  },
  attached,
  skippedExisting,
  skippedExplicit,
  rejectedOnly,
  noCandidate,
};
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Portrait attachments: ${attached.length}; candidate people: ${candidatesByPerson.size}; report: ${posix(path.relative(process.cwd(), REPORT_PATH))}`);
