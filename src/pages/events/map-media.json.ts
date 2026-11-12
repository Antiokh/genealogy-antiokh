import type { APIRoute } from 'astro';
import { getImage } from 'astro:assets';
import { getCollection } from 'astro:content';

export const prerender = true;

function recordRef(id: string, type: string) {
  return `${id.replace(new RegExp(`^${type}/`), '')}.md`;
}

function mediaYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/(?:^|[^\d])(\d{3,4})(?:[^\d]|$)/);
    return match ? Number(match[1]) : null;
  }
  if (value && typeof value === 'object' && 'year' in value) {
    const year = (value as { year?: unknown }).year;
    return typeof year === 'number' && Number.isInteger(year) ? year : null;
  }
  return null;
}

function subjectRef(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'person' in value) {
    const person = (value as { person?: unknown }).person;
    return typeof person === 'string' ? person : null;
  }
  return null;
}

export const GET: APIRoute = async () => {
  const docs = await getCollection('docs');
  const published = docs.filter((entry) => entry.data.draft !== true && entry.data.public !== false);
  const places = new Map(published.filter((entry) => entry.data.entity === 'place')
    .map((entry) => [recordRef(entry.id, 'places'), entry]));
  const events = new Map(published.filter((entry) => entry.data.entity === 'event')
    .map((entry) => [recordRef(entry.id, 'events'), entry]));

  const photos = [];
  for (const entry of published) {
    if (entry.data.entity !== 'media' || !entry.data.image) continue;
    if (entry.data.mediaType && entry.data.mediaType !== 'photo') continue;

    const { image, geo, place, eventRefs = [] } = entry.data;
    // An explicit media place wins. Derive a place from eventRefs only when
    // every referenced event agrees on one uniquely identifiable location.
    let placeRef = typeof place === 'string' && places.has(place) ? place : null;
    if (!placeRef && !geo && eventRefs.length) {
      const inferred = new Set<string>();
      for (const eventRef of eventRefs) {
        const related = events.get(eventRef);
        for (const ref of related?.data.places ?? []) inferred.add(ref);
      }
      if (inferred.size === 1) {
        const [ref] = inferred;
        if (places.has(ref)) placeRef = ref;
      }
    }

    const placeEntry = placeRef ? places.get(placeRef) : undefined;
    const point = geo || placeEntry?.data.geo;
    if (!point) continue;
    const coords = [point.longitude, point.latitude];
    if (!coords.every(Number.isFinite)) continue;

    const imageUrl = typeof image === 'string' ? image : image.src;
    const thumbnailUrl = typeof image === 'string'
      ? image
      : (await getImage({ src: image, width: 96, height: 96, fit: 'cover', format: 'webp' })).src;

    const explicitDifferentPoint = Boolean(geo && (!placeEntry?.data.geo
      || Math.abs(geo.latitude - placeEntry.data.geo.latitude) > 0.00001
      || Math.abs(geo.longitude - placeEntry.data.geo.longitude) > 0.00001));
    const ref = recordRef(entry.id, 'media');
    photos.push({
      ref,
      url: `/media/${ref.replace(/\.mdx?$/i, '')}/`,
      title: entry.data.title,
      caption: entry.data.caption ?? null,
      alt: entry.data.alt ?? entry.data.title,
      imageUrl,
      thumbnailUrl,
      date: entry.data.date ?? null,
      year: mediaYear(entry.data.date),
      subjects: (entry.data.subjects ?? []).map(subjectRef).filter((ref): ref is string => Boolean(ref)),
      eventRefs,
      placeRef,
      placeUrl: placeRef ? `/places/${placeRef.replace(/\.mdx?$/i, '')}/` : null,
      placeLabel: placeEntry?.data.label ?? placeEntry?.data.title ?? entry.data.title,
      coordinates: coords,
      geoExplicit: explicitDifferentPoint,
    });
  }
  photos.sort((a, b) => a.ref.localeCompare(b.ref));
  return new Response(JSON.stringify({ schema: 'genealogy-map-media-1', photos }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
