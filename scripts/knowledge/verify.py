#!/usr/bin/env python3
"""Acceptance checks for the deterministic CORNET X extraction artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DIR = ROOT / ".cache/knowledge/corenet-x-3.1"


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR)
    args = parser.parse_args()
    manifest = json.loads((args.dir / "manifest.json").read_text(encoding="utf-8"))
    documents = read_jsonl(args.dir / "documents.jsonl")
    evidence = read_jsonl(args.dir / "evidence.jsonl")
    chunks = read_jsonl(args.dir / "chunks.jsonl")
    nodes = read_jsonl(args.dir / "nodes.jsonl")
    warnings = read_jsonl(args.dir / "warnings.jsonl")

    require(manifest["schemaVersion"] == 1, "Unexpected artifact schema version.")
    require(manifest["embeddingDimensions"] == 1536, "Embedding dimensions must match pgvector.")
    require(len(documents) == 2, "Exactly two source snapshots must be present.")
    pdf = next(document for document in documents if document["sourceKind"] == "cop_pdf")
    workbook = next(document for document in documents if document["sourceKind"] == "industry_workbook")
    require(pdf["metadata"]["pageCount"] == 442, "COP page count changed.")
    require(pdf["metadata"]["internalLinkCount"] == 2564, "COP internal links changed.")
    require(pdf["metadata"]["externalLinkCount"] == 644, "COP external links changed.")
    require(workbook["metadata"]["mappingRowCount"] == 831, "Business mapping row count changed.")
    require(workbook["metadata"]["spaceValueRowCount"] == 1405, "Space Values row count changed.")
    require(workbook["metadata"]["changeLogEntryCount"] == 81, "Change Log entry count changed.")
    require(workbook["metadata"]["mappingHyperlinkRowCount"] == 10, "Mapping hyperlink count changed.")
    evidence_ids = {item["id"] for item in evidence}
    require(evidence_ids, "No source evidence was extracted.")
    require(
        all(set(chunk.get("evidenceIds", [])).issubset(evidence_ids) for chunk in chunks),
        "A chunk references missing evidence.",
    )
    require(all(chunk.get("evidenceIds") for chunk in chunks), "Every chunk must retain source evidence.")
    pdf_evidence = [item for item in evidence if item["locator"].get("page")]
    require(pdf_evidence, "No PDF evidence locators were extracted.")
    require(
        all(len(item["locator"].get("bbox", [])) == 4 for item in pdf_evidence),
        "Every PDF evidence locator must include a bounding box.",
    )
    workbook_evidence = [item for item in evidence if item["locator"].get("sheet")]
    require(workbook_evidence, "No workbook evidence locators were extracted.")
    require(
        all(item["metadata"].get("structuredFields") for item in workbook_evidence),
        "Every workbook evidence span must retain structured fields.",
    )

    mapping_chunks = [chunk for chunk in chunks if chunk["sourceRole"] == "mapping_guidance"]
    require(len(mapping_chunks) == 831, "Every declared mapping row must produce one chunk.")
    require(sum("S/N: 609" in chunk["content"] for chunk in mapping_chunks) == 2, "Duplicate S/N 609 must be retained.")
    require(not any("#REF!" in chunk["content"] for chunk in mapping_chunks), "Helper-column #REF! leaked into the corpus.")
    quarantined_rows = sorted(warning.get("row") for warning in warnings if warning.get("sheet") == "CX Pilot Mapping")
    require(quarantined_rows == [833, 834], "Unexpected mapping quarantine set.")

    requirement_tables = [
        chunk
        for chunk in chunks
        if chunk["sourceRole"] == "requirement" and chunk["metadata"].get("tableIndex") is not None
    ]
    require(requirement_tables, "No Section 3 requirement tables were extracted.")
    require(
        any(chunk["metadata"].get("disciplines") for chunk in requirement_tables),
        "No discipline color bands were associated with requirement tables.",
    )
    node_types = {node["nodeType"] for node in nodes}
    require(
        {"Document", "Section", "IdentifiedComponent", "IFCEntity", "Property", "ValueDomain", "AllowedValue"}.issubset(node_types),
        "The knowledge graph is missing required node types.",
    )
    print(
        json.dumps(
            {
                "revisionId": manifest["revisionId"],
                "evidence": len(evidence),
                "chunks": len(chunks),
                "nodes": len(nodes),
                "warnings": len(warnings),
                "status": "ok",
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
