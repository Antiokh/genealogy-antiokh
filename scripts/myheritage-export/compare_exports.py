#!/usr/bin/env python3
"""Compare userscript and CDP MyHeritage snapshots by stable IDs.

Typical use from the Obsidian project directory:

    py D:\path\to\genealogy-library\scripts\myheritage-export\compare_exports.py .

Expected children of ROOT:
    myheritage-export-userscript/
    myheritage-export-cdp/

Outputs into ROOT:
    comparison-report.json
    photo-comparison.csv

The script never mutates either export.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from pathlib import Path
from typing import Any

DIM_RE = re.compile(r"_(\d+)x(\d+)(?:C)?(?:/|$)", re.I)
ID_RE = re.compile(r"^(\d+)")
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".bmp"}


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as f:
        return json.load(f)


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def dimensions_from_url(url: str | None) -> tuple[int | None, int | None]:
    if not url:
        return None, None
    matches = DIM_RE.findall(url)
    if not matches:
        return None, None
    w, h = matches[-1]
    return int(w), int(h)


def image_dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        from PIL import Image
    except Exception:
        return None, None
    try:
        with Image.open(path) as im:
            return int(im.width), int(im.height)
    except Exception:
        return None, None


def photo_id_from_path(path: Path) -> str | None:
    m = ID_RE.match(path.stem)
    return m.group(1) if m else None


def map_images(directory: Path) -> dict[str, list[Path]]:
    result: dict[str, list[Path]] = {}
    if not directory.exists():
        return result
    for path in sorted(directory.iterdir()):
        if not path.is_file() or path.suffix.lower() not in IMAGE_EXTS:
            continue
        photo_id = photo_id_from_path(path)
        if photo_id:
            result.setdefault(photo_id, []).append(path)
    return result


def read_userscript_profiles(root: Path) -> dict[str, Any]:
    people_dir = root / "raw" / "people"
    result = {}
    if not people_dir.exists():
        return result
    for path in sorted(people_dir.glob("*.json")):
        m = ID_RE.match(path.name)
        if not m:
            continue
        value = load_json(path)
        # Packed userscript raw person files wrap the server payload.
        body = value.get("body") if isinstance(value, dict) else None
        result[m.group(1)] = body if isinstance(body, dict) else value
    return result


def read_cdp_profiles(root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    state_path = root / "state.json"
    state = load_json(state_path) if state_path.exists() else {}
    result = {}
    for person_id, relative in (state.get("profileFiles") or {}).items():
        path = root / Path(str(relative))
        if not path.exists():
            continue
        value = load_json(path)
        result[str(person_id)] = value
    return result, state


def json_shape(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: json_shape(v) for k, v in sorted(value.items())}
    if isinstance(value, list):
        return [json_shape(v) for v in value]
    return type(value).__name__


def photo_metadata_from_cdp(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(k): v for k, v in (state.get("photos") or {}).items() if isinstance(v, dict)}


def photo_metadata_from_userscript(root: Path) -> dict[str, dict[str, Any]]:
    # Prefer raw aggregate because data/export.json has rewritten local URLs.
    for candidate in [root / "raw" / "export.json", root / "data" / "export.json"]:
        if not candidate.exists():
            continue
        value = load_json(candidate)
        photos = value.get("photos") if isinstance(value, dict) else None
        if isinstance(photos, dict):
            return {str(k): v for k, v in photos.items() if isinstance(v, dict)}
    return {}


def best_url(meta: dict[str, Any] | None) -> str | None:
    if not meta:
        return None
    for key in ["originalUrl", "largeUrl", "resolvedUrl", "url", "thumbUrl"]:
        value = meta.get(key)
        if isinstance(value, str) and value:
            return value
    nested = meta.get("metadata")
    if isinstance(nested, dict):
        return best_url(nested)
    return None


def choose_one(paths: list[Path]) -> Path | None:
    if not paths:
        return None
    # If several payloads exist for one photo ID, retain the largest as the
    # comparison candidate but report the count separately.
    return max(paths, key=lambda p: (p.stat().st_size, p.name))


def quality_tuple(path: Path | None, fallback_url: str | None) -> tuple[int, int, int, int]:
    if path:
        w, h = image_dimensions(path)
        size = path.stat().st_size
    else:
        w = h = None
        size = 0
    if not w or not h:
        w, h = dimensions_from_url(fallback_url)
    w = w or 0
    h = h or 0
    return w * h, w, h, size


def recommend_photo_master(
    user_path: Path | None,
    cdp_path: Path | None,
    user_url: str | None,
    cdp_url: str | None,
) -> tuple[str, str]:
    if user_path and cdp_path:
        uq = quality_tuple(user_path, user_url)
        cq = quality_tuple(cdp_path, cdp_url)
        if uq[0] > cq[0]:
            return "userscript", "larger pixel area"
        if cq[0] > uq[0]:
            return "cdp", "larger pixel area"
        # Equal dimensions: CDP is normally direct largeUrl bytes whereas the
        # packed userscript image is a q65 derivative.
        if user_path.suffix.lower() == ".webp" and cdp_path.suffix.lower() != ".webp":
            return "cdp", "same dimensions; CDP preserves direct largeUrl bytes while userscript is q65 WebP"
        if cdp_path.stat().st_size > user_path.stat().st_size:
            return "cdp", "same dimensions; larger direct file"
        if user_path.stat().st_size > cdp_path.stat().st_size:
            return "userscript", "same dimensions; larger file"
        return "either", "same dimensions and byte size"
    if cdp_path:
        return "cdp", "only local image available"
    if user_path:
        return "userscript", "only local image available"
    return "none", "no local image"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", type=Path, default=Path.cwd())
    parser.add_argument("--userscript", type=Path)
    parser.add_argument("--cdp", type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--photo-csv", type=Path)
    args = parser.parse_args()

    root = args.root.resolve()
    userscript = (args.userscript or root / "myheritage-export-userscript").resolve()
    cdp = (args.cdp or root / "myheritage-export-cdp").resolve()
    report_path = (args.report or root / "comparison-report.json").resolve()
    csv_path = (args.photo_csv or root / "photo-comparison.csv").resolve()

    if not userscript.exists():
        raise SystemExit(f"Userscript export not found: {userscript}")
    if not cdp.exists():
        raise SystemExit(f"CDP export not found: {cdp}")

    user_profiles = read_userscript_profiles(userscript)
    cdp_profiles, cdp_state = read_cdp_profiles(cdp)
    user_profile_ids = set(user_profiles)
    cdp_profile_ids = set(cdp_profiles)
    profile_overlap = sorted(user_profile_ids & cdp_profile_ids, key=int)

    exact_profiles = []
    differing_profiles = []
    same_shape_profiles = []
    for person_id in profile_overlap:
        left = user_profiles[person_id]
        right = cdp_profiles[person_id]
        if left == right:
            exact_profiles.append(person_id)
        else:
            differing_profiles.append(person_id)
            if json_shape(left) == json_shape(right):
                same_shape_profiles.append(person_id)

    user_images = map_images(userscript / "photos")
    cdp_images = map_images(cdp / "photos")
    user_photo_meta = photo_metadata_from_userscript(userscript)
    cdp_photo_meta = photo_metadata_from_cdp(cdp_state)
    all_photo_ids = sorted(
        set(user_images) | set(cdp_images) | set(user_photo_meta) | set(cdp_photo_meta),
        key=lambda x: int(x) if x.isdigit() else x,
    )

    photo_rows = []
    exact_image_hash_matches = 0
    recommendations = {"userscript": 0, "cdp": 0, "either": 0, "none": 0}
    for photo_id in all_photo_ids:
        up = choose_one(user_images.get(photo_id, []))
        cp = choose_one(cdp_images.get(photo_id, []))
        uu = best_url(user_photo_meta.get(photo_id))
        cu = best_url(cdp_photo_meta.get(photo_id))
        uq = quality_tuple(up, uu)
        cq = quality_tuple(cp, cu)
        uh = sha256(up) if up else None
        ch = sha256(cp) if cp else None
        exact = bool(uh and ch and uh == ch)
        if exact:
            exact_image_hash_matches += 1
        recommendation, reason = recommend_photo_master(up, cp, uu, cu)
        recommendations[recommendation] += 1
        photo_rows.append({
            "photoId": photo_id,
            "userscriptFile": up.relative_to(userscript).as_posix() if up else "",
            "userscriptVariants": len(user_images.get(photo_id, [])),
            "userscriptWidth": uq[1] or "",
            "userscriptHeight": uq[2] or "",
            "userscriptBytes": up.stat().st_size if up else "",
            "userscriptSha256": uh or "",
            "userscriptUrl": uu or "",
            "cdpFile": cp.relative_to(cdp).as_posix() if cp else "",
            "cdpVariants": len(cdp_images.get(photo_id, [])),
            "cdpWidth": cq[1] or "",
            "cdpHeight": cq[2] or "",
            "cdpBytes": cp.stat().st_size if cp else "",
            "cdpSha256": ch or "",
            "cdpUrl": cu or "",
            "exactByteMatch": exact,
            "recommendedMaster": recommendation,
            "reason": reason,
        })

    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(photo_rows[0]) if photo_rows else ["photoId"])
        writer.writeheader()
        writer.writerows(photo_rows)

    user_missing = {}
    missing_path = userscript / "raw" / "missing.json"
    if missing_path.exists():
        user_missing = load_json(missing_path)
    manifest = {}
    manifest_path = userscript / "manifest.json"
    if manifest_path.exists():
        manifest = load_json(manifest_path)

    known_ids = [str(x) for x in (cdp_state.get("knownIds") or [])]
    report = {
        "userscript": {
            "path": str(userscript),
            "stats": user_missing.get("stats") if isinstance(user_missing, dict) else None,
            "manifestCounts": manifest.get("counts") if isinstance(manifest, dict) else None,
            "rawProfilesAvailable": len(user_profiles),
            "localPhotoIds": len(user_images),
        },
        "cdp": {
            "path": str(cdp),
            "knownIds": len(known_ids),
            "profilesCaptured": len(cdp_profiles),
            "localPhotoIds": len(cdp_images),
        },
        "profiles": {
            "overlap": len(profile_overlap),
            "semanticExactMatches": len(exact_profiles),
            "different": len(differing_profiles),
            "differentButSameShape": len(same_shape_profiles),
            "userscriptOnlyRawProfileIds": sorted(user_profile_ids - cdp_profile_ids, key=int),
            "cdpOnlyProfileIds": sorted(cdp_profile_ids - user_profile_ids, key=int),
            "differentIds": differing_profiles,
        },
        "photos": {
            "allKnownIds": len(all_photo_ids),
            "userscriptLocalIds": len(user_images),
            "cdpLocalIds": len(cdp_images),
            "localOverlap": len(set(user_images) & set(cdp_images)),
            "exactByteMatches": exact_image_hash_matches,
            "masterRecommendations": recommendations,
            "csv": csv_path.name,
        },
        "policy": {
            "treeBaseline": "userscript",
            "profileMerge": "merge by stable person ID; preserve provenance; do not overwrite richer non-empty fields blindly",
            "photoMaster": "choose by actual pixel dimensions/source; on equal dimensions prefer direct CDP largeUrl bytes over q65 userscript WebP",
            "raw": "preserve both raw datasets unchanged",
        },
    }

    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Userscript raw profiles: {len(user_profiles)}")
    print(f"CDP known IDs:            {len(known_ids)}")
    print(f"CDP profiles captured:    {len(cdp_profiles)}")
    print(f"Profile overlap:          {len(profile_overlap)}")
    print(f"Semantic exact matches:   {len(exact_profiles)}")
    print(f"Different profiles:       {len(differing_profiles)}")
    print(f"Userscript local photos:  {len(user_images)}")
    print(f"CDP local photos:         {len(cdp_images)}")
    print(f"Photo overlap:            {len(set(user_images) & set(cdp_images))}")
    print(f"Report: {report_path}")
    print(f"Photos: {csv_path}")
    try:
        import PIL  # noqa: F401
    except Exception:
        print("NOTE: Pillow is not installed; URL dimensions were used where possible. Install with: py -m pip install pillow")


if __name__ == "__main__":
    main()
