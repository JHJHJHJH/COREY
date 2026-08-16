import assert from "node:assert/strict";
import test from "node:test";
import type {
  ViewerDataTableCell,
  ViewerDataTableColumn,
  ViewerDataTableData,
  ViewerValidationRunResult,
} from "@/features/viewer/types";
import {
  getMcpElements,
  prepareMcpDraftEdits,
  queryMcpElements,
  queryValidationIssues,
} from "@/features/viewer/mcp/query";

function value(raw: unknown, binding: ViewerDataTableCell["binding"]): ViewerDataTableCell {
  return {
    raw,
    text: String(raw),
    state: "present",
    source: "ifc",
    binding,
    valueKind:
      typeof raw === "number"
        ? "number"
        : typeof raw === "boolean"
          ? "boolean"
          : "string",
    original: null,
  };
}

const columns: ViewerDataTableColumn[] = [
  {
    key: "ifcType",
    label: "IFC Type",
    kind: "base",
    group: null,
    populatedRowCount: 2,
    editable: false,
    editableReason: "Read only",
    binding: { kind: "attribute", name: "type" },
    valueKind: "string",
    origin: "ifc",
    importHeader: null,
  },
  {
    key: "globalId",
    label: "GlobalId",
    kind: "base",
    group: null,
    populatedRowCount: 2,
    editable: false,
    editableReason: "Read only",
    binding: { kind: "attribute", name: "_guid" },
    valueKind: "string",
    origin: "ifc",
    importHeader: null,
  },
  {
    key: "name",
    label: "Name",
    kind: "base",
    group: null,
    populatedRowCount: 2,
    editable: true,
    editableReason: null,
    binding: { kind: "attribute", name: "Name" },
    valueKind: "string",
    origin: "ifc",
    importHeader: null,
  },
  {
    key: "property:Pset_WallCommon::FireRating",
    label: "FireRating",
    kind: "property",
    group: "Pset_WallCommon",
    populatedRowCount: 1,
    editable: true,
    editableReason: null,
    binding: { kind: "property", group: "Pset_WallCommon", label: "FireRating" },
    valueKind: "number",
    origin: "ifc",
    importHeader: null,
  },
];

const data: ViewerDataTableData = {
  columns,
  ifcTypes: ["IFCDOOR", "IFCWALL"],
  rows: [
    {
      key: "model:1",
      modelId: "model",
      localId: 1,
      ifcType: "IFCWALL",
      subtype: null,
      selection: { modelId: "model", localId: 1, label: "Wall A", category: "IFCWALL" },
      cells: {
        ifcType: value("IFCWALL", { kind: "attribute", name: "type" }),
        globalId: value("wall-guid", { kind: "attribute", name: "_guid" }),
        name: value("Wall A", { kind: "attribute", name: "Name" }),
        "property:Pset_WallCommon::FireRating": value(60, {
          kind: "property",
          group: "Pset_WallCommon",
          label: "FireRating",
        }),
      },
      searchText: "ifcwall wall a pset_wallcommon firerating 60",
    },
    {
      key: "model:2",
      modelId: "model",
      localId: 2,
      ifcType: "IFCDOOR",
      subtype: null,
      selection: { modelId: "model", localId: 2, label: "Door A", category: "IFCDOOR" },
      cells: {
        ifcType: value("IFCDOOR", { kind: "attribute", name: "type" }),
        globalId: value("door-guid", { kind: "attribute", name: "_guid" }),
        name: value("Door A", { kind: "attribute", name: "Name" }),
      },
      searchText: "ifcdoor door a",
    },
  ],
};

test("query filters by IFC type and numeric property", () => {
  const result = queryMcpElements({
    data,
    validation: null,
    revision: "r1",
    query: {
      ifcTypes: ["IFCWALL"],
      where: [
        {
          field: { kind: "property", group: "Pset_WallCommon", label: "FireRating" },
          operator: "gte",
          value: 60,
        },
      ],
    },
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.globalId, "wall-guid");
});

test("pagination cursors are rejected after a revision change", () => {
  const first = queryMcpElements({
    data,
    validation: null,
    revision: "r1",
    query: { limit: 1 },
  });
  assert.ok(first.nextCursor);
  assert.throws(
    () =>
      queryMcpElements({
        data,
        validation: null,
        revision: "r2",
        query: { cursor: first.nextCursor ?? undefined },
      }),
    /model changed/i,
  );
});

test("validation issue pagination works without a Node Buffer global", () => {
  const bufferDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
  Object.defineProperty(globalThis, "Buffer", {
    configurable: true,
    enumerable: false,
    writable: true,
    value: undefined,
  });

  try {
    const result: ViewerValidationRunResult = {
      sourceId: "source",
      failedClauseCount: 0,
      failedClauses: [],
      results: [
        { modelId: "model", localId: 1, result: "error", failedClauses: [] },
        { modelId: "model", localId: 2, result: "warn", failedClauses: [] },
      ],
    };
    const first = queryValidationIssues({ data, result, revision: "r1", limit: 1 });
    assert.equal(first.items[0]?.globalId, "wall-guid");
    assert.match(first.nextCursor ?? "", /^[A-Za-z0-9_-]+$/);

    const second = queryValidationIssues({
      data,
      result,
      revision: "r1",
      cursor: first.nextCursor ?? undefined,
      limit: 1,
    });
    assert.equal(second.items[0]?.globalId, "door-guid");
    assert.equal(second.nextCursor, null);
  } finally {
    if (bufferDescriptor) Object.defineProperty(globalThis, "Buffer", bufferDescriptor);
    else Reflect.deleteProperty(globalThis, "Buffer");
  }
});

test("element details use GlobalId and include normalized field bindings", () => {
  const result = getMcpElements({ data, validation: null, globalIds: ["wall-guid"] });
  assert.equal(result.items[0]?.found, true);
  assert.equal(
    result.items[0]?.found &&
      result.items[0].fields["property:Pset_WallCommon::FireRating"]?.value,
    60,
  );
});

test("draft edit batches are optimistic and atomic", () => {
  const prepared = prepareMcpDraftEdits({
    sourceId: "source",
    baseData: data,
    currentDraft: null,
    edits: [
      {
        globalId: "wall-guid",
        field: { kind: "property", group: "Pset_WallCommon", label: "FireRating" },
        expected: { state: "present", value: 60 },
        value: 90,
      },
    ],
  });
  assert.equal(prepared.draft?.edits[0]?.value.raw, 90);

  assert.throws(
    () =>
      prepareMcpDraftEdits({
        sourceId: "source",
        baseData: data,
        currentDraft: null,
        edits: [
          {
            globalId: "wall-guid",
            field: { kind: "property", group: "Pset_WallCommon", label: "FireRating" },
            expected: { state: "present", value: 30 },
            value: 90,
          },
        ],
      }),
    /conflict/i,
  );
});
