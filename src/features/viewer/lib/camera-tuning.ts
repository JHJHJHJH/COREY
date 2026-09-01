/**
 * Camera frustum and dolly limits derived from the size of the loaded model.
 *
 * `@thatopen/components` configures its camera once, for a demo-sized scene, and never
 * re-derives it: `SimpleCamera` builds a `near: 1 / far: 1000` perspective camera, and
 * `OrbitMode` pins `minDistance: 1 / maxDistance: 300`. On a real IFC those numbers clip
 * geometry a metre from the eye and refuse to frame anything larger than 300 units, so we
 * recompute them from each model's bounding box instead.
 *
 * Deliberately free of three.js imports so it runs directly under `pnpm viewer:test`.
 */

export interface CameraLimits {
  /** Near clipping plane, in world units. */
  near: number;
  /** Far clipping plane, in world units. */
  far: number;
  /** Closest the camera may dolly to its orbit target. */
  minDistance: number;
  /** Furthest the camera may dolly from its orbit target. */
  maxDistance: number;
}

/** Extent assumed when a model has no usable bounding box, in world units. */
export const FALLBACK_MODEL_DIAGONAL = 40;

/** Smaller diagonals are rounded up; below this, limits stop being meaningful. */
const MIN_SUPPORTED_DIAGONAL = 0.5;
/** Larger diagonals are treated as corrupt geometry rather than as a very large site. */
const MAX_SUPPORTED_DIAGONAL = 1e7;

/**
 * Every limit is a fixed fraction or multiple of the model's own size, which is what
 * makes the viewer feel the same on a room and on a site: the depth-buffer ratio
 * (`far / near`) comes out at a constant ~42,000 whatever the model's scale.
 *
 * Tying the near plane to the model rather than to a fixed 1-unit default is the reason
 * the camera can now be walked right up to a surface without it clipping away, and
 * `NEAR_FRACTION` sitting three times finer than `MIN_DISTANCE_FRACTION` is what keeps
 * that surface drawn at the closest the controls will let you dolly.
 */
const NEAR_FRACTION = 1 / 3000;
const MIN_DISTANCE_FRACTION = 1 / 1000;
const MAX_DISTANCE_MULTIPLE = 10;
const FAR_MULTIPLE = 14;

/**
 * Reduce a bounding-box diagonal to something we can safely derive limits from. Empty
 * models, models whose box never resolved, and nonsense extents all collapse to the
 * fallback rather than producing `NaN` clipping planes.
 */
export function normalizeModelDiagonal(diagonal: number): number {
  if (!Number.isFinite(diagonal) || diagonal <= 0 || diagonal > MAX_SUPPORTED_DIAGONAL) {
    return FALLBACK_MODEL_DIAGONAL;
  }
  return Math.max(diagonal, MIN_SUPPORTED_DIAGONAL);
}

/**
 * Derive camera limits from a model's bounding-box diagonal.
 *
 * Guarantees `0 < near < minDistance < maxDistance < far` for every input, so the camera
 * can always both touch a detail and pull back past the whole model.
 */
export function cameraLimitsForDiagonal(diagonal: number): CameraLimits {
  const extent = normalizeModelDiagonal(diagonal);

  return {
    near: extent * NEAR_FRACTION,
    far: extent * FAR_MULTIPLE,
    minDistance: extent * MIN_DISTANCE_FRACTION,
    maxDistance: extent * MAX_DISTANCE_MULTIPLE,
  };
}
