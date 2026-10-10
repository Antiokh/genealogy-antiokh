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
portrait: 1980-1989/anton-nazarov-portrait.md

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

## Media and photographs

A photograph is a first-class record, not an array copied into every person page. Media records live under:

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

The same media record may also reference a place and one or more events, allowing future place/event galleries to use the same source without duplication.

### Main portrait

The main photograph is an editorial choice and therefore belongs on the person record as one direct reference:

```yaml
portrait: 1880-1889/vladimir-bush-portrait.md
```

`portrait` points to a media record relative to the `media/` root. It does not duplicate the image path itself.

The legacy `photo` string remains temporarily supported as a rendering fallback for imported records. New curated records should use `portrait` plus a media record.

### Local vs remote images

Local image files are preferred. Astro reads their real dimensions and can generate responsive optimized variants at build time. Remote URLs are accepted for transition/provenance, but they remain dependent on the remote host and may block hotlinking or server downloads.

PhotoSwipe is enabled only when real image dimensions are available. Local Astro assets provide them automatically; a remote media record can provide explicit `width` and `height` if those values are known. Unknown dimensions fall back to a normal link instead of inventing geometry.

Optional `subjects[].focal` coordinates are normalized from `0` to `1` and identify where a particular person is located within a group image. They can be used for portrait cropping without creating duplicate derivative source files.

## What is stored and what is derived

Store only facts that an editor or importer actually knows:

- names and surnames;
- sex;
- explicit main `portrait` selection;
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

`media-index.json` contains reverse indexes by person, place and event so consumers do not need to duplicate those lists in source records.

Generated files are ignored by Git. They are rebuilt from zero every time and copied into the static site through Astro's `public/` directory.

## Validation

The build fails for broken person references or self-references. Media validation additionally fails for broken `portrait`, media subject, place, event or source references.

During migration the genealogy builder also understands the first snapshot's legacy `P...` references so the repository can move to content refs incrementally.

The final canonical form is path-based frontmatter. Legacy `P...` IDs and direct person `photo` URLs are transitional only.
