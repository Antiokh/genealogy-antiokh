#!/usr/bin/env python3
"""Localize MyHeritage profile photos as same-basename WebP person portraits.

Canonical form:
    people/1980-1989/anton-nazarov.md
    people/1980-1989/anton-nazarov.webp

Sources, in order:
1. the transitional remote `photo:` URL already stored in person frontmatter;
2. the saved MyHeritage tree snapshot `data.personCards[].ph`, matched by the
   stable MyHeritage xref/individual ID.

Existing same-basename portraits and explicit direct non-media `portrait:`
overrides are preserved.

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
from typing import Any

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
XREF_RE = re.compile(r'^\s*xref:\s*["\']?(I\d+)["\']?\s*$', re.M | re.I)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--quality", type=int, default=65, help="WebP quality (default: 65)")
    p.add_argument(
        "--max-edge",
        type=int,
        default=1024,
        help="Downscale so neither dimension exceeds this many pixels; never upscale (default: 1024)",
    )
    p.add_argument("--timeout", type=int, default=30, help="HTTP timeout per candidate in seconds")
    p.add_argument(
        "--tree-json",
        type=Path,
        help="Saved MyHeritage tree.json containing data.personCards[].ph profile thumbnails",
    )
    p.add_argument(
        "--force",
        action="store_true",
        help="Replace existing same-basename WebP portraits. Explicit direct portrait overrides are still preserved.",
    )
    p.add_argument(
        "--fail-on-error",
        action="store_true",
        help="Return non-zero if a person had portrait sources but every source failed.",
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
    # Legacy portrait-as-media refs remain migratable: a same-basename local
    # portrait has precedence over them in the project content model.
    if re.search(r"\.mdx?$", value, re.I):
        return None
    return value


def remote_photo(fm: str) -> str | None:
    match = PHOTO_RE.search(fm)
    return match.group(1) if match else None


def title_for(fm: str, file_path: Path) -> str:
    match = TITLE_RE.search(fm)
    return clean_yaml_scalar(match.group(1)) if match else file_path.stem


def xref_for(fm: str) -> str | None:
    match = XREF_RE.search(fm)
    return match.group(1).upper() if match else None


def individual_id_from_xref(xref: str | None) -> str | None:
    if not xref or not re.fullmatch(r"I\d+", xref, re.I):
        return None
    return str(int(xref[1:]) + 1_000_000)


def load_tree_profile_urls(tree_path: Path | None) -> dict[str, str]:
    if not tree_path:
        return {}
    if not tree_path.exists():
        raise SystemExit(f"MyHeritage tree snapshot not found: {tree_path}")

    data: Any = json.loads(tree_path.read_text(encoding="utf-8-sig"))
    if isinstance(data, dict) and isinstance(data.get("data"), dict):
        data = data["data"]
    cards = data.get("personCards", []) if isinstance(data, dict) else []

    result: dict[str, str] = {}
    for card in cards if isinstance(cards, list) else []:
        if not isinstance(card, dict):
            continue
        person_id = card.get("id")
        url = card.get("ph")
        if person_id is None or not isinstance(url, str) or not url.startswith(("http://", "https://")):
            continue
        result[str(person_id)] = url
    return result


def fetch_bytes(url: str, timeout: int) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; genealogy-library portrait importer)",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Referer": "https://www.myheritage.com/",
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


def save_webp(payload: bytes, target: Path, quality: int, max_edge: int) -> dict[str, int]:
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

        output = image.convert("RGBA" if "A" in image.getbands() else "RGB")
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

    tree_profile_urls = load_tree_profile_urls(args.tree_json)
    imported: list[dict] = []
    skipped_existing: list[str] = []
    skipped_explicit: list[dict] = []
    no_portrait_source: list[str] = []
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

        target = person_file.with_suffix(".webp")
        if target.exists() and not args.force:
            skipped_existing.append(rel)
            continue

        xref = xref_for(fm)
        individual_id = individual_id_from_xref(xref)
        candidates: list[tuple[str, str]] = []

        legacy_url = remote_photo(fm)
        if legacy_url:
            candidates.append(("legacy-photo", legacy_url))

        tree_url = tree_profile_urls.get(individual_id or "")
        if tree_url and tree_url != legacy_url:
            candidates.append(("tree-thumbnail", tree_url))

        if not candidates:
            no_portrait_source.append(rel)
            continue

        attempts = []
        for source_kind, url in candidates:
            try:
                payload = fetch_bytes(url, args.timeout)
                image_info = save_webp(payload, target, args.quality, args.max_edge)
                imported.append(
                    {
                        "person": rel,
                        "title": title,
                        "portrait": target.relative_to(PEOPLE_ROOT).as_posix(),
                        "xref": xref,
                        "individualId": individual_id,
                        "sourceKind": source_kind,
                        **image_info,
                    }
                )
                print(
                    f"OK   {rel} <- {source_kind} -> {target.name} "
                    f"({image_info['width']}x{image_info['height']}, {image_info['bytes']} bytes)"
                )
                break
            except (OSError, ValueError, urllib.error.URLError, urllib.error.HTTPError) as exc:
                attempts.append({"sourceKind": source_kind, "error": str(exc)})
        else:
            failed.append(
                {
                    "person": rel,
                    "title": title,
                    "xref": xref,
                    "individualId": individual_id,
                    "attempts": attempts,
                }
            )
            print(
                f"FAIL {rel}: " + "; ".join(f"{a['sourceKind']}: {a['error']}" for a in attempts),
                file=sys.stderr,
            )

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "quality": args.quality,
        "maxEdge": args.max_edge,
        "treeSnapshot": str(args.tree_json) if args.tree_json else None,
        "treeProfileUrls": len(tree_profile_urls),
        "peopleScanned": len(people_files),
        "imported": imported,
        "skippedExisting": skipped_existing,
        "skippedExplicitPortrait": skipped_explicit,
        "noPortraitSource": no_portrait_source,
        "failed": failed,
        "counts": {
            "imported": len(imported),
            "skippedExisting": len(skipped_existing),
            "skippedExplicitPortrait": len(skipped_explicit),
            "noPortraitSource": len(no_portrait_source),
            "failed": len(failed),
        },
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    by_source: dict[str, int] = {}
    for item in imported:
        by_source[item["sourceKind"]] = by_source.get(item["sourceKind"], 0) + 1

    print()
    print(
        "Portraits: "
        f"imported={len(imported)} {by_source}, existing={len(skipped_existing)}, "
        f"explicit={len(skipped_explicit)}, no-source={len(no_portrait_source)}, failed={len(failed)}"
    )
    print(f"Tree profile URLs available: {len(tree_profile_urls)}")
    print(f"Report: {REPORT_PATH}")

    return 1 if args.fail_on_error and failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
