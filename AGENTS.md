# Agent instructions — genealogy site (content and publication)

This repository is **the family encyclopedia's data, editorial, and deployment project**. Its upstream reusable application code lives in `Antiokh/genealogy-engine`. Keep the division of responsibilities explicit.

## Which repository to edit

**Work in this repository** for:
- Real family biographies, events, places, sources and published prose under `src/content/docs/`, including frontmatter and links.
- Site-specific assets and media under `src/assets/` and site-managed `public/` paths **except `public/tree/`**; family imports, evidence and research.
- `astro.config.mjs`: production title, domain/site/base, Starlight configuration, navigation, and deployment-specific wiring.
- Dependency/lockfile updates needed by the production site, site-only scripts such as `scripts/check-public-person-catalog.mjs`, and family-content tests.
- Cloudflare Pages and optional GitHub Pages workflows, custom-domain settings, hosting and publishing behavior.
- Editorial standards, publication criteria and source accuracy.

**Work in `Antiokh/genealogy-engine`** for:
- Generic Astro/Starlight UI components and renderers (`src/components/`, `src/pages/`), genealogy logic (`src/scripts/`, `src/routeData.ts`, `src/content.config.ts`).
- Shared CSS themes, including archival asides, headers, mobile layout (`src/styles/`).
- Shared public tree renderer code (`public/tree/`).
- Shared build/check scripts enumerated in `genealogy-engine/scripts/sync-engine-to-content.mjs`.

**Do not directly modify engine-managed files in this repository as the normal workflow.** They are updated automatically by the engine's `main` CI and may be overwritten by a subsequent engine sync. Instead fix upstream in `genealogy-engine`, merge after verification, and observe the resulting site commit and deployment. If an urgent downstream hotfix is unavoidable, immediately port it upstream and reconcile before the next sync.

## Automatic engine delivery

- `.genealogy-engine-managed.json` is the machine-generated **authoritative list of synchronized paths**. Do not edit, regenerate manually or delete it.
- The engine's `.github/workflows/ci.yml` verifies the synthetic engine on PR and `main`, then pushes a scoped, automatically generated commit here using `GENEALOGY_CONTENT_PUSH_TOKEN`.
- `src/content/docs/`, site-specific config, site media/imports and this `AGENTS.md` are **not** synchronized from the engine.
- `scripts/check-public-person-catalog.mjs` belongs to this repository despite the synthetic engine having a counterpart; keep its real-family test cases here.
- A change in `astro.config.mjs` or dependencies requested by a new engine feature needs a separate reviewed site change; those paths are not transferred automatically.

## Required checks

- For content changes, obey the existing editorial rules below; keep visible prose strictly biographical rather than describing editorial process.
- For content/data/code updates, run `npm run check` and `npm run build` when applicable, and review GitHub Actions/Cloudflare checks after committing.
- Cloudflare Pages publishes the site's built output; an independent GitHub Pages mirror is a separate, opt-in hosting task. Do not treat a PR build as a production deployment.
- For structural changes, prefer a focused PR and avoid concurrent edits that overwrite a bot sync commit.
- Never commit tokens or credentials. Site repository visibility and publication decisions are owned by the repository owner; they are **not** an agent prerequisite for the sync.

See the engine's `docs/engine-content-sync.md` for details.

---

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
