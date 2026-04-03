"use client";

import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
} from "react";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as FRAGS from "@thatopen/fragments";
import * as THREE from "three";
import {
  buildCategorySummary,
  buildSingleItemMap,
  buildViewerTree,
  countItems,
  getPrimarySelection,
  readNameMaps,
} from "@/features/viewer/lib/ifc-data";
import { LocalFileModelSource } from "@/features/viewer/lib/model-source";
import type {
  ModelMetadata,
  ViewerSelectionDetails,
  ViewerSessionState,
  ViewerStatus,
  ViewerTool,
  ViewerViewportHandle,
} from "@/features/viewer/types";

type IfcViewportProps = {
  embedded?: boolean;
  status: ViewerStatus;
  activeTool: ViewerTool;
  onStatusChange: (status: ViewerStatus) => void;
  onSessionChange: (session: ViewerSessionState) => void;
  onModelLoaded: (input: {
    metadata: ModelMetadata;
    tree: Awaited<ReturnType<typeof buildViewerTree>>;
    categories: Awaited<ReturnType<typeof buildCategorySummary>>;
  }) => void;
  onSelectionDetailsChange: (details: ViewerSelectionDetails) => void;
};

type ViewerRuntime = {
  components: OBC.Components;
  world: OBC.World;
  fragments: OBC.FragmentsManager;
  ifcLoader: OBC.IfcLoader;
  highlighter: OBF.Highlighter;
  hider: OBC.Hider;
  clipper: OBC.Clipper;
  measurer: OBF.LengthMeasurement;
  model: FRAGS.FragmentsModel | null;
  labels: Map<number, string>;
  categories: Map<number, string | null>;
  hiddenItems: OBC.ModelIdMap | null;
};

const source = new LocalFileModelSource();
const fragmentsWorkerUrl = new URL("@thatopen/fragments/worker", import.meta.url);

function toBox(boxes: THREE.Box3[]) {
  const aggregate = new THREE.Box3();
  for (const box of boxes) {
    aggregate.union(box);
  }
  return aggregate;
}

function hasRenderableBox(box: THREE.Box3) {
  return Number.isFinite(box.min.x) && Number.isFinite(box.max.x) && !box.isEmpty();
}

const selectionDetailsDataConfig = {
  attributesDefault: true,
  relations: {
    IsDefinedBy: { attributes: true, relations: true },
    HasAssociations: { attributes: true, relations: false },
  },
  relationsDefault: { attributes: false, relations: false },
} satisfies Partial<FRAGS.ItemsDataConfig>;

export const IfcViewport = forwardRef<ViewerViewportHandle, IfcViewportProps>(function IfcViewport(
  {
    embedded = false,
    status,
    activeTool,
    onModelLoaded,
    onSelectionDetailsChange,
    onSessionChange,
    onStatusChange,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const activeToolRef = useRef<ViewerTool>(activeTool);
  const loadSequenceRef = useRef(0);
  const selectionLoadSequenceRef = useRef(0);
  const selectionLoadTimerRef = useRef<number | null>(null);
  const fragmentsUpdateFrameRef = useRef<number | null>(null);
  const pendingFragmentsForceRef = useRef(false);

  const emitStatusChange = useEffectEvent(onStatusChange);
  const emitSelectionDetailsChange = useEffectEvent(onSelectionDetailsChange);
  const emitModelLoaded = useEffectEvent(onModelLoaded);
  const emitSessionChange = useEffectEvent(onSessionChange);

  const clearSelectionDetailsTimer = () => {
    if (selectionLoadTimerRef.current !== null) {
      window.clearTimeout(selectionLoadTimerRef.current);
      selectionLoadTimerRef.current = null;
    }
  };

  const clearQueuedFragmentsUpdate = () => {
    if (fragmentsUpdateFrameRef.current !== null) {
      window.cancelAnimationFrame(fragmentsUpdateFrameRef.current);
      fragmentsUpdateFrameRef.current = null;
    }

    pendingFragmentsForceRef.current = false;
  };

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

  const syncSession = useEffectEvent((selection: ViewerSessionState["selected"] | null) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    emitSessionChange({
      activeTool: activeToolRef.current,
      selected: selection,
      sectionCount: runtime.clipper.list.size,
      measurementCount: runtime.measurer.list.size,
      hiddenItemCount: countItems(runtime.hiddenItems),
    });
  });

  const resetSelectionDetails = useEffectEvent(() => {
    selectionLoadSequenceRef.current += 1;
    clearSelectionDetailsTimer();
    emitSelectionDetailsChange({
      selection: null,
      data: null,
      loading: false,
    });
  });

  const loadSelectionDetails = useEffectEvent((selection: ViewerSessionState["selected"] | null) => {
    const requestId = ++selectionLoadSequenceRef.current;
    clearSelectionDetailsTimer();

    const runtime = runtimeRef.current;
    if (!runtime || !runtime.model || !selection) {
      resetSelectionDetails();
      return;
    }

    emitSelectionDetailsChange({
      selection,
      data: null,
      loading: true,
    });

    selectionLoadTimerRef.current = window.setTimeout(() => {
      selectionLoadTimerRef.current = null;

      void (async () => {
        const activeRuntime = runtimeRef.current;
        if (!activeRuntime || !activeRuntime.model) {
          return;
        }

        try {
          const data = await activeRuntime.model.getItemsData(
            [selection.localId],
            selectionDetailsDataConfig,
          );

          if (selectionLoadSequenceRef.current !== requestId) {
            return;
          }

          const first = data[0] ?? null;
          if (first) {
            readNameMaps(first, selection.localId, activeRuntime.labels, activeRuntime.categories);
          }

          const enrichedSelection = {
            ...selection,
            label: activeRuntime.labels.get(selection.localId) ?? selection.label,
            category: activeRuntime.categories.get(selection.localId) ?? selection.category,
          };

          syncSession(enrichedSelection);
          emitSelectionDetailsChange({
            selection: enrichedSelection,
            data: first,
            loading: false,
          });
        } catch (error) {
          if (selectionLoadSequenceRef.current !== requestId) {
            return;
          }

          console.error("Failed to load selection details", error);
          emitSelectionDetailsChange({
            selection,
            data: null,
            loading: false,
          });
        }
      })();
    }, 80);
  });

  const syncSelectionFromMap = useEffectEvent((selectionMap: OBC.ModelIdMap) => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    const selection = getPrimarySelection(selectionMap, runtime.labels, runtime.categories);
    syncSession(selection);
    loadSelectionDetails(selection);
  });

  useEffect(() => {
    activeToolRef.current = activeTool;

    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }

    runtime.measurer.enabled = activeTool === "measure";
    runtime.clipper.enabled = activeTool === "section";
    syncSession(runtime.model ? getPrimarySelection(runtime.highlighter.selection.select, runtime.labels, runtime.categories) : null);
  }, [activeTool]);

  useImperativeHandle(ref, () => ({
    async loadIfc(file) {
      const runtime = runtimeRef.current;
      if (!runtime) {
        return;
      }

      await this.clearModel();
      const loadSequence = ++loadSequenceRef.current;

      const { bytes, metadata } = await source.read(file);

      emitStatusChange({
        phase: "loading",
        message: `Converting ${metadata.name} to fragments...`,
      });

      try {
        const importer = new FRAGS.IfcImporter();
        importer.wasm.path = runtime.ifcLoader.settings.wasm.path;
        importer.wasm.absolute = runtime.ifcLoader.settings.wasm.absolute;
        importer.webIfcSettings = runtime.ifcLoader.settings.webIfc;

        let lastProgress = -1;
        const fragmentsBytes = await importer.process({
          bytes,
          progressCallback: (progress) => {
            const normalized = Math.floor(progress);
            if (normalized === lastProgress || normalized % 5 !== 0) {
              return;
            }

            lastProgress = normalized;
            emitStatusChange({
              phase: "loading",
              message: `Converting ${metadata.name} to fragments... ${normalized}%`,
            });
          },
        });

        emitStatusChange({
          phase: "loading",
          message: `Loading ${metadata.name} into the viewer...`,
        });

        const model = await runtime.fragments.core.load(fragmentsBytes, {
          modelId: metadata.name,
          camera: runtime.world.camera.three as
            | THREE.PerspectiveCamera
            | THREE.OrthographicCamera,
        });
        runtime.model = model;
        runtime.hiddenItems = null;
        runtime.labels.clear();
        runtime.categories.clear();

        emitModelLoaded({
          metadata: { ...metadata, loadStatus: "loaded" },
          tree: [],
          categories: [],
        });

        emitStatusChange({
          phase: "loaded",
          message: `${metadata.name} loaded. Framing the view and indexing metadata...`,
        });

        syncSession(null);
        resetSelectionDetails();

        await runtime.fragments.core.update(true);

        const controls = runtime.world.camera.controls;
        const modelBox = model.box.clone();
        if (controls && hasRenderableBox(modelBox)) {
          await controls.fitToBox(modelBox, true, {
            paddingBottom: 0.2,
            paddingTop: 0.2,
            paddingLeft: 0.2,
            paddingRight: 0.2,
          });
        } else {
          console.warn("Loaded IFC model has an empty bounding box; skipping automatic framing.");
        }

        void (async () => {
          try {
            const [tree, categories] = await Promise.all([
              buildViewerTree(model, metadata.name),
              buildCategorySummary(model),
            ]);

            const activeRuntime = runtimeRef.current;
            if (
              !activeRuntime ||
              activeRuntime.model?.modelId !== model.modelId ||
              loadSequenceRef.current !== loadSequence
            ) {
              return;
            }

            emitModelLoaded({
              metadata: { ...metadata, loadStatus: "loaded" },
              tree,
              categories,
            });

            emitStatusChange({
              phase: "loaded",
              message: `${metadata.name} ready. Click to select, double-click to place tools.`,
            });
          } catch (indexingError) {
            const message =
              indexingError instanceof Error ? indexingError.message : "Unknown indexing error";
            console.error("Failed to index IFC metadata", indexingError);

            const activeRuntime = runtimeRef.current;
            if (
              !activeRuntime ||
              activeRuntime.model?.modelId !== model.modelId ||
              loadSequenceRef.current !== loadSequence
            ) {
              return;
            }

            emitStatusChange({
              phase: "loaded",
              message: `${metadata.name} rendered, but tree indexing failed: ${message}`,
            });
          }
        })();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown IFC load error";
        emitStatusChange({
          phase: "error",
          message: `Failed to load IFC: ${message}`,
        });
      }
    },
    async clearModel() {
      loadSequenceRef.current += 1;
      selectionLoadSequenceRef.current += 1;
      clearSelectionDetailsTimer();
      const runtime = runtimeRef.current;
      if (!runtime || !runtime.model) {
        void runtime?.highlighter.clear("select");
        if (runtime) {
          syncSession(null);
          resetSelectionDetails();
        }
        return;
      }

      const modelId = runtime.model.modelId;
      runtime.world.scene.three.remove(runtime.model.object);
      await runtime.fragments.core.disposeModel(modelId);
      runtime.model = null;
      runtime.hiddenItems = null;
      runtime.labels.clear();
      runtime.categories.clear();
      runtime.measurer.list.clear();
      runtime.clipper.deleteAll();
      await runtime.highlighter.clear("select");

      resetSelectionDetails();
      syncSession(null);
    },
    async selectNode(localId) {
      const runtime = runtimeRef.current;
      if (!runtime?.model) {
        return;
      }

      const selection = buildSingleItemMap(runtime.model.modelId, localId);
      await runtime.highlighter.highlightByID("select", selection);
    },
    async showAll() {
      const runtime = runtimeRef.current;
      if (!runtime) return;

      await runtime.hider.set(true);
      runtime.hiddenItems = null;
      syncSession(getPrimarySelection(runtime.highlighter.selection.select, runtime.labels, runtime.categories));
    },
    async hideSelection() {
      const runtime = runtimeRef.current;
      if (!runtime) return;

      const selection = runtime.highlighter.selection.select;
      if (OBC.ModelIdMapUtils.isEmpty(selection)) return;

      await runtime.hider.set(false, selection);
      runtime.hiddenItems = {
        ...runtime.hiddenItems,
        ...selection,
      };
      await runtime.highlighter.clear("select");
      syncSession(null);
      resetSelectionDetails();
    },
    async isolateSelection() {
      const runtime = runtimeRef.current;
      if (!runtime) return;

      const selection = runtime.highlighter.selection.select;
      if (OBC.ModelIdMapUtils.isEmpty(selection)) return;

      await runtime.hider.isolate(selection);
      const hiddenItems = await runtime.hider.getVisibilityMap(false);
      runtime.hiddenItems = Object.fromEntries(
        Object.entries(hiddenItems).map(([modelId, ids]) => [modelId, new Set(ids)]),
      );
      syncSession(getPrimarySelection(selection, runtime.labels, runtime.categories));
    },
    async isolateCategory(category) {
      const runtime = runtimeRef.current;
      if (!runtime?.model) return;

      const items = await runtime.model.getItemsOfCategories([new RegExp(`^${category}$`)]);
      const localIds = new Set(Object.values(items).flat());
      const selection = { [runtime.model.modelId]: localIds };
      await runtime.hider.isolate(selection);
      const hiddenItems = await runtime.hider.getVisibilityMap(false);
      runtime.hiddenItems = Object.fromEntries(
        Object.entries(hiddenItems).map(([modelId, ids]) => [modelId, new Set(ids)]),
      );
      syncSession(getPrimarySelection(runtime.highlighter.selection.select, runtime.labels, runtime.categories));
    },
    async hideCategory(category) {
      const runtime = runtimeRef.current;
      if (!runtime?.model) return;

      const items = await runtime.model.getItemsOfCategories([new RegExp(`^${category}$`)]);
      const localIds = new Set(Object.values(items).flat());
      const selection = { [runtime.model.modelId]: localIds };
      await runtime.hider.set(false, selection);
      runtime.hiddenItems = selection;
      syncSession(getPrimarySelection(runtime.highlighter.selection.select, runtime.labels, runtime.categories));
    },
    async focusSelection() {
      const runtime = runtimeRef.current;
      if (!runtime) return;

      const selection = runtime.highlighter.selection.select;
      if (OBC.ModelIdMapUtils.isEmpty(selection)) {
        const controls = runtime.world.camera.controls;
        if (runtime.model && controls) {
          const modelBox = runtime.model.box.clone();
          if (hasRenderableBox(modelBox)) {
            await controls.fitToBox(modelBox, true);
          }
        }
        return;
      }

      const boxes = await runtime.fragments.getBBoxes(selection);
      if (boxes.length === 0) {
        return;
      }

      const controls = runtime.world.camera.controls;
      const box = toBox(boxes);
      if (controls && hasRenderableBox(box)) {
        await controls.fitToBox(toBox(boxes), true, {
          paddingBottom: 0.25,
          paddingTop: 0.25,
          paddingLeft: 0.25,
          paddingRight: 0.25,
        });
      }
    },
    clearMeasurements() {
      const runtime = runtimeRef.current;
      if (!runtime) return;

      runtime.measurer.list.clear();
      syncSession(getPrimarySelection(runtime.highlighter.selection.select, runtime.labels, runtime.categories));
    },
    clearSections() {
      const runtime = runtimeRef.current;
      if (!runtime) return;

      runtime.clipper.deleteAll();
      syncSession(getPrimarySelection(runtime.highlighter.selection.select, runtime.labels, runtime.categories));
    },
    setTool(tool) {
      activeToolRef.current = tool;
      const runtime = runtimeRef.current;
      if (!runtime) return;

      runtime.measurer.enabled = tool === "measure";
      runtime.clipper.enabled = tool === "section";
      syncSession(getPrimarySelection(runtime.highlighter.selection.select, runtime.labels, runtime.categories));
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let cancelled = false;

    const initialize = async () => {
      const components = new OBC.Components();
      const worlds = components.get(OBC.Worlds);
      const world = worlds.create<
        OBC.SimpleScene,
        OBC.OrthoPerspectiveCamera,
        OBF.PostproductionRenderer
      >();
      world.scene = new OBC.SimpleScene(components);
      world.scene.setup({
        directionalLight: {
          color: new THREE.Color("#fff3dc"),
          intensity: 0.9,
          position: new THREE.Vector3(25, 50, 25),
        },
        ambientLight: {
          intensity: 0.8,
          color: new THREE.Color("#f3efe5"),
        },
      });
      world.scene.three.background = new THREE.Color("#e8e0d2");
      world.renderer = new OBF.PostproductionRenderer(components, container);
      world.camera = new OBC.OrthoPerspectiveCamera(components);
      await world.camera.controls?.setLookAt(18, 16, 18, 0, 0, 0);

      components.init();

      const fragments = components.get(OBC.FragmentsManager);
      fragments.init(fragmentsWorkerUrl.toString());

      const controls = world.camera.controls;
      const handleCameraUpdate = () => {
        scheduleFragmentsUpdate(false);
      };
      const handleCameraRest = () => {
        scheduleFragmentsUpdate(true);
      };
      controls?.addEventListener("update", handleCameraUpdate);
      controls?.addEventListener("rest", handleCameraRest);

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

      components.get(OBC.Raycasters).get(world);

      const highlighter = components.get(OBF.Highlighter);
      highlighter.multiple = "ctrlKey";
      highlighter.setup({
        world,
        selectMaterialDefinition: {
          color: new THREE.Color("#0b6e4f"),
          opacity: 1,
          transparent: false,
          renderedFaces: 0,
        },
      });
      highlighter.mouseMoveThreshold = 10;

      highlighter.events.select.onHighlight.add((selectionMap) => {
        syncSelectionFromMap(selectionMap);
      });

      highlighter.events.select.onClear.add(() => {
        syncSession(null);
        resetSelectionDetails();
      });

      const hider = components.get(OBC.Hider);

      const clipper = components.get(OBC.Clipper);
      clipper.setup({
        color: new THREE.Color("#b7552d"),
        opacity: 0.2,
        size: 5,
      });
      clipper.enabled = false;
      clipper.onAfterCreate.add(() => {
        syncSession(getPrimarySelection(highlighter.selection.select, runtimeRef.current?.labels ?? new Map(), runtimeRef.current?.categories ?? new Map()));
      });
      clipper.onAfterDelete.add(() => {
        syncSession(getPrimarySelection(highlighter.selection.select, runtimeRef.current?.labels ?? new Map(), runtimeRef.current?.categories ?? new Map()));
      });

      const ifcLoader = components.get(OBC.IfcLoader);
      await ifcLoader.setup({
        autoSetWasm: false,
        wasm: {
          path: "/wasm/",
          absolute: true,
        },
      });

      const measurer = components.get(OBF.LengthMeasurement);
      measurer.world = world;
      measurer.color = new THREE.Color("#27445d");
      measurer.enabled = false;
      measurer.snappings = [FRAGS.SnappingClass.POINT];

      runtimeRef.current = {
        components,
        world,
        fragments,
        ifcLoader,
        highlighter,
        hider,
        clipper,
        measurer,
        model: null,
        labels: new Map(),
        categories: new Map(),
        hiddenItems: null,
      };

      if (cancelled) {
        components.dispose();
        return;
      }

      emitStatusChange({
        phase: "idle",
        message: "Choose an IFC file to begin.",
      });
      syncSession(null);
    };

    void initialize();

    const handleDoubleClick = () => {
      const runtime = runtimeRef.current;
      if (!runtime) return;

      if (activeToolRef.current === "measure") {
        void runtime.measurer.create();
        syncSession(getPrimarySelection(runtime.highlighter.selection.select, runtime.labels, runtime.categories));
      }

      if (activeToolRef.current === "section") {
        void runtime.clipper.create(runtime.world);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const runtime = runtimeRef.current;
      if (!runtime) return;

      if (event.key === "Escape") {
        runtime.measurer.cancelCreation();
      }

      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }

      if (activeToolRef.current === "measure") {
        runtime.measurer.delete();
        syncSession(getPrimarySelection(runtime.highlighter.selection.select, runtime.labels, runtime.categories));
      }

      if (activeToolRef.current === "section") {
        void runtime.clipper.delete(runtime.world);
      }
    };

    container.addEventListener("dblclick", handleDoubleClick);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelled = true;
      clearSelectionDetailsTimer();
      clearQueuedFragmentsUpdate();
      container.removeEventListener("dblclick", handleDoubleClick);
      window.removeEventListener("keydown", handleKeyDown);
      runtimeRef.current?.components.dispose();
      runtimeRef.current = null;
    };
  }, []);

  return (
    <div
      className={`relative h-full min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top,#f6f1e8,transparent_40%),linear-gradient(180deg,#d8c8b0_0%,#c6b49a_100%)] ${
        embedded
          ? ""
          : "rounded-[2rem] border border-[color:var(--viewer-border)] shadow-[var(--viewer-shadow)]"
      }`}
    >
      <div ref={containerRef} className="h-full min-h-0 w-full" />
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 bg-[linear-gradient(180deg,transparent_0%,rgba(23,29,24,0.75)_100%)] px-5 pb-5 pt-20 text-sm text-white">
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <span>Click to select</span>
          <span>Ctrl + click for multi-select</span>
          <span>Double-click for {activeTool === "measure" ? "measurement points" : activeTool === "section" ? "section planes" : "tool placement"}</span>
          <span>Delete removes the active tool element</span>
        </div>
      </div>
      {status.phase !== "loaded" ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[color:var(--viewport-overlay)]">
          <div className="max-w-md rounded-[1.75rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/95 px-6 py-5 text-center shadow-[var(--viewer-shadow)] backdrop-blur">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              IFC Viewer
            </div>
            <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">{status.message}</div>
            <div className="mt-2 text-sm text-[color:var(--muted-ink)]">
              Upload an IFC file to render it with That Open components and inspect the BIM data in-browser.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});
