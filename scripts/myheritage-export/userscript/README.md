# MyHeritage userscript exporter

Final working snapshot: **v0.3.7**.

The source is stored as four gzip/base64 chunks because the repository connector used to archive the tooling has a practical payload limit for a single large userscript write.

Restore the exact `.user.js` file with:

```powershell
py .\restore_userscript.py
```

Expected output:

- filename: `MyHeritage-Tree-Exporter.user.js`
- size: `80877` bytes
- SHA-256: `885a8f374909d895f2a9d7d5a4d20f28cb51d35603c2f8f04c15c655a8e401c8`

The four archive chunks were verified against the Git blob hashes after upload, so `restore_userscript.py` reconstructs the exact source used on 2026-10-11 and refuses to write it if the size or SHA-256 differs.

Do not add browser cookies, session IDs, or CSRF tokens to this directory.
