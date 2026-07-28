import assert from "node:assert/strict";
import test from "node:test";
import {
  createMutableBounds,
  expandBounds,
  finalizeBounds,
  geometryResult,
  transformPoint,
} from "@/features/viewer/mcp/geometry";

test("transforms points with a column-major placement matrix", () => {
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, -2, 3, 1];
  assert.deepEqual(transformPoint(matrix, 1, 2, 3), { x: 11, y: 0, z: 6 });
});

test("finalizes and aggregates axis-aligned bounds", () => {
  const mutable = createMutableBounds();
  expandBounds(mutable, { x: -1, y: 2, z: 3 });
  expandBounds(mutable, { x: 3, y: 6, z: 11 });
  const first = finalizeBounds(mutable);
  assert.deepEqual(first?.center, { x: 1, y: 4, z: 7 });
  assert.deepEqual(first?.size, { x: 4, y: 4, z: 8 });

  const result = geometryResult(
    ["a", "missing"],
    new Map(first ? [["a", first]] : []),
  );
  assert.equal(result.items[0]?.found, true);
  assert.equal(result.items[1]?.found, false);
  assert.deepEqual(result.aggregateBounds, first);
  assert.equal(result.unit, "m");
});
