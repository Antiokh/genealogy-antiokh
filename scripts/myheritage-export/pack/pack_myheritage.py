#!/usr/bin/env python3
"""
Pack MHX__* MyHeritage downloads into a repo-ready directory.

Pipeline:
  1. Select only MHX__* files (optionally only today's date).
  2. Stage them into one package directory (copy by default, --move optional).
  3. Resolve browser suffix duplicates: "name (1).json", "(2)", etc.
     Largest wins; ties use newest mtime.
  4. Keep exact raw JSON under raw/.
  5. SHA-256 deduplicate image payloads.
  6. Convert unique images to WebP quality 65 (configurable).
  7. Create data/export.json from the aggregate export and rewrite known image
     URLs/references to relative ../photos/*.webp paths.
  8. Write manifest.json with hashes, duplicate groups, mappings and counts.

Requires one image backend:
  - Pillow: py -m pip install pillow
  OR
  - ImageMagick "magick" available on PATH.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

PREFIX = "MHX__"
BROWSER_DUP_RE = re.compile(r" \((\d+)\)(?=\.[^.]+$)")
PHOTO_RE = re.compile(r"^MHX__photos__(\d+)(.*)\.([^.]+)$", re.I)
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"}

def parse_args():
    today = dt.date.today().isoformat()
    downloads = Path.home() / "Downloads"
    p = argparse.ArgumentParser()
    p.add_argument("--source", type=Path, default=downloads)
    p.add_argument("--out", type=Path, default=downloads / f"myheritage-export-{today}")
    p.add_argument("--date", default=today,
                   help="Local mtime date YYYY-MM-DD; use 'all' for all MHX files")
    p.add_argument("--quality", type=int, default=65)
    p.add_argument("--move", action="store_true",
                   help="Move selected MHX files out of source instead of copying")
    p.add_argument("--keep-staged-images", action="store_true",
                   help="Keep original JPG/PNG/WebP files under raw/photos-original")
    return p.parse_args()

def sha256(path: Path, chunk=1024 * 1024) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()

def normalized_browser_name(name: str) -> str:
    return BROWSER_DUP_RE.sub("", name)

def choose_largest_newest(paths: list[Path]) -> Path:
    return max(paths, key=lambda p: (p.stat().st_size, p.stat().st_mtime))

def select_source_files(source: Path, date_filter: str) -> list[Path]:
    if not source.exists():
        raise SystemExit(f"Source directory not found: {source}")
    result = []
    wanted_date = None if date_filter.lower() == "all" else dt.date.fromisoformat(date_filter)
    for p in source.iterdir():
        if not p.is_file() or not p.name.startswith(PREFIX):
            continue
        if wanted_date is not None:
            d = dt.datetime.fromtimestamp(p.stat().st_mtime).date()
            if d != wanted_date:
                continue
        result.append(p)
    return sorted(result, key=lambda p: p.name.lower())

def stage_files(files: list[Path], inbox: Path, move: bool) -> list[Path]:
    inbox.mkdir(parents=True, exist_ok=True)
    staged = []
    for src in files:
        dst = inbox / src.name
        if dst.exists():
            stem, suffix = dst.stem, dst.suffix
            i = 2
            while dst.exists():
                dst = inbox / f"{stem}__stage{i}{suffix}"
                i += 1
        if move:
            shutil.move(str(src), str(dst))
        else:
            shutil.copy2(src, dst)
        staged.append(dst)
    return staged

def dedupe_browser_suffixes(paths: list[Path]):
    groups = defaultdict(list)
    for p in paths:
        groups[normalized_browser_name(p.name)].append(p)

    kept = []
    dropped = []
    for logical, members in groups.items():
        winner = choose_largest_newest(members)
        clean = winner.with_name(logical)
        if winner != clean and not clean.exists():
            winner.rename(clean)
            winner = clean
        kept.append(winner)
        for p in members:
            if p.exists() and p != winner:
                dropped.append({
                    "name": p.name,
                    "size": p.stat().st_size,
                    "reason": "browser-suffix-duplicate",
                    "kept": winner.name,
                })
                p.unlink()
    return kept, dropped

def detect_image_backend():
    try:
        from PIL import Image  # noqa
        return "pillow"
    except Exception:
        pass
    if shutil.which("magick"):
        return "magick"
    return None

def convert_webp(src: Path, dst: Path, quality: int, backend: str):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if backend == "pillow":
        from PIL import Image
        with Image.open(src) as im:
            if "A" in im.getbands():
                out = im.convert("RGBA")
            else:
                out = im.convert("RGB")
            out.save(dst, "WEBP", quality=quality, method=6)
        return
    if backend == "magick":
        subprocess.run(
            ["magick", str(src), "-strip", "-quality", str(quality), str(dst)],
            check=True,
        )
        return
    raise RuntimeError("No image backend")

def photo_id_from_name(name: str) -> str | None:
    m = PHOTO_RE.match(name)
    return m.group(1) if m else None

def canonical_photo_name(photo_id: str, index: int = 1) -> str:
    return f"{photo_id}.webp" if index == 1 else f"{photo_id}__{index}.webp"

def prepare_images(image_paths: list[Path], photos_dir: Path, quality: int, keep_original_dir: Path | None):
    backend = detect_image_backend()
    if not backend:
        raise SystemExit(
            "No WebP converter found. Install Pillow (`py -m pip install pillow`) "
            "or ImageMagick (`magick`)."
        )

    by_hash = defaultdict(list)
    hashes = {}
    for p in image_paths:
        h = sha256(p)
        hashes[p] = h
        by_hash[h].append(p)

    id_payload_counter = defaultdict(int)
    hash_to_output = {}
    source_to_output = {}
    id_to_outputs = defaultdict(list)
    duplicate_groups = []

    for h, members in sorted(by_hash.items(), key=lambda kv: min(x.name for x in kv[1])):
        representative = sorted(
            members,
            key=lambda p: (
                0 if re.match(r"^MHX__photos__\d+\.[^.]+$", p.name, re.I) else 1,
                len(p.name),
                p.name.lower(),
            ),
        )[0]
        ids = [photo_id_from_name(p.name) for p in members]
        ids = [x for x in ids if x]
        photo_id = sorted(ids, key=int)[0] if ids else h[:16]

        id_payload_counter[photo_id] += 1
        out_name = canonical_photo_name(photo_id, id_payload_counter[photo_id])
        out_path = photos_dir / out_name

        convert_webp(representative, out_path, quality, backend)
        out_rel = f"../photos/{out_name}"

        hash_to_output[h] = out_rel
        for p in members:
            source_to_output[p.name] = out_rel
            pid = photo_id_from_name(p.name)
            if pid and out_rel not in id_to_outputs[pid]:
                id_to_outputs[pid].append(out_rel)

        if keep_original_dir:
            keep_original_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(representative, keep_original_dir / representative.name)

        if len(members) > 1:
            duplicate_groups.append({
                "sha256": h,
                "keptSource": representative.name,
                "sources": [p.name for p in members],
                "output": out_rel,
            })

    return {
        "backend": backend,
        "hashes": {p.name: hashes[p] for p in image_paths},
        "sourceToOutput": source_to_output,
        "idToOutputs": dict(id_to_outputs),
        "duplicates": duplicate_groups,
    }

def classify_json(path: Path) -> tuple[str, Path]:
    name = path.name
    clean = normalized_browser_name(name)
    if clean.startswith("MHX__raw__people__"):
        tail = clean[len("MHX__raw__people__"):]
        return "raw-person", Path("raw") / "people" / tail
    if clean.startswith("MHX__raw__responses"):
        return "raw-responses", Path("raw") / "responses.json"
    if clean.startswith("MHX__export"):
        return "aggregate-export", Path("raw") / "export.json"
    if clean.startswith("MHX__missing"):
        return "missing", Path("raw") / "missing.json"
    return "raw-other", Path("raw") / clean[len(PREFIX):]

def copy_raw_json(json_paths: list[Path], package_root: Path):
    copied = []
    aggregate = None
    for p in json_paths:
        kind, rel = classify_json(p)
        dst = package_root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dst)
        copied.append({"source": p.name, "kind": kind, "path": rel.as_posix(), "sha256": sha256(dst)})
        if kind == "aggregate-export":
            aggregate = dst
    return copied, aggregate

def numeric_tail(value: Any) -> str | None:
    if value is None:
        return None
    m = re.search(r"(?:^|-)(\d+)$", str(value))
    return m.group(1) if m else None

def build_remote_mapping(export_obj: Any, id_to_outputs: dict[str, list[str]]):
    remote_to_local = {}
    if not isinstance(export_obj, dict):
        return remote_to_local

    photos = export_obj.get("photos")
    if not isinstance(photos, dict):
        return remote_to_local

    def collect_urls(v):
        out = []
        if isinstance(v, str) and re.match(r"^https?://", v):
            out.append(v)
        elif isinstance(v, list):
            for x in v:
                out.extend(collect_urls(x))
        elif isinstance(v, dict):
            for x in v.values():
                out.extend(collect_urls(x))
        return out

    for key, photo in photos.items():
        pid = numeric_tail(key)
        if not pid and isinstance(photo, dict):
            pid = numeric_tail(photo.get("id"))
        if not pid:
            continue
        outputs = id_to_outputs.get(pid)
        if not outputs:
            continue
        local = outputs[0]
        for url in collect_urls(photo):
            if re.search(r"(mhcache|myheritageimages)", url, re.I) or re.search(r"\.(jpe?g|png|webp)(?:[?#]|$)", url, re.I):
                remote_to_local[url] = local
    return remote_to_local

def rewrite_json_strings(value: Any, remote_to_local: dict[str, str], source_to_output: dict[str, str]):
    if isinstance(value, str):
        if value in remote_to_local:
            return remote_to_local[value]

        basename = Path(value.replace("\\", "/")).name
        if basename in source_to_output:
            return source_to_output[basename]

        if value.startswith("MHX__photos__") and basename in source_to_output:
            return source_to_output[basename]

        return value

    if isinstance(value, list):
        return [rewrite_json_strings(x, remote_to_local, source_to_output) for x in value]

    if isinstance(value, dict):
        return {
            k: rewrite_json_strings(v, remote_to_local, source_to_output)
            for k, v in value.items()
        }

    return value

def normalize_export(raw_export: Path, data_dir: Path, image_info: dict):
    with raw_export.open("r", encoding="utf-8-sig") as f:
        raw = json.load(f)

    normalized = copy.deepcopy(raw)
    remote_map = build_remote_mapping(normalized, image_info["idToOutputs"])
    normalized = rewrite_json_strings(
        normalized,
        remote_map,
        image_info["sourceToOutput"],
    )

    photos = normalized.get("photos") if isinstance(normalized, dict) else None
    if isinstance(photos, dict):
        for key, photo in photos.items():
            if not isinstance(photo, dict):
                continue
            pid = numeric_tail(key) or numeric_tail(photo.get("id"))
            outputs = image_info["idToOutputs"].get(pid or "", [])
            if outputs:
                photo["localPath"] = outputs[0]
                if len(outputs) > 1:
                    photo["localPaths"] = outputs

    data_dir.mkdir(parents=True, exist_ok=True)
    out = data_dir / "export.json"
    with out.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(normalized, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return out, len(remote_map)

def main():
    args = parse_args()
    source = args.source.expanduser().resolve()
    package = args.out.expanduser().resolve()

    if package == source:
        raise SystemExit("--out must differ from --source")

    package.mkdir(parents=True, exist_ok=True)
    inbox = package / "_staging"

    files = select_source_files(source, args.date)
    if not files:
        raise SystemExit(f"No {PREFIX}* files matched in {source}")

    print(f"Selected: {len(files)} files")
    print(f"Source:   {source}")
    print(f"Package:  {package}")
    print("Mode:     " + ("MOVE" if args.move else "COPY"))

    staged = stage_files(files, inbox, args.move)
    staged, browser_dupes = dedupe_browser_suffixes(staged)

    image_paths = [p for p in staged if p.suffix.lower() in IMAGE_EXTS]
    json_paths = [p for p in staged if p.suffix.lower() == ".json"]
    other_paths = [p for p in staged if p not in image_paths and p not in json_paths]

    raw_files, raw_export = copy_raw_json(json_paths, package)

    keep_original_dir = (
        package / "raw" / "photos-original"
        if args.keep_staged_images else None
    )
    image_info = prepare_images(
        image_paths,
        package / "photos",
        args.quality,
        keep_original_dir,
    )

    normalized_export = None
    rewritten_urls = 0
    if raw_export:
        normalized_export, rewritten_urls = normalize_export(
            raw_export,
            package / "data",
            image_info,
        )

    if other_paths:
        other_dir = package / "raw" / "other"
        other_dir.mkdir(parents=True, exist_ok=True)
        for p in other_paths:
            shutil.copy2(p, other_dir / p.name)

    input_bytes = sum(p.stat().st_size for p in staged if p.exists())
    photo_bytes = sum(p.stat().st_size for p in (package / "photos").glob("*.webp"))
    raw_bytes = sum(
        p.stat().st_size
        for p in (package / "raw").rglob("*")
        if p.is_file()
    )
    data_bytes = sum(
        p.stat().st_size
        for p in (package / "data").rglob("*")
        if p.is_file()
    ) if (package / "data").exists() else 0

    manifest = {
        "format": "myheritage-repo-package-v1",
        "createdAt": dt.datetime.now().astimezone().isoformat(),
        "sourceDateFilter": args.date,
        "imageQuality": args.quality,
        "imageBackend": image_info["backend"],
        "counts": {
            "selectedFiles": len(files),
            "stagedAfterBrowserDedupe": len(staged),
            "rawJson": len(json_paths),
            "sourceImages": len(image_paths),
            "uniqueImagePayloads": len(set(image_info["hashes"].values())),
            "webpFiles": len(list((package / "photos").glob("*.webp"))),
            "browserSuffixDuplicatesRemoved": len(browser_dupes),
            "imageDuplicateGroups": len(image_info["duplicates"]),
            "rewrittenRemoteImageUrls": rewritten_urls,
        },
        "bytes": {
            "stagedInput": input_bytes,
            "raw": raw_bytes,
            "photosWebp": photo_bytes,
            "normalizedData": data_bytes,
        },
        "browserSuffixDuplicatesRemoved": browser_dupes,
        "imageDuplicates": image_info["duplicates"],
        "sourceImageToLocal": image_info["sourceToOutput"],
        "photoIdToLocal": image_info["idToOutputs"],
        "rawFiles": raw_files,
        "normalizedExport": (
            normalized_export.relative_to(package).as_posix()
            if normalized_export else None
        ),
    }

    with (package / "manifest.json").open("w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")

    shutil.rmtree(inbox)

    readme = f"""# MyHeritage export package

Generated by `pack_myheritage.py`.

## Layout

- `raw/` — original MyHeritage JSON, kept unchanged.
- `data/export.json` — normalized analysis copy with local relative image links.
- `photos/` — SHA-256-deduplicated WebP images, quality {args.quality}.
- `manifest.json` — hashes, duplicate mappings and package statistics.

The normalized export is derivative data. Use `raw/` whenever exact source
responses or original MyHeritage URLs are required.
"""
    (package / "README.md").write_text(readme, encoding="utf-8", newline="\n")

    print()
    print("DONE")
    print(f"  raw JSON:              {len(json_paths)}")
    print(f"  source images:         {len(image_paths)}")
    print(f"  unique image payloads: {len(set(image_info['hashes'].values()))}")
    print(f"  WebP files:            {len(list((package / 'photos').glob('*.webp')))}")
    print(f"  image dup groups:      {len(image_info['duplicates'])}")
    print(f"  rewritten image URLs:  {rewritten_urls}")
    print(f"  package:               {package}")
    print()
    print("Review manifest.json and data/export.json before committing to Git.")

if __name__ == "__main__":
    main()
