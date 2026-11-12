# Public biography prose contract

Public person pages under `src/content/docs/people/` are encyclopedia-style articles about a concrete person and that person's life.

Their visible Markdown body must contain only reader-facing biographical narrative and factual context. It must not contain commentary about the article itself, its material, composition, verification workflow, internal confidence bookkeeping, data model, or implementation.

Examples of material that belongs outside the public article body:

- frontmatter/YAML/schema/mapping/import/rendering notes;
- explanations of why facts were grouped, omitted, moved, or duplicated;
- statements about what is stored “for analytics” or “below” as structured data;
- project-internal confidence levels and reconciliation notes;
- instructions to editors, agents, researchers, or future maintainers.

## First-person testimony

An autobiography or first-person recollection is a primary source for its author's life. Where no concrete conflicting evidence exists, use it directly as biographical fact; independent confirmation is not a prerequisite. Do not introduce habitual distancing (“по воспоминаниям”, “по его словам”, “не подтверждено независимо”) merely because the account is autobiographical. Source records can name and describe the testimony without repeatedly qualifying the article's prose.

Retain the author's own uncertainty and identify actual contradictions, not hypothetical doubts. Statements about other people's unobservable motives or emotions remain the author's interpretation; direct observations and their own experiences may be reported plainly.

Historical uncertainty may be stated as part of the biography itself: for example, “Точная дата вступления неизвестна” or “В воспоминаниях приводятся две версии”. The article should not explain how the repository scores, stores, or verifies that uncertainty.

The automated check `scripts/check-public-biography-prose.mjs` blocks common forms of leaked editorial/meta prose in person-page bodies. The repository-level `AGENTS.md` contains the mandatory editing rule.
