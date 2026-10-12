# Deceased portrait treatment

Person portraits use the same deceased-state rule in tree cards, encyclopedia person pages, and generated Open Graph cards:

- deceased when `died.known === true` or the death record contains a parseable year;
- portrait imagery is rendered in grayscale;
- a black diagonal mourning ribbon is overlaid on the portrait;
- tree cards and encyclopedia pages may keep their normal placeholder behavior for missing/broken images, but generated Open Graph cards omit the portrait area entirely when no portrait resolves.

The tree derives its boolean `deceased` field in `scripts/build-tree-data.mjs`; `src/components/GenealogyPageTitle.astro` and `scripts/build-og-images.mjs` mirror the same date-year parsing rule directly from the person frontmatter.

Open Graph cards reuse the projected portrait chosen during `scripts/augment-genealogy-metadata.mjs`, so portrait precedence stays consistent with person pages and tree data. Raster sources are normalized before SVG composition so local WebP portraits and the leather background render reliably in the final PNG.
