import type { CollectionEntry } from 'astro:content';

type Doc = CollectionEntry<'docs'>;

/**
 * Only romantic relationship events without a subsequent marriage are folded
 * on a person's page. A marriage may be known from an event or either
 * participant's canonical partner record (including marriages later dissolved).
 */
export function isUnmarriedRelationship(event: Doc, docs: Doc[], personRef: string): boolean {
  if (event.data.entity !== 'event' || event.data.kind !== 'relationship') return false;
  if (!event.data.participants?.includes(personRef)) return false;

  const otherRefs = event.data.participants.filter((ref) => ref !== personRef);
  if (!otherRefs.length) return true;

  const marriageEvent = docs.some((entry) => (
    entry.data.entity === 'event'
    && entry.data.kind === 'marriage'
    && entry.data.participants?.includes(personRef)
    && otherRefs.some((ref) => entry.data.participants?.includes(ref))
  ));
  if (marriageEvent) return false;

  return !docs.some((entry) => {
    if (entry.data.entity !== 'person' || !entry.id.startsWith('people/')) return false;
    const owner = `${entry.id.replace(/^people\//, '')}.md`;
    const counterpartRefs = owner === personRef ? otherRefs : owner && otherRefs.includes(owner) ? [personRef] : [];
    if (!counterpartRefs.length) return false;

    return entry.data.partners?.some((partner) => (
      typeof partner !== 'string'
      && counterpartRefs.includes(partner.person)
      && Boolean(partner.married)
      && partner.married?.known !== false
    )) ?? false;
  });
}
