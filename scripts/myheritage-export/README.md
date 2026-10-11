# MyHeritage export tooling

Repeatable tooling used to export and preserve data from an authorized MyHeritage family tree.

## Contents

- `userscript/MyHeritage-Tree-Exporter.user.js` — Tampermonkey exporter (v0.3.7). Persistent IndexedDB state, People inventory/detail capture, tree/profile sweep, photo inventory/download, resumable export.
- `cdp/` — independent Chrome DevTools Protocol / Playwright capture and crawler. Useful as a second implementation for validation and for retaining raw MyHeritage JSON responses.
- `pack/pack_myheritage.py` — repo packer: browser-download dedupe, SHA-256 image dedupe, WebP q65 derivative generation, normalized relative image links, manifest generation. Raw JSON is kept unchanged.
- `pack/organize-mhx-downloads.ps1` — simple helper for organizing `MHX__*` browser downloads.

## Data policy

This directory contains tooling only. Live genealogy exports are deliberately not copied into this repository. The working snapshots used on 2026-10-11 live in the Obsidian repository under:

`antiokh/Work Ideas/MyHeritage Exporter/`

with two independent captures:

- `myheritage-export-userscript/`
- `myheritage-export-cdp/`

Never commit browser cookies, `PHPSESSID`, CSRF tokens, authorization headers, or other session material.

## Recommended workflow

1. Prefer the userscript for breadth/completeness of the current tree inventory.
2. Keep CDP capture as an independent raw-data cross-check and possible source of richer per-person payloads / better photo files.
3. Preserve exact raw JSON before normalization.
4. Compare records by stable MyHeritage individual/photo IDs, not names.
5. For photos, choose archival candidates by actual pixel dimensions first, then file bytes/format. WebP q65 is a derivative for repository/analysis use, not the archival original.
6. Respect MyHeritage usage-limit/fallback pages; do not loop or attempt to bypass site limits.

## 2026-10-11 snapshot note

The userscript snapshot reached all 253 people. The parallel CDP state currently contains 129 known individual IDs, so the CDP snapshot is incomplete as a standalone tree export. Keep both until a field-by-field merge/comparison is complete.
