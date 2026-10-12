# Open Graph card generation

Generated Open Graph cards follow the same portrait semantics as encyclopedia person pages and family-tree cards.

- portrait precedence comes from the projected person metadata produced by `scripts/augment-genealogy-metadata.mjs`;
- same-basename local portraits therefore remain the preferred source;
- raster inputs are normalized to PNG before SVG composition, including WebP portraits and leather backgrounds;
- deceased portraits are grayscale and carry the same black diagonal mourning ribbon;
- when no portrait resolves, no portrait block, frame, placeholder, or mourning ribbon is rendered; the text layout expands into the available space;
- landscape cards use `docs/Stitched Leather Family Tree Book Cover.webp` as the background;
- square fallback cards use `docs/Emblematic Tree Leather Book Cover.webp`.

The build emits landscape and square PNGs under `public/generated/og/` and `src/components/GenealogyHead.astro` publishes them through Open Graph/Twitter metadata.
