from __future__ import annotations

import argparse
import csv
import json
import math
import re
from collections import Counter, defaultdict, deque
from pathlib import Path
from typing import Any


def load_tsv(path: Path) -> list[list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.reader(handle, delimiter="\t"))


def parse_xy(text: str) -> tuple[float, float]:
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*/\s*(-?\d+(?:\.\d+)?)", text)
    if not match:
        raise ValueError(f"cannot parse coordinate: {text!r}")
    return float(match.group(1)), float(match.group(2))


def angle_diff_deg(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


def graph_components(nodes: set[str], edges: list[tuple[str, str]]) -> list[list[str]]:
    adjacency: dict[str, set[str]] = {node: set() for node in nodes}
    for a, b in edges:
        if a in adjacency and b in adjacency:
            adjacency[a].add(b)
            adjacency[b].add(a)
    unseen = set(nodes)
    components: list[list[str]] = []
    while unseen:
        start = min(unseen)
        queue = deque([start])
        unseen.remove(start)
        component: list[str] = []
        while queue:
            node = queue.popleft()
            component.append(node)
            for other in sorted(adjacency[node]):
                if other in unseen:
                    unseen.remove(other)
                    queue.append(other)
        components.append(sorted(component))
    return sorted(components, key=lambda item: (-len(item), item[0]))


def audit_map(tables_dir: Path, old_json_path: Path) -> dict[str, Any]:
    node_rows = load_tsv(tables_dir / "table_073.tsv")[1:]
    edge_rows = load_tsv(tables_dir / "table_074.tsv")[1:]
    wall_meta_rows = load_tsv(tables_dir / "table_075.tsv")[1:]
    wall_detail_rows = load_tsv(tables_dir / "table_076.tsv")[1:]
    spawn_macro_rows = load_tsv(tables_dir / "table_082.tsv")[1:]
    spawn_rows = load_tsv(tables_dir / "table_083.tsv")[1:]
    shop_macro_rows = load_tsv(tables_dir / "table_084.tsv")[1:]
    shop_rows = load_tsv(tables_dir / "table_085.tsv")[1:]
    monster_slot_rows = load_tsv(tables_dir / "table_086.tsv")[1:]
    nest_rows = load_tsv(tables_dir / "table_087.tsv")[1:]
    link_rows = load_tsv(tables_dir / "table_088.tsv")[1:]
    pig_rows = load_tsv(tables_dir / "table_089.tsv")[1:]
    dragon_rows = load_tsv(tables_dir / "table_090.tsv")[1:]
    leader_rows = load_tsv(tables_dir / "table_091.tsv")[1:]
    rock_rows = load_tsv(tables_dir / "table_092.tsv")[1:]
    choke_rows = load_tsv(tables_dir / "table_093.tsv")[1:]
    chest_rows = load_tsv(tables_dir / "table_094.tsv")[1:]

    nodes = {
        row[0]: {
            "x": float(row[1]),
            "y": float(row[2]),
            "z": float(row[3]),
            "attributes": row[4],
        }
        for row in node_rows
    }
    node_ids = [row[0] for row in node_rows]
    expected_node_ids = [f"N{i:03d}" for i in range(len(node_rows))]
    duplicate_node_ids = sorted(
        node_id for node_id, count in Counter(node_ids).items() if count > 1
    )
    coordinate_groups: dict[tuple[float, float, float], list[str]] = defaultdict(list)
    for node_id, node in nodes.items():
        coordinate_groups[(node["x"], node["y"], node["z"])].append(node_id)
    duplicate_coordinates = {
        str(coord): ids
        for coord, ids in coordinate_groups.items()
        if len(ids) > 1
    }

    edge_ids = [row[0] for row in edge_rows]
    duplicate_edge_ids = sorted(
        edge_id for edge_id, count in Counter(edge_ids).items() if count > 1
    )
    edge_objects: list[dict[str, Any]] = []
    invalid_endpoint_edges: list[str] = []
    self_loops: list[str] = []
    length_mismatches: list[dict[str, Any]] = []
    pair_groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in edge_rows:
        edge = {
            "id": row[0],
            "a": row[1],
            "b": row[2],
            "class": row[3],
            "width_m": float(row[4]),
            "length_m": float(row[5]),
            "nav": row[6],
            "direction": row[7],
        }
        edge_objects.append(edge)
        if edge["a"] not in nodes or edge["b"] not in nodes:
            invalid_endpoint_edges.append(edge["id"])
            continue
        if edge["a"] == edge["b"]:
            self_loops.append(edge["id"])
        a = nodes[edge["a"]]
        b = nodes[edge["b"]]
        geometric = math.dist((a["x"], a["y"]), (b["x"], b["y"]))
        difference = abs(geometric - edge["length_m"])
        if difference > 0.2:
            length_mismatches.append(
                {
                    "id": edge["id"],
                    "declared_m": edge["length_m"],
                    "geometric_m": round(geometric, 4),
                    "difference_m": round(difference, 4),
                }
            )
        pair_groups[tuple(sorted((edge["a"], edge["b"])))].append(edge)

    duplicate_pairs = []
    for pair, group in sorted(pair_groups.items()):
        if len(group) > 1:
            duplicate_pairs.append(
                {
                    "pair": list(pair),
                    "count": len(group),
                    "edges": group,
                }
            )

    unique_pairs = list(pair_groups)
    components = graph_components(set(nodes), unique_pairs)
    degree = Counter()
    for a, b in unique_pairs:
        degree[a] += 1
        degree[b] += 1

    long_edges = sorted(
        (
            {
                "id": edge["id"],
                "class": edge["class"],
                "a": edge["a"],
                "b": edge["b"],
                "length_m": edge["length_m"],
            }
            for edge in edge_objects
            if edge["length_m"] > 60.0
        ),
        key=lambda item: (-item["length_m"], item["id"]),
    )

    wall_meta = {
        row[0]: {
            "class": row[1],
            "z0": float(row[2]),
            "height_m": float(row[3]),
            "declared_vertex_count": int(row[4]),
            "collision": row[5],
        }
        for row in wall_meta_rows
    }
    wall_detail: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in wall_detail_rows:
        points = [
            (float(x), float(y))
            for x, y in re.findall(
                r"V\d+=(-?\d+(?:\.\d+)?)\s*/\s*(-?\d+(?:\.\d+)?)",
                row[2],
            )
        ]
        labels = [int(value) for value in re.findall(r"V(\d+)=", row[2])]
        wall_detail[row[0]].append(
            {
                "sequence_label": row[1],
                "labels": labels,
                "points": points,
            }
        )
    wall_mismatches: list[dict[str, Any]] = []
    for wall_id, meta in wall_meta.items():
        detail_rows = wall_detail.get(wall_id, [])
        detail_point_count = sum(len(item["points"]) for item in detail_rows)
        repeated_v1_rows = sum(
            bool(item["labels"]) and item["labels"][0] == 1 for item in detail_rows
        )
        if (
            detail_point_count != meta["declared_vertex_count"]
            or len(detail_rows) != 1
            or repeated_v1_rows > 1
        ):
            wall_mismatches.append(
                {
                    "wall_id": wall_id,
                    "declared_vertex_count": meta["declared_vertex_count"],
                    "detail_point_count": detail_point_count,
                    "detail_row_count": len(detail_rows),
                    "rows_restarting_at_V1": repeated_v1_rows,
                    "sequence_labels": [
                        item["sequence_label"] for item in detail_rows
                    ],
                }
            )
    missing_wall_meta = sorted(set(wall_detail) - set(wall_meta))
    missing_wall_detail = sorted(set(wall_meta) - set(wall_detail))

    spawn_ids = [row[0] for row in spawn_rows]
    spawn_by_id = {row[0]: row for row in spawn_rows}
    spawn_macro_ids = [row[0] for row in spawn_macro_rows]
    spawn_macro_refs: dict[str, list[str]] = {}
    for row in spawn_macro_rows:
        spawn_macro_refs[row[0]] = re.findall(r"MAP_SPAWN_POINT_\d+", row[2])
    spawn_macro_ref_errors: list[dict[str, Any]] = []
    for macro_id, refs in spawn_macro_refs.items():
        if len(refs) != 2 or any(ref not in spawn_by_id for ref in refs):
            spawn_macro_ref_errors.append(
                {"macro_id": macro_id, "refs": refs, "expected_ref_count": 2}
            )
    spawn_row_ref_errors: list[dict[str, Any]] = []
    spawn_facing: list[dict[str, Any]] = []
    for row in spawn_rows:
        spawn_id = row[0]
        position = parse_xy(row[2])
        facing = float(row[3])
        macro_id = row[4]
        exit_node = row[5]
        if macro_id not in spawn_macro_refs or spawn_id not in spawn_macro_refs.get(
            macro_id, []
        ):
            spawn_row_ref_errors.append(
                {"spawn_id": spawn_id, "issue": "macro_back_reference", "macro": macro_id}
            )
        if exit_node not in nodes:
            spawn_row_ref_errors.append(
                {"spawn_id": spawn_id, "issue": "missing_exit_node", "node": exit_node}
            )
            continue
        node = nodes[exit_node]
        desired = math.degrees(
            math.atan2(node["y"] - position[1], node["x"] - position[0])
        )
        difference = angle_diff_deg(facing, desired)
        spawn_facing.append(
            {
                "spawn_id": spawn_id,
                "facing_deg": facing,
                "exit_bearing_deg": round(desired, 3),
                "difference_deg": round(difference, 3),
            }
        )

    shop_ids = [row[0] for row in shop_rows]
    shop_by_id = {row[0]: row for row in shop_rows}
    shop_macro_refs: dict[str, list[str]] = {}
    for row in shop_macro_rows:
        shop_macro_refs[row[0]] = re.findall(r"MAP_SHOP_POINT_\d+", row[2])
    shop_macro_ref_errors: list[dict[str, Any]] = []
    for macro_id, refs in shop_macro_refs.items():
        if len(refs) != 3 or any(ref not in shop_by_id for ref in refs):
            shop_macro_ref_errors.append(
                {"macro_id": macro_id, "refs": refs, "expected_ref_count": 3}
            )
    shop_row_ref_errors: list[dict[str, Any]] = []
    for row in shop_rows:
        if row[3] not in shop_macro_refs or row[0] not in shop_macro_refs[row[3]]:
            shop_row_ref_errors.append(
                {"shop_id": row[0], "macro_id": row[3]}
            )

    monster_slot_ids = [row[0] for row in monster_slot_rows]
    nest_ids = [row[0] for row in nest_rows]
    nest_id_set = set(nest_ids)
    monster_slot_nest_errors = [
        {"slot_id": row[0], "nest_id": row[4]}
        for row in monster_slot_rows
        if row[4] not in nest_id_set
    ]

    old = json.loads(old_json_path.read_text(encoding="utf-8"))
    old_nodes = {
        node_id: (float(value[0]), float(value[1]))
        for node_id, value in old.get("nodes", {}).items()
    }
    old_pairs = {
        tuple(sorted((str(edge["a"]), str(edge["b"]))))
        for edge in old.get("edges", [])
    }
    new_pairs = set(pair_groups)
    common_node_ids = sorted(set(old_nodes) & set(nodes))
    changed_common_nodes = []
    for node_id in common_node_ids:
        old_xy = old_nodes[node_id]
        new_xy = (nodes[node_id]["x"], nodes[node_id]["y"])
        distance = math.dist(old_xy, new_xy)
        if distance > 0.05:
            changed_common_nodes.append(
                {
                    "id": node_id,
                    "old": list(old_xy),
                    "new": list(new_xy),
                    "move_m": round(distance, 3),
                }
            )

    counts = {
        "nodes": len(node_rows),
        "edge_rows": len(edge_rows),
        "unique_undirected_edge_pairs": len(pair_groups),
        "walls_meta": len(wall_meta_rows),
        "walls_detail_rows": len(wall_detail_rows),
        "spawn_macros": len(spawn_macro_rows),
        "spawn_points": len(spawn_rows),
        "shop_macros": len(shop_macro_rows),
        "shop_points": len(shop_rows),
        "monster_slots": len(monster_slot_rows),
        "nests": len(nest_rows),
        "nest_links": len(link_rows),
        "pig_dens": len(pig_rows),
        "dragon_palaces": len(dragon_rows),
        "leader_arenas": len(leader_rows),
        "rocks": len(rock_rows),
        "chokes": len(choke_rows),
        "chest_points": len(chest_rows),
    }

    return {
        "counts": counts,
        "nodes": {
            "duplicate_ids": duplicate_node_ids,
            "id_sequence_exact_N000_onward": node_ids == expected_node_ids,
            "duplicate_coordinates": duplicate_coordinates,
        },
        "edges": {
            "duplicate_ids": duplicate_edge_ids,
            "invalid_endpoint_edges": invalid_endpoint_edges,
            "self_loops": self_loops,
            "length_mismatches_over_0_2m": length_mismatches,
            "duplicate_undirected_pair_count": len(duplicate_pairs),
            "duplicate_row_excess": sum(item["count"] - 1 for item in duplicate_pairs),
            "duplicate_pairs": duplicate_pairs,
            "class_counts": dict(Counter(edge["class"] for edge in edge_objects)),
            "longer_than_60m_count": len(long_edges),
            "longer_than_60m_by_class": dict(
                Counter(item["class"] for item in long_edges)
            ),
            "longest_edges": long_edges[:30],
            "component_count": len(components),
            "component_sizes": [len(component) for component in components],
            "isolated_nodes": sorted(set(nodes) - set(degree)),
            "degree_histogram_unique_pairs": dict(Counter(degree.values())),
        },
        "walls": {
            "missing_meta": missing_wall_meta,
            "missing_detail": missing_wall_detail,
            "mismatch_count": len(wall_mismatches),
            "mismatches": wall_mismatches,
        },
        "spawns": {
            "duplicate_ids": sorted(
                item for item, count in Counter(spawn_ids).items() if count > 1
            ),
            "duplicate_macro_ids": sorted(
                item
                for item, count in Counter(spawn_macro_ids).items()
                if count > 1
            ),
            "macro_ref_errors": spawn_macro_ref_errors,
            "row_ref_errors": spawn_row_ref_errors,
            "facing_max_difference_deg": max(
                (item["difference_deg"] for item in spawn_facing), default=None
            ),
            "facing_over_5deg": [
                item for item in spawn_facing if item["difference_deg"] > 5.0
            ],
        },
        "shops": {
            "duplicate_ids": sorted(
                item for item, count in Counter(shop_ids).items() if count > 1
            ),
            "macro_ref_errors": shop_macro_ref_errors,
            "row_ref_errors": shop_row_ref_errors,
        },
        "monster_ecology": {
            "duplicate_slot_ids": sorted(
                item
                for item, count in Counter(monster_slot_ids).items()
                if count > 1
            ),
            "duplicate_nest_ids": sorted(
                item for item, count in Counter(nest_ids).items() if count > 1
            ),
            "slot_missing_nest_refs": monster_slot_nest_errors,
        },
        "old_candidate_comparison": {
            "old_nodes": len(old_nodes),
            "new_nodes": len(nodes),
            "common_node_ids": len(common_node_ids),
            "changed_common_nodes_count": len(changed_common_nodes),
            "changed_common_nodes": changed_common_nodes,
            "removed_old_node_ids": sorted(set(old_nodes) - set(nodes)),
            "added_new_node_ids": sorted(set(nodes) - set(old_nodes)),
            "old_edge_rows": len(old.get("edges", [])),
            "old_unique_pairs": len(old_pairs),
            "new_edge_rows": len(edge_rows),
            "new_unique_pairs": len(new_pairs),
            "common_edge_pairs": len(old_pairs & new_pairs),
            "removed_old_edge_pairs": len(old_pairs - new_pairs),
            "added_new_edge_pairs": len(new_pairs - old_pairs),
            "old_spawn_points": len(old.get("spawn_micro", [])),
            "new_spawn_points": len(spawn_rows),
            "old_walls": len(old.get("walls", [])),
            "new_walls": len(wall_meta_rows),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("tables_dir", type=Path)
    parser.add_argument("old_json", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = audit_map(args.tables_dir.resolve(), args.old_json.resolve())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    summary = {
        "counts": result["counts"],
        "edge_duplicate_pair_count": result["edges"][
            "duplicate_undirected_pair_count"
        ],
        "edge_duplicate_row_excess": result["edges"]["duplicate_row_excess"],
        "edges_longer_than_60m": result["edges"]["longer_than_60m_count"],
        "map_components": result["edges"]["component_count"],
        "wall_mismatch_count": result["walls"]["mismatch_count"],
        "spawn_ref_errors": len(result["spawns"]["macro_ref_errors"])
        + len(result["spawns"]["row_ref_errors"]),
        "spawn_facing_max_difference_deg": result["spawns"][
            "facing_max_difference_deg"
        ],
        "old_candidate_comparison": result["old_candidate_comparison"],
        "out": str(args.out.resolve()),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
