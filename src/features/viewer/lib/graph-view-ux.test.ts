import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGraphFocusContext,
  buildSelectionGraphContext,
  getAdaptiveLabelVisibility,
  getGraphPanDelta,
  getGraphSearchSummary,
  getOrderedVisibleMatchedNodeKeys,
  getSparseOverviewTuning,
  getWrappedMatchIndex,
  resolveActiveMatchNodeKey,
} from "./graph-view-ux.ts";

test("getAdaptiveLabelVisibility keeps all labels in sparse overview mode", () => {
  assert.deepEqual(
    getAdaptiveLabelVisibility({
      nodeKeys: ["root", "wall-1"],
      sparseOverview: true,
      searchActive: false,
      focusNodeKey: null,
      deemphasizedNodeKeys: new Set(),
      selectedPathKeys: new Set(),
    }),
    {
      priorityLabelNodeKeys: new Set<string>(),
      suppressedLabelNodeKeys: new Set<string>(),
    },
  );
});

test("getAdaptiveLabelVisibility suppresses low-priority labels in focused graphs", () => {
  const result = getAdaptiveLabelVisibility({
    nodeKeys: ["root", "wall-1", "wall-2", "door-1"],
    sparseOverview: false,
    searchActive: true,
    focusNodeKey: "wall-1",
    deemphasizedNodeKeys: new Set(["door-1"]),
    selectedPathKeys: new Set(["root", "wall-1"]),
  });

  assert.deepEqual([...result.priorityLabelNodeKeys].sort(), ["root", "wall-1"].sort());
  assert.deepEqual([...result.suppressedLabelNodeKeys], ["door-1"]);
});

test("getSparseOverviewTuning tightens sparse ungrouped overview graphs", () => {
  assert.deepEqual(
    getSparseOverviewTuning({
      visibleNodeCount: 4,
      hasCompoundGroups: false,
      searchActive: false,
      focusNodeKey: null,
    }),
    {
      isSparseOverview: true,
      fitPadding: 28,
      breadthfirstSpacingFactor: 0.82,
    },
  );
});

test("getSparseOverviewTuning keeps normal layout when search or focus is active", () => {
  assert.deepEqual(
    getSparseOverviewTuning({
      visibleNodeCount: 4,
      hasCompoundGroups: false,
      searchActive: true,
      focusNodeKey: null,
    }),
    {
      isSparseOverview: false,
      fitPadding: 56,
      breadthfirstSpacingFactor: 1.05,
    },
  );

  assert.deepEqual(
    getSparseOverviewTuning({
      visibleNodeCount: 4,
      hasCompoundGroups: false,
      searchActive: false,
      focusNodeKey: "wall-1",
    }),
    {
      isSparseOverview: false,
      fitPadding: 56,
      breadthfirstSpacingFactor: 1.05,
    },
  );
});

test("getSparseOverviewTuning keeps grouped graphs on normal layout defaults", () => {
  assert.deepEqual(
    getSparseOverviewTuning({
      visibleNodeCount: 4,
      hasCompoundGroups: true,
      searchActive: false,
      focusNodeKey: null,
    }),
    {
      isSparseOverview: false,
      fitPadding: 56,
      breadthfirstSpacingFactor: 1.05,
    },
  );
});

test("getGraphPanDelta returns bounded viewport-relative pan distances for drag controls", () => {
  assert.deepEqual(
    getGraphPanDelta({
      direction: "left",
      viewportWidth: 1200,
      viewportHeight: 800,
    }),
    { x: -216, y: 0 },
  );

  assert.deepEqual(
    getGraphPanDelta({
      direction: "up",
      viewportWidth: 1200,
      viewportHeight: 800,
    }),
    { x: 0, y: -144 },
  );

  assert.deepEqual(
    getGraphPanDelta({
      direction: "right",
      viewportWidth: 200,
      viewportHeight: 180,
    }),
    { x: 80, y: 0 },
  );

  assert.deepEqual(
    getGraphPanDelta({
      direction: "down",
      viewportWidth: 4000,
      viewportHeight: 3000,
    }),
    { x: 0, y: 220 },
  );
});

test("buildGraphFocusContext keeps selected node and direct neighbors emphasized", () => {
  const context = buildGraphFocusContext({
    nodeKeys: ["root", "wall-1", "wall-2", "door-1"],
    edges: [
      { sourceKey: "root", targetKey: "wall-1" },
      { sourceKey: "wall-1", targetKey: "wall-2" },
    ],
    focusNodeKey: "wall-1",
  });

  assert.deepEqual([...context.contextNodeKeys].sort(), ["root", "wall-1", "wall-2"].sort());
  assert.deepEqual([...context.deemphasizedNodeKeys], ["door-1"]);
});

test("buildSelectionGraphContext derives parent and search metadata for the selected node", () => {
  const context = buildSelectionGraphContext({
    nodes: [
      {
        key: "storey-1",
        modelId: "model.ifc",
        localId: 10,
        rowKey: null,
        kind: "spatial",
        label: "Level 2",
        category: "IFCBUILDINGSTOREY",
        depth: 2,
        parentKey: "building-1",
        childKeys: ["wall-1"],
        directChildCount: 1,
        descendantCount: 6,
        searchText: "level 2",
      },
      {
        key: "wall-1",
        modelId: "model.ifc",
        localId: 42,
        rowKey: null,
        kind: "element",
        label: "Basic Wall:01",
        category: "IFCWALL",
        depth: 3,
        parentKey: "storey-1",
        childKeys: ["door-1", "window-1"],
        directChildCount: 2,
        descendantCount: 7,
        searchText: "basic wall 01",
      },
      {
        key: "door-1",
        modelId: "model.ifc",
        localId: 99,
        rowKey: null,
        kind: "element",
        label: "Door 01",
        category: "IFCDOOR",
        depth: 4,
        parentKey: "wall-1",
        childKeys: [],
        directChildCount: 0,
        descendantCount: 0,
        searchText: "door 01",
      },
      {
        key: "window-1",
        modelId: "model.ifc",
        localId: 100,
        rowKey: null,
        kind: "element",
        label: "Window 01",
        category: "IFCWINDOW",
        depth: 4,
        parentKey: "wall-1",
        childKeys: [],
        directChildCount: 0,
        descendantCount: 0,
        searchText: "window 01",
      },
    ],
    selectedLocalId: 42,
    matchedNodeKeys: new Set(["wall-1", "window-1"]),
    orderedMatchedNodeKeys: ["window-1", "wall-1"],
    activeMatchNodeKey: "wall-1",
    searchQuery: "wall",
  });

  assert.deepEqual(context, {
    directRelationshipCount: 3,
    childCount: 2,
    descendantCount: 7,
    depth: 3,
    parentLabel: "Level 2",
    parentCategory: "IFCBUILDINGSTOREY",
    isSearchMatch: true,
    searchQuery: "wall",
    matchCount: 2,
    activeMatchIndex: 1,
  });
});

test("getGraphSearchSummary returns active match details when matches exist", () => {
  assert.deepEqual(
    getGraphSearchSummary({ query: "wall", matchCount: 180, activeMatchIndex: 0 }),
    {
      label: '180 matches for "wall"',
      detail: 'Viewing match 1 of 180',
    },
  );
});

test("getGraphSearchSummary returns no-match details when query has no matches", () => {
  assert.deepEqual(
    getGraphSearchSummary({ query: "xyz", matchCount: 0, activeMatchIndex: -1 }),
    {
      label: 'No matches for "xyz"',
      detail: "Try IFC class, local ID, or partial element name.",
    },
  );
});

test("getOrderedVisibleMatchedNodeKeys preserves visible graph order for matches", () => {
  const ordered = getOrderedVisibleMatchedNodeKeys(
    [{ key: "root" }, { key: "wall-2" }, { key: "wall-1" }, { key: "door-1" }],
    new Set(["wall-1", "wall-2", "missing"]),
  );

  assert.deepEqual(ordered, ["wall-2", "wall-1"]);
});

test("getWrappedMatchIndex wraps forward and backward through match results", () => {
  assert.equal(getWrappedMatchIndex({ currentIndex: 0, totalCount: 3, direction: 1 }), 1);
  assert.equal(getWrappedMatchIndex({ currentIndex: 2, totalCount: 3, direction: 1 }), 0);
  assert.equal(getWrappedMatchIndex({ currentIndex: 0, totalCount: 3, direction: -1 }), 2);
});

test("resolveActiveMatchNodeKey keeps current active match when still visible", () => {
  assert.equal(resolveActiveMatchNodeKey(["wall-1", "wall-2"], "wall-2"), "wall-2");
});

test("resolveActiveMatchNodeKey falls back to first match when current key disappears", () => {
  assert.equal(resolveActiveMatchNodeKey(["wall-1", "wall-2"], "missing"), "wall-1");
});

test("resolveActiveMatchNodeKey returns null when there are no matches", () => {
  assert.equal(resolveActiveMatchNodeKey([], "wall-1"), null);
});
