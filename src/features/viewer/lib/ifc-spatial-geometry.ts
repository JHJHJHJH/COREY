import type {
  CoreyMcpBounds,
  CoreyMcpSpatialIndex,
  CoreyMcpSpatialNode,
  CoreyMcpSpatialRelation,
} from "@/features/viewer/mcp/contracts";
import {
  createMutableBounds,
  expandBounds,
  expandBoundsByBounds,
  finalizeBounds,
  transformPoint,
} from "@/features/viewer/mcp/geometry";
import {
  loadWebIfc,
  readWrappedValue,
  type IfcApiInstance,
} from "@/features/viewer/lib/ifc-node-core";

type IfcHandle = { type: number; value: number };

type EntityRef = {
  expressId: number;
  globalId: string;
  ifcType: string;
  name: string | null;
};

export interface IfcSpatialGeometryIndex {
  spatial: CoreyMcpSpatialIndex;
  boundsByGlobalId: Map<string, CoreyMcpBounds>;
  modelBounds: CoreyMcpBounds | null;
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHandle(value: unknown): value is IfcHandle {
  return isRecord(value) && value.type === 5 && typeof value.value === "number";
}

function readString(value: unknown) {
  const normalized = readWrappedValue(value);
  return typeof normalized === "string" && normalized.trim() ? normalized.trim() : null;
}

function readHandles(value: unknown) {
  return Array.isArray(value) ? value.filter(isHandle).map((entry) => entry.value) : [];
}

function collectEntityRefs(api: IfcApiInstance, modelId: number) {
  const refsByExpressId = new Map<number, EntityRef>();
  const globalIdToExpressId = new Map<string, number>();
  const objectDefinitionCode = api.GetTypeCodeFromName("IFCOBJECTDEFINITION");
  const ids = api.GetLineIDsWithType(modelId, objectDefinitionCode, true);

  for (let index = 0; index < ids.size(); index += 1) {
    const expressId = ids.get(index);
    const line = api.GetLine(modelId, expressId, false, false);
    if (!isRecord(line)) continue;
    const globalId = readString(line.GlobalId);
    if (!globalId || globalIdToExpressId.has(globalId)) continue;
    const ref = {
      expressId,
      globalId,
      ifcType: api.GetNameFromTypeCode(api.GetLineType(modelId, expressId)),
      name: readString(line.Name),
    };
    refsByExpressId.set(expressId, ref);
    globalIdToExpressId.set(globalId, expressId);
  }
  return { refsByExpressId, globalIdToExpressId };
}

function addRelations(
  api: IfcApiInstance,
  modelId: number,
  relationName: string,
  relatingKey: string,
  relatedKey: string,
  relation: CoreyMcpSpatialRelation,
  refsByExpressId: Map<number, EntityRef>,
  parentByChild: Map<number, { parent: number; relation: CoreyMcpSpatialRelation }>,
) {
  const relationCode = api.GetTypeCodeFromName(relationName);
  const ids = api.GetLineIDsWithType(modelId, relationCode, false);
  for (let index = 0; index < ids.size(); index += 1) {
    const line = api.GetLine(modelId, ids.get(index), false, false);
    if (!isRecord(line) || !isHandle(line[relatingKey])) continue;
    const parent = line[relatingKey].value;
    if (!refsByExpressId.has(parent)) continue;
    for (const child of readHandles(line[relatedKey])) {
      if (!refsByExpressId.has(child) || parentByChild.has(child)) continue;
      parentByChild.set(child, { parent, relation });
    }
  }
}

function buildSpatialIndex(
  refsByExpressId: Map<number, EntityRef>,
  parentByChild: Map<number, { parent: number; relation: CoreyMcpSpatialRelation }>,
  boundsByGlobalId: Map<string, CoreyMcpBounds>,
) {
  const nodes: Record<string, CoreyMcpSpatialNode> = {};
  const children: Record<string, string[]> = {};
  for (const ref of refsByExpressId.values()) {
    const parent = parentByChild.get(ref.expressId);
    const parentGlobalId = parent
      ? (refsByExpressId.get(parent.parent)?.globalId ?? null)
      : null;
    nodes[ref.globalId] = {
      globalId: ref.globalId,
      expressId: ref.expressId,
      ifcType: ref.ifcType,
      name: ref.name,
      parentGlobalId,
      relation: parent?.relation ?? null,
      childCount: 0,
      hasGeometry: boundsByGlobalId.has(ref.globalId),
    };
    children[ref.globalId] = [];
  }

  for (const node of Object.values(nodes)) {
    if (!node.parentGlobalId || !nodes[node.parentGlobalId]) continue;
    children[node.parentGlobalId].push(node.globalId);
  }
  for (const [globalId, childIds] of Object.entries(children)) {
    childIds.sort((left, right) => {
      const a = nodes[left];
      const b = nodes[right];
      return (
        a.ifcType.localeCompare(b.ifcType) ||
        (a.name ?? "").localeCompare(b.name ?? "") ||
        a.globalId.localeCompare(b.globalId)
      );
    });
    nodes[globalId].childCount = childIds.length;
  }

  let roots = Object.values(nodes)
    .filter(
      (node) =>
        !node.parentGlobalId &&
        (node.ifcType.toUpperCase() === "IFCPROJECT" || node.childCount > 0),
    )
    .map((node) => node.globalId);
  if (roots.length === 0) {
    roots = Object.values(nodes)
      .filter((node) => !node.parentGlobalId)
      .map((node) => node.globalId);
  }
  roots.sort();
  return { nodes, children, roots } satisfies CoreyMcpSpatialIndex;
}

function collectGeometryBounds(
  api: IfcApiInstance,
  modelId: number,
  refsByExpressId: Map<number, EntityRef>,
) {
  const mutableByGlobalId = new Map<string, ReturnType<typeof createMutableBounds>>();

  api.StreamAllMeshes(modelId, (mesh) => {
    const ref = refsByExpressId.get(mesh.expressID);
    if (!ref) {
      mesh.delete?.();
      return;
    }
    const bounds = mutableByGlobalId.get(ref.globalId) ?? createMutableBounds();
    mutableByGlobalId.set(ref.globalId, bounds);
    try {
      for (let index = 0; index < mesh.geometries.size(); index += 1) {
        const placed = mesh.geometries.get(index);
        const geometry = api.GetGeometry(modelId, placed.geometryExpressID);
        try {
          const vertices = api.GetVertexArray(
            geometry.GetVertexData(),
            geometry.GetVertexDataSize(),
          );
          for (let vertex = 0; vertex + 2 < vertices.length; vertex += 6) {
            expandBounds(
              bounds,
              transformPoint(
                placed.flatTransformation,
                vertices[vertex],
                vertices[vertex + 1],
                vertices[vertex + 2],
              ),
            );
          }
        } finally {
          geometry.delete?.();
        }
      }
    } finally {
      mesh.delete?.();
    }
  });

  const boundsByGlobalId = new Map<string, CoreyMcpBounds>();
  const modelMutable = createMutableBounds();
  for (const [globalId, mutable] of mutableByGlobalId) {
    const bounds = finalizeBounds(mutable);
    if (!bounds) continue;
    boundsByGlobalId.set(globalId, bounds);
    expandBoundsByBounds(modelMutable, bounds);
  }
  return { boundsByGlobalId, modelBounds: finalizeBounds(modelMutable) };
}

export async function buildIfcSpatialGeometryIndex(
  bytes: Uint8Array,
): Promise<IfcSpatialGeometryIndex> {
  const { IfcAPI } = await loadWebIfc();
  const api = new IfcAPI();
  await api.Init();
  let modelId = -1;
  try {
    modelId = api.OpenModel(bytes, { COORDINATE_TO_ORIGIN: true });
    const { refsByExpressId } = collectEntityRefs(api, modelId);
    const parentByChild = new Map<
      number,
      { parent: number; relation: CoreyMcpSpatialRelation }
    >();
    addRelations(
      api,
      modelId,
      "IFCRELAGGREGATES",
      "RelatingObject",
      "RelatedObjects",
      "aggregates",
      refsByExpressId,
      parentByChild,
    );
    addRelations(
      api,
      modelId,
      "IFCRELNESTS",
      "RelatingObject",
      "RelatedObjects",
      "aggregates",
      refsByExpressId,
      parentByChild,
    );
    addRelations(
      api,
      modelId,
      "IFCRELCONTAINEDINSPATIALSTRUCTURE",
      "RelatingStructure",
      "RelatedElements",
      "contains",
      refsByExpressId,
      parentByChild,
    );
    const { boundsByGlobalId, modelBounds } = collectGeometryBounds(
      api,
      modelId,
      refsByExpressId,
    );
    return {
      spatial: buildSpatialIndex(refsByExpressId, parentByChild, boundsByGlobalId),
      boundsByGlobalId,
      modelBounds,
      warnings: [],
    };
  } finally {
    if (modelId >= 0) api.CloseModel(modelId);
  }
}
