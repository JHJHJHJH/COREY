export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export type ViewerTool = "select" | "measure" | "section";

export type ViewerInspectionValueState = "present" | "missing" | "empty" | "null" | "undefined";

export type ViewerValidationFailureSeverity = "warn" | "error";

export type ViewerValidationResult = "ok" | "warn" | "error";

export type ViewerValidationTarget =
  | {
      kind: "attribute";
      name: string;
    }
  | {
      kind: "property";
      group: string;
      label: string;
    };

export type ViewerValidationCheck =
  | {
      kind: "empty";
    }
  | {
      kind: "enum";
      allowedValues: string[];
    }
  | {
      kind: "numberRange";
      min: number | null;
      max: number | null;
    };

export interface ViewerValidationRule {
  id: string;
  ifcType: string;
  target: ViewerValidationTarget;
  check: ViewerValidationCheck;
  failSeverity: ViewerValidationFailureSeverity;
}

export interface ViewerValidationConfig {
  version: 1;
  rules: ViewerValidationRule[];
}

export interface ViewerValidationMatch {
  result: ViewerValidationResult;
  ruleId: string;
}

export interface ViewerValidationSummary {
  result: ViewerValidationResult | null;
  targetedRowCount: number;
  okCount: number;
  warnCount: number;
  errorCount: number;
}

export interface ViewerValidationValue {
  text: string;
  state: ViewerInspectionValueState;
}

export interface ViewerValidationRow {
  modelId: string;
  localId: number;
  ifcType: string | null;
  values: Record<string, ViewerValidationValue>;
}

export interface ViewerValidationElementResult {
  modelId: string;
  localId: number;
  result: ViewerValidationFailureSeverity;
  matchedRuleIds: string[];
}

export interface ViewerValidationRunPayload {
  version: number;
  sourceId: string;
  rules: ViewerValidationRule[];
  rows: ViewerValidationRow[];
}

export interface ViewerValidationRunResult {
  sourceId: string;
  results: ViewerValidationElementResult[];
}

export type ViewerValidationElementMap = Record<string, number[]>;

export interface ViewerValidationHighlights {
  warn: ViewerValidationElementMap;
  error: ViewerValidationElementMap;
}

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
  validation: ViewerValidationMatch | null;
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
  target: ViewerValidationTarget | null;
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
  modelId: string;
  localId: number;
  summaryRows: ViewerInspectionRow[];
  propertySets: ViewerInspectionGroup[];
  issueCount: number;
  validationSummary: ViewerValidationSummary | null;
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
