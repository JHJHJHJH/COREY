import assert from "node:assert/strict";
import test from "node:test";
import type {
  ViewerDataTableCell,
  ViewerDataTableColumn,
  ViewerDataTableData,
} from "@/features/viewer/types";
import {
  getMcpElements,
  listMcpFields,
  prepareMcpDraftEdits,
  queryMcpElements,
} from "@/features/viewer/mcp/query";
import { listMcpSpatialChildren } from "@/features/viewer/mcp/spatial";
import type { CoreyMcpSpatialIndex } from "@/features/viewer/mcp/contracts";

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

const spatial: CoreyMcpSpatialIndex = {
  roots: ["storey-guid"],
  children: { "storey-guid": ["wall-guid"], "wall-guid": [], "door-guid": [] },
  nodes: {
    "storey-guid": {
      globalId: "storey-guid",
      expressId: 10,
      ifcType: "IFCBUILDINGSTOREY",
      name: "Level 1",
      parentGlobalId: null,
      relation: null,
      childCount: 1,
      hasGeometry: false,
    },
    "wall-guid": {
      globalId: "wall-guid",
      expressId: 1,
      ifcType: "IFCWALL",
      name: "Wall A",
      parentGlobalId: "storey-guid",
      relation: "contains",
      childCount: 0,
      hasGeometry: true,
    },
    "door-guid": {
      globalId: "door-guid",
      expressId: 2,
      ifcType: "IFCDOOR",
      name: "Door A",
      parentGlobalId: null,
      relation: null,
      childCount: 0,
      hasGeometry: true,
    },
  },
};

test("query filters by IFC type, numeric property, and spatial ancestor", () => {
  const result = queryMcpElements({
    data,
    validation: null,
    spatial,
    revision: "r1",
    query: {
      ifcTypes: ["IFCWALL"],
      withinGlobalIds: ["storey-guid"],
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

test("element details include normalized field bindings", () => {
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

test("base-column bindings are discoverable and editable by their IFC attribute name", () => {
  assert.ok(
    listMcpFields(data).some(
      (field) => field.field.kind === "attribute" && field.field.name === "Name",
    ),
  );
  const prepared = prepareMcpDraftEdits({
    sourceId: "source",
    baseData: data,
    currentDraft: null,
    edits: [
      {
        globalId: "wall-guid",
        field: { kind: "attribute", name: "Name" },
        expected: { state: "present", value: "Wall A" },
        value: "Wall B",
      },
    ],
  });
  assert.equal(prepared.draft?.edits[0]?.columnKey, "name");
  assert.equal(prepared.draft?.edits[0]?.value.raw, "Wall B");
});

test("spatial children are paginated and parent-validated", () => {
  const result = listMcpSpatialChildren({
    spatial,
    parentGlobalId: "storey-guid",
    revision: "r1",
    limit: 1,
  });
  assert.equal(result.items[0]?.globalId, "wall-guid");
  assert.throws(
    () =>
      listMcpSpatialChildren({
        spatial,
        parentGlobalId: "missing",
        revision: "r1",
      }),
    /not found/i,
  );
});
