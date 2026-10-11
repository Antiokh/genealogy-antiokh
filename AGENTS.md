# Editorial rules for public genealogy content

These rules are mandatory for all automated and human edits to public person pages under `src/content/docs/people/`.

## Public prose must be reader-facing

The Markdown body of a person page is a published biographical article. Write only prose that belongs in an encyclopedia-style biography intended for a reader.

Never put implementation, data-model, research-workflow, or editorial-process commentary in the visible article body. In particular, do not tell the reader about:

- frontmatter, YAML, schemas, structured fields, mappings, imports, renderers, cards, records, or internal storage;
- why some facts were or were not moved into another file, field, table, event list, or person page;
- what is retained "for analytics", "for tables", "for later processing", or "below" as structured data;
- instructions to future editors, agents, or researchers;
- confidence/reconciliation mechanics unless uncertainty itself is historically relevant and can be stated naturally as source criticism;
- phrases such as "нецелесообразно механически перечислять", "сохранено в frontmatter", "разнесено по карточкам", or similar meta-commentary.

If a fact does not belong in narrative prose, keep it in frontmatter, source/evidence files, comments, commit/PR notes, or internal documentation — not in the published body.

Before committing a person-page edit, read the Markdown body as if it were already visible on the public website. Every paragraph must answer the reader's question about the person, not explain how the repository works.
