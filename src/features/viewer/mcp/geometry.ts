import type {
  CoreyMcpBounds,
  CoreyMcpVector3,
} from "@/features/viewer/mcp/contracts";

export type MutableBounds = {
  min: CoreyMcpVector3;
  max: CoreyMcpVector3;
};

export function createMutableBounds(): MutableBounds {
  return {
    min: { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY },
    max: { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY },
  };
}

export function expandBounds(bounds: MutableBounds, point: CoreyMcpVector3) {
  bounds.min.x = Math.min(bounds.min.x, point.x);
  bounds.min.y = Math.min(bounds.min.y, point.y);
  bounds.min.z = Math.min(bounds.min.z, point.z);
  bounds.max.x = Math.max(bounds.max.x, point.x);
  bounds.max.y = Math.max(bounds.max.y, point.y);
  bounds.max.z = Math.max(bounds.max.z, point.z);
}

export function expandBoundsByBounds(bounds: MutableBounds, value: CoreyMcpBounds) {
  expandBounds(bounds, value.min);
  expandBounds(bounds, value.max);
}

export function finalizeBounds(bounds: MutableBounds): CoreyMcpBounds | null {
  if (
    !Number.isFinite(bounds.min.x) ||
    !Number.isFinite(bounds.min.y) ||
    !Number.isFinite(bounds.min.z) ||
    !Number.isFinite(bounds.max.x) ||
    !Number.isFinite(bounds.max.y) ||
    !Number.isFinite(bounds.max.z)
  ) {
    return null;
  }
  const size = {
    x: bounds.max.x - bounds.min.x,
    y: bounds.max.y - bounds.min.y,
    z: bounds.max.z - bounds.min.z,
  };
  return {
    min: { ...bounds.min },
    max: { ...bounds.max },
    center: {
      x: bounds.min.x + size.x / 2,
      y: bounds.min.y + size.y / 2,
      z: bounds.min.z + size.z / 2,
    },
    size,
  };
}

export function transformPoint(matrix: number[], x: number, y: number, z: number) {
  return {
    x: (matrix[0] ?? 1) * x + (matrix[4] ?? 0) * y + (matrix[8] ?? 0) * z + (matrix[12] ?? 0),
    y: (matrix[1] ?? 0) * x + (matrix[5] ?? 1) * y + (matrix[9] ?? 0) * z + (matrix[13] ?? 0),
    z: (matrix[2] ?? 0) * x + (matrix[6] ?? 0) * y + (matrix[10] ?? 1) * z + (matrix[14] ?? 0),
  };
}

export function geometryResult(
  globalIds: string[],
  boundsByGlobalId: ReadonlyMap<string, CoreyMcpBounds>,
) {
  const ids = [...new Set(globalIds.map((value) => value.trim()).filter(Boolean))];
  if (ids.length === 0) throw new Error("At least one GlobalId is required.");
  if (ids.length > 25) throw new Error("At most 25 elements can be requested at once.");
  const aggregate = createMutableBounds();
  const items = ids.map((globalId) => {
    const bounds = boundsByGlobalId.get(globalId) ?? null;
    if (bounds) expandBoundsByBounds(aggregate, bounds);
    return { globalId, found: bounds !== null, bounds };
  });
  return {
    coordinateFrame: "corey-coordinated" as const,
    unit: "m" as const,
    items,
    aggregateBounds: finalizeBounds(aggregate),
  };
}
