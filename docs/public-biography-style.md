# Public biography prose contract

Public person pages under `src/content/docs/people/` are encyclopedia-style articles about a concrete person and that person's life.

Their visible Markdown body must contain only reader-facing biographical narrative and factual context. It must not contain commentary about the article itself, its material, composition, verification workflow, internal confidence bookkeeping, data model, or implementation.

Examples of material that belongs outside the public article body:

- frontmatter/YAML/schema/mapping/import/rendering notes;
- explanations of why facts were grouped, omitted, moved, or duplicated;
- statements about what is stored “for analytics” or “below” as structured data;
- project-internal confidence levels and reconciliation notes;
- instructions to editors, agents, researchers, or future maintainers.

Historical uncertainty may be stated as part of the biography itself: for example, “Точная дата вступления неизвестна” or “В воспоминаниях приводятся две версии”. The article should not explain how the repository scores, stores, or verifies that uncertainty.

The automated check `scripts/check-public-biography-prose.mjs` blocks common forms of leaked editorial/meta prose in person-page bodies. The repository-level `AGENTS.md` contains the mandatory editing rule.
