import assert from "node:assert/strict";
import test from "node:test";
import {
  clampCoreyOverlayPoint,
  exceededCoreyDragThreshold,
  parseStoredCoreyOverlayPoint,
} from "@/features/viewer/lib/corey-overlay-position";

test("clampCoreyOverlayPoint keeps a surface within the viewport margin", () => {
  assert.deepEqual(
    clampCoreyOverlayPoint({ x: -20, y: 900 }, { width: 1200, height: 800 }, { width: 400, height: 300 }),
    { x: 16, y: 484 },
  );
});

test("clampCoreyOverlayPoint handles a surface larger than the viewport", () => {
  assert.deepEqual(
    clampCoreyOverlayPoint({ x: 300, y: 300 }, { width: 320, height: 240 }, { width: 500, height: 400 }),
    { x: 16, y: 16 },
  );
});

test("drag threshold distinguishes a click from intentional movement", () => {
  assert.equal(exceededCoreyDragThreshold(2, 2), false);
  assert.equal(exceededCoreyDragThreshold(4, 0), true);
});

test("stored overlay positions are validated", () => {
  assert.deepEqual(parseStoredCoreyOverlayPoint('{"x":42,"y":81}'), { x: 42, y: 81 });
  assert.equal(parseStoredCoreyOverlayPoint('{"x":"42","y":81}'), null);
  assert.equal(parseStoredCoreyOverlayPoint("not-json"), null);
});
