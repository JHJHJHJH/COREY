import assert from "node:assert/strict";
import test from "node:test";
import {
  FALLBACK_MODEL_DIAGONAL,
  cameraLimitsForDiagonal,
  normalizeModelDiagonal,
} from "./camera-tuning";

test("a room-scale model can still be approached closely", () => {
  const limits = cameraLimitsForDiagonal(8);
  // Inspecting a detail means getting within centimetres without it clipping away.
  assert.ok(limits.near <= 0.01, `near ${limits.near} should reach centimetre scale`);
  assert.ok(limits.minDistance < 0.1, `minDistance ${limits.minDistance} is too far out`);
});

test("a site-scale model can still be approached to arm's length", () => {
  // The regression found on Demo_RevitSampleProject: deriving minDistance from a near
  // plane that scaled with the whole site left the camera walled off a metre from any
  // surface, so zoom went dead against a wall exactly like the original bug.
  const limits = cameraLimitsForDiagonal(300);
  assert.ok(limits.minDistance <= 0.35, `minDistance ${limits.minDistance} is too far out`);
  assert.ok(limits.near < limits.minDistance);
});

test("the depth-buffer ratio is scale invariant", () => {
  // A constant far/near is what makes a room and a site feel the same, and keeps
  // z-fighting on IFC's coincident surfaces predictable rather than model-dependent.
  const ratios = [4, 40, 400, 4000, 40_000].map((d) => {
    const { near, far } = cameraLimitsForDiagonal(d);
    return far / near;
  });
  for (const ratio of ratios) {
    assert.ok(Math.abs(ratio - ratios[0]) < 1e-6, `ratio drifted: ${ratios.join(", ")}`);
    assert.ok(ratio < 1e5, `far/near ${ratio} risks z-fighting`);
  }
});

test("a site-scale model can be framed instead of being clamped inside itself", () => {
  // The regression this replaces: OrbitMode's fixed maxDistance of 300 put the camera
  // inside anything bigger than a demo scene.
  const limits = cameraLimitsForDiagonal(3000);
  assert.ok(limits.maxDistance > 3000, `maxDistance ${limits.maxDistance} cannot frame the model`);
  assert.ok(limits.far > limits.maxDistance);
});

test("a millimetre-authored model stays finite and ordered", () => {
  const limits = cameraLimitsForDiagonal(120_000);
  for (const [key, value] of Object.entries(limits)) {
    assert.ok(Number.isFinite(value), `${key} should be finite, got ${value}`);
  }
  assert.ok(limits.maxDistance > 120_000);
});

test("an implausibly tiny extent is rounded up rather than trusted", () => {
  assert.equal(normalizeModelDiagonal(0.01), normalizeModelDiagonal(0.5));
  const limits = cameraLimitsForDiagonal(0.01);
  assert.ok(limits.near > 0 && Number.isFinite(limits.far));
});

test("degenerate extents fall back instead of producing NaN planes", () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1e12]) {
    assert.equal(normalizeModelDiagonal(bad), FALLBACK_MODEL_DIAGONAL, `input ${bad}`);
    assert.deepEqual(
      cameraLimitsForDiagonal(bad),
      cameraLimitsForDiagonal(FALLBACK_MODEL_DIAGONAL),
      `input ${bad}`,
    );
  }
});

test("near < minDistance < maxDistance < far holds across every model scale", () => {
  for (let exponent = -2; exponent <= 7; exponent += 0.5) {
    const diagonal = 10 ** exponent;
    const { near, far, minDistance, maxDistance } = cameraLimitsForDiagonal(diagonal);
    assert.ok(
      near > 0 && near < minDistance && minDistance < maxDistance && maxDistance < far,
      `broken ordering at diagonal ${diagonal}: ${JSON.stringify({ near, minDistance, maxDistance, far })}`,
    );
  }
});
