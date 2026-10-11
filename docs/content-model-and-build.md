# Canonical content model and derived genealogy graph

## Goal

The repository is the human-editable database. Person pages should be convenient to read and edit directly, convenient to inspect as a table, and independent of any tree renderer.

The visual genealogy graph, timelines, maps and galleries are build/render projections, not duplicated source data.

## Canonical person records

People live under:

```text
src/content/docs/people/<birth-decade>/<person>.md
```

Links between people use content references relative to the `people/` root, for example:

```yaml
father: 1960-1969/vladislav-nazarov.md
mother: 1960-1969/tatyana-beskorovaynaya.md
```

This is intentionally more readable for editors than opaque internal IDs. A refactor that moves a person to another decade must update incoming content references; the build validator detects stale references.

A typical person record is:

```yaml
---
title: Антон Назаров
entity: person

name:
  display: Антон Назаров
  first: Антон
  last: Назаров
  birth_last: Назаров
  aliases: []

sex: M

father: 1960-1969/vladislav-nazarov.md
mother: 1960-1969/tatyana-beskorovaynaya.md

born:
  date: 1988-12-21
  place: moscow.md

died:
  known: false
  date:
  place:

buried:
  date:
  place:

partners:
  - person: 2000-2009/anna-tatarintseva.md
    married:
      date: 2023-01-21
      place: belgrade-zvezdara.md

occupation:
  - programmer
  - entrepreneur

residence:
  - place: moscow.md
    from: 1988
    to: 2022
  - place: belgrade.md
    from: 2022

sources: []
external:
  myheritage:
    xref: I500001
---
```

The schema may contain more factual fields when useful for tables and analytics. Normalization is not a goal by itself; editability is.

## Portraits, media and photographs

### Main portrait

The ordinary main portrait is an asset of the person page, not a separate media entity. By convention it is a WebP file next to the Markdown record with the same basename:

```text
src/content/docs/people/1880-1889/vladimir-bush.md
src/content/docs/people/1880-1889/vladimir-bush.webp
```

No frontmatter field is required. Starlight detects the matching `.webp` automatically and renders it beside the page title. Keeping the same basename also reuses the uniqueness already present in person filenames, including existing suffixes used for namesakes.

An explicit `portrait` field exists only as an override for unusual cases, for example a differently named local image or a temporary remote URL:

```yaml
portrait: ./vladimir-bush-special.webp
```

The legacy imported `photo` URL remains temporarily supported as the final rendering fallback. Existing old `portrait: *.md` references to media records are also read during transition, but new curated person records should not create media records merely to hold a main portrait.

Portrait resolution order is:

1. explicit direct `portrait` image/URL override, when present;
2. same-basename local `person.webp`;
3. legacy `portrait: *.md` media reference, during transition;
4. legacy imported `photo` URL.

This order means adding `foo.webp` beside `foo.md` automatically migrates an old card to the new convention even if a legacy portrait-media reference has not yet been removed.

Local portrait files are preferred because Astro reads their dimensions, fingerprints them and can emit responsive optimized assets at build time. Remote URLs remain dependent on the remote host and may block hotlinking or server downloads.

### Media records and galleries

A photograph becomes a first-class `media` record when it has its own identity or context: for example a group photograph, historical scene, event photograph, document/scan, or an image that belongs to several people, a place or an event.

Media records live under:

```text
src/content/docs/media/
```

Prefer placing the original image beside its media record:

```text
media/1925/volsk-expedition.md
media/1925/volsk-expedition.jpg
```

Example:

```yaml
---
title: Экспедиция в Вольском уезде
entity: media
mediaType: photo
image: ./volsk-expedition.jpg
alt: Участники фольклорной экспедиции
caption: Экспедиция в Вольском уезде
date: 1925
subjects:
  - person: 1880-1889/vladimir-bush.md
    focal:
      x: 0.37
      y: 0.42
  - person: 1890-1899/example-person.md
place: volsky-uyezd.md
eventRefs:
  - 1925/example-expedition.md
source: example-source.md
---
```

`subjects[]` is the canonical person-to-photo relation. A group photograph is stored once and may name any number of people. The same media record is then projected automatically into every subject's gallery.

Do not maintain `gallery[]` on person records. The build creates reverse indexes from media records:

```text
media -> subjects[]
           ↓
       person -> media[]
```

The same media record may also reference a place and one or more events, allowing place/event galleries to use the same source without duplication.

The standalone main portrait is deliberately not part of this media graph. If an image that happens to be used as a portrait also needs historical metadata, multiple subjects, a place/event relation or source-level treatment, it can instead be modeled as media and selected explicitly as a legacy/exceptional portrait.

PhotoSwipe is used for derived media galleries. It is enabled only when real image dimensions are available. Local Astro assets provide them automatically; a remote media record can provide explicit `width` and `height` if those values are known. Unknown dimensions fall back to a normal link instead of inventing geometry.

Optional `subjects[].focal` coordinates are normalized from `0` to `1` and identify where a particular person is located within a group image.

## What is stored and what is derived

Store only facts that an editor or importer actually knows:

- names and surnames;
- sex;
- an optional same-basename portrait asset or explicit portrait override;
- media records and the people/places/events they depict;
- father and mother;
- explicit additional/unknown parents when necessary;
- partners and marriage/divorce facts;
- birth, death and burial facts;
- occupations and residences;
- places and sources;
- external source identifiers.

Do not maintain reverse or graph-derived fields by hand:

- person galleries;
- place/event galleries;
- children;
- siblings;
- grandparents;
- grandchildren;
- ancestors;
- descendants;
- generation numbers;
- connected-component membership;
- visualization-specific node/edge structures.

Children are derived by scanning other people whose `father`, `mother` or generic `parents` reference the person. Galleries are derived by scanning media `subjects`, `place` and `eventRefs`.

## People without genealogy links

A person does not need to be connected to the family graph to exist in the encyclopedia.

All valid person records appear in catalog/search/table views.

Only people with at least one genealogy edge are included in the visualization graph. A completely isolated person is therefore searchable and readable but does not create an isolated box on the family map.

Independent family branches become separate connected components. The renderer may show one component at a time instead of forcing unrelated branches onto one canvas.

## Build products

Before the Astro/Starlight build, the data scripts rebuild the projections from canonical Markdown/YAML:

```text
scripts/build-genealogy.mjs
scripts/augment-genealogy-metadata.mjs
scripts/build-events-places.mjs
scripts/build-media.mjs
```

The genealogy build writes:

```text
public/generated/people.json
public/generated/genealogy.json
```

The event/place build writes event, place and geographic projections. The media build writes:

```text
public/generated/media.json
public/generated/media-index.json
```

`media-index.json` contains reverse indexes by person, place and event so consumers do not need to duplicate those lists in source records. Main portrait files are not included in `media-index.json` because they belong directly to person pages rather than the media relation graph.

Generated files are ignored by Git. They are rebuilt from zero every time and copied into the static site through Astro's `public/` directory.

## Validation

The build fails for broken person references or self-references. Media validation additionally fails for broken media subject, place, event or source references. Transitional `portrait: *.md` values are still checked as legacy media references; direct portrait image overrides are validated by Astro's content schema.

During migration the genealogy builder also understands the first snapshot's legacy `P...` references so the repository can move to content refs incrementally.

The final canonical form is path-based frontmatter. Legacy `P...` IDs, direct person `photo` URLs and portrait-as-media records are transitional only.
