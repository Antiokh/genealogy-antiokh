# Genealogy Library

A repository-first family-history encyclopedia. People, events and supporting entities live as readable Markdown/YAML in Git; Starlight turns the same files into the browsing interface, while tables, analytics and family-tree renderers consume generated build data.

The repository must remain useful independently of MyHeritage, Genotek, a particular tree library, or even Starlight itself.

## Current state

- Astro + Starlight encyclopedia shell.
- 253 person records imported from the 2026-09-10 MyHeritage snapshot.
- People grouped by birth decade; unknown birth year goes to `people/unknown/`.
- Person-to-person authoring uses readable content refs such as `1960-1969/vladislav-nazarov.md`.
- `father` and `mother` are canonical forward relations; children and siblings are derived at build time.
- Explicit partners/marriages remain canonical because they cannot be inferred from children alone.
- Every build produces `people.json` for all people and `genealogy.json` for the connected visual graph.
- Completely isolated people remain in encyclopedia/search/table views but are omitted from the visual graph.
- Independent family branches are detected as connected components.
- Existing tree-renderer demos remain under `/demos/`; the final renderer is intentionally deferred.

## Product direction

The primary interface is for **reading, exploring and sharing family history**, with occasional corrections and additions. Git is the source of truth. Any editor or import UI must end by changing ordinary repository files rather than creating a second database.

The frontmatter is intentionally useful as a small human-editable database: fields that are helpful for tables or analytics may live there even when a tree renderer does not need them.

Design notes:

- [Canonical content model and derived genealogy graph](docs/content-model-and-build.md)
- [Product direction and reference projects](docs/product-direction-and-references.md)
- [GEDCOM import and conflict strategy](docs/gedcom-import-conflicts.md)
- [Charted Roots migration / compatibility contract](docs/charted-roots-migration-contract.md)

## Canonical content tree

Starlight reads records directly from `src/content/docs/`.

```text
src/content/docs/
├── people/
│   ├── 1810-1819/
│   ├── ...
│   ├── 1980-1989/
│   │   └── anton-nazarov.md
│   ├── 2020-2029/
│   └── unknown/
├── events/
│   ├── 1917/
│   ├── 1941/
│   └── unknown/
├── places/
├── sources/
└── _templates/
```

People are referenced relative to the `people/` root. Example:

```yaml
father: 1960-1969/vladislav-nazarov.md
mother: 1960-1969/tatyana-beskorovaynaya.md
```

This favors direct human editing over opaque internal IDs. If a person file is moved to another decade, incoming refs must be refactored too; the build validator fails on stale references instead of silently producing a broken graph.

## Person records

A typical record looks like:

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
  place: null

died:
  known: false
  date: null
  place: null

buried:
  known: false
  date: null
  place: null

partners:
  - person: 2000-2009/anna-tatarintseva.md
    married:
      date: 2023-01-21

occupation: []
residence: []
sources: []
---
```

The schema accepts empty values so these records can later be represented as an editable table without inventing placeholder data.

## Stored vs derived relations

Store facts we actually know or import:

- names and surnames;
- sex and photo;
- father and mother;
- generic `parents[]` only for ambiguous/additional parent cases;
- partners and marriage/divorce facts;
- birth, death and burial facts;
- occupations and residence history;
- source/place references and external source IDs.

Do not maintain these manually when they can be derived:

- children;
- siblings;
- grandparents;
- grandchildren;
- ancestors and descendants;
- generations;
- connected-component membership;
- renderer-specific nodes/edges.

## Build model

`npm run build` first runs:

```text
scripts/build-genealogy.mjs
```

The build scans all person frontmatter, validates person references and reconstructs the graph from zero.

```text
canonical person Markdown/YAML
        ↓
parse + validate refs
        ↓
resolve father / mother / parents / partners
        ↓
derive children + siblings
        ↓
detect connected components
        ↓
people.json + genealogy.json
        ↓
Starlight / tables / analytics / tree adapters
```

Generated outputs:

```text
public/generated/people.json
public/generated/genealogy.json
```

They are build artifacts and are not committed.

`people.json` contains every person, including isolated records.

`genealogy.json` contains only people with at least one genealogy edge. Isolated people therefore stay fully visible in the encyclopedia but do not create meaningless single boxes on a family map.

Independent branches are separate connected components and may be rendered separately.

The current imported dataset builds as 253 connected people, 406 edges and 2 connected components. The implementation already supports unconnected people even though the current snapshot happens to contain none.

## MyHeritage snapshot import

The current source snapshot is under `demos/anton-family/`. The deterministic importer is:

```text
scripts/import-demo-snapshot.mjs
```

Its mapping is persisted at:

```text
imports/myheritage-2026/mapping.json
```

The mapping now records MyHeritage XREF → current content ref, for example:

```json
{
  "I500001": "1980-1989/anton-nazarov.md"
}
```

MyHeritage identifiers remain external import metadata, not canonical genealogy relations.

The GitHub Actions workflow `Import MyHeritage snapshot` remains manual because import is a maintenance action and must not silently rewrite canonical records.

## Adding a person manually

1. Choose the birth decade, or `unknown`.
2. Create `src/content/docs/people/<decade>/<person-slug>.md`.
3. Start from `src/content/docs/_templates/person.md`.
4. Fill in known facts.
5. Point `father`, `mother` and explicit partners to other person files when known.
6. Do not add `children`; the build derives them.
7. Run `npm run build:data` or the full build to validate refs and inspect generated relations.

## Implementation status

```text
[x] Astro + Starlight encyclopedia shell
[x] 253 imported person pages
[x] Path-based person references
[x] Father / mother canonical forward relations
[x] Explicit partner + marriage relations
[x] Birth / death / burial structured fields
[x] Human-editable analytics fields (occupation, residence, sources)
[x] Derived children and siblings
[x] Broken/self-reference validation
[x] people.json containing all people
[x] genealogy.json containing only connected people
[x] Connected-component detection
[x] MyHeritage XREF → content-ref mapping
[x] Full-text search with Pagefind
[x] Sitemap
[x] Preserve existing tree demos in production build
[ ] First-class place refs and validation
[ ] First-class event import
[ ] Rich source/citation/evidence schemas
[ ] General GEDCOM importer and reconciliation workflow
[ ] Encyclopedia person-page component with portrait/facts/family/source layout
[ ] Privacy/publication rules for living people
[ ] Tree renderer adapter/view
[ ] Pedigree view
[ ] Timeline/map views
[ ] Add Person wizard / table editor
[ ] GEDCOM export
```

## Visualization

Visualization is a consumer of `genealogy.json`, not part of the canonical data model. A renderer should normally receive either one connected component or a component around a selected person rather than every encyclopedia record indiscriminately.

