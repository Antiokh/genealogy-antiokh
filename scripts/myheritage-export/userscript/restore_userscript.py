#!/usr/bin/env python3
from __future__ import annotations

import base64
import gzip
import hashlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
PREFIX = "MyHeritage-Tree-Exporter.user.js.gz.b64."
OUTPUT = HERE / "MyHeritage-Tree-Exporter.user.js"
EXPECTED_SHA256 = "885a8f374909d895f2a9d7d5a4d20f28cb51d35603c2f8f04c15c655a8e401c8"
EXPECTED_SIZE = 80877

parts = sorted(HERE.glob(f"{PREFIX}*"))
if not parts:
    raise SystemExit("No userscript archive parts found")

encoded = "".join(p.read_text(encoding="ascii").strip() for p in parts)
raw = gzip.decompress(base64.b64decode(encoded))
sha256 = hashlib.sha256(raw).hexdigest()

if len(raw) != EXPECTED_SIZE:
    raise SystemExit(f"Size mismatch: {len(raw)} != {EXPECTED_SIZE}")
if sha256 != EXPECTED_SHA256:
    raise SystemExit(f"SHA-256 mismatch: {sha256} != {EXPECTED_SHA256}")

OUTPUT.write_bytes(raw)
print(f"Restored {OUTPUT.name}: {len(raw)} bytes, sha256={sha256}")
