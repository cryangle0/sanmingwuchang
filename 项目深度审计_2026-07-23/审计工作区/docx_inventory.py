from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import zipfile
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

from docx import Document
from docx.document import Document as DocumentType
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from lxml import etree
from PIL import Image


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W_NS}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clean_text(value: str) -> str:
    value = value.replace("\r", "\n")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def paragraph_text(paragraph: Paragraph) -> str:
    return clean_text(paragraph.text)


def cell_text(cell: Any) -> str:
    return clean_text("\n".join(p.text for p in cell.paragraphs))


def iter_block_items(document: DocumentType) -> Iterable[Paragraph | Table]:
    parent = document.element.body
    for child in parent.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, document)
        elif child.tag == qn("w:tbl"):
            yield Table(child, document)


def write_tsv(path: Path, rows: Iterable[Iterable[Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerows(rows)


def visible_para_xml_text(element: etree._Element) -> str:
    parts: list[str] = []
    for node in element.xpath(".//w:t | .//w:tab | .//w:br", namespaces=NS):
        if node.tag == f"{{{W_NS}}}t":
            parts.append(node.text or "")
        elif node.tag == f"{{{W_NS}}}tab":
            parts.append("\t")
        else:
            parts.append("\n")
    return clean_text("".join(parts))


def inspect_package(docx_path: Path) -> dict[str, Any]:
    result: dict[str, Any] = {}
    with zipfile.ZipFile(docx_path) as archive:
        names = archive.namelist()
        result["part_count"] = len(names)
        result["parts"] = sorted(names)
        result["comments_present"] = any(
            name in names for name in ("word/comments.xml", "word/commentsExtended.xml")
        )
        result["footnotes_present"] = "word/footnotes.xml" in names
        result["endnotes_present"] = "word/endnotes.xml" in names
        result["custom_xml_parts"] = sorted(
            name for name in names if name.startswith("customXml/")
        )
        result["embedded_objects"] = sorted(
            name for name in names if name.startswith("word/embeddings/")
        )
        result["media"] = []
        for name in sorted(n for n in names if n.startswith("word/media/")):
            data = archive.read(name)
            media: dict[str, Any] = {
                "part": name,
                "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(),
            }
            try:
                import io

                with Image.open(io.BytesIO(data)) as image:
                    media.update(
                        {
                            "format": image.format,
                            "width": image.width,
                            "height": image.height,
                            "mode": image.mode,
                        }
                    )
            except Exception as exc:
                media["image_error"] = str(exc)
            result["media"].append(media)

        document_xml = archive.read("word/document.xml")
        root = etree.fromstring(document_xml)
        result["xml_counts"] = {
            "paragraphs_all": len(root.xpath(".//w:p", namespaces=NS)),
            "tables_all": len(root.xpath(".//w:tbl", namespaces=NS)),
            "rows_all": len(root.xpath(".//w:tr", namespaces=NS)),
            "cells_all": len(root.xpath(".//w:tc", namespaces=NS)),
            "text_nodes": len(root.xpath(".//w:t", namespaces=NS)),
            "drawings": len(root.xpath(".//w:drawing", namespaces=NS)),
            "legacy_pict": len(root.xpath(".//w:pict", namespaces=NS)),
            "alt_chunks": len(root.xpath(".//w:altChunk", namespaces=NS)),
            "content_controls": len(root.xpath(".//w:sdt", namespaces=NS)),
            "insertions": len(root.xpath(".//w:ins", namespaces=NS)),
            "deletions": len(root.xpath(".//w:del", namespaces=NS)),
            "comment_ranges": len(root.xpath(".//w:commentRangeStart", namespaces=NS)),
            "bookmarks": len(root.xpath(".//w:bookmarkStart", namespaces=NS)),
            "hyperlinks": len(root.xpath(".//w:hyperlink", namespaces=NS)),
            "fields": len(root.xpath(".//w:fldSimple | .//w:instrText", namespaces=NS)),
        }

        body = root.find("w:body", namespaces=NS)
        direct_counts = Counter(
            etree.QName(child).localname for child in body if isinstance(child.tag, str)
        )
        result["body_direct_children"] = dict(sorted(direct_counts.items()))

        all_para_texts = [
            visible_para_xml_text(node)
            for node in root.xpath(".//w:p", namespaces=NS)
        ]
        result["xml_nonempty_paragraphs"] = sum(bool(text) for text in all_para_texts)

        for props_name in ("docProps/core.xml", "docProps/app.xml", "docProps/custom.xml"):
            if props_name in names:
                props_root = etree.fromstring(archive.read(props_name))
                result[props_name] = clean_text(" | ".join(props_root.itertext()))
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("docx", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    docx_path = args.docx.resolve()
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    document = Document(docx_path)
    package = inspect_package(docx_path)

    paragraph_rows: list[list[Any]] = [
        ["paragraph_index", "block_index", "style", "text"]
    ]
    block_rows: list[list[Any]] = [
        [
            "block_index",
            "kind",
            "item_index",
            "style_or_shape",
            "preceding_context",
            "text_or_preview",
        ]
    ]
    table_index_rows: list[list[Any]] = [
        [
            "table_index",
            "block_index",
            "rows",
            "columns_max",
            "preceding_context",
            "header_preview",
            "cell_count",
        ]
    ]
    body_lines: list[str] = []
    tables_json: list[dict[str, Any]] = []
    recent_nonempty: list[str] = []
    paragraph_index = 0
    table_index = 0

    for block_index, block in enumerate(iter_block_items(document), start=1):
        if isinstance(block, Paragraph):
            paragraph_index += 1
            text = paragraph_text(block)
            style = block.style.name if block.style is not None else ""
            paragraph_rows.append([paragraph_index, block_index, style, text])
            block_rows.append(
                [block_index, "paragraph", paragraph_index, style, "", text]
            )
            if text:
                recent_nonempty.append(text)
                recent_nonempty = recent_nonempty[-4:]
                body_lines.append(f"[P{paragraph_index:03d} | {style}] {text}")
            else:
                body_lines.append(f"[P{paragraph_index:03d} | {style}]")
        else:
            table_index += 1
            context = " || ".join(recent_nonempty[-3:])
            rows = [[cell_text(cell) for cell in row.cells] for row in block.rows]
            max_cols = max((len(row) for row in rows), default=0)
            cell_count = sum(len(row) for row in rows)
            preview = " | ".join(rows[0])[:500] if rows else ""
            table_index_rows.append(
                [
                    table_index,
                    block_index,
                    len(rows),
                    max_cols,
                    context,
                    preview,
                    cell_count,
                ]
            )
            block_rows.append(
                [
                    block_index,
                    "table",
                    table_index,
                    f"{len(rows)}x{max_cols}",
                    context,
                    preview,
                ]
            )
            write_tsv(
                out_dir / "tables" / f"table_{table_index:03d}.tsv",
                rows,
            )
            tables_json.append(
                {
                    "table_index": table_index,
                    "block_index": block_index,
                    "rows": rows,
                    "preceding_context": recent_nonempty[-4:],
                }
            )
            body_lines.append(
                f"\n[TABLE {table_index:03d} | {len(rows)}x{max_cols} | {context}]"
            )
            for row in rows:
                body_lines.append(" || ".join(row))
            body_lines.append(f"[END TABLE {table_index:03d}]\n")

    styles = Counter(
        row[2] for row in paragraph_rows[1:] if row[2]
    )
    heading_rows = [
        row
        for row in paragraph_rows[1:]
        if str(row[2]).lower().startswith("heading")
        or re.match(r"^(appendix|annex|附录|第[一二三四五六七八九十0-9]+[章节篇])", str(row[3]), re.I)
    ]

    metadata: dict[str, Any] = {
        "source": str(docx_path),
        "bytes": docx_path.stat().st_size,
        "sha256": sha256_file(docx_path),
        "direct_body_paragraphs": paragraph_index,
        "direct_body_tables": table_index,
        "inline_shapes": len(document.inline_shapes),
        "sections": len(document.sections),
        "style_counts": dict(styles.most_common()),
        "headings": [
            {
                "paragraph_index": row[0],
                "block_index": row[1],
                "style": row[2],
                "text": row[3],
            }
            for row in heading_rows
        ],
        "package": package,
    }

    write_tsv(out_dir / "paragraphs.tsv", paragraph_rows)
    write_tsv(out_dir / "document_order.tsv", block_rows)
    write_tsv(out_dir / "table_index.tsv", table_index_rows)
    (out_dir / "body_order.txt").write_text(
        "\n".join(body_lines), encoding="utf-8"
    )
    (out_dir / "tables.json").write_text(
        json.dumps(tables_json, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (out_dir / "inventory.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(json.dumps(
        {
            "source": str(docx_path),
            "sha256": metadata["sha256"],
            "direct_body_paragraphs": paragraph_index,
            "direct_body_tables": table_index,
            "xml_counts": package["xml_counts"],
            "out": str(out_dir),
        },
        ensure_ascii=False,
        indent=2,
    ))


if __name__ == "__main__":
    main()
