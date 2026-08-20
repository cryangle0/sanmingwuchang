from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any

import imagehash
from lxml import etree
from PIL import Image, ImageDraw, ImageFont


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"w": W_NS, "r": R_NS, "a": A_NS}


def load_tsv(path: Path) -> list[list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.reader(handle, delimiter="\t"))


def table_kv(path: Path) -> dict[str, str]:
    rows = load_tsv(path)
    return {
        row[0].strip(): row[1].strip()
        for row in rows[1:]
        if len(row) >= 2 and row[0].strip()
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clean_text(value: str) -> str:
    value = value.replace("\r", "\n")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n+", "\n", value)
    return value.strip()


def xml_text(element: etree._Element) -> str:
    return clean_text("".join(element.xpath(".//w:t/text()", namespaces=NS)))


def load_payloads(tables_dir: Path) -> list[dict[str, Any]]:
    specs = {
        120: "active",
        126: "passive",
        128: "equipment",
        130: "monster_skill",
        131: "summon",
    }
    records: list[dict[str, Any]] = []
    for table, kind in specs.items():
        rows = load_tsv(tables_dir / f"table_{table:03d}.tsv")
        for row in rows[1:]:
            if len(row) < 2 or not row[0]:
                continue
            records.append(
                {
                    "table": table,
                    "kind": kind,
                    "id": row[0],
                    "payload": json.loads(row[1]),
                }
            )
    return records


def walk_typed(
    value: Any,
    path: str = "",
) -> list[tuple[str, dict[str, Any]]]:
    result: list[tuple[str, dict[str, Any]]] = []
    if isinstance(value, dict):
        if isinstance(value.get("type"), str):
            result.append((path, value))
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            result.extend(walk_typed(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            result.extend(walk_typed(child, f"{path}[{index}]"))
    return result


def parse_enum_registry(tables_dir: Path) -> dict[str, list[str]]:
    rows = load_tsv(tables_dir / "table_117.tsv")
    registry: dict[str, list[str]] = {}
    for row in rows[1:]:
        if len(row) < 2 or not row[0] or "." in row[0]:
            continue
        registry[row[0]] = [
            part.strip() for part in row[1].split("/") if part.strip()
        ]
    return registry


def enum_for_path(kind: str, path: str) -> str | None:
    leaf = re.sub(r"\[\d+\]", "", path.split(".")[-1])
    if leaf == "targeting" and kind == "active":
        return "Targeting"
    if leaf == "cast_type":
        return "CastType"
    if leaf == "shape":
        return "MonsterSkillShape" if kind == "monster_skill" else "Shape"
    if leaf == "effect_type":
        return "ActiveEffectType" if kind == "active" else None
    if leaf == "trigger" and kind == "passive" and path == "trigger":
        return "PassiveTrigger"
    if leaf == "quality" and kind == "equipment":
        return "EquipmentQuality"
    if leaf == "stat" and kind == "equipment":
        return "StatKind"
    if path == "effect.type" and kind == "equipment":
        return "EquipmentEffectType"
    if leaf in {"summon_archetype", "archetype"}:
        return "SummonArchetype"
    if leaf.endswith("damage_form"):
        return "DamageForm"
    if leaf.endswith("source_faction"):
        return "SourceFaction"
    if leaf.endswith("element_rule"):
        return "ElementRule"
    if leaf.endswith("hit_kind"):
        return "HitKind"
    if leaf.endswith("owner_credit"):
        return "OwnerCredit"
    if leaf == "event_id":
        return "DamageEventId"
    return None


def enum_audit(
    records: list[dict[str, Any]],
    registry: dict[str, list[str]],
    gate_kv: dict[str, str],
) -> dict[str, Any]:
    failures: list[dict[str, Any]] = []
    checked = 0
    for record in records:
        for path, node in walk_typed(record["payload"]):
            if node.get("type") != "ENUM":
                continue
            enum_name = enum_for_path(record["kind"], path)
            if not enum_name or enum_name not in registry:
                continue
            checked += 1
            value = str(node.get("value"))
            if value not in registry[enum_name]:
                failures.append(
                    {
                        "table": record["table"],
                        "kind": record["kind"],
                        "id": record["id"],
                        "path": path,
                        "enum": enum_name,
                        "value": value,
                    }
                )

    gate_statuses = {
        value
        for key, value in gate_kv.items()
        if re.fullmatch(r"gates\[\d+\]\.status", key)
    }
    declared_gate_statuses = {
        part.strip()
        for part in gate_kv.get("statuses", "").split(" / ")
        if part.strip()
    }
    rule_status = set(registry.get("RuleStatus", []))
    return {
        "checked_typed_enum_nodes": checked,
        "typed_enum_failures": failures,
        "typed_enum_failure_count": len(failures),
        "gate_statuses_used": sorted(gate_statuses),
        "gate_statuses_declared": sorted(declared_gate_statuses),
        "rule_status_registered": sorted(rule_status),
        "gate_statuses_missing_from_registry": sorted(gate_statuses - rule_status),
        "declared_gate_statuses_missing_from_registry": sorted(
            declared_gate_statuses - rule_status
        ),
        "registered_rule_statuses_unused_by_gates": sorted(rule_status - gate_statuses),
        "registered_rule_statuses_absent_from_gate_vocabulary": sorted(
            rule_status - declared_gate_statuses
        ),
    }


EXPECTED_UNIT_OVERRIDES: dict[tuple[str, str], str] = {
    ("H004", "damage_target_max_hp_percent_per_stack"): "pct",
    ("H024", "distance_bonus_percent_per_10m"): "pct",
    ("D16", "amount"): "gold",
    ("D17", "base_bounty"): "gold",
    ("D17", "cap"): "gold",
    ("B11", "l5_last_hit_other_passive_chance"): "pct",
    ("B16", "l5_full_block_chance"): "pct",
    ("B18", "attack_percent_per_missing_10pct_hp"): "pct",
    ("B24", "heal_percent_actual_hp_plus_shield_damage"): "pct",
    ("B31", "gold"): "gold",
    ("B31", "l5_heal_percent_transferred_gold"): "pct",
    ("B33", "chest_chance"): "pct",
    ("B33", "gem_chance"): "pct",
    ("B33", "gold_equipment_chance"): "pct",
    ("B34", "percent"): "pct",
    ("B36", "move_speed_percent_per_stack"): "pct",
    ("B44", "l5_zone_chance"): "pct",
    ("B6", "add_percentage_points"): "pct",
    ("P16", "attack_speed_percent_per_stack"): "pct",
    ("P16", "each_damage_event_maximum_stack_gain"): "scalar",
    ("CORE_V5_THUNDERCHAIN", "decay_percent_per_jump"): "pct",
}


def unit_audit(records: list[dict[str, Any]], type_kv: dict[str, str]) -> dict[str, Any]:
    allowed_match = re.search(
        r"unit[：:]\s*(.+)$", type_kv.get("type_system.unit_required", "")
    )
    allowed = {
        part.strip()
        for part in (allowed_match.group(1).split(" / ") if allowed_match else [])
        if part.strip()
    }
    observed: Counter[str] = Counter()
    formula_missing_unit: list[dict[str, Any]] = []
    mismatches: list[dict[str, Any]] = []
    unsupported_dimensions: list[dict[str, Any]] = []
    for record in records:
        for path, node in walk_typed(record["payload"]):
            unit = node.get("unit")
            if isinstance(unit, str):
                observed[unit] += 1
            if node.get("type") == "FORMULA" and "unit" not in node:
                formula_missing_unit.append(
                    {
                        "table": record["table"],
                        "kind": record["kind"],
                        "id": record["id"],
                        "path": path,
                        "src": node.get("src"),
                    }
                )
            leaf = re.sub(r"\[\d+\]", "", path.split(".")[-1])
            expected = EXPECTED_UNIT_OVERRIDES.get((record["id"], leaf))
            if expected and unit != expected:
                mismatches.append(
                    {
                        "table": record["table"],
                        "kind": record["kind"],
                        "id": record["id"],
                        "path": path,
                        "actual": unit,
                        "expected": expected,
                    }
                )
            if leaf == "orbit_angular_speed_deg_s":
                unsupported_dimensions.append(
                    {
                        "table": record["table"],
                        "id": record["id"],
                        "path": path,
                        "actual": unit,
                        "semantic_dimension": "deg/s",
                        "allowed_by_E28": "deg/s" in allowed,
                    }
                )
            if leaf == "l5_heal_max_hp_percent_per_s":
                unsupported_dimensions.append(
                    {
                        "table": record["table"],
                        "id": record["id"],
                        "path": path,
                        "actual": unit,
                        "semantic_dimension": "pct/s",
                        "allowed_by_E28": "pct/s" in allowed,
                    }
                )
    return {
        "declared_units": sorted(allowed),
        "observed_unit_counts": dict(observed.most_common()),
        "observed_units_not_declared": sorted(set(observed) - allowed),
        "formula_nodes_missing_unit_count": len(formula_missing_unit),
        "formula_nodes_missing_unit": formula_missing_unit,
        "semantic_unit_mismatch_count": len(mismatches),
        "semantic_unit_mismatches": mismatches,
        "unsupported_dimensions": unsupported_dimensions,
    }


def ref_audit(
    records: list[dict[str, Any]],
    paragraph_text: str,
    tables_dir: Path,
) -> dict[str, Any]:
    refs: list[dict[str, Any]] = []
    for record in records:
        for path, node in walk_typed(record["payload"]):
            if node.get("type") != "REF":
                continue
            value = str(node.get("value", ""))
            section_tokens = re.findall(r"§?((?:\d+\.)*\d+|E\.\d+)", value)
            broad_hits = {
                token: bool(
                    re.search(
                        rf"(?m)^(?:\[P\d+.*?\]\s*)?{re.escape(token)}(?:\s|$)",
                        paragraph_text,
                    )
                )
                for token in section_tokens
            }
            refs.append(
                {
                    "table": record["table"],
                    "kind": record["kind"],
                    "id": record["id"],
                    "path": path,
                    "value": value,
                    "section_tokens": section_tokens,
                    "section_hits": broad_hits,
                    "malformed_bracket": value.count("[") != value.count("]"),
                }
            )

    summon_rows = load_tsv(tables_dir / "table_131.tsv")
    summon_payloads = {
        row[0]: json.loads(row[1])
        for row in summon_rows[1:]
        if len(row) >= 2 and row[0]
    }
    summon_ref_targets = {
        "B12": "WOLF_SPIRIT",
        "B13": "FIRE_SPIRIT",
        "B39": "STONE_STATUE",
        "CORE_V6_MIRRORSHADOW": "CORE_MIRROR",
    }
    target_checks = []
    record_ids = {record["id"] for record in records}
    for source_id, target_id in summon_ref_targets.items():
        target_checks.append(
            {
                "source_id": source_id,
                "source_exists": source_id in record_ids,
                "target_id": target_id,
                "target_exists": target_id in summon_payloads,
            }
        )
    return {
        "ref_count": len(refs),
        "refs": refs,
        "malformed_ref_count": sum(item["malformed_bracket"] for item in refs),
        "all_section_tokens_found": all(
            all(item["section_hits"].values()) for item in refs
        ),
        "typed_summon_target_checks": target_checks,
    }


def structural_docx_audit(docx_path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(docx_path) as archive:
        root = etree.fromstring(archive.read("word/document.xml"))
        cells = root.xpath(".//w:tc", namespaces=NS)
        blank_cells = []
        for index, cell in enumerate(cells, start=1):
            text = clean_text("".join(cell.xpath(".//w:t/text()", namespaces=NS)))
            if not text:
                blank_cells.append(index)
        return {
            "raw_word_cell_count": len(cells),
            "raw_word_blank_cell_count": len(blank_cells),
            "raw_word_blank_cell_indices": blank_cells,
        }


def rules_conflict_audit(tables_dir: Path) -> dict[str, Any]:
    t4 = table_kv(tables_dir / "table_004.tsv")
    t95 = table_kv(tables_dir / "table_095.tsv")
    t96 = table_kv(tables_dir / "table_096.tsv")
    t97 = table_kv(tables_dir / "table_097.tsv")
    t122 = table_kv(tables_dir / "table_122.tsv")
    return {
        "passive_cd": {
            "chapter_2_projection": "CONTINUE_REMAINING; NEVER_RESET_BY_TRUE_DEATH",
            "chapter_7_projection": "RESET_INTERNAL_COOLDOWN",
            "appendix_A_engine_key": t96.get(
                "life.true_death_reset.passive_internal_cooldowns"
            ),
            "authority": t95.get("true_death_reset.authority"),
            "verdict": "APPENDIX_A_AND_CHAPTER_2_AGREE; CHAPTER_7_IS_STALE_PROJECTION",
        },
        "rounding": {
            "chapter_0": t4.get("数值"),
            "combat_engine_key": t97.get("rounding.hp_commit"),
            "typed_payload_engine_key": t122.get("type_system.final_rounding"),
            "verdict": "CONFLICT_OR_UNSPECIFIED_ORDER",
        },
        "projection_policy": {
            "conflict": t4.get("冲突"),
            "generation": t4.get("投影生成"),
            "validation": t4.get("投影校验"),
        },
    }


def gate_audit(tables_dir: Path, source_root: Path) -> dict[str, Any]:
    kv = table_kv(tables_dir / "table_064.tsv")
    gates: dict[int, dict[str, str]] = {}
    for key, value in kv.items():
        match = re.fullmatch(r"gates\[(\d+)\]\.(.+)", key)
        if not match:
            continue
        gates.setdefault(int(match.group(1)), {})[match.group(2)] = value
    files = [path for path in source_root.rglob("*") if path.is_file()]
    names = {path.name.lower() for path in files}
    expected_evidence = "v4_final_check_report.json"
    statuses = Counter(gate.get("status", "MISSING") for gate in gates.values())
    self_passed = [
        gate.get("id")
        for gate in gates.values()
        if gate.get("status") == "TOOL_PASS"
    ]
    evidence_rows = []
    for index in sorted(gates):
        gate = gates[index]
        evidence_rows.append(
            {
                "index": index,
                "id": gate.get("id"),
                "status": gate.get("status"),
                "evidence_id": gate.get("evidence_id"),
                "checker_version": gate.get("checker_version"),
                "result_hash": gate.get("result_hash"),
            }
        )
    return {
        "gate_count": len(gates),
        "status_counts": dict(statuses),
        "self_declared_tool_pass": self_passed,
        "expected_evidence_file": expected_evidence,
        "expected_evidence_file_present": expected_evidence.lower() in names,
        "checker_or_generator_files": [
            str(path)
            for path in files
            if re.search(r"(CCK_V4_2|projection|schema|ruleset)", path.name, re.I)
        ],
        "gates": evidence_rows,
    }


def media_contexts(docx_path: Path, media_out: Path) -> list[dict[str, Any]]:
    media_out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(docx_path) as archive:
        root = etree.fromstring(archive.read("word/document.xml"))
        rel_root = etree.fromstring(archive.read("word/_rels/document.xml.rels"))
        rels = {
            rel.get("Id"): rel.get("Target")
            for rel in rel_root.findall(f"{{{PKG_REL_NS}}}Relationship")
        }
        contexts: list[dict[str, Any]] = []
        recent: list[str] = []
        body = root.find("w:body", namespaces=NS)
        for child in body:
            if child.tag == f"{{{W_NS}}}p":
                text = xml_text(child)
                if text:
                    recent.append(text)
                    recent = recent[-5:]
                for blip in child.xpath(".//a:blip", namespaces=NS):
                    rid = blip.get(f"{{{R_NS}}}embed")
                    target = rels.get(rid, "")
                    part = f"word/{target}" if not target.startswith("word/") else target
                    data = archive.read(part)
                    output = media_out / Path(target).name
                    output.write_bytes(data)
                    contexts.append(
                        {
                            "rid": rid,
                            "part": part,
                            "file": str(output),
                            "preceding_context": recent[-4:],
                        }
                    )
        return contexts


def compare_media(
    contexts: list[dict[str, Any]],
    old_maps_dir: Path,
) -> list[dict[str, Any]]:
    old_paths = sorted(
        [
            path
            for path in old_maps_dir.iterdir()
            if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg"}
        ],
        key=lambda path: path.name,
    )
    old_hashes = {}
    for path in old_paths:
        with Image.open(path) as image:
            old_hashes[path] = imagehash.phash(image.convert("RGB"))

    comparisons: list[dict[str, Any]] = []
    for context in contexts:
        path = Path(context["file"])
        with Image.open(path) as image:
            rgb = image.convert("RGB")
            current_hash = imagehash.phash(rgb)
            ranked = sorted(
                (
                    {
                        "old_file": old.name,
                        "phash_distance": int(current_hash - old_hash),
                    }
                    for old, old_hash in old_hashes.items()
                ),
                key=lambda item: (item["phash_distance"], item["old_file"]),
            )
            comparisons.append(
                {
                    **context,
                    "width": rgb.width,
                    "height": rgb.height,
                    "sha256": sha256_file(path),
                    "nearest_old_maps": ranked[:3],
                }
            )
    return comparisons


def create_contact_sheet(
    comparisons: list[dict[str, Any]],
    output: Path,
) -> None:
    thumb_w = 480
    thumb_h = 385
    label_h = 90
    columns = 3
    rows = (len(comparisons) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (columns * thumb_w, rows * (thumb_h + label_h)),
        "white",
    )
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, item in enumerate(comparisons):
        col = index % columns
        row = index // columns
        x = col * thumb_w
        y = row * (thumb_h + label_h)
        with Image.open(item["file"]) as image:
            thumb = image.convert("RGB")
            thumb.thumbnail((thumb_w - 12, thumb_h - 12))
            px = x + (thumb_w - thumb.width) // 2
            py = y + (thumb_h - thumb.height) // 2
            sheet.paste(thumb, (px, py))
        nearest = item["nearest_old_maps"][0]
        context = " | ".join(item["preceding_context"][-2:])
        label = (
            f"{Path(item['file']).name}  {item['width']}x{item['height']}\n"
            f"nearest: {nearest['old_file']}  pHash={nearest['phash_distance']}\n"
            f"{context[:90]}"
        )
        draw.multiline_text((x + 8, y + thumb_h + 4), label, fill="black", font=font)
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output, quality=92)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--docx", type=Path, required=True)
    parser.add_argument("--tables", type=Path, required=True)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--old-maps", type=Path, required=True)
    parser.add_argument("--media-out", type=Path, required=True)
    parser.add_argument("--contact-sheet", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    records = load_payloads(args.tables)
    registry = parse_enum_registry(args.tables)
    gate_kv = table_kv(args.tables / "table_064.tsv")
    type_kv = table_kv(args.tables / "table_122.tsv")
    paragraph_text = (args.tables.parent / "body_order.txt").read_text(
        encoding="utf-8-sig"
    )
    contexts = media_contexts(args.docx, args.media_out)
    comparisons = compare_media(contexts, args.old_maps)
    create_contact_sheet(comparisons, args.contact_sheet)

    report = {
        "source_docx": str(args.docx),
        "source_docx_sha256": sha256_file(args.docx),
        "structural_docx": structural_docx_audit(args.docx),
        "rule_conflicts": rules_conflict_audit(args.tables),
        "enum_closure": enum_audit(records, registry, gate_kv),
        "unit_contract": unit_audit(records, type_kv),
        "ref_closure": ref_audit(records, paragraph_text, args.tables),
        "release_gates": gate_audit(args.tables, args.source_root),
        "embedded_media": comparisons,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
