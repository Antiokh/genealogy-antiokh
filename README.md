# Genealogy Library — семейная энциклопедия и данные

[![Engine CI](https://github.com/Antiokh/genealogy-engine/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Antiokh/genealogy-engine/actions/workflows/ci.yml)
[![Открыть семейную энциклопедию](https://img.shields.io/badge/%D1%81%D0%B0%D0%B9%D1%82-tree.antiokh.ru-795138)](https://tree.antiokh.ru/)
[![Люди](https://tree.antiokh.ru/badges/people.svg)](https://tree.antiokh.ru/people/)
[![События](https://tree.antiokh.ru/badges/events.svg)](https://tree.antiokh.ru/events/)
[![Места](https://tree.antiokh.ru/badges/places.svg)](https://tree.antiokh.ru/places/)
[![Фото](https://tree.antiokh.ru/badges/photos.svg)](https://github.com/Antiokh/genealogy-antiokh/tree/main/src/content/docs/media)

**Это репозиторий семейных записей и настроек публикации** сайта [«Семейная энциклопедия»](https://tree.antiokh.ru/). Универсальный программный движок вынесен в отдельный публичный репозиторий **[Antiokh/genealogy-engine](https://github.com/Antiokh/genealogy-engine)**.

## Два репозитория: где что редактировать

| | Семейные данные и сайт | Движок |
| --- | --- | --- |
| **Репозиторий** | **[Antiokh/genealogy-antiokh](https://github.com/Antiokh/genealogy-antiokh)** (вы здесь) | **[Antiokh/genealogy-engine](https://github.com/Antiokh/genealogy-engine)** |
| **Здесь меняем** | Биографии, события, места, источники, фотографии, импорты, production-конфигурацию, хостинг | UI, CSS, темы, компоненты, родственные алгоритмы, карты, рендереры дерева, общие генераторы |
| **Основные пути** | [`src/content/docs/`](src/content/docs/), [`imports/`](imports/), [`research/`](research/), [`astro.config.mjs`](astro.config.mjs) | [`src/components/`](https://github.com/Antiokh/genealogy-engine/tree/main/src/components), [`src/styles/`](https://github.com/Antiokh/genealogy-engine/tree/main/src/styles), [`scripts/`](https://github.com/Antiokh/genealogy-engine/tree/main/scripts) |
| **Подробный README** | Этот документ: модель данных и работа с биографиями | **[README движка](https://github.com/Antiokh/genealogy-engine#readme)**: архитектура, сборка, разработка, CI |

**Правило:** общие файлы движка в этом репозитории — автоматически поддерживаемая копия. Не редактируйте их здесь напрямую: внесите изменение в [`genealogy-engine`](https://github.com/Antiokh/genealogy-engine), проверьте PR и слейте его. После успешного Engine CI код автоматически попадёт сюда; изменения в семейных записях идут только в этом репозитории.

Точный перечень зеркалируемых файлов: [`.genealogy-engine-managed.json`](.genealogy-engine-managed.json). Принципы и диагностика доставки: **[документация синхронизации](https://github.com/Antiokh/genealogy-engine/blob/main/docs/engine-content-sync.md)**. Правила для агентов: [AGENTS.md](AGENTS.md) здесь и [AGENTS.md движка](https://github.com/Antiokh/genealogy-engine/blob/main/AGENTS.md).

### Путь изменений до сайта

```text
UI / общий код → genealogy-engine/main → Engine CI → sync-коммит сюда
Биографии / источники ───────────────────────────────→ коммит сюда
                                                       ↓
                                       сборка сайта + Cloudflare Pages
                                                       ↓
                                             tree.antiokh.ru
```

## Об энциклопедии

A repository-first family-history encyclopedia. People, events and supporting entities live as readable Markdown/YAML in Git; Starlight turns the same files into the browsing interface, while tables, analytics and family-tree renderers consume generated build data.

The repository must remain useful independently of MyHeritage, Genotek, a particular tree library, or even Starlight itself.

## Current state

- Astro + Starlight encyclopedia shell.
- Initial person records were imported from the 2026-09-10 MyHeritage snapshot; technical unknown-parent placeholders are excluded. Current totals (including later additions) are shown in the live badges above.
- People files remain grouped by birth decade; unknown birth year goes to `people/unknown/`.
- The navigation is independent from the filesystem and groups people by explicit `families` metadata. One person may appear in several family groups.
- Person-to-person authoring uses readable content refs such as `1960-1969/vladislav-nazarov.md`.
- `father` and `mother` are canonical forward relations; children and siblings are derived at build time.
- Explicit partners/marriages remain canonical because they cannot be inferred from children alone.
- Names support a primary locale plus optional localized forms such as `ru`, `sr-Latn`, `sr-Cyrl`, `en`, `de` or `sv`.
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
title: Антон Владиславович Назаров
entity: person

name:
  locale: ru
  display: Антон Владиславович Назаров
  first: Антон
  middle: Владиславович
  last: Назаров
  birth_last: Назаров
  localized:
    sr-Latn:
      first: Anton
      middle: Vladislavovič
      last: Nazarov
      display: Anton Vladislavovič Nazarov
  aliases: []

families:
  - key: nazarov
    label: Назаровы
    locale: ru
    roles:
      - birth
      - current

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

### Localized names

The primary `name` fields are the reference form used by the Russian-language encyclopedia. `name.locale` records its language/script. Other known forms belong under `name.localized` and use BCP-47-style keys such as `sr-Latn`, `sr-Cyrl`, `en`, `de` or `sv`.

Do not invent a language just because a name is written in Latin script. If only the script is known, use `und-Latn`.

Localized forms are explicit data, not automatically generated translations. This lets a future Serbian or English presentation choose a local form without changing the canonical person record.

### Family navigation groups

`families` is navigation and analytics metadata, separate from the person's current or birth surname. It is deliberately an array: one person may belong to several family groups at the same time.

```yaml
families:
  - key: kurochkin
    label: Курочкины
    locale: ru
    roles:
      - birth
  - key: spiridonov
    label: Спиридоновы
    locale: ru
    roles:
      - partner
```

Typical roles are:

- `birth` — family identified by the birth/parent surname;
- `current` — family identified by the person's current/display surname;
- `marriage` — family identified by an explicit married surname;
- `partner` — family reached through a recorded family union/partner.

The roles explain why a person appears in a group; they do not replace genealogy relations. Membership can be overridden or added manually when the historical situation is more complicated than surname inference.

Russian gendered surname forms are grouped under one key, for example `Спиридонов` and `Спиридонова` → `spiridonov` / `Спиридоновы`.

The same family may have labels in multiple scripts:

```yaml
families:
  - key: bush
    label: Буши
    locale: ru
    localized:
      und-Latn: Bush
    roles:
      - birth
```

`family.key` inside each membership defines group identity. `label`, `locale` and `localized` control presentation. A woman can therefore appear both in her parental family and in the family group of a husband/partner; remarriages can produce more than two memberships. A person whose surname changed can likewise remain visible in both the birth family and the current-surname family.

Imported inferred memberships are marked `inferred: true`. Hand-written memberships without that flag are preserved by the import enrichment step rather than being overwritten.

The People sidebar groups by every entry in `families`, not by physical decade folders. The same person may therefore appear under several family headings, while remaining one canonical person page. Russian groups use Russian collation; Latin-script groups use an appropriate Latin collation/fallback. People without any family assignment appear under `Без семейной группы`.

The legacy singular `family` field is still accepted temporarily for compatibility, but new and migrated records use `families[]`.

## Stored vs derived relations

Store facts we actually know or import:

- names, surnames and explicit localized forms;
- one or more family navigation memberships;
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

`npm run build` first runs the genealogy data build and attaches presentation metadata such as family groups:

```text
scripts/build-genealogy.mjs
scripts/augment-genealogy-metadata.mjs
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
attach family/presentation metadata
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

`people.json` contains every person, including isolated records, and carries the person's `families[]` memberships for tables and analytics.

`genealogy.json` contains only people with at least one genealogy edge. Isolated people therefore stay fully visible in the encyclopedia but do not create meaningless single boxes on a family map.

Independent branches are separate connected components and may be rendered separately.

The build recalculates people, family connections and graph statistics from the current corpus. Live entity counts are shown in the badges above and published as `/site-stats.json`; graph counts are generated in `public/generated/genealogy.json`.

## MyHeritage snapshot import

The current source snapshot is under `demos/anton-family/`. The deterministic import/enrichment pipeline is:

```text
scripts/import-demo-snapshot.mjs
scripts/enrich-person-names.mjs
scripts/enrich-family-groups.mjs
```

Its mapping is persisted at:

```text
imports/myheritage-2026/mapping.json
```

The mapping records MyHeritage XREF → current content ref, for example:

```json
{
  "I500001": "1980-1989/anton-nazarov.md"
}
```

MyHeritage identifiers remain external import metadata, not canonical genealogy relations.

The family enrichment step can infer several memberships from birth/current/married surnames and recorded family unions. It deduplicates them by family key and records the reasons in `roles`. Explicit hand-managed memberships are preserved.

The GitHub Actions workflow `Import MyHeritage snapshot` remains manual because import is a maintenance action and must not silently rewrite canonical records.

## Adding a person manually

1. Choose the birth decade, or `unknown`.
2. Create `src/content/docs/people/<decade>/<person-slug>.md`.
3. Start from `src/content/docs/_templates/person.md`.
4. Fill in known facts and the primary name locale.
5. Add localized name forms only when actually known.
6. Add every relevant entry to `families[]`; a person may intentionally belong to more than one family group.
7. Point `father`, `mother` and explicit partners to other person files when known.
8. Do not add `children`; the build derives them.
9. Run `npm run build:data` or the full build to validate refs and inspect generated relations.

## Implementation status

```text
[x] Astro + Starlight encyclopedia shell
[x] Real person pages; the current count is generated automatically
[x] Path-based person references
[x] Father / mother canonical forward relations
[x] Explicit partner + marriage relations
[x] Birth / death / burial structured fields
[x] Structured FIO with optional patronymic/middle name
[x] Localized name variants and primary name locale
[x] Multiple family navigation memberships per person
[x] Locale/script-aware family navigation sorting
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
