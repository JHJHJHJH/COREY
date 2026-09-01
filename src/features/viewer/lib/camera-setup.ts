import * as THREE from "three";
import type * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import CameraControls from "camera-controls";

import { cameraLimitsForDiagonal } from "./camera-tuning";

type ViewportControls = NonNullable<OBC.OrthoPerspectiveCamera["controls"]>;

/** The worlds both viewports build: a `SimpleWorld` with an `OrthoPerspectiveCamera`. */
export type ViewportWorld = OBC.World & { camera: OBC.OrthoPerspectiveCamera };

const { ACTION } = CameraControls;

/**
 * Every action that counts as "the user is rotating". `currentAction` returns the
 * controls' `_state`, which the library treats as a bitmask throughout, so this covers
 * the touch gestures that combine rotation with a dolly or zoom as well as the mouse one.
 */
const ROTATE_ACTIONS =
  ACTION.ROTATE | ACTION.TOUCH_ROTATE | ACTION.TOUCH_DOLLY_ROTATE | ACTION.TOUCH_ZOOM_ROTATE;

/**
 * Diameter of the pivot marker. It is a DOM node, so this holds however far the camera
 * is dollied. Authored in the app's own px, which `html { zoom: 0.75 }`
 * (`src/app/globals.css:288`) renders at three quarters — so this lands around 25 real
 * pixels, matching how the rest of the viewer chrome is sized.
 */
const PIVOT_SIZE = 34;
/** The glyph is drawn on a 28-unit grid and scaled to `PIVOT_SIZE` by the viewBox. */
const PIVOT_VIEWBOX = 28;

/**
 * Amber, drawn over a dark halo. The halo is what lets one colour work on the light
 * (`#ffffff`) and dark (`#080a0d`) scene backgrounds and over geometry, so the marker
 * needs no per-theme plumbing. Amber also keeps it clear of the selection blue
 * (`#0a5cff`), the measurement blue and the clipper's rust (`#b7552d`).
 */
const PIVOT_COLOR = "#f59e0b";
const PIVOT_HALO = "rgba(0, 0, 0, 0.55)";

/** A box we can actually point a camera at: finite, and not the empty-model sentinel. */
export function hasRenderableBox(box: THREE.Box3) {
  return Number.isFinite(box.min.x) && Number.isFinite(box.max.x) && !box.isEmpty();
}

/**
 * A ring with a crosshair through it, as an SVG in a plain div.
 *
 * Every stroke is drawn twice — the wide dark halo first, the amber over it — so the
 * glyph keeps its contrast whatever it happens to be sitting on.
 */
function createPivotElement() {
  const element = document.createElement("div");
  element.style.width = `${PIVOT_SIZE}px`;
  element.style.height = `${PIVOT_SIZE}px`;
  element.style.pointerEvents = "none";

  const strokes = `
    <circle cx="14" cy="14" r="7.5" fill="none" />
    <path d="M14 1.5 V6.5 M14 21.5 V26.5 M1.5 14 H6.5 M21.5 14 H26.5" />
  `;
  element.innerHTML = `
    <svg width="${PIVOT_SIZE}" height="${PIVOT_SIZE}" viewBox="0 0 ${PIVOT_VIEWBOX} ${PIVOT_VIEWBOX}" aria-hidden="true">
      <g stroke="${PIVOT_HALO}" stroke-width="4" stroke-linecap="round">${strokes}</g>
      <g stroke="${PIVOT_COLOR}" stroke-width="2" stroke-linecap="round">${strokes}</g>
      <circle cx="14" cy="14" r="2.2" fill="${PIVOT_HALO}" />
      <circle cx="14" cy="14" r="1.3" fill="${PIVOT_COLOR}" />
    </svg>
  `;
  return element;
}

export interface ViewportCameraOptions {
  /**
   * Re-anchor the orbit pivot onto the current anchor when a Shift-drag starts.
   *
   * Left off in the compare panes: `setOrbitPoint` keeps the image still by writing a
   * focal offset, and the pane-to-pane camera link in `visual-compare-overlay.tsx`
   * mirrors only position and target, so an offset on one pane would desync the other.
   */
  anchoredOrbit?: boolean;
}

export interface ViewportCameraController {
  /** Point subsequent orbits at this box's centre (the model, or the selection). */
  setAnchor(box: THREE.Box3): void;
  /** Re-derive clipping planes and dolly range from the loaded model's size. */
  applyModelLimits(box: THREE.Box3): void;
  /**
   * Clear the focal offset left behind by orbit anchoring. Call immediately before
   * `fitToBox`/`fitToSphere`, which do not reset it and would otherwise frame off-centre.
   */
  prepareFit(): void;
  dispose(): void;
}

function applyNavigationButtons(controls: ViewportControls, orbiting: boolean) {
  // Revit/Navisworks mapping: left selects, middle and right pan, wheel zooms, and Shift
  // turns a drag into an orbit. Right stays on pan and Shift+left orbits so a trackpad
  // with no middle button can still do both.
  controls.mouseButtons.left = orbiting ? ACTION.ROTATE : ACTION.NONE;
  controls.mouseButtons.middle = orbiting ? ACTION.ROTATE : ACTION.TRUCK;
  controls.mouseButtons.right = ACTION.TRUCK;
  controls.mouseButtons.wheel = ACTION.DOLLY;
}

/**
 * Replace the camera defaults `@thatopen/components` installs when the world is assigned,
 * and draw the centre of rotation while the user is orbiting.
 *
 * Must run *after* `world.camera = new OBC.OrthoPerspectiveCamera(...)`: that assignment
 * is what constructs the controls and runs `OrbitMode`, so anything written earlier is
 * overwritten.
 */
export function configureViewportCamera(
  world: ViewportWorld,
  options: ViewportCameraOptions = {},
): ViewportCameraController {
  const camera = world.camera;
  const controls = camera.controls as ViewportControls | undefined;
  const anchor = new THREE.Vector3();
  let hasAnchor = false;

  if (!controls) {
    // A camera with no world has no controls; hand back an inert controller rather than
    // make every call site null-check.
    return {
      setAnchor: () => {},
      applyModelLimits: () => {},
      prepareFit: () => {},
      dispose: () => {},
    };
  }

  // The heart of the fix. With `infinityDolly` on, camera-controls takes an unclamped
  // dolly path that drives the orbit radius asymptotically toward zero as you scroll in;
  // once the radius is tiny, a wheel notch moves the camera a fraction of a millimetre
  // and an orbit barely shifts the view, which is what made zoom and rotate feel dead at
  // close range. It also walks the pivot along the view direction whenever the distance
  // limits trip, leaving orbits centred on nothing.
  controls.infinityDolly = false;
  controls.dollyToCursor = true;
  controls.smoothTime = 0.15;
  controls.truckSpeed = 2;
  applyNavigationButtons(controls, false);

  const domElement = world.renderer?.three.domElement ?? null;

  // A CSS2D marker rather than a mesh: it holds a constant screen size on its own, the
  // renderer draws the 2D layer after the WebGL pass whatever postproduction is doing,
  // and its overlay is `pointer-events: none`, so picking is untouched.
  const pivotMark = new OBF.Mark(world, createPivotElement());
  pivotMark.visible = false;
  const pivotPosition = new THREE.Vector3();
  let showingPivot = false;

  const syncPivotPosition = () => {
    if (!showingPivot) return;
    // `getTarget` returns the transition end value by default, so the marker sits still
    // instead of chasing the damped target.
    controls.getTarget(pivotPosition);
    pivotMark.three.position.copy(pivotPosition);
  };

  const handleControlStart = () => {
    if ((controls.currentAction & ROTATE_ACTIONS) === 0) return;
    showingPivot = true;
    syncPivotPosition();
    pivotMark.visible = true;
    world.update(0);
  };

  const handleControlEnd = () => {
    if (!showingPivot) return;
    showingPivot = false;
    pivotMark.visible = false;
    world.update(0);
  };

  const setOrbiting = (orbiting: boolean) => {
    applyNavigationButtons(controls, orbiting);
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Shift") setOrbiting(true);
  };
  const handleKeyUp = (event: KeyboardEvent) => {
    if (event.key === "Shift") setOrbiting(false);
  };
  // A Shift release that lands outside the window never reaches us, so reset defensively
  // rather than leave the viewer stuck in orbit mode.
  const handleBlur = () => setOrbiting(false);

  const handlePointerDown = (event: PointerEvent) => {
    if (!event.shiftKey || !hasAnchor) return;
    // camera-controls samples `mouseButtons` and the pivot at pointerdown, so the anchor
    // has to be applied before the gesture starts, not while it runs.
    controls.setOrbitPoint(anchor.x, anchor.y, anchor.z);
  };

  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("blur", handleBlur);
  document.addEventListener("visibilitychange", handleBlur);
  // Wheel dolly emits neither of these, which is what we want: the pivot marker should
  // appear for rotation only, not for zooming.
  controls.addEventListener("controlstart", handleControlStart);
  controls.addEventListener("controlend", handleControlEnd);
  controls.addEventListener("update", syncPivotPosition);
  if (options.anchoredOrbit) {
    domElement?.addEventListener("pointerdown", handlePointerDown);
  }

  return {
    setAnchor(box) {
      if (!hasRenderableBox(box)) return;
      box.getCenter(anchor);
      hasAnchor = true;
    },
    applyModelLimits(box) {
      const diagonal = hasRenderableBox(box)
        ? box.getSize(new THREE.Vector3()).length()
        : Number.NaN;
      const limits = cameraLimitsForDiagonal(diagonal);
      // Both cameras, so a future projection toggle inherits the same frustum.
      for (const three of [camera.threePersp, camera.threeOrtho]) {
        three.near = limits.near;
        three.far = limits.far;
        three.updateProjectionMatrix();
      }
      controls.minDistance = limits.minDistance;
      controls.maxDistance = limits.maxDistance;
    },
    prepareFit() {
      controls.setFocalOffset(0, 0, 0, false);
    },
    dispose() {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleBlur);
      controls.removeEventListener("controlstart", handleControlStart);
      controls.removeEventListener("controlend", handleControlEnd);
      controls.removeEventListener("update", syncPivotPosition);
      domElement?.removeEventListener("pointerdown", handlePointerDown);
      pivotMark.dispose();
    },
  };
}
