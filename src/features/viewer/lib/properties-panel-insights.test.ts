import assert from "node:assert/strict";
import test from "node:test";

import type {
  ViewerElementInspection,
  ViewerInspectionGroup,
  ViewerInspectionRow,
  ViewerSelectionDetails,
} from "@/features/viewer/types";
import { buildPropertiesPanelViewModel } from "./properties-panel-insights.ts";

function makeRow(
  key: string,
  label: string,
  text: string,
  state: ViewerInspectionRow["value"]["state"] = "present",
): ViewerInspectionRow {
  return {
    key,
    label,
    target: null,
    value: {
      raw: text,
      text,
      state,
      validation: null,
    },
  };
}

function makeGroup(title: string, rows: ViewerInspectionRow[]): ViewerInspectionGroup {
  return {
    key: title,
    title,
    subtitle: "IFCPROPERTYSET",
    rows,
    issueCount: rows.reduce((count, row) => count + Number(row.value.state !== "present"), 0),
  };
}

function makeInspection(overrides: Partial<ViewerElementInspection> = {}): ViewerElementInspection {
  return {
    title: "Basic Wall:01",
    modelId: "model.ifc",
    localId: 42,
    summaryRows: [
      makeRow("type", "type", "IFCWALL"),
      makeRow("GlobalId", "GlobalId", "3hXx$abc"),
      makeRow("Name", "Name", "Basic Wall:01"),
      makeRow("Description", "Description", "", "empty"),
      makeRow("ObjectType", "ObjectType", "Exterior wall"),
    ],
    propertySets: [
      makeGroup("Pset_WallCommon", [
        makeRow("Reference", "Reference", "W-01"),
        makeRow("AcousticRating", "AcousticRating", "", "empty"),
      ]),
    ],
    issueCount: 1,
    validationSummary: null,
    graphContext: {
      directRelationshipCount: 3,
      childCount: 2,
      descendantCount: 7,
      depth: 4,
      parentLabel: "Level 2",
      parentCategory: "IFCBUILDINGSTOREY",
      isSearchMatch: true,
      searchQuery: "wall",
      matchCount: 12,
      activeMatchIndex: 1,
    },
    ...overrides,
  };
}

test("buildPropertiesPanelViewModel creates an insight-first summary and graph context", () => {
  const details: ViewerSelectionDetails = {
    selection: {
      modelId: "model.ifc",
      localId: 42,
      label: "Basic Wall:01",
      category: "IFCWALL",
    },
    inspection: makeInspection(),
    loading: false,
  };

  const model = buildPropertiesPanelViewModel(details, { showEmptyRows: false });

  assert.equal(model.summary.ifcClass, "IFCWALL");
  assert.equal(model.summary.title, "Basic Wall:01");
  assert.equal(model.summary.localIdLabel, "#42");
  assert.equal(model.graphContextRows.length, 5);
  assert.deepEqual(
    model.graphContextRows.map((row) => [row.label, row.value]),
    [
      ["Direct links", "3"],
      ["Parent container", "Level 2"],
      ["Visible children", "2"],
      ["Nested elements", "7"],
      ["Search status", 'Match 2 of 12 for "wall"'],
    ],
  );
});

test("buildPropertiesPanelViewModel hides empty summary and property rows by default", () => {
  const model = buildPropertiesPanelViewModel(
    {
      selection: {
        modelId: "model.ifc",
        localId: 42,
        label: "Basic Wall:01",
        category: "IFCWALL",
      },
      inspection: makeInspection(),
      loading: false,
    },
    { showEmptyRows: false },
  );

  assert.deepEqual(model.keyAttributeRows.map((row) => row.label), ["Name", "ObjectType"]);
  assert.deepEqual(model.rawAttributeRows.map((row) => row.label), ["GlobalId"]);
  assert.deepEqual(model.propertySets[0]?.rows.map((row) => row.label), ["Reference"]);
  assert.equal(model.hiddenEmptyRowCount, 2);
});

test("buildPropertiesPanelViewModel can reveal empty rows on demand", () => {
  const model = buildPropertiesPanelViewModel(
    {
      selection: {
        modelId: "model.ifc",
        localId: 42,
        label: "Basic Wall:01",
        category: "IFCWALL",
      },
      inspection: makeInspection(),
      loading: false,
    },
    { showEmptyRows: true },
  );

  assert.deepEqual(model.keyAttributeRows.map((row) => row.label), ["Name", "Description", "ObjectType"]);
  assert.deepEqual(model.propertySets[0]?.rows.map((row) => row.label), ["Reference", "AcousticRating"]);
  assert.equal(model.hiddenEmptyRowCount, 0);
});
