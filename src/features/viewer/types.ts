import type * as FRAGS from "@thatopen/fragments";

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export type ViewerTool = "select" | "measure" | "section";

export interface ModelMetadata {
  name: string;
  size: number;
  loadStatus: LoadStatus;
  sourceId?: string;
}

export interface ModelSourceResult {
  bytes: Uint8Array;
  metadata: ModelMetadata;
}

export interface ModelSource {
  id: string;
  kind: "local-file";
  read(file: File): Promise<ModelSourceResult>;
}

export interface ViewerTreeNode {
  key: string;
  localId: number | null;
  category: string | null;
  label: string;
  children: ViewerTreeNode[];
}

export interface ViewerCategorySummary {
  category: string;
  count: number;
}

export interface ViewerSelection {
  modelId: string;
  localId: number;
  label: string;
  category: string | null;
}

export interface ViewerSelectionDetails {
  selection: ViewerSelection | null;
  data: FRAGS.ItemData | null;
  loading: boolean;
}

export interface ViewerSessionState {
  activeTool: ViewerTool;
  selected: ViewerSelection | null;
  sectionCount: number;
  measurementCount: number;
  hiddenItemCount: number;
}

export interface ViewerStatus {
  phase: LoadStatus;
  message: string;
}

export interface ViewerViewportHandle {
  loadIfc(file: File): Promise<void>;
  clearModel(): Promise<void>;
  selectNode(localId: number): Promise<void>;
  showAll(): Promise<void>;
  hideSelection(): Promise<void>;
  isolateSelection(): Promise<void>;
  isolateCategory(category: string): Promise<void>;
  hideCategory(category: string): Promise<void>;
  focusSelection(): Promise<void>;
  clearMeasurements(): void;
  clearSections(): void;
  setTool(tool: ViewerTool): void;
}
