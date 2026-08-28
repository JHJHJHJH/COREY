import assert from "node:assert/strict";
import test from "node:test";
import {
  buildViewerGraphEdge,
  classifyViewerGraphNode,
  collapseViewerGraphNode,
  flattenViewerGraphRelations,
  mergeViewerGraphEdge,
  mergeViewerGraphNeighborhood,
  paginateViewerGraphRelations,
  resolveAssociationSemantics,
  resolveDefinitionSemantics,
  viewerGraphNodeId,
} from "./ifc-graph";
import type { ViewerGraphEdge, ViewerGraphNeighborhood, ViewerGraphNode } from "../types";

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

test("grouping containers are spatial but element classes that merely contain the word are not", () => {
  assert.equal(classifyViewerGraphNode("IfcGroup"), "spatial");
  assert.equal(classifyViewerGraphNode("IfcSystem"), "spatial");
  assert.equal(classifyViewerGraphNode("IfcDistributionSystem"), "spatial");
  assert.equal(classifyViewerGraphNode("IfcSystemFurnitureElement"), "element");
});

test("external association resources are not classified as building elements", () => {
  assert.equal(classifyViewerGraphNode("IfcClassificationReference"), "other");
  assert.equal(classifyViewerGraphNode("IfcDocumentReference"), "other");
  assert.equal(classifyViewerGraphNode("IfcLibraryReference"), "other");
  assert.equal(classifyViewerGraphNode("IfcConstraint"), "other");
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
  // Only what actually landed: the node turned away at the limit was never added.
  assert.deepEqual(result.addedLocalIds, [1, 2]);
});

test("merging reports the nodes it newly added, and none on a repeat", () => {
  const nodes = new Map<number, ViewerGraphNode>();
  const edges = new Map();
  const neighborhood: ViewerGraphNeighborhood = {
    modelId: "model",
    anchorLocalId: 1,
    nodes: [graphNode(1), graphNode(2)],
    edges: [
      buildViewerGraphEdge({
        modelId: "model",
        anchorLocalId: 1,
        relation: "ContainsElements",
        relatedLocalId: 2,
      }),
    ],
    offset: 0,
    nextOffset: null,
    totalRelationCount: 1,
  };

  const first = mergeViewerGraphNeighborhood({ neighborhood, nodes, edges });
  assert.deepEqual(first.addedLocalIds, [1, 2]);

  // The layout positions d3 wrote onto the existing objects have to survive a re-merge, so a node
  // already on screen is neither replaced nor reported as new.
  const placed = nodes.get(2) as ViewerGraphNode & { x?: number };
  placed.x = 42;
  const second = mergeViewerGraphNeighborhood({ neighborhood, nodes, edges });

  assert.deepEqual(second.addedLocalIds, []);
  assert.equal((nodes.get(2) as ViewerGraphNode & { x?: number }).x, 42);
});


test("every mapped inverse pair collapses to one edge whichever endpoint is expanded", () => {
  const pairs: [string, string][] = [
    ["ContainsElements", "ContainedInStructure"],
    ["IsDecomposedBy", "Decomposes"],
    ["IsNestedBy", "Nests"],
    ["ReferencesElements", "ReferencedInStructures"],
    ["ServicesBuildings", "ServicedBySystems"],
    ["TypesObject", "IsTypedBy"],
    ["DefinesOccurrence", "IsDefinedBy"],
    ["HasOpenings", "VoidsElements"],
    ["HasFillings", "FillsVoids"],
    ["ConnectedTo", "ConnectedFrom"],
    ["HasCoverings", "CoversElements"],
    ["HasPorts", "ContainedIn"],
    ["IsGroupedBy", "HasAssignments"],
  ];

  for (const [forwardRelation, inverseRelation] of pairs) {
    const forward = buildViewerGraphEdge({
      modelId: "model",
      anchorLocalId: 10,
      relation: forwardRelation,
      relatedLocalId: 20,
    });
    const inverse = buildViewerGraphEdge({
      modelId: "model",
      anchorLocalId: 20,
      relation: inverseRelation,
      relatedLocalId: 10,
    });

    assert.equal(forward.id, inverse.id, `${forwardRelation}/${inverseRelation} disagree on id`);
    assert.equal(forward.sourceLocalId, 10, forwardRelation);
    assert.equal(forward.targetLocalId, 20, forwardRelation);
    // A shared id is itself the proof that both names are mapped: an unmapped relation falls back
    // to its own lowercased name as the family, so the two ids could not agree.
    assert.equal(forward.relationGroup, inverse.relationGroup, forwardRelation);
    assert.equal(forward.relation, inverse.relation, forwardRelation);
  }
});

test("an IFC2x3 definition edge is a type or a property set depending on its source class", () => {
  // The occupant's side of the link.
  const fromOccupant = buildViewerGraphEdge({
    modelId: "model",
    anchorLocalId: 1,
    anchorIfcType: "IFCFURNISHINGELEMENT",
    relation: "IsDefinedBy",
    relatedLocalId: 2,
    relatedIfcType: "IFCFURNITURETYPE",
  });
  // The same link reached by expanding the type instead.
  const fromType = buildViewerGraphEdge({
    modelId: "model",
    anchorLocalId: 2,
    anchorIfcType: "IFCFURNITURETYPE",
    relation: "ObjectTypeOf",
    relatedLocalId: 1,
    relatedIfcType: "IFCFURNISHINGELEMENT",
  });

  assert.equal(fromOccupant.id, fromType.id);
  assert.equal(fromOccupant.relation, "Type of");
  assert.equal(fromOccupant.relationGroup, "type");

  const pset = buildViewerGraphEdge({
    modelId: "model",
    anchorLocalId: 1,
    anchorIfcType: "IFCFURNISHINGELEMENT",
    relation: "IsDefinedBy",
    relatedLocalId: 3,
    relatedIfcType: "IFCPROPERTYSET",
  });
  assert.equal(pset.relation, "Defines");
  assert.equal(pset.relationGroup, "property");
  assert.notEqual(pset.id, fromOccupant.id);

  assert.equal(resolveDefinitionSemantics(null).group, "property");
});

test("type and property definitions land in separate relation groups", () => {
  const typed = buildViewerGraphEdge({
    modelId: "model",
    anchorLocalId: 1,
    relation: "IsTypedBy",
    relatedLocalId: 2,
  });
  const defined = buildViewerGraphEdge({
    modelId: "model",
    anchorLocalId: 1,
    relation: "IsDefinedBy",
    relatedLocalId: 3,
  });

  assert.equal(typed.relationGroup, "type");
  assert.equal(typed.relation, "Type of");
  assert.equal(defined.relationGroup, "property");
  assert.equal(defined.relation, "Defines");
});

test("association edges are labelled from the resource class, not the relation name", () => {
  const material = buildViewerGraphEdge({
    modelId: "model",
    anchorLocalId: 1,
    anchorIfcType: "IFCWALL",
    relation: "HasAssociations",
    relatedLocalId: 2,
    relatedIfcType: "IFCMATERIALLAYERSETUSAGE",
  });
  const classification = buildViewerGraphEdge({
    modelId: "model",
    anchorLocalId: 1,
    anchorIfcType: "IFCWALL",
    relation: "HasAssociations",
    relatedLocalId: 3,
    relatedIfcType: "IFCCLASSIFICATIONREFERENCE",
  });

  assert.equal(material.relation, "Material");
  assert.equal(material.relationGroup, "association");
  assert.equal(classification.relation, "Classification");
  assert.equal(classification.relationGroup, "association");
  assert.notEqual(material.id, classification.id);
});

test("an association resolves the same whichever endpoint is expanded", () => {
  const fromElement = buildViewerGraphEdge({
    modelId: "model",
    anchorLocalId: 1,
    anchorIfcType: "IFCWALL",
    relation: "HasAssociations",
    relatedLocalId: 2,
    relatedIfcType: "IFCCLASSIFICATIONREFERENCE",
  });
  const fromResource = buildViewerGraphEdge({
    modelId: "model",
    anchorLocalId: 2,
    anchorIfcType: "IFCCLASSIFICATIONREFERENCE",
    relation: "AssociatedTo",
    relatedLocalId: 1,
    relatedIfcType: "IFCWALL",
  });

  assert.equal(fromElement.id, fromResource.id);
  assert.equal(fromResource.relation, "Classification");
});

test("association semantics fall back to a shared family when the class is unknown", () => {
  assert.deepEqual(resolveAssociationSemantics(null), {
    family: "association",
    label: "Association",
  });
  assert.equal(resolveAssociationSemantics("IfcDocumentReference").label, "Document");
});

test("collapsing a hub removes only what it alone contributed", () => {
  const nodes = new Map<number, ViewerGraphNode>(
    [1, 2, 3, 4, 5].map((localId) => [localId, graphNode(localId)]),
  );
  const edges = new Map<string, ViewerGraphEdge>();
  const connect = (anchorLocalId: number, relatedLocalId: number) => {
    const edge = buildViewerGraphEdge({
      modelId: "model",
      anchorLocalId,
      relation: "ContainsElements",
      relatedLocalId,
    });
    edges.set(edge.id, edge);
  };

  // 1 is the anchor; 2 is the hub; 3 hangs off 2 alone; 4 hangs off both 2 and the anchor.
  connect(1, 2);
  connect(2, 3);
  connect(2, 4);
  connect(1, 4);
  connect(1, 5);

  const result = collapseViewerGraphNode({
    localId: 2,
    anchorLocalId: 1,
    nodes,
    edges,
  });

  assert.deepEqual(result.removedLocalIds, [3]);
  assert.deepEqual([...nodes.keys()].sort(), [1, 2, 4, 5]);
  assert.equal(
    [...edges.values()].some((edge) => edge.sourceLocalId === 3 || edge.targetLocalId === 3),
    false,
  );
});

test("collapsing never removes the anchor, the hub itself, or a pinned selection", () => {
  const nodes = new Map<number, ViewerGraphNode>(
    [1, 2, 3].map((localId) => [localId, graphNode(localId)]),
  );
  const edges = new Map<string, ViewerGraphEdge>();
  for (const [anchorLocalId, relatedLocalId] of [
    [1, 2],
    [2, 3],
  ]) {
    const edge = buildViewerGraphEdge({
      modelId: "model",
      anchorLocalId,
      relation: "ContainsElements",
      relatedLocalId,
    });
    edges.set(edge.id, edge);
  }

  assert.deepEqual(
    collapseViewerGraphNode({ localId: 1, anchorLocalId: 1, nodes, edges }).removedLocalIds,
    [],
  );
  assert.deepEqual(
    collapseViewerGraphNode({
      localId: 2,
      anchorLocalId: 1,
      nodes,
      edges,
      keepLocalIds: [3],
    }).removedLocalIds,
    [],
  );
  assert.deepEqual([...nodes.keys()].sort(), [1, 2, 3]);
});
