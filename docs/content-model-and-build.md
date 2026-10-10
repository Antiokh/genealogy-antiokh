# Canonical content model and derived genealogy graph

## Goal

The repository is the human-editable database. Person pages should be convenient to read and edit directly, convenient to inspect as a table, and independent of any tree renderer.

The visual genealogy graph is a build artifact, not source data.

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
photo: anton.webp

father: 1960-1969/vladislav-nazarov.md
mother: 1960-1969/tatyana-beskorovaynaya.md

born:
  date: 1988-12-21
  place: places/moscow.md

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
      place: places/belgrade-zvezdara.md

occupation:
  - programmer
  - entrepreneur

residence:
  - place: places/moscow.md
    from: 1988
    to: 2022
  - place: places/belgrade.md
    from: 2022

sources: []
external:
  myheritage:
    xref: I500001
---
```

The schema may contain more factual fields when useful for tables and analytics. Normalization is not a goal by itself; editability is.

## What is stored and what is derived

Store only facts that an editor or importer actually knows:

- names and surnames;
- sex;
- photo;
- father and mother;
- explicit additional/unknown parents when necessary;
- partners and marriage/divorce facts;
- birth, death and burial facts;
- occupations and residences;
- places and sources;
- external source identifiers.

Do not maintain reverse or graph-derived fields by hand:

- children;
- siblings;
- grandparents;
- grandchildren;
- ancestors;
- descendants;
- generation numbers;
- connected-component membership;
- visualization-specific node/edge structures.

Children are derived by scanning other people whose `father`, `mother` or generic `parents` reference the person.

## People without genealogy links

A person does not need to be connected to the family graph to exist in the encyclopedia.

All valid person records appear in catalog/search/table views.

Only people with at least one genealogy edge are included in the visualization graph. A completely isolated person is therefore searchable and readable but does not create an isolated box on the family map.

Independent family branches become separate connected components. The renderer may show one component at a time instead of forcing unrelated branches onto one canvas.

## Build products

Before the Astro/Starlight build, `scripts/build-genealogy.mjs` reads every person frontmatter record and writes:

```text
public/generated/people.json
public/generated/genealogy.json
```

`people.json` contains every person plus derived relations useful for tables and analytics.

`genealogy.json` contains only connected people, normalized genealogy edges and connected components for visual renderers.

The generated files are ignored by Git. They are rebuilt from zero every time and copied into the static site through Astro's `public/` directory.

## Validation

The build fails for broken person references or self-references. During migration it also understands the first snapshot's legacy `P...` references so the repository can move to content refs incrementally.

The final canonical form is path-based frontmatter. Legacy `P...` IDs are transitional only.
