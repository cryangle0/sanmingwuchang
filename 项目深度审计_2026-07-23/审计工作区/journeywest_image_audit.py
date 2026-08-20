from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps, ImageStat


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def dhash(image: Image.Image, size: int = 16) -> int:
    gray = ImageOps.grayscale(image).resize(
        (size + 1, size), Image.Resampling.LANCZOS
    )
    pixels = np.asarray(gray, dtype=np.int16)
    diff = pixels[:, 1:] > pixels[:, :-1]
    value = 0
    for bit in diff.flatten():
        value = (value << 1) | int(bit)
    return value


def hamming(a: int, b: int) -> int:
    return (a ^ b).bit_count()


def normalized_name(name: str) -> str:
    stem = Path(name).stem
    stem = re.sub(r"（[^）]*）", "", stem)
    stem = stem.replace("超级BOSS", "")
    stem = stem.replace("佛祖", "")
    stem = stem.replace("青狮精", "青狮怪")
    element_match = re.fullmatch(r"肥猪（([金木水火土])）", Path(name).stem)
    if element_match:
        return element_match.group(1) + "肥猪"
    dragon_match = re.fullmatch(r"龙王（([金木水火土])）", Path(name).stem)
    if dragon_match:
        return dragon_match.group(1) + "龙王"
    return stem


def analyze_image(path: Path) -> tuple[dict[str, Any], Image.Image, int]:
    result: dict[str, Any] = {
        "path": str(path),
        "filename": path.name,
        "bytes": path.stat().st_size,
        "file_sha256": sha256_file(path),
        "normalized_name": normalized_name(path.name),
    }
    with Image.open(path) as source:
        source.load()
        result.update(
            {
                "format": source.format,
                "mode": source.mode,
                "width": source.width,
                "height": source.height,
            }
        )
        rgba = source.convert("RGBA")
        alpha = np.asarray(rgba.getchannel("A"), dtype=np.uint8)
        result["has_alpha_channel"] = "A" in source.getbands()
        result["alpha_min"] = int(alpha.min())
        result["alpha_max"] = int(alpha.max())
        result["transparent_pixel_ratio"] = round(float(np.mean(alpha < 255)), 6)
        result["fully_transparent_pixel_ratio"] = round(
            float(np.mean(alpha == 0)), 6
        )
        bbox = rgba.getbbox()
        result["content_bbox_rgba"] = list(bbox) if bbox else None
        if bbox:
            result["content_bbox_coverage"] = round(
                ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1]))
                / (source.width * source.height),
                6,
            )
        else:
            result["content_bbox_coverage"] = 0.0
        result["rgba_pixel_sha256"] = hashlib.sha256(rgba.tobytes()).hexdigest()
        gray_stat = ImageStat.Stat(ImageOps.grayscale(rgba))
        result["grayscale_mean"] = round(gray_stat.mean[0], 3)
        result["grayscale_stddev"] = round(gray_stat.stddev[0], 3)
        hash_value = dhash(rgba)
        result["dhash_256_hex"] = f"{hash_value:064x}"
        return result, rgba.copy(), hash_value


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            try:
                return ImageFont.truetype(str(candidate), size=size)
            except Exception:
                pass
    return ImageFont.load_default()


def make_contact_sheets(
    items: list[tuple[dict[str, Any], Image.Image]],
    out_dir: Path,
    prefix: str,
    columns: int = 4,
    rows: int = 5,
) -> list[str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    cell_w = 360
    cell_h = 420
    label_h = 62
    per_sheet = columns * rows
    font = load_font(22)
    small_font = load_font(16)
    paths: list[str] = []
    for sheet_index in range(math.ceil(len(items) / per_sheet)):
        page_items = items[
            sheet_index * per_sheet : (sheet_index + 1) * per_sheet
        ]
        sheet = Image.new(
            "RGB",
            (columns * cell_w, rows * cell_h),
            (240, 240, 238),
        )
        draw = ImageDraw.Draw(sheet)
        for item_index, (metadata, image) in enumerate(page_items):
            col = item_index % columns
            row = item_index // columns
            x0 = col * cell_w
            y0 = row * cell_h
            thumb_area = (cell_w - 20, cell_h - label_h - 20)
            checker = Image.new("RGB", thumb_area, (224, 224, 224))
            checker_draw = ImageDraw.Draw(checker)
            step = 20
            for cy in range(0, thumb_area[1], step):
                for cx in range(0, thumb_area[0], step):
                    if (cx // step + cy // step) % 2:
                        checker_draw.rectangle(
                            [cx, cy, cx + step - 1, cy + step - 1],
                            fill=(200, 200, 200),
                        )
            thumb = image.copy()
            thumb.thumbnail(thumb_area, Image.Resampling.LANCZOS)
            paste_x = (thumb_area[0] - thumb.width) // 2
            paste_y = (thumb_area[1] - thumb.height) // 2
            checker.paste(thumb, (paste_x, paste_y), thumb)
            sheet.paste(checker, (x0 + 10, y0 + 10))
            draw.rectangle(
                [x0, y0, x0 + cell_w - 1, y0 + cell_h - 1],
                outline=(120, 120, 120),
                width=1,
            )
            draw.text(
                (x0 + 10, y0 + cell_h - label_h + 4),
                metadata["filename"],
                fill=(20, 20, 20),
                font=font,
            )
            draw.text(
                (x0 + 10, y0 + cell_h - 25),
                f'{metadata["width"]}x{metadata["height"]} {metadata["mode"]}',
                fill=(70, 70, 70),
                font=small_font,
            )
        output = out_dir / f"{prefix}_{sheet_index + 1:02d}.jpg"
        sheet.save(output, quality=90, optimize=True)
        paths.append(str(output.resolve()))
    return paths


def audit_directory(path: Path, contact_dir: Path, prefix: str) -> dict[str, Any]:
    files = sorted(
        (
            item
            for item in path.iterdir()
            if item.is_file() and item.suffix.lower() in {".png", ".jpg", ".jpeg"}
        ),
        key=lambda item: item.name,
    )
    records: list[dict[str, Any]] = []
    contact_items: list[tuple[dict[str, Any], Image.Image]] = []
    hashes: dict[str, int] = {}
    errors: list[dict[str, str]] = []
    for file in files:
        try:
            record, image, hash_value = analyze_image(file)
            records.append(record)
            contact_items.append((record, image))
            hashes[file.name] = hash_value
        except Exception as exc:
            errors.append({"filename": file.name, "error": str(exc)})

    exact_file_groups: dict[str, list[str]] = defaultdict(list)
    pixel_groups: dict[str, list[str]] = defaultdict(list)
    for record in records:
        exact_file_groups[record["file_sha256"]].append(record["filename"])
        pixel_groups[record["rgba_pixel_sha256"]].append(record["filename"])
    exact_duplicates = [
        group for group in exact_file_groups.values() if len(group) > 1
    ]
    pixel_duplicates = [
        group for group in pixel_groups.values() if len(group) > 1
    ]
    near_duplicates = []
    names = sorted(hashes)
    for index, left in enumerate(names):
        for right in names[index + 1 :]:
            distance = hamming(hashes[left], hashes[right])
            if distance <= 12:
                near_duplicates.append(
                    {"left": left, "right": right, "dhash_distance": distance}
                )
    near_duplicates.sort(key=lambda item: (item["dhash_distance"], item["left"], item["right"]))

    contact_sheets = make_contact_sheets(
        contact_items,
        contact_dir,
        prefix,
    )
    return {
        "directory": str(path.resolve()),
        "count": len(files),
        "errors": errors,
        "dimension_counts": {
            f"{width}x{height}": count
            for (width, height), count in Counter(
                (record["width"], record["height"]) for record in records
            ).most_common()
        },
        "mode_counts": dict(Counter(record["mode"] for record in records)),
        "format_counts": dict(Counter(record["format"] for record in records)),
        "images_with_alpha_channel": sum(
            bool(record["has_alpha_channel"]) for record in records
        ),
        "images_with_any_transparency": sum(
            record["transparent_pixel_ratio"] > 0 for record in records
        ),
        "exact_file_duplicates": exact_duplicates,
        "decoded_pixel_duplicates": pixel_duplicates,
        "near_duplicate_pairs_dhash_le_12": near_duplicates,
        "records": records,
        "contact_sheets": contact_sheets,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("hero_dir", type=Path)
    parser.add_argument("monster_dir", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--contact-dir", type=Path, required=True)
    args = parser.parse_args()

    result = {
        "heroes": audit_directory(
            args.hero_dir.resolve(),
            args.contact_dir.resolve(),
            "heroes",
        ),
        "monsters": audit_directory(
            args.monster_dir.resolve(),
            args.contact_dir.resolve(),
            "monsters",
        ),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    summary = {
        category: {
            "count": data["count"],
            "errors": len(data["errors"]),
            "dimension_counts": data["dimension_counts"],
            "mode_counts": data["mode_counts"],
            "format_counts": data["format_counts"],
            "images_with_any_transparency": data["images_with_any_transparency"],
            "exact_file_duplicates": data["exact_file_duplicates"],
            "decoded_pixel_duplicates": data["decoded_pixel_duplicates"],
            "near_duplicate_pairs": len(data["near_duplicate_pairs_dhash_le_12"]),
            "contact_sheets": data["contact_sheets"],
        }
        for category, data in result.items()
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
