# Cloudflare and GitHub Pages deployment

This repository contains family content and production-specific configuration. The **public engine** is `Antiokh/genealogy-engine`; engine changes should come from its verified `main`, never be developed only in this repo. See the engine's `docs/engine-content-sync.md`.

## Diagnose the missing Cloudflare deployment

Cloudflare Pages was previously linked to `Antiokh/genealogy-library`, which GitHub currently redirects to `Antiokh/genealogy-antiokh`. Check Cloudflare project's **Settings → Builds → Git Repository**: after a rename or visibility change, verify Cloudflare's GitHub App still has access to the new canonical repository. Also verify **Branch control**: `main` is production and PR/other-branch previews are enabled.

This PR itself should generate a Cloudflare preview check when integration and preview branch rules are working. If there is no Cloudflare check, treat it as an integration/branch-control problem, not evidence that the frontend compiled. GitHub Actions runner failures are an independent problem.

## GitHub Pages: opt-in deployment

`.github/workflows/github-pages.yml` builds the site for pull requests but publishes **only from `main`** after `ENABLE_GENEALOGY_GH_PAGES=true` is configured as a GitHub Actions repository variable.

The workflow uploads **only `dist/`**, not Markdown source, imports, Git history, or private assets. **Important:** the current GitHub repository visibility must also be reviewed: its source is currently reported as **public**, independently of what Pages publishes. If private source is required, set the repository private and ensure GitHub Pages is available under the account's plan.

One-time setup:
1. Fix the site repository visibility if the data should not be in a public repository.
2. GitHub → repository → Settings → Pages → Build and deployment → Source = **GitHub Actions**.
3. GitHub repository Variables: `ENABLE_GENEALOGY_GH_PAGES=true`.
4. Optional variables: `GENEALOGY_PAGES_SITE_URL`, `GENEALOGY_PAGES_SITE_BASE` (for a custom domain, use its origin and `/`; for a project path use `https://antiokh.github.io` and `/genealogy-antiokh/`).
5. Prefer a separate DNS hostname for the mirror; **do not** switch the current Cloudflare custom domain until the alternative is verified.

### Root-relative links limitation

The genealogy app currently contains root-absolute page, JSON and asset URLs (such as `/people/` and `/generated/*.json`). The initial `antiokh.github.io/genealogy-antiokh/` build may therefore have **broken navigation/data loading**, even with Astro's `base`. The production-quality choice is a **custom-domain GitHub Pages site mounted at `/`**, or a deliberate refactor of all root-relative URLs to honor `import.meta.env.BASE_URL`. Until then, treat a `github.io` project-path deploy as a technical reachability experiment, not as a fully working public mirror.

GitHub Pages is a **different hosting network**, not guaranteed accessible in Russia. Test the resulting hostname from Russian networks on mobile and fixed ISPs; independently check HTML, CSS, JS, fonts, JSON and images (do not rely on a simple HTTP 200).

### CI and source responsibilities

Private source changes continue to be made only here; the public engine never receives family biographies. Engine CI runs on the public repo and pushes vetted allowlisted code into the private content repository using a repository-scoped secret after successful checks. The content repo's existing Cloudflare build remains unchanged unless intentionally reconfigured.
