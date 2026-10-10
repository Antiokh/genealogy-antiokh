# Canonical content

Starlight reads this directory directly. The filesystem is a navigation structure, while semantic relationships use stable IDs from frontmatter.

- `people/<birth-decade>/<slug>.md` — people by birth decade.
- `events/<year>/<slug>.md` — events by event year.
- `places/` — reusable place entities.
- `sources/` — source records.
- `_templates/` — authoring templates ignored by Starlight's `docsLoader()`.

Moving a file between decades or years must not change its `id` or break relationships.
