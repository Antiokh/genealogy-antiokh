# Genealogy Library

A repository-first family-history encyclopedia. Canonical people, events and supporting entities live as readable Markdown/YAML in Git; Starlight turns the same files into the browsing interface, while family-tree renderers remain replaceable views over the data.

The repository must remain useful independently of MyHeritage, Genotek, a particular tree library, or even Starlight itself.

## Current state

The encyclopedia shell is built with Astro + Starlight and the current MyHeritage snapshot has been imported into canonical person pages.

- 253 person records are published from the 2026-09-10 snapshot.
- One MyHeritage media bucket (`Unassociated photos`) is deliberately not treated as a person.
- Internal person IDs are stable `P......` identifiers.
- MyHeritage `I......` values are retained only as external import identifiers.
- Parents and partners are canonical ID relations; children and other reverse relations are derived.
- People are grouped by birth decade, events by year.
- Starlight generates navigation, search and sitemap from the same content tree.
- Existing tree-renderer demos are preserved under `/demos/`; choosing a final renderer is intentionally deferred.

## Product direction

The primary interface is for **reading, exploring and sharing family history**, with occasional corrections and additions. It is not intended to become a full-time genealogy workstation like Gramps.

Normal use should favor person pages, search, family context, events, sources, maps/timelines and tree/pedigree exploration. Import, reconciliation and conflict resolution are maintenance workflows.

Git remains the source of truth. Any editor or import UI must end by changing ordinary repository files rather than creating a second database.

Design notes:

- [Product direction and reference projects](docs/product-direction-and-references.md)
- [GEDCOM import and conflict strategy](docs/gedcom-import-conflicts.md)
- [Charted Roots migration / compatibility contract](docs/charted-roots-migration-contract.md)

## Canonical content tree

Starlight reads canonical records directly from `src/content/docs/`.

```text
src/content/docs/
├── people/
│   ├── 1810-1819/
│   ├── 1820-1829/
│   ├── ...
│   ├── 1980-1989/
│   │   └── anton-nazarov.md
│   ├── 2020-2029/
│   └── unknown/
├── events/
│   ├── 1917/
│   ├── 1941/
│   ├── 1988/
│   └── unknown/
├── places/
├── sources/
└── _templates/
```

The directory structure is navigation, not identity. Moving a person to another decade after correcting a birth year must not break a relationship. Semantic links always use stable IDs.

## Person records

One person is one Markdown record with frontmatter.

```yaml
---
title: Иван Петрович Назаров
entity: person
id: P000251
name: Иван Петрович Назаров
sex: M
birth:
  year: 1877
death:
  year: 1948
parents:
  - P000134
  - P000135
partners:
  - P000252
sources: []
external:
  myheritage:
    snapshot: "2026-09-10"
    xref: "I500418"
---
```

Do not manually maintain relations that can be derived from the graph. Children, siblings, grandparents, descendants and generations should be calculated from canonical forward relations.

Imported person pages currently carry `importManaged: true`. The snapshot importer may rewrite those generated records. Before turning an imported page into a hand-maintained biography, remove that flag or change the importer workflow so generated and authored sections are separated.

## Events and other entities

Events are first-class records grouped by event year:

```text
src/content/docs/events/
├── 1917/
├── 1941/
├── 1988/
│   └── birth-anton-nazarov.md
└── unknown/
```

Event participants, places and sources use stable IDs. Correcting a date may move an event between folders without changing its identity.

The content schema already reserves first-class entity types for:

```text
person
 event
place
source
citation
evidence
```

Places, sources, citations and evidence still need their richer domain schemas and real records.

## Stateless build

Every build starts from repository files and can reconstruct the complete genealogy state:

```text
canonical Markdown/YAML
        ↓
parse + validate
        ↓
resolve stable IDs
        ↓
construct neutral genealogy graph
        ↓
Starlight pages / search / tree / pedigree / timeline / map
```

No generated relationship state from a previous build is authoritative.

A future neutral output such as `generated/genealogy.json` should be our own contract rather than the native data model of Family Chart, Topola or another renderer.

## MyHeritage snapshot import

The current source snapshot is represented by the demo dataset under `demos/anton-family/`. The deterministic importer is:

```text
scripts/import-demo-snapshot.mjs
```

Its stable external-to-internal mapping is persisted at:

```text
imports/myheritage-2026/mapping.json
```

The mapping prevents a repeated import from assigning new internal IDs to the same external people.

The GitHub Actions workflow `Import MyHeritage snapshot` is intentionally manual. Import is a maintenance action and must not silently rewrite canonical records whenever the repository changes.

GEDCOM remains the intended interchange format for future general imports. GEDCOM identifiers are external identifiers, not our database keys.

## Adding a person manually

1. Choose the person's birth decade, or `unknown`.
2. Create `src/content/docs/people/<decade>/<person-slug>.md`.
3. Start from `src/content/docs/_templates/person.md`.
4. Assign a permanent internal ID.
5. Fill in known dates and canonical relationship IDs.
6. Commit the file.

A future Add Person wizard can automate these steps, but its output must remain an ordinary repository change.

## Visualization

Tree visualization is an adapter concern, not a storage concern. Current experiments remain available under `demos/` and include Family Chart, BALKAN FamilyTreeJS 2 and Vue Flow + ELK.

The encyclopedia can therefore mature independently of the final tree renderer.

## Implementation status

```text
[x] Astro + Starlight encyclopedia shell
[x] Autogenerated People / Events / Places / Sources navigation
[x] Extended genealogy frontmatter schema
[x] Person authoring template
[x] Deterministic MyHeritage snapshot importer
[x] Stable external → internal person ID mapping
[x] 253 imported person pages
[x] Parent / partner canonical relations
[x] Derived child links on generated pages
[x] Full-text search with Pagefind
[x] Sitemap
[x] Preserve existing tree demos in production build
[ ] Dedicated canonical relationship validator (duplicate IDs, dangling refs, cycles/edge cases)
[ ] Neutral genealogy graph schema
[ ] Generate `genealogy.json` from canonical records
[ ] General GEDCOM importer and reconciliation workflow
[ ] First-class event import
[ ] Rich place/source/citation/evidence schemas
[ ] Encyclopedia person-page component with portrait/facts/family/source layout
[ ] Privacy/publication rules for living people
[ ] Tree renderer adapter/view
[ ] Pedigree view
[ ] Timeline/map views
[ ] Add Person wizard
[ ] GEDCOM export
```

## Non-goals for the data model

The canonical repository structure should not encode paternal vs maternal branches, a fixed generation number, descendants as nested folders, relationships through paths, or assumptions specific to any visualization library. Those are views over the same genealogy graph.
