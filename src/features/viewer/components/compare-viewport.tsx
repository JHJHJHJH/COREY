"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import {
  configureViewportCamera,
  hasRenderableBox,
  type ViewportCameraController,
} from "@/features/viewer/lib/camera-setup";
import { elementInspectionDataConfig } from "@/features/viewer/lib/ifc-data";

/** camera-controls instance type, derived from the camera rather than re-imported. */
export type CompareCameraControls = NonNullable<OBC.OrthoPerspectiveCamera["controls"]>;

/**
 * What a compare pane paints on top of the raw model:
 * - "diff": ambient delta colors (changed + this side's added-or-removed list)
 * - "focus": everything ghosted; `focusLocalId` re-highlighted in its diff-tone
 *   color when the focused element exists in this version (null = fully ghosted
 *   pane, e.g. the base pane while an added element is focused)
 */
export type CompareViewportVisualState =
  | { mode: "none" }
  | { mode: "diff"; changedIds: number[]; deltaIds: number[]; deltaTone: "added" | "removed" }
  | { mode: "focus"; focusLocalId: number | null; tone?: "added" | "removed" | "modified" };

export interface CompareViewportHandle {
  loadModel(bytes: Uint8Array, modelId: string, onProgress?: (percent: number) => void): Promise<void>;
  getControls(): CompareCameraControls | null;
  fitModel(): Promise<void>;
  /** Zooms to the element; resolves false when it has no renderable geometry. */
  focusElement(localId: number): Promise<boolean>;
  applyVisualState(state: CompareViewportVisualState): Promise<void>;
  /** Raw attributes + psets for one element; null when the pane has no model or the id is unknown. */
  getItemData(localId: number): Promise<FRAGS.ItemData | null>;
}

type CompareViewportProps = {
  theme: "light" | "dark";
  /** Corner chip, e.g. "v1 · Base". */
  label: string;
};

type CompareRuntime = {
  components: OBC.Components;
  world: OBC.World;
  camera: ViewportCameraController;
  fragments: OBC.FragmentsManager;
  model: FRAGS.FragmentsModel | null;
};

const fragmentsWorkerUrl = new URL("@thatopen/fragments/worker", import.meta.url);

const compareSceneThemes = {
  light: { background: "#ffffff", ambientLight: "#edf4ff" },
  dark: { background: "#080a0d", ambientLight: "#dbe8ff" },
} as const;

const ghostMaterial = {
  color: new THREE.Color("#8b939c"),
  opacity: 0.1,
  transparent: true,
  renderedFaces: FRAGS.RenderedFaces.ONE,
  depthWrite: false,
} satisfies FRAGS.MaterialDefinition;
// Fallback focus color when the focused element has no diff tone.
const focusMaterial = {
  color: new THREE.Color("#0a5cff"),
  opacity: 1,
  transparent: false,
  renderedFaces: FRAGS.RenderedFaces.ONE,
} satisfies FRAGS.MaterialDefinition;
// Diff tones: orange = modified, green = added, red = removed. Keep in sync
// with the section dots in visual-compare-overlay.tsx.
const changedMaterial = {
  color: new THREE.Color("#e07b2a"),
  opacity: 1,
  transparent: false,
  renderedFaces: FRAGS.RenderedFaces.ONE,
} satisfies FRAGS.MaterialDefinition;
const addedMaterial = {
  color: new THREE.Color("#2e9e5b"),
  opacity: 1,
  transparent: false,
  renderedFaces: FRAGS.RenderedFaces.ONE,
} satisfies FRAGS.MaterialDefinition;
const removedMaterial = {
  color: new THREE.Color("#d64545"),
  opacity: 1,
  transparent: false,
  renderedFaces: FRAGS.RenderedFaces.ONE,
} satisfies FRAGS.MaterialDefinition;

/**
 * Minimal single-model 3D pane for the visual compare overlay. Unlike
 * `IfcViewport` it has no picking, tools, or shell callbacks — the overlay
 * drives everything through the imperative handle, and all visual states are
 * painted with `FragmentsModel.highlight` (per-item last-write-wins).
 */
export const CompareViewport = forwardRef<CompareViewportHandle, CompareViewportProps>(
  function CompareViewport({ theme, label }, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const runtimeRef = useRef<CompareRuntime | null>(null);
    const themeRef = useRef(theme);
    const fragmentsUpdateFrameRef = useRef<number | null>(null);
    const pendingFragmentsForceRef = useRef(false);
    // Serializes applyVisualState calls so a repaint never interleaves with a
    // previous reset/highlight sequence still in flight.
    const visualStateQueueRef = useRef<Promise<void>>(Promise.resolve());

    const scheduleFragmentsUpdate = (force = false) => {
      pendingFragmentsForceRef.current = pendingFragmentsForceRef.current || force;
      if (fragmentsUpdateFrameRef.current !== null) {
        return;
      }

      fragmentsUpdateFrameRef.current = window.requestAnimationFrame(() => {
        fragmentsUpdateFrameRef.current = null;

        const runtime = runtimeRef.current;
        const nextForce = pendingFragmentsForceRef.current;
        pendingFragmentsForceRef.current = false;
        if (!runtime) {
          return;
        }

        void runtime.fragments.core.update(nextForce);
      });
    };

    useEffect(() => {
      themeRef.current = theme;

      const runtime = runtimeRef.current;
      if (!runtime) {
        return;
      }

      const sceneTheme = compareSceneThemes[theme];
      (runtime.world.scene.three as THREE.Scene).background = new THREE.Color(
        sceneTheme.background,
      );
      runtime.world.update(0);
    }, [theme]);

    useImperativeHandle(ref, () => ({
      async loadModel(bytes, modelId, onProgress) {
        const runtime = runtimeRef.current;
        if (!runtime) {
          throw new Error("The compare viewport is not ready yet.");
        }

        if (runtime.model) {
          runtime.world.scene.three.remove(runtime.model.object);
          await runtime.fragments.core.disposeModel(runtime.model.modelId);
          runtime.model = null;
        }

        const importer = new FRAGS.IfcImporter();
        importer.wasm.path = "/wasm/";
        importer.wasm.absolute = true;

        let lastProgress = -1;
        const fragmentsBytes = await importer.process({
          bytes,
          progressCallback: (progress) => {
            const normalized = Math.floor(progress);
            if (normalized === lastProgress || normalized % 5 !== 0) {
              return;
            }

            lastProgress = normalized;
            onProgress?.(normalized);
          },
        });

        const model = await runtime.fragments.core.load(fragmentsBytes, {
          modelId,
          camera: runtime.world.camera.three as
            | THREE.PerspectiveCamera
            | THREE.OrthographicCamera,
        });
        runtime.model = model;

        await runtime.fragments.core.update(true);

        const controls = runtime.world.camera.controls;
        const modelBox = model.box.clone();
        runtime.camera.applyModelLimits(modelBox);
        if (controls && hasRenderableBox(modelBox)) {
          await controls.fitToBox(modelBox, false, {
            paddingBottom: 0.2,
            paddingTop: 0.2,
            paddingLeft: 0.2,
            paddingRight: 0.2,
          });
        }
      },
      getControls() {
        return runtimeRef.current?.world.camera.controls ?? null;
      },
      async fitModel() {
        const runtime = runtimeRef.current;
        const controls = runtime?.world.camera.controls;
        if (!runtime?.model || !controls) {
          return;
        }

        const modelBox = runtime.model.box.clone();
        if (hasRenderableBox(modelBox)) {
          await controls.fitToBox(modelBox, true, {
            paddingBottom: 0.2,
            paddingTop: 0.2,
            paddingLeft: 0.2,
            paddingRight: 0.2,
          });
        }
      },
      async focusElement(localId) {
        const runtime = runtimeRef.current;
        const controls = runtime?.world.camera.controls;
        if (!runtime?.model || !controls) {
          return false;
        }

        const box = await runtime.model.getMergedBox([localId]);
        if (!hasRenderableBox(box)) {
          return false;
        }

        await controls.fitToBox(box, true, {
          paddingBottom: 0.25,
          paddingTop: 0.25,
          paddingLeft: 0.25,
          paddingRight: 0.25,
        });
        return true;
      },
      async getItemData(localId) {
        const model = runtimeRef.current?.model;
        if (!model) {
          return null;
        }

        try {
          const data = await model.getItemsData([localId], elementInspectionDataConfig);
          return data[0] ?? null;
        } catch {
          return null;
        }
      },
      applyVisualState(state) {
        const run = async () => {
          const runtime = runtimeRef.current;
          const model = runtime?.model;
          if (!runtime || !model) {
            return;
          }

          await model.resetHighlight();

          if (state.mode === "focus") {
            await model.highlight(undefined, ghostMaterial);
            if (state.focusLocalId !== null) {
              const toneMaterial =
                state.tone === "added"
                  ? addedMaterial
                  : state.tone === "removed"
                    ? removedMaterial
                    : state.tone === "modified"
                      ? changedMaterial
                      : focusMaterial;
              await model.highlight([state.focusLocalId], toneMaterial);
            }
          } else if (state.mode === "diff") {
            if (state.changedIds.length > 0) {
              await model.highlight(state.changedIds, changedMaterial);
            }
            if (state.deltaIds.length > 0) {
              await model.highlight(
                state.deltaIds,
                state.deltaTone === "added" ? addedMaterial : removedMaterial,
              );
            }
          }

          await runtime.fragments.core.update(true);
        };

        const queued = visualStateQueueRef.current.then(run, run);
        visualStateQueueRef.current = queued;
        return queued;
      },
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      let cancelled = false;

      // Panel resize/collapse in the overlay resizes the pane, which clears
      // the canvas; force a fragments redraw so the model doesn't blank out
      // until the next camera move.
      const resizeObserver = new ResizeObserver(() => {
        scheduleFragmentsUpdate(true);
      });
      resizeObserver.observe(container);

      const initialize = async () => {
        const components = new OBC.Components();
        const worlds = components.get(OBC.Worlds);
        const world = worlds.create<
          OBC.SimpleScene,
          OBC.OrthoPerspectiveCamera,
          OBF.PostproductionRenderer
        >();
        world.scene = new OBC.SimpleScene(components);
        const sceneTheme = compareSceneThemes[themeRef.current];
        world.scene.setup({
          directionalLight: {
            color: new THREE.Color("#ffffff"),
            intensity: 0.9,
            position: new THREE.Vector3(25, 50, 25),
          },
          ambientLight: {
            intensity: 0.8,
            color: new THREE.Color(sceneTheme.ambientLight),
          },
        });
        world.scene.three.background = new THREE.Color(sceneTheme.background);
        world.renderer = new OBF.PostproductionRenderer(components, container);
        world.camera = new OBC.OrthoPerspectiveCamera(components);
        // Anchored orbit is off here: it works by writing a focal offset, which the
        // pane-to-pane camera link in `visual-compare-overlay.tsx` does not mirror.
        const viewportCamera = configureViewportCamera(world);
        await world.camera.controls?.setLookAt(18, 16, 18, 0, 0, 0);

        components.init();

        const fragments = components.get(OBC.FragmentsManager);
        fragments.init(fragmentsWorkerUrl.toString());

        const controls = world.camera.controls;
        controls?.addEventListener("update", () => {
          scheduleFragmentsUpdate(false);
        });
        controls?.addEventListener("rest", () => {
          scheduleFragmentsUpdate(true);
        });

        world.onCameraChanged.add((camera) => {
          for (const [, model] of fragments.list) {
            model.useCamera(camera.three);
          }
          scheduleFragmentsUpdate(true);
        });

        fragments.list.onItemSet.add(({ value: model }) => {
          model.useCamera(world.camera.three);
          world.scene.three.add(model.object);
          scheduleFragmentsUpdate(true);
        });

        fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
          if (!("isLodMaterial" in material && material.isLodMaterial)) {
            material.polygonOffset = true;
            material.polygonOffsetUnits = 1;
            material.polygonOffsetFactor = Math.random();
          }
        });

        runtimeRef.current = {
          components,
          world,
          camera: viewportCamera,
          fragments,
          model: null,
        };

        if (cancelled) {
          components.dispose();
          runtimeRef.current = null;
        }
      };

      void initialize();

      return () => {
        cancelled = true;
        resizeObserver.disconnect();
        if (fragmentsUpdateFrameRef.current !== null) {
          window.cancelAnimationFrame(fragmentsUpdateFrameRef.current);
          fragmentsUpdateFrameRef.current = null;
        }
        runtimeRef.current?.camera.dispose();
        runtimeRef.current?.components.dispose();
        runtimeRef.current = null;
      };
    }, []);

    return (
      <div className="relative h-full min-h-0 overflow-hidden [background:var(--viewport-bg)]">
        <div ref={containerRef} className="h-full min-h-0 w-full" />
        <span className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/90 px-2 py-1 text-[11px] font-semibold text-[color:var(--foreground)]">
          {label}
        </span>
      </div>
    );
  },
);
