import cytoscape from "cytoscape";
import assert from "node:assert/strict";
import test from "node:test";

import type { ViewerGraphEdge, ViewerGraphNode } from "../types";
import { buildCompoundLayoutGraph } from "./graph-compounds.ts";

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
