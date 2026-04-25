import cytoscape from "cytoscape";
import assert from "node:assert/strict";
import test from "node:test";

import type { ViewerGraphEdge, ViewerGraphNode } from "../types";
import { buildCompoundLayoutGraph, buildCompoundNodePositionOverrides } from "./graph-compounds.ts";


function makeNode(overrides: Partial<ViewerGraphNode> & Pick<ViewerGraphNode, "key" | "kind" | "label">): ViewerGraphNode {
  return {
    key: overrides.key,
    modelId: overrides.modelId ?? "model-1",
    localId: overrides.localId ?? null,
    rowKey: overrides.rowKey ?? null,
    kind: overrides.kind,
    label: overrides.label,
    category: overrides.category ?? null,
    depth: overrides.depth ?? 0,
    parentKey: overrides.parentKey ?? null,
    childKeys: overrides.childKeys ?? [],
    directChildCount: overrides.directChildCount ?? 0,
    descendantCount: overrides.descendantCount ?? 0,
    searchText: overrides.searchText ?? overrides.label,
  };
}

function makeEdge(sourceKey: string, targetKey: string): ViewerGraphEdge {
  return {
    key: `${sourceKey}->${targetKey}`,
    sourceKey,
    targetKey,
    relation: "contains",
  };
}

test("dense sibling sets create one compound per IFC class without rewriting layout edges", () => {
  const nodes: ViewerGraphNode[] = [
    makeNode({ key: "parent", kind: "spatial", label: "Storey", category: "IFCBUILDINGSTOREY", localId: 10, childKeys: ["wall-1", "wall-2", "slab-1"], directChildCount: 3 }),
    makeNode({ key: "wall-1", kind: "element", label: "Wall 1", category: "IFCWALL", localId: 101, parentKey: "parent" }),
    makeNode({ key: "wall-2", kind: "element", label: "Wall 2", category: "IFCWALL", localId: 102, parentKey: "parent" }),
    makeNode({ key: "slab-1", kind: "element", label: "Slab 1", category: "IFCSLAB", localId: 103, parentKey: "parent" }),
  ];
  const edges = [makeEdge("parent", "wall-1"), makeEdge("parent", "wall-2"), makeEdge("parent", "slab-1")];

  const result = buildCompoundLayoutGraph({ nodes, edges, denseChildThreshold: 2, collapsedGroupIds: new Set() });

  assert.deepEqual(
    result.groups.map((group) => ({ id: group.id, anchorNodeId: group.anchorNodeId, label: group.label, children: group.childNodeKeys })),
    [
      { id: "parent::compound::IFCSLAB", anchorNodeId: "parent::compound::IFCSLAB::anchor", label: "IFCSLAB", children: ["slab-1"] },
      { id: "parent::compound::IFCWALL", anchorNodeId: "parent::compound::IFCWALL::anchor", label: "IFCWALL", children: ["wall-1", "wall-2"] },
    ],
  );

  assert.equal(result.nodeKeyToCompoundId.get("wall-1"), "parent::compound::IFCWALL");
  assert.equal(result.nodeKeyToCompoundId.get("wall-2"), "parent::compound::IFCWALL");
  assert.equal(result.nodeKeyToCompoundId.get("slab-1"), "parent::compound::IFCSLAB");

  assert.deepEqual(
    result.layoutEdges.map((edge) => [edge.sourceKey, edge.targetKey]),
    [
      ["parent", "parent::compound::IFCSLAB::anchor"],
      ["parent", "parent::compound::IFCWALL::anchor"],
      ["parent", "wall-1"],
      ["parent", "wall-2"],
      ["parent", "slab-1"],
    ],
  );
});

test("compound grouping remains compatible with Cytoscape breadthfirst layout", () => {
  const nodes: ViewerGraphNode[] = [
    makeNode({ key: "parent", kind: "spatial", label: "Storey", category: "IFCBUILDINGSTOREY", localId: 10, childKeys: ["wall-1", "wall-2", "slab-1"], directChildCount: 3 }),
    makeNode({ key: "wall-1", kind: "element", label: "Wall 1", category: "IFCWALL", localId: 101, parentKey: "parent" }),
    makeNode({ key: "wall-2", kind: "element", label: "Wall 2", category: "IFCWALL", localId: 102, parentKey: "parent" }),
    makeNode({ key: "slab-1", kind: "element", label: "Slab 1", category: "IFCSLAB", localId: 103, parentKey: "parent" }),
  ];
  const edges = [makeEdge("parent", "wall-1"), makeEdge("parent", "wall-2"), makeEdge("parent", "slab-1")];
  const result = buildCompoundLayoutGraph({ nodes, edges, denseChildThreshold: 2, collapsedGroupIds: new Set() });

  const elements = [
    ...result.groups.map((group) => ({ data: { id: group.id } })),
    ...result.groups.map((group) => ({ data: { id: group.anchorNodeId } })),
    ...nodes.map((node) => ({ data: { id: node.key, parent: result.nodeKeyToCompoundId.get(node.key) } })),
    ...result.layoutEdges.map((edge) => ({ data: { id: edge.key, source: edge.sourceKey, target: edge.targetKey } })),
  ];

  const cy = cytoscape({ elements, headless: true });

  assert.doesNotThrow(() => {
    cy.layout({ name: "breadthfirst", directed: true, animate: false }).run();
  });
});

test("collapsed compound groups hide their member nodes and edges while keeping the group container connected", () => {
  const nodes: ViewerGraphNode[] = [
    makeNode({ key: "parent", kind: "spatial", label: "Storey", category: "IFCBUILDINGSTOREY", localId: 10, childKeys: ["wall-1", "wall-2", "slab-1"], directChildCount: 3 }),
    makeNode({ key: "wall-1", kind: "element", label: "Wall 1", category: "IFCWALL", localId: 101, parentKey: "parent" }),
    makeNode({ key: "wall-2", kind: "element", label: "Wall 2", category: "IFCWALL", localId: 102, parentKey: "parent" }),
    makeNode({ key: "slab-1", kind: "element", label: "Slab 1", category: "IFCSLAB", localId: 103, parentKey: "parent" }),
  ];
  const edges = [makeEdge("parent", "wall-1"), makeEdge("parent", "wall-2"), makeEdge("parent", "slab-1")];

  const result = buildCompoundLayoutGraph({
    nodes,
    edges,
    denseChildThreshold: 2,
    collapsedGroupIds: new Set(["parent::compound::IFCWALL"]),
  });

  assert.deepEqual(result.visibleNodes.map((node) => node.key), ["parent", "slab-1"]);
  assert.deepEqual(result.groups.map((group) => group.id), ["parent::compound::IFCSLAB", "parent::compound::IFCWALL"]);
  assert.deepEqual(
    result.layoutEdges.map((edge) => [edge.sourceKey, edge.targetKey]),
    [
      ["parent", "parent::compound::IFCSLAB::anchor"],
      ["parent", "parent::compound::IFCWALL::anchor"],
      ["parent", "slab-1"],
    ],
  );
});

test("collapsed compound groups remain compatible with Cytoscape breadthfirst layout", () => {
  const nodes: ViewerGraphNode[] = [
    makeNode({ key: "parent", kind: "spatial", label: "Storey", category: "IFCBUILDINGSTOREY", localId: 10, childKeys: ["wall-1", "wall-2", "slab-1"], directChildCount: 3 }),
    makeNode({ key: "wall-1", kind: "element", label: "Wall 1", category: "IFCWALL", localId: 101, parentKey: "parent" }),
    makeNode({ key: "wall-2", kind: "element", label: "Wall 2", category: "IFCWALL", localId: 102, parentKey: "parent" }),
    makeNode({ key: "slab-1", kind: "element", label: "Slab 1", category: "IFCSLAB", localId: 103, parentKey: "parent" }),
  ];
  const edges = [makeEdge("parent", "wall-1"), makeEdge("parent", "wall-2"), makeEdge("parent", "slab-1")];
  const result = buildCompoundLayoutGraph({
    nodes,
    edges,
    denseChildThreshold: 2,
    collapsedGroupIds: new Set(["parent::compound::IFCWALL"]),
  });

  const elements = [
    ...result.groups.map((group) => ({ data: { id: group.id } })),
    ...result.groups.map((group) => ({ data: { id: group.anchorNodeId, parent: group.id } })),
    ...result.visibleNodes.map((node) => ({ data: { id: node.key, parent: result.nodeKeyToCompoundId.get(node.key) } })),
    ...result.layoutEdges.map((edge) => ({ data: { id: edge.key, source: edge.sourceKey, target: edge.targetKey } })),
  ];

  const cy = cytoscape({ elements, headless: true });

  assert.doesNotThrow(() => {
    cy.layout({ name: "breadthfirst", directed: true, animate: false }).run();
  });
});

test("non-dense sibling sets keep original edges and do not create compounds", () => {
  const nodes: ViewerGraphNode[] = [
    makeNode({ key: "parent", kind: "spatial", label: "Storey", category: "IFCBUILDINGSTOREY", localId: 10, childKeys: ["wall-1", "slab-1"], directChildCount: 2 }),
    makeNode({ key: "wall-1", kind: "element", label: "Wall 1", category: "IFCWALL", localId: 101, parentKey: "parent" }),
    makeNode({ key: "slab-1", kind: "element", label: "Slab 1", category: "IFCSLAB", localId: 103, parentKey: "parent" }),
  ];
  const edges = [makeEdge("parent", "wall-1"), makeEdge("parent", "slab-1")];

  const result = buildCompoundLayoutGraph({ nodes, edges, denseChildThreshold: 2, collapsedGroupIds: new Set() });

  assert.equal(result.groups.length, 0);
  assert.equal(result.nodeKeyToCompoundId.size, 0);
  assert.deepEqual(
    result.layoutEdges.map((edge) => [edge.sourceKey, edge.targetKey]),
    [
      ["parent", "wall-1"],
      ["parent", "slab-1"],
    ],
  );
});

test("buildCompoundNodePositionOverrides repacks nested compound groups relative to moved parent subtrees", () => {
  const nodes: ViewerGraphNode[] = [
    makeNode({
      key: "root",
      kind: "spatial",
      label: "Root",
      category: "IFCPROJECT",
      localId: 1,
      childKeys: ["parent-a", "parent-b", "parent-c"],
      directChildCount: 3,
    }),
    makeNode({
      key: "parent-a",
      kind: "element",
      label: "Parent A",
      category: "IFCBEAM",
      localId: 10,
      parentKey: "root",
      childKeys: ["leaf-a1", "leaf-a2", "leaf-a3"],
      directChildCount: 3,
    }),
    makeNode({
      key: "parent-b",
      kind: "element",
      label: "Parent B",
      category: "IFCBEAM",
      localId: 11,
      parentKey: "root",
      childKeys: ["leaf-b1", "leaf-b2", "leaf-b3"],
      directChildCount: 3,
    }),
    makeNode({
      key: "parent-c",
      kind: "element",
      label: "Parent C",
      category: "IFCBEAM",
      localId: 12,
      parentKey: "root",
      childKeys: ["leaf-c1", "leaf-c2", "leaf-c3"],
      directChildCount: 3,
    }),
    makeNode({ key: "leaf-a1", kind: "element", label: "Leaf A1", category: "IFCWALL", localId: 21, parentKey: "parent-a" }),
    makeNode({ key: "leaf-a2", kind: "element", label: "Leaf A2", category: "IFCWALL", localId: 22, parentKey: "parent-a" }),
    makeNode({ key: "leaf-a3", kind: "element", label: "Leaf A3", category: "IFCWALL", localId: 23, parentKey: "parent-a" }),
    makeNode({ key: "leaf-b1", kind: "element", label: "Leaf B1", category: "IFCWALL", localId: 24, parentKey: "parent-b" }),
    makeNode({ key: "leaf-b2", kind: "element", label: "Leaf B2", category: "IFCWALL", localId: 25, parentKey: "parent-b" }),
    makeNode({ key: "leaf-b3", kind: "element", label: "Leaf B3", category: "IFCWALL", localId: 26, parentKey: "parent-b" }),
    makeNode({ key: "leaf-c1", kind: "element", label: "Leaf C1", category: "IFCWALL", localId: 27, parentKey: "parent-c" }),
    makeNode({ key: "leaf-c2", kind: "element", label: "Leaf C2", category: "IFCWALL", localId: 28, parentKey: "parent-c" }),
    makeNode({ key: "leaf-c3", kind: "element", label: "Leaf C3", category: "IFCWALL", localId: 29, parentKey: "parent-c" }),
  ];

  const result = buildCompoundNodePositionOverrides({
    groups: [
      {
        id: "root::compound::IFCBEAM",
        anchorNodeId: "root::compound::IFCBEAM::anchor",
        label: "IFCBEAM",
        childNodeKeys: ["parent-a", "parent-b", "parent-c"],
        parentNodeKey: "root",
      },
      {
        id: "parent-a::compound::IFCWALL",
        anchorNodeId: "parent-a::compound::IFCWALL::anchor",
        label: "IFCWALL",
        childNodeKeys: ["leaf-a1", "leaf-a2", "leaf-a3"],
        parentNodeKey: "parent-a",
      },
    ],
    visibleNodes: nodes,
    nodePositions: new Map([
      ["root::compound::IFCBEAM::anchor", { x: 300, y: 100 }],
      ["parent-a::compound::IFCWALL::anchor", { x: 100, y: 200 }],
      ["parent-a", { x: 40, y: 30 }],
      ["parent-b", { x: 80, y: 30 }],
      ["parent-c", { x: 120, y: 30 }],
      ["leaf-a1", { x: 20, y: 260 }],
      ["leaf-a2", { x: 40, y: 260 }],
      ["leaf-a3", { x: 60, y: 260 }],
      ["leaf-b1", { x: 80, y: 260 }],
      ["leaf-b2", { x: 100, y: 260 }],
      ["leaf-b3", { x: 120, y: 260 }],
      ["leaf-c1", { x: 140, y: 260 }],
      ["leaf-c2", { x: 160, y: 260 }],
      ["leaf-c3", { x: 180, y: 260 }],
    ]),
  });

  assert.deepEqual(result.get("parent-a"), { x: 192, y: 178 });
  assert.deepEqual(result.get("parent-a::compound::IFCWALL::anchor"), { x: 252, y: 348 });
  assert.deepEqual(result.get("leaf-a1"), { x: 144, y: 426 });
  assert.deepEqual(result.get("leaf-a2"), { x: 252, y: 426 });
  assert.deepEqual(result.get("leaf-a3"), { x: 360, y: 426 });
});
