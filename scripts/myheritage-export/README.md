# MyHeritage export tooling

Repeatable tooling used to export and preserve data from an authorized MyHeritage family tree.

## Contents

- `userscript/` — Tampermonkey exporter **v0.3.7** archived losslessly as gzip/base64 chunks, plus `restore_userscript.py`. Restored source is 80,877 bytes, SHA-256 `885a8f374909d895f2a9d7d5a4d20f28cb51d35603c2f8f04c15c655a8e401c8`.
- `cdp/` — independent Chrome DevTools Protocol / Playwright capture and crawler (`capture.cjs`, `crawler.cjs`, `payload.cjs`, package metadata). Useful as a second implementation for validation and for retaining raw MyHeritage JSON responses.
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

1. Use the userscript snapshot as the completeness baseline for the current tree inventory.
2. Keep CDP capture as an independent raw-data cross-check and as an archival-photo source where it has the original downloaded JPEG/PNG/WebP.
3. Preserve exact raw JSON before normalization.
4. Compare/merge records by stable MyHeritage individual/photo IDs, not names.
5. For photos, choose archival candidates by actual pixel dimensions and source URL first, then file bytes/format. WebP q65 is a derivative for repository/analysis use, not the archival master.
6. Respect MyHeritage usage-limit/fallback pages; do not loop or attempt to bypass site limits.

## 2026-10-11 snapshot comparison

### Userscript

- inventory: **253 / 253**
- People detail: **253 / 253**
- tree profile: **253 / 253**
- missing People detail: **0**
- missing tree profile: **0**
- photo IDs discovered/resolved/downloaded by the exporter: **174 / 174 / 174**
- packed image source files: **331**
- unique image payloads after SHA-256 dedupe: **170**
- repository derivatives: **170 WebP q65 files**

### CDP snapshot

- `knownIds`: **129 / 253**
- captured profile files: **65**
- therefore CDP is **not** a complete standalone tree export in this snapshot.

For overlapping people, both capture methods contain the same MyHeritage `get-extended-card-content.php` profile payload shape; the userscript raw file wraps it with capture metadata while CDP keeps the server JSON body directly. The main semantic advantage of the userscript snapshot is completeness, not a richer version of that particular profile endpoint.

For photos, CDP downloads the `largeUrl` response bytes directly and preserves the original content type. The userscript package currently contains q65 WebP derivatives. Therefore, where both exist, treat the CDP image as the archival candidate until dimensions/source URLs are compared; use the userscript WebP as the compact analysis derivative. Do not discard either dataset until an ID-by-ID merge/comparison is complete.
