import { getCollection } from 'astro:content';
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

function dateKey(value: unknown): number {
  if (typeof value === 'number') return value * 10000;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
    if (match) return Number(match[1]) * 10000 + Number(match[2] ?? 0) * 100 + Number(match[3] ?? 0);
    return Number.MAX_SAFE_INTEGER;
  }
  if (value && typeof value === 'object' && 'year' in value) {
    const item = value as { year?: number; month?: number; day?: number };
    if (item.year) return item.year * 10000 + (item.month ?? 0) * 100 + (item.day ?? 0);
  }
  return Number.MAX_SAFE_INTEGER;
}

function mediaSubjectMatches(value: unknown, personRef: string): boolean {
  if (typeof value === 'string') return value === personRef;
  if (!value || typeof value !== 'object' || !('person' in value)) return false;
  return (value as { person?: string }).person === personRef;
}

function partnerRef(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || !('person' in value)) return undefined;
  const person = (value as { person?: unknown }).person;
  return typeof person === 'string' ? person : undefined;
}

function eventAnchor(eventId: string): string {
  return `timeline-${eventId
    .replace(/^events\//, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')}`;
}

export const onRequest = defineRouteMiddleware(async (context) => {
  const route = context.locals.starlightRoute;
  if (!route.toc || route.entry.data.entity !== 'person' || !route.id.startsWith('people/')) return;

  const personRef = `${route.id.replace(/^people\//, '').replace(/\/$/, '')}.md`;
  const docs = await getCollection('docs');

  const events = docs
    .filter((entry) => (
      entry.data.entity === 'event'
      && entry.data.timeline !== false
      && entry.data.participants?.includes(personRef)
    ))
    .sort((a, b) => dateKey(a.data.date) - dateKey(b.data.date) || a.data.title.localeCompare(b.data.title, 'ru'));

  const hasPhotos = docs.some((entry) => (
    entry.data.entity === 'media'
    && Boolean(entry.data.image)
    && entry.data.subjects?.some((subject) => mediaSubjectMatches(subject, personRef))
  ));

  const geoPlaceRefs = new Set(
    docs
      .filter((entry) => entry.data.entity === 'place' && Boolean(entry.data.geo))
      .map((entry) => `${entry.id.replace(/^places\//, '')}.md`),
  );
  const hasEventMap = events.some((event) => event.data.places?.some((place) => geoPlaceRefs.has(place)));

  const person = route.entry.data;
  const hasDirectRelations = Boolean(
    person.father
    || person.mother
    || person.parents?.length
    || person.partners?.length,
  );
  const hasReverseRelations = docs.some((entry) => {
    if (entry.data.entity !== 'person') return false;
    const parentRefs = [entry.data.father, entry.data.mother, ...(entry.data.parents ?? [])];
    if (parentRefs.includes(personRef)) return true;
    return entry.data.partners?.some((partner) => partnerRef(partner) === personRef) ?? false;
  });
  const hasRelations = hasDirectRelations || hasReverseRelations;

  const generatedItems = [];

  if (hasPhotos) {
    generatedItems.push({
      depth: 2,
      slug: 'person-gallery-heading',
      text: 'Фото',
      children: [],
    });
  }

  if (events.length > 0) {
    generatedItems.push({
      depth: 2,
      slug: 'event-seq-person-heading',
      text: 'Лента событий',
      children: events.map((event) => ({
        depth: 3,
        slug: eventAnchor(event.id),
        text: event.data.title,
        children: [],
      })),
    });
  }

  if (hasEventMap) {
    const mapId = `person-places-${personRef.replace(/[^a-z0-9]+/gi, '-')}`;
    generatedItems.push({
      depth: 2,
      slug: `${mapId}-heading`,
      text: 'Карта событий',
      children: [],
    });
  }

  if (hasRelations) {
    generatedItems.push({
      depth: 2,
      slug: `family-tree-${personRef.replace(/[^a-z0-9_-]+/gi, '-')}`,
      text: 'Родственные связи',
      children: [],
    });
  }

  route.toc = {
    ...route.toc,
    items: [...route.toc.items, ...generatedItems],
  };
});
