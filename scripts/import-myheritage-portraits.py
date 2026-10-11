#!/usr/bin/env python3
"""Localize legacy MyHeritage person `photo:` URLs as same-basename WebP portraits.

The canonical genealogy content model treats a person's main portrait as an asset
next to the person Markdown record, for example:

    people/1980-1989/anton-nazarov.md
    people/1980-1989/anton-nazarov.webp

This script migrates the transitional remote `photo:` fallback into that canonical
form. Existing same-basename portraits and explicit non-media `portrait:` overrides
are preserved.

Requires Pillow:
    py -m pip install pillow
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError as exc:  # pragma: no cover - environment guard
    raise SystemExit("Pillow is required: py -m pip install pillow") from exc

PEOPLE_ROOT = Path("src/content/docs/people")
REPORT_PATH = Path("imports/myheritage-2026/portrait-import-report.json")
FRONTMATTER_RE = re.compile(r"^---\s*\r?\n([\s\S]*?)\r?\n---", re.M)
PHOTO_RE = re.compile(r'^photo:\s*["\']?(https?://[^"\'\s]+)["\']?\s*$', re.M)
PORTRAIT_RE = re.compile(r'^portrait:\s*["\']?([^"\'\r\n]+)["\']?\s*$', re.M)
TITLE_RE = re.compile(r'^title:\s*["\']?(.+?)["\']?\s*$', re.M)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--quality", type=int, default=65, help="WebP quality (default: 65)")
    p.add_argument(
        "--max-edge",
        type=int,
        default=1024,
        help="Downscale so neither dimension exceeds this many pixels (default: 1024)",
    )
    p.add_argument("--timeout", type=int, default=30, help="HTTP timeout in seconds")
    p.add_argument(
        "--force",
        action="store_true",
        help="Replace existing same-basename WebP portraits. Explicit direct portrait overrides are still preserved.",
    )
    p.add_argument(
        "--fail-on-error",
        action="store_true",
        help="Return a non-zero exit status if any portrait could not be downloaded/converted.",
    )
    return p.parse_args()


def frontmatter(text: str) -> str:
    match = FRONTMATTER_RE.search(text)
    return match.group(1) if match else ""


def clean_yaml_scalar(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]
    return value


def explicit_direct_portrait(fm: str) -> str | None:
    match = PORTRAIT_RE.search(fm)
    if not match:
        return None
    value = clean_yaml_scalar(match.group(1))
    if not value or value.lower() in {"null", "~"}:
        return None
    # Legacy `portrait: *.md` media references are intentionally not treated as
    # direct overrides: the content model gives a same-basename local portrait
    # precedence over those transitional media references.
    if re.search(r"\.mdx?$", value, re.I):
        return None
    return value


def remote_photo(fm: str) -> str | None:
    match = PHOTO_RE.search(fm)
    return match.group(1) if match else None


def title_for(fm: str, file_path: Path) -> str:
    match = TITLE_RE.search(fm)
    return clean_yaml_scalar(match.group(1)) if match else file_path.stem


def fetch_bytes(url: str, timeout: int) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; genealogy-library portrait importer)",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get("Content-Type", "")
        payload = response.read()
    if not payload:
        raise ValueError("empty response")
    if content_type and not content_type.lower().startswith("image/"):
        raise ValueError(f"unexpected content type: {content_type}")
    return payload


def save_webp(payload: bytes, target: Path, quality: int, max_edge: int) -> dict[str, int | str]:
    with Image.open(BytesIO(payload)) as image:
        image = ImageOps.exif_transpose(image)
        source_width, source_height = image.size

        if max_edge > 0 and max(source_width, source_height) > max_edge:
            scale = max_edge / max(source_width, source_height)
            resized = (
                max(1, round(source_width * scale)),
                max(1, round(source_height * scale)),
            )
            image = image.resize(resized, Image.Resampling.LANCZOS)

        if "A" in image.getbands():
            output = image.convert("RGBA")
        else:
            output = image.convert("RGB")

        target.parent.mkdir(parents=True, exist_ok=True)
        output.save(target, "WEBP", quality=quality, method=6)
        width, height = output.size

    return {
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "width": width,
        "height": height,
        "bytes": target.stat().st_size,
    }


def main() -> int:
    args = parse_args()
    if not PEOPLE_ROOT.exists():
        raise SystemExit(f"People directory not found: {PEOPLE_ROOT}")

    imported: list[dict] = []
    skipped_existing: list[str] = []
    skipped_explicit: list[dict] = []
    no_remote_photo: list[str] = []
    failed: list[dict] = []

    people_files = sorted(
        [*PEOPLE_ROOT.rglob("*.md"), *PEOPLE_ROOT.rglob("*.mdx")],
        key=lambda p: p.as_posix().lower(),
    )

    for person_file in people_files:
        text = person_file.read_text(encoding="utf-8")
        fm = frontmatter(text)
        if not fm or not re.search(r"^entity:\s*person\s*$", fm, re.M):
            continue

        rel = person_file.relative_to(PEOPLE_ROOT).as_posix()
        title = title_for(fm, person_file)
        direct_portrait = explicit_direct_portrait(fm)
        if direct_portrait:
            skipped_explicit.append({"person": rel, "portrait": direct_portrait})
            continue

        photo_url = remote_photo(fm)
        if not photo_url:
            no_remote_photo.append(rel)
            continue

        target = person_file.with_suffix(".webp")
        if target.exists() and not args.force:
            skipped_existing.append(rel)
            continue

        try:
            payload = fetch_bytes(photo_url, args.timeout)
            image_info = save_webp(payload, target, args.quality, args.max_edge)
            imported.append(
                {
                    "person": rel,
                    "title": title,
                    "portrait": target.relative_to(PEOPLE_ROOT).as_posix(),
                    "sourceUrl": photo_url,
                    **image_info,
                }
            )
            print(f"OK   {rel} -> {target.name} ({image_info['width']}x{image_info['height']}, {image_info['bytes']} bytes)")
        except (OSError, ValueError, urllib.error.URLError, urllib.error.HTTPError) as exc:
            failed.append({"person": rel, "title": title, "sourceUrl": photo_url, "error": str(exc)})
            print(f"FAIL {rel}: {exc}", file=sys.stderr)

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "quality": args.quality,
        "maxEdge": args.max_edge,
        "peopleScanned": len(people_files),
        "imported": imported,
        "skippedExisting": skipped_existing,
        "skippedExplicitPortrait": skipped_explicit,
        "noRemotePhoto": no_remote_photo,
        "failed": failed,
        "counts": {
            "imported": len(imported),
            "skippedExisting": len(skipped_existing),
            "skippedExplicitPortrait": len(skipped_explicit),
            "noRemotePhoto": len(no_remote_photo),
            "failed": len(failed),
        },
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print()
    print(
        "Portraits: "
        f"imported={len(imported)}, existing={len(skipped_existing)}, "
        f"explicit={len(skipped_explicit)}, no-photo={len(no_remote_photo)}, failed={len(failed)}"
    )
    print(f"Report: {REPORT_PATH}")

    return 1 if args.fail_on_error and failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
