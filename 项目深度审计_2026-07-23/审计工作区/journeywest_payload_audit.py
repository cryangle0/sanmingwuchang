from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Callable


CLOSED_TYPES = {
    "INT64",
    "Q4",
    "BOOL",
    "ENUM",
    "SET",
    "ARRAY",
    "FORMULA",
    "HASH",
    "REF",
}
DECLARED_UNITS = {"m", "mm", "s", "m/s", "pct", "deg", "hz", "gold", "hp", "ratio", "scalar"}
OBSERVED_DERIVED_UNITS = {"1/s", "hp/s"}
FORMULA_FUNCTIONS = {"FLOOR", "CEIL", "MAX", "MIN", "CLAMP", "MOD", "ATAN2_DEG", "ABS"}
FORMULA_OPS = FORMULA_FUNCTIONS | {"ADD", "SUB", "MUL", "DIV_FLOOR", "POW_INT", "NEG"}
FORMULA_VARIABLES = {
    "BASE_DURATION",
    "COST",
    "COUNT",
    "CURRENT_GAME_MOVE_SPEED",
    "CURRENT_GOLD",
    "CURRENT_HP",
    "DECOY_MAX_HP",
    "HISTORICAL_HP_CLAMPED_TO_CURRENT_MAX_HP",
    "MISSING_HP_PERCENT",
    "OWNER_CURRENT_HP",
    "OWNER_CURRENT_MAX_HP",
    "PRE_OVERHEAL_AMOUNT",
    "SOURCE_FLAT_EXTENSION",
    "TARGET_STRONGEST_MULTIPLIER",
    "VALUE",
    "target_x",
    "target_y",
    "viewer_x",
    "viewer_y",
}


@dataclass
class PayloadRecord:
    table: int
    kind: str
    row_id: str
    payload: dict[str, Any]
    raw: str


class DuplicateKeyError(ValueError):
    pass


def no_duplicate_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError(key)
        result[key] = value
    return result


def load_tsv(path: Path) -> list[list[str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.reader(handle, delimiter="\t"))


def canonical_payload_hash(payload: dict[str, Any]) -> str:
    clone = dict(payload)
    clone.pop("payload_sha256", None)
    encoded = json.dumps(
        clone,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


TOKEN_RE = re.compile(
    r"\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(.))"
)


class FormulaParser:
    def __init__(self, source: str) -> None:
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", source):
            source = source.split("=", 1)[1]
        self.tokens: list[tuple[str, str]] = []
        position = 0
        while position < len(source):
            match = TOKEN_RE.match(source, position)
            if not match:
                raise ValueError(f"tokenization failed at {position}")
            position = match.end()
            number, ident, symbol = match.groups()
            if number is not None:
                self.tokens.append(("NUMBER", number))
            elif ident is not None:
                self.tokens.append(("IDENT", ident))
            elif symbol and not symbol.isspace():
                self.tokens.append((symbol, symbol))
        self.tokens.append(("EOF", "EOF"))
        self.index = 0

    def peek(self, token_type: str) -> bool:
        return self.tokens[self.index][0] == token_type

    def take(self, token_type: str) -> str:
        actual_type, value = self.tokens[self.index]
        if actual_type != token_type:
            raise ValueError(f"expected {token_type}, got {actual_type}")
        self.index += 1
        return value

    def parse(self) -> dict[str, Any]:
        result = self.expr()
        self.take("EOF")
        return result

    def expr(self) -> dict[str, Any]:
        left = self.term()
        while self.peek("+") or self.peek("-"):
            op = "ADD" if self.peek("+") else "SUB"
            self.index += 1
            left = {"op": op, "args": [left, self.term()]}
        return left

    def term(self) -> dict[str, Any]:
        left = self.power()
        while self.peek("*") or self.peek("/"):
            op = "MUL" if self.peek("*") else "DIV_FLOOR"
            self.index += 1
            left = {"op": op, "args": [left, self.power()]}
        return left

    def power(self) -> dict[str, Any]:
        left = self.factor()
        if self.peek("^"):
            self.index += 1
            return {"op": "POW_INT", "args": [left, self.factor()]}
        return left

    def factor(self) -> dict[str, Any]:
        if self.peek("-"):
            self.index += 1
            return {"op": "NEG", "args": [self.factor()]}
        if self.peek("NUMBER"):
            raw = self.take("NUMBER")
            q4 = int((Decimal(raw) * Decimal(10000)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            return {"q4": q4}
        if self.peek("IDENT"):
            ident = self.take("IDENT")
            if self.peek("("):
                self.take("(")
                args: list[dict[str, Any]] = []
                if not self.peek(")"):
                    args.append(self.expr())
                    while self.peek(","):
                        self.take(",")
                        args.append(self.expr())
                self.take(")")
                return {"op": ident, "args": args}
            return {"var": ident}
        if self.peek("("):
            self.take("(")
            result = self.expr()
            self.take(")")
            return result
        raise ValueError(f"unexpected token {self.tokens[self.index]}")


def walk_typed(
    value: Any,
    callback: Callable[[dict[str, Any], str], None],
    path: str = "",
    inside_formula_ast: bool = False,
) -> None:
    if isinstance(value, dict):
        if isinstance(value.get("type"), str):
            callback(value, path)
            inside_formula_ast = value.get("type") == "FORMULA"
        for key, child in value.items():
            child_path = f"{path}.{key}" if path else key
            walk_typed(
                child,
                callback,
                child_path,
                inside_formula_ast or key == "ast",
            )
    elif isinstance(value, list):
        for index, child in enumerate(value):
            walk_typed(child, callback, f"{path}[{index}]", inside_formula_ast)


def formula_ast_find(ast: Any, variables: set[str], ops: set[str]) -> None:
    if isinstance(ast, dict):
        if "var" in ast:
            variables.add(str(ast["var"]))
        if "op" in ast:
            ops.add(str(ast["op"]))
        for value in ast.values():
            formula_ast_find(value, variables, ops)
    elif isinstance(ast, list):
        for value in ast:
            formula_ast_find(value, variables, ops)


def parse_field_matrix(rows: list[list[str]]) -> dict[str, dict[str, set[str]]]:
    matrix: dict[str, dict[str, set[str]]] = {}
    for row in rows[1:]:
        if len(row) < 2 or not row[0]:
            continue
        effect_type = row[0].strip()
        text = row[1].replace("\u3000", " ").strip()
        optional: set[str] = set()
        if "允许缺省：" in text:
            required_text, optional_text = text.split("允许缺省：", 1)
            optional = {part.strip() for part in optional_text.split("/") if part.strip()}
        else:
            required_text = text
        required = {part.strip() for part in required_text.split("/") if part.strip()}
        matrix[effect_type] = {"required": required, "optional": optional}
    return matrix


def audit_payloads(base: Path) -> dict[str, Any]:
    table_specs = [
        (120, "active", "active_id"),
        (126, "passive", "passive_id"),
        (128, "equipment", "equipment_id"),
        (130, "monster_skill", "monster_skill_id"),
        (131, "summon", "summon_archetype"),
    ]
    records: list[PayloadRecord] = []
    parse_errors: list[dict[str, Any]] = []
    for table, kind, _ in table_specs:
        rows = load_tsv(base / f"table_{table:03d}.tsv")
        for row in rows[1:]:
            if len(row) < 2 or not row[0]:
                continue
            row_id, raw = row[0], row[1]
            try:
                payload = json.loads(raw, object_pairs_hook=no_duplicate_object)
                if not isinstance(payload, dict):
                    raise ValueError("top-level JSON is not an object")
                records.append(PayloadRecord(table, kind, row_id, payload, raw))
            except Exception as exc:
                parse_errors.append(
                    {"table": table, "kind": kind, "id": row_id, "error": str(exc)}
                )

    hash_failures: list[dict[str, Any]] = []
    schema_failures: list[dict[str, Any]] = []
    id_failures: list[dict[str, Any]] = []
    typed_issues: list[dict[str, Any]] = []
    formula_issues: list[dict[str, Any]] = []
    type_counts: Counter[str] = Counter()
    unit_counts: Counter[str] = Counter()
    array_order_missing: list[dict[str, Any]] = []
    set_contract_issues: list[dict[str, Any]] = []

    id_field_by_kind = {
        "active": None,
        "passive": "passive_id",
        "equipment": "equipment_id",
        "monster_skill": "monster_skill_id",
        "summon": "summon_archetype",
    }

    for record in records:
        payload = record.payload
        hash_node = payload.get("payload_sha256")
        expected = (
            hash_node.get("value")
            if isinstance(hash_node, dict) and hash_node.get("type") == "HASH"
            else None
        )
        actual = canonical_payload_hash(payload)
        if expected != actual:
            hash_failures.append(
                {
                    "table": record.table,
                    "kind": record.kind,
                    "id": record.row_id,
                    "expected": expected,
                    "actual": actual,
                }
            )

        schema = payload.get("schema_version")
        if not (
            isinstance(schema, dict)
            and schema.get("type") == "ENUM"
            and schema.get("value") == "V3_0"
        ):
            schema_failures.append(
                {"table": record.table, "kind": record.kind, "id": record.row_id}
            )

        id_field = id_field_by_kind[record.kind]
        if record.kind == "active":
            id_ok = record.row_id.startswith("H") and record.row_id in {
                f"H{i:03d}" for i in range(1, 39)
            }
            id_ok = id_ok or (
                record.row_id.startswith("D")
                and record.row_id[1:].isdigit()
            )
        else:
            node = payload.get(id_field or "")
            id_ok = (
                isinstance(node, dict)
                and node.get("type") == "ENUM"
                and node.get("value") == record.row_id
            )
        if not id_ok:
            id_failures.append(
                {"table": record.table, "kind": record.kind, "id": record.row_id}
            )

        def check_typed(node: dict[str, Any], path: str) -> None:
            node_type = node.get("type")
            type_counts[str(node_type)] += 1
            issue_base = {
                "table": record.table,
                "kind": record.kind,
                "id": record.row_id,
                "path": path,
                "type": node_type,
            }
            if node_type not in CLOSED_TYPES:
                typed_issues.append({**issue_base, "issue": "unknown_type"})
                return
            if node_type == "INT64":
                if not isinstance(node.get("value"), int) or isinstance(node.get("value"), bool):
                    typed_issues.append({**issue_base, "issue": "INT64_value_not_integer"})
                if "unit" not in node:
                    typed_issues.append({**issue_base, "issue": "INT64_missing_unit"})
            elif node_type == "Q4":
                if not isinstance(node.get("value_scaled_1e4"), int):
                    typed_issues.append({**issue_base, "issue": "Q4_scaled_not_integer"})
                if "unit" not in node:
                    typed_issues.append({**issue_base, "issue": "Q4_missing_unit"})
            elif node_type == "BOOL":
                if not isinstance(node.get("value"), bool):
                    typed_issues.append({**issue_base, "issue": "BOOL_value_not_boolean"})
            elif node_type == "ENUM":
                if not isinstance(node.get("value"), str) or not node.get("value"):
                    typed_issues.append({**issue_base, "issue": "ENUM_value_not_string"})
            elif node_type == "HASH":
                if not re.fullmatch(r"[0-9a-f]{64}", str(node.get("value", ""))):
                    typed_issues.append({**issue_base, "issue": "HASH_not_lower_hex_sha256"})
            elif node_type == "REF":
                if not isinstance(node.get("value"), str) or not node.get("value"):
                    typed_issues.append({**issue_base, "issue": "REF_value_not_string"})
            elif node_type == "ARRAY":
                if node.get("ordered") is not True:
                    array_order_missing.append(issue_base)
                if not isinstance(node.get("element"), str):
                    typed_issues.append({**issue_base, "issue": "ARRAY_missing_element"})
                has_value = isinstance(node.get("value"), list)
                has_scaled = isinstance(node.get("value_scaled_1e4"), list)
                if not has_value and not has_scaled:
                    typed_issues.append({**issue_base, "issue": "ARRAY_missing_value_array"})
            elif node_type == "SET":
                values = node.get("value")
                if node.get("element") != "ENUM":
                    set_contract_issues.append({**issue_base, "issue": "SET_element_not_ENUM"})
                if node.get("unique") is not True:
                    set_contract_issues.append({**issue_base, "issue": "SET_unique_not_true"})
                if node.get("ordered") is not False:
                    set_contract_issues.append({**issue_base, "issue": "SET_ordered_not_false"})
                if not isinstance(values, list):
                    set_contract_issues.append({**issue_base, "issue": "SET_value_not_list"})
                else:
                    if len(values) != len(set(map(str, values))):
                        set_contract_issues.append({**issue_base, "issue": "SET_duplicates"})
                    if values != sorted(values):
                        set_contract_issues.append({**issue_base, "issue": "SET_not_lexical_order"})
            elif node_type == "FORMULA":
                src = node.get("src")
                ast = node.get("ast")
                if not isinstance(src, str) or not isinstance(ast, dict):
                    formula_issues.append({**issue_base, "issue": "FORMULA_missing_src_or_ast"})
                else:
                    variables: set[str] = set()
                    ops: set[str] = set()
                    formula_ast_find(ast, variables, ops)
                    unknown_vars = sorted(variables - FORMULA_VARIABLES)
                    unknown_ops = sorted(ops - FORMULA_OPS)
                    if unknown_vars:
                        formula_issues.append(
                            {**issue_base, "issue": "unknown_variables", "values": unknown_vars}
                        )
                    if unknown_ops:
                        formula_issues.append(
                            {**issue_base, "issue": "unknown_ops", "values": unknown_ops}
                        )
                    try:
                        compiled = FormulaParser(src).parse()
                        if compiled != ast:
                            formula_issues.append(
                                {
                                    **issue_base,
                                    "issue": "src_ast_mismatch",
                                    "compiled": compiled,
                                    "stored": ast,
                                }
                            )
                    except Exception as exc:
                        formula_issues.append(
                            {**issue_base, "issue": "src_parse_error", "error": str(exc)}
                        )

            unit = node.get("unit")
            if isinstance(unit, str):
                unit_counts[unit] += 1
                if unit not in DECLARED_UNITS | OBSERVED_DERIVED_UNITS:
                    typed_issues.append(
                        {**issue_base, "issue": "unit_outside_declared_contract", "unit": unit}
                    )

        walk_typed(payload, check_typed)

    matrix = parse_field_matrix(load_tsv(base / "table_124.tsv"))
    active_effect_counts: Counter[str] = Counter()
    active_matrix_issues: list[dict[str, Any]] = []
    for record in (r for r in records if r.kind == "active"):
        effect_node = record.payload.get("effect_type")
        effect_type = effect_node.get("value") if isinstance(effect_node, dict) else None
        active_effect_counts[str(effect_type)] += 1
        if effect_type not in matrix:
            active_matrix_issues.append(
                {"id": record.row_id, "effect_type": effect_type, "issue": "missing_matrix_row"}
            )
            continue
        actual_fields = set(record.payload) - {"schema_version", "payload_sha256"}
        required = matrix[effect_type]["required"]
        optional = matrix[effect_type]["optional"]
        missing = sorted(required - actual_fields)
        extra = sorted(actual_fields - required - optional)
        if missing or extra:
            active_matrix_issues.append(
                {
                    "id": record.row_id,
                    "effect_type": effect_type,
                    "missing": missing,
                    "extra": extra,
                }
            )

    expected_sets = {
        "active": {
            row[0] for row in load_tsv(base / "table_021.tsv")[1:] if row and row[0]
        },
        "passive": {
            row[0] for row in load_tsv(base / "table_022.tsv")[1:] if row and row[0]
        },
        "equipment": {
            row[0] for row in load_tsv(base / "table_024.tsv")[1:] if row and row[0]
        },
    }
    actual_sets: dict[str, set[str]] = defaultdict(set)
    for record in records:
        actual_sets[record.kind].add(record.row_id)
    projection_id_diffs = {}
    for kind, expected_ids in expected_sets.items():
        projection_id_diffs[kind] = {
            "summary_count": len(expected_ids),
            "payload_count": len(actual_sets[kind]),
            "missing_payload_ids": sorted(expected_ids - actual_sets[kind]),
            "extra_payload_ids": sorted(actual_sets[kind] - expected_ids),
        }

    duplicate_ids = {
        kind: sorted(
            row_id
            for row_id, count in Counter(
                record.row_id for record in records if record.kind == kind
            ).items()
            if count > 1
        )
        for kind in {record.kind for record in records}
    }

    return {
        "record_counts": dict(Counter(record.kind for record in records)),
        "total_records": len(records),
        "parse_errors": parse_errors,
        "hash_failures": hash_failures,
        "schema_failures": schema_failures,
        "id_failures": id_failures,
        "duplicate_ids": duplicate_ids,
        "type_counts": dict(type_counts.most_common()),
        "unit_counts": dict(unit_counts.most_common()),
        "typed_issues": typed_issues,
        "array_contract_violations": {
            "missing_ordered_true_count": len(array_order_missing),
            "items": array_order_missing,
        },
        "set_contract_violations": set_contract_issues,
        "formula_issues": formula_issues,
        "active_effect_matrix": {
            "declared_effect_type_count": len(matrix),
            "used_effect_type_count": len(active_effect_counts),
            "used_counts": dict(active_effect_counts.most_common()),
            "unused_declared_types": sorted(set(matrix) - set(active_effect_counts)),
            "issues": active_matrix_issues,
        },
        "projection_id_diffs": projection_id_diffs,
        "contract_note": {
            "declared_unit_list": sorted(DECLARED_UNITS),
            "derived_units_used_but_omitted_from_declared_unit_list": sorted(
                unit
                for unit in OBSERVED_DERIVED_UNITS
                if unit_counts[unit] > 0 and unit not in DECLARED_UNITS
            ),
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("tables_dir", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = audit_payloads(args.tables_dir.resolve())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    summary = {
        "record_counts": result["record_counts"],
        "total_records": result["total_records"],
        "parse_errors": len(result["parse_errors"]),
        "hash_failures": len(result["hash_failures"]),
        "schema_failures": len(result["schema_failures"]),
        "id_failures": len(result["id_failures"]),
        "typed_issues": len(result["typed_issues"]),
        "array_missing_ordered_true": result["array_contract_violations"][
            "missing_ordered_true_count"
        ],
        "set_contract_violations": len(result["set_contract_violations"]),
        "formula_issues": len(result["formula_issues"]),
        "active_effect_matrix_issues": len(
            result["active_effect_matrix"]["issues"]
        ),
        "out": str(args.out.resolve()),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
