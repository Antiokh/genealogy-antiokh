# Editorial rules for public genealogy content

These rules are mandatory for all edits to public person pages under `src/content/docs/people/`.

## Public biographies contain only biography

The Markdown body of a person page is a public article about a concrete person and that person's life. It must contain only reader-facing narrative or factual biographical text.

A public article must not contain evaluations or commentary about the article itself, its material, composition, verification process, data representation, or technical properties.

Do not put into the visible article body:

- judgments about completeness, quality, reliability, usefulness, granularity, or organization of the article's material;
- explanations of why information is included, omitted, shortened, grouped, moved, duplicated, or not duplicated;
- discussion of verification, reconciliation, confidence levels, source-processing workflow, or editorial decisions;
- references to frontmatter, YAML, schemas, fields, mappings, imports, renderers, cards, records, tables, analytics, internal storage, or other implementation details;
- instructions or notes addressed to editors, agents, researchers, or future maintainers;
- meta-language such as “в этой карточке”, “в основном тексте”, “сохранено в frontmatter”, “структурированные события ниже”, “разнесено по карточкам”, “в проекте отмечено”, “с пониженной уверенностью”, or equivalent phrases.

Uncertainty that is genuinely part of the historical record may be expressed only as a normal biographical fact, without discussing the repository's verification mechanics. For example: “Точная дата вступления в партию неизвестна.” Do not write: “в событийной модели проекта этот эпизод отмечен с низкой уверенностью”.

If information is useful only for data processing, evidence tracking, or editorial work, keep it in frontmatter, source/evidence files, comments, commits, pull requests, or internal documentation — never in the published prose.

Before committing a person-page edit, read the Markdown body as if it were already visible on the public website. Every visible sentence must be about the person, the person's life, work, relationships, historical context, or legacy — not about how the article or repository was assembled.
