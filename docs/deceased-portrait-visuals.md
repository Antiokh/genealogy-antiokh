# Deceased portrait treatment

Person portraits use the same deceased-state rule in tree cards and encyclopedia person pages:

- deceased when `died.known === true` or the death record contains a parseable year;
- portrait imagery is rendered in grayscale;
- a black diagonal mourning ribbon is overlaid on the portrait;
- missing/broken portrait images keep the normal placeholder, with the deceased treatment applied to that placeholder as well.

The tree derives its boolean `deceased` field in `scripts/build-tree-data.mjs`; `src/components/GenealogyPageTitle.astro` mirrors the same date-year parsing rule directly from the person frontmatter.
