export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export type ViewerTool = "select" | "measure" | "section";

export type ViewerInspectionValueState = "present" | "missing" | "empty" | "null" | "undefined";

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

export interface ViewerInspectionValue {
  raw: unknown;
  text: string;
  state: ViewerInspectionValueState;
}

export interface ViewerDataTableCell {
  raw: unknown;
  text: string;
  state: ViewerInspectionValueState;
}

export type ViewerDataTableColumnKind = "base" | "attribute" | "property";

export interface ViewerDataTableColumn {
  key: string;
  label: string;
  kind: ViewerDataTableColumnKind;
  group: string | null;
  populatedRowCount: number;
}

export interface ViewerDataTableRow {
  key: string;
  modelId: string;
  localId: number;
  selection: ViewerSelection;
  cells: Record<string, ViewerDataTableCell>;
  searchText: string;
  ifcType: string | null;
}

export interface ViewerDataTableData {
  rows: ViewerDataTableRow[];
  columns: ViewerDataTableColumn[];
  ifcTypes: string[];
}

export type ViewerDataTableSortDirection = "asc" | "desc";

export interface ViewerDataTableSort {
  columnKey: string;
  direction: ViewerDataTableSortDirection;
}

export interface ViewerDataTableFilters {
  query: string;
  ifcType: string;
}

export interface ViewerDataTableState {
  phase: LoadStatus;
  message: string;
  data: ViewerDataTableData | null;
}

export interface ViewerInspectionRow {
  key: string;
  label: string;
  value: ViewerInspectionValue;
}

export interface ViewerInspectionGroup {
  key: string;
  title: string;
  subtitle: string | null;
  rows: ViewerInspectionRow[];
  issueCount: number;
}

export interface ViewerElementInspection {
  title: string;
  ifcType: ViewerInspectionValue;
  globalId: ViewerInspectionValue;
  modelId: string;
  localId: number;
  coreAttributes: ViewerInspectionRow[];
  propertySets: ViewerInspectionGroup[];
  issueCount: number;
}

export interface ViewerSelectionDetails {
  selection: ViewerSelection | null;
  inspection: ViewerElementInspection | null;
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
