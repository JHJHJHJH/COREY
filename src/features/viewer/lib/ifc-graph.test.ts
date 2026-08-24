import assert from "node:assert/strict";
import test from "node:test";
import {
  buildViewerGraphEdge,
  classifyViewerGraphNode,
  flattenViewerGraphRelations,
  mergeViewerGraphEdge,
  mergeViewerGraphNeighborhood,
  paginateViewerGraphRelations,
  viewerGraphNodeId,
} from "./ifc-graph";
import type { ViewerGraphNeighborhood, ViewerGraphNode } from "../types";

function graphNode(localId: number): ViewerGraphNode {
  return {
    id: viewerGraphNodeId("model", localId),
    modelId: "model",
    localId,
    globalId: null,
    ifcType: "IFCWALL",
    label: `Wall ${localId}`,
    kind: "element",
    hasGeometry: true,
  };
}

test("graph relations are flattened in a deterministic order", () => {
  assert.deepEqual(
    flattenViewerGraphRelations({
      IsDefinedBy: [9, 2],
      ContainsElements: [7],
    }),
    [
      { relation: "ContainsElements", targetLocalId: 7 },
      { relation: "IsDefinedBy", targetLocalId: 2 },
      { relation: "IsDefinedBy", targetLocalId: 9 },
    ],
  );
});

test("inverse relation names resolve to one canonical directed edge", () => {
  const forward = buildViewerGraphEdge({
    modelId: "model",
    anchorLocalId: 10,
    relation: "ContainsElements",
    relatedLocalId: 20,
  });
  const inverse = buildViewerGraphEdge({
    modelId: "model",
    anchorLocalId: 20,
    relation: "ContainedInStructure",
    relatedLocalId: 10,
  });

  assert.equal(forward.id, inverse.id);
  assert.equal(forward.source, viewerGraphNodeId("model", 10));
  assert.equal(forward.target, viewerGraphNodeId("model", 20));
  assert.deepEqual(mergeViewerGraphEdge(forward, inverse).rawRelations, [
    "ContainedInStructure",
    "ContainsElements",
  ]);
});

test("graph node roles are derived from IFC categories", () => {
  assert.equal(classifyViewerGraphNode("IfcBuildingStorey"), "spatial");
  assert.equal(classifyViewerGraphNode("IFCWALLTYPE"), "type");
  assert.equal(classifyViewerGraphNode("IfcPropertySet"), "property");
  assert.equal(classifyViewerGraphNode("IfcMaterial"), "material");
  assert.equal(classifyViewerGraphNode("IfcWall"), "element");
  assert.equal(classifyViewerGraphNode(null), "other");
});

test("graph relation pages preserve a stable offset and bounded page size", () => {
  const relations = Array.from({ length: 105 }, (_, targetLocalId) => ({
    relation: "ContainsElements",
    targetLocalId,
  }));
  const firstPage = paginateViewerGraphRelations(relations, -10, 1_000);
  const finalPage = paginateViewerGraphRelations(relations, 100, 100);

  assert.equal(firstPage.offset, 0);
  assert.equal(firstPage.page.length, 100);
  assert.equal(firstPage.nextOffset, 100);
  assert.equal(firstPage.totalRelationCount, 105);
  assert.equal(finalPage.page.length, 5);
  assert.equal(finalPage.nextOffset, null);
});

test("neighborhood merging enforces the node limit and drops dangling edges", () => {
  const nodes = new Map<number, ViewerGraphNode>();
  const edges = new Map();
  const neighborhood: ViewerGraphNeighborhood = {
    modelId: "model",
    anchorLocalId: 1,
    nodes: [graphNode(1), graphNode(2), graphNode(3)],
    edges: [
      buildViewerGraphEdge({
        modelId: "model",
        anchorLocalId: 1,
        relation: "ContainsElements",
        relatedLocalId: 2,
      }),
      buildViewerGraphEdge({
        modelId: "model",
        anchorLocalId: 1,
        relation: "ContainsElements",
        relatedLocalId: 3,
      }),
    ],
    offset: 0,
    nextOffset: null,
    totalRelationCount: 2,
  };

  const result = mergeViewerGraphNeighborhood({
    neighborhood,
    nodes,
    edges,
    maxNodes: 2,
  });

  assert.deepEqual([...nodes.keys()], [1, 2]);
  assert.equal(edges.size, 1);
  assert.equal([...edges.values()][0]?.targetLocalId, 2);
  assert.equal(result.atNodeLimit, true);
});
