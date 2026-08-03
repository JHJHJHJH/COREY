export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export type ViewerTool = "select" | "measure" | "section";

export type ViewerInspectionValueState = "present" | "missing" | "empty" | "null" | "undefined";

export type ViewerValidationFailureSeverity = "warn" | "error";

/** `"issues"` means error-or-warn; `"all"` disables the filter entirely. */
export type ViewerValidationSeverityFilter =
  | "all"
  | "issues"
  | ViewerValidationFailureSeverity;

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
    }
  | {
      kind: "pattern";
      pattern: string;
      caseInsensitive: boolean;
    }
  | {
      kind: "boolean";
      expected: boolean;
    };

export interface ViewerValidationRule {
  id: string;
  ifcType: string;
  target: ViewerValidationTarget;
  check: ViewerValidationCheck;
  failSeverity: ViewerValidationFailureSeverity;
}

export interface ViewerValidationClause {
  id: string;
  title: string;
  rules: ViewerValidationRule[];
}

export interface ViewerValidationConfig {
  version: 2;
  clauses: ViewerValidationClause[];
}

export type ViewerRuleTemplateSourceKind = "starter" | "industry-mapping";

export interface ViewerRuleTemplateSummary {
  templateId: string;
  name: string;
  description: string;
  ruleCount: number;
  sourceKind: ViewerRuleTemplateSourceKind;
  sourceFileName: string | null;
  updatedAt: string;
}

export interface ViewerRuleTemplateRecord extends ViewerRuleTemplateSummary {
  config: ViewerValidationConfig;
}

export interface ViewerValidationRuleFailure {
  clauseId: string;
  clauseTitle: string;
  ruleId: string;
  result: ViewerValidationFailureSeverity;
  description: string;
}

export interface ViewerValidationClauseFailure {
  clauseId: string;
  clauseTitle: string;
  result: ViewerValidationFailureSeverity;
  rules: ViewerValidationRuleFailure[];
}

export interface ViewerValidationMatch {
  result: ViewerValidationResult;
  failedRuleCount: number;
  clauseFailures: ViewerValidationClauseFailure[];
}

export interface ViewerValidationSummary {
  result: ViewerValidationResult | null;
  targetedRowCount: number;
  okCount: number;
  warnCount: number;
  errorCount: number;
  failedClauseCount: number;
  failedClauses: ViewerValidationClauseFailure[];
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
  failedClauses: ViewerValidationClauseFailure[];
}

export interface ViewerValidationRunPayload {
  version: number;
  sourceId: string;
  clauses: ViewerValidationClause[];
  rows: ViewerValidationRow[];
}

export interface ViewerValidationRunResult {
  sourceId: string;
  results: ViewerValidationElementResult[];
  failedClauseCount: number;
  failedClauses: ViewerValidationClauseFailure[];
}

export interface ViewerValidationClauseTableView {
  clauseId: string;
  clauseTitle: string;
  result: ViewerValidationFailureSeverity;
  elementCount: number;
  rowKeys: string[];
}

export type ViewerValidationElementMap = Record<string, number[]>;

export interface ViewerValidationHighlights {
  warn: ViewerValidationElementMap;
  error: ViewerValidationElementMap;
}

/**
 * Per-severity membership for filtering. An element appears under *every* severity it failed
 * at, so one with both a warn and an error failure is in both sets.
 *
 * This is deliberately different from `ViewerValidationHighlights`, which buckets each element
 * by its single worst severity because the 3D view can only paint it one colour.
 */
export interface ViewerValidationSeverityElements {
  warn: ViewerElementIdMap;
  error: ViewerElementIdMap;
}

export interface ViewerValidationSeverityRowKeys {
  warn: Set<string>;
  error: Set<string>;
}

export interface ModelMetadata {
  name: string;
  size: number;
  loadStatus: LoadStatus;
  sourceId?: string;
  serverModelId?: string;
}

export interface ModelSourceResult {
  bytes: Uint8Array;
  metadata: ModelMetadata;
}

export type ModelSourceKind = "local-file" | "remote";

export type ModelSourceInput =
  | { kind: "file"; file: File }
  | { kind: "remote"; modelId: string };

export interface ModelSource {
  id: string;
  kind: ModelSourceKind;
  read(input: ModelSourceInput): Promise<ModelSourceResult>;
}

export interface ServerModelSummary {
  modelId: string;
  name: string;
  size: number;
  uploadedAt: string;
  versionCount?: number;
  latestVersion?: number;
  /** Change summary of the latest version, for the catalog's compact log line. */
  latestChangeSummary?: ModelVersionChangeSummary | null;
}

/**
 * Structural diff of a version against the previous latest version, computed
 * server-side when the version is uploaded and stored on the version row as
 * its change-log entry. `null` on `ServerModelVersionSummary` means there was
 * no previous version (initial upload) or the row predates this feature.
 */
export interface ModelVersionChangeSummary {
  comparedToVersion: number;
  baseElementCount: number;
  targetElementCount: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  /** Up to a few element display names per list, for tooltips. */
  examples: { added: string[]; removed: string[]; changed: string[] };
  computedAt: string;
  /** Present when the diff computation failed; counts are zero. */
  failed?: true;
}

export interface ServerModelVersionSummary {
  versionId: string;
  modelId: string;
  versionNumber: number;
  size: number;
  label: string | null;
  changeSummary: ModelVersionChangeSummary | null;
  uploadedAt: string;
}

export interface ModelCompareValue {
  text: string;
  state: ViewerInspectionValueState;
}

export interface ModelCompareElementRef {
  globalId: string;
  ifcType: string;
  name: string | null;
  baseExpressId: number | null;
  targetExpressId: number | null;
}

export interface ModelCompareFieldChange {
  /** Field key: "attribute:{name}", "property:{group}::{label}", or "attribute:type". */
  field: string;
  label: string;
  base: ModelCompareValue | null;
  target: ModelCompareValue | null;
}

export interface ModelCompareChangedElement extends ModelCompareElementRef {
  fields: ModelCompareFieldChange[];
  fieldsTruncated: boolean;
}

export interface ModelCompareValidationEntry extends ModelCompareElementRef {
  severity: ViewerValidationFailureSeverity;
  clauses: ViewerValidationClauseFailure[];
  elementAdded?: boolean;
  elementRemoved?: boolean;
}

export interface ModelCompareValidationSideSummary {
  failedElementCount: number;
  failedClauseCount: number;
}

export interface ModelCompareValidationDiff {
  base: ModelCompareValidationSideSummary;
  target: ModelCompareValidationSideSummary;
  resolved: ModelCompareValidationEntry[];
  introduced: ModelCompareValidationEntry[];
  stillFailing: ModelCompareValidationEntry[];
}

export interface ModelCompareSummary {
  baseElementCount: number;
  targetElementCount: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  truncated: boolean;
  warnings: string[];
}

export interface ModelCompareResult {
  modelId: string;
  baseVersion: number;
  targetVersion: number;
  summary: ModelCompareSummary;
  added: ModelCompareElementRef[];
  removed: ModelCompareElementRef[];
  changed: ModelCompareChangedElement[];
  validation: ModelCompareValidationDiff | null;
}

/** Everything the visual (side-by-side 3D) compare overlay needs to open. */
export interface VisualCompareRequest {
  modelId: string;
  name: string;
  baseVersion: number;
  targetVersion: number;
  /** The already-computed diff — the overlay never re-runs the compare. */
  result: ModelCompareResult;
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

export type ViewerDataTableEditableValueKind = "string" | "number" | "boolean";

export type ViewerDataTableColumnBinding =
  | {
      kind: "attribute";
      name: string;
    }
  | {
      kind: "property";
      group: string;
      label: string;
    };

export type ViewerDataTableCellSource = "ifc" | "draft";

export interface ViewerDataTableCellSnapshot {
  raw: unknown;
  text: string;
  state: ViewerInspectionValueState;
}

export interface ViewerDataTableCell {
  raw: unknown;
  text: string;
  state: ViewerInspectionValueState;
  source: ViewerDataTableCellSource;
  binding: ViewerDataTableColumnBinding | null;
  valueKind: ViewerDataTableEditableValueKind | null;
  original: ViewerDataTableCellSnapshot | null;
}

export type ViewerDataTableColumnKind = "base" | "attribute" | "property";

export type ViewerDataTableColumnOrigin = "ifc" | "import";

export interface ViewerDataTableColumn {
  key: string;
  label: string;
  kind: ViewerDataTableColumnKind;
  group: string | null;
  populatedRowCount: number;
  editable: boolean;
  editableReason: string | null;
  binding: ViewerDataTableColumnBinding | null;
  valueKind: ViewerDataTableEditableValueKind | null;
  origin: ViewerDataTableColumnOrigin;
  importHeader: string | null;
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

export type ViewerElementIdMap = Record<string, Set<number>>;

export interface ViewerDataTableDraftValue extends ViewerDataTableCellSnapshot {
  valueKind: ViewerDataTableEditableValueKind | null;
}

export interface ViewerDataTableEdit {
  rowKey: string;
  columnKey: string;
  value: ViewerDataTableDraftValue;
}

export interface ViewerDataTableCellEditRequest {
  rowKey: string;
  columnKey: string;
  raw: string;
}

export interface ViewerDataTableDraft {
  version: 2;
  sourceId: string;
  updatedAt: string;
  importedColumns: ViewerDataTableColumn[];
  edits: ViewerDataTableEdit[];
}

export interface ViewerDataTableIssue {
  rowKey: string | null;
  columnKey: string | null;
  message: string;
}

export interface ViewerDataTableImportReport {
  fileName: string;
  appliedEditCount: number;
  skippedCellCount: number;
  issues: ViewerDataTableIssue[];
}

export type ViewerDataTableExportPhase = "idle" | "running" | "success" | "error";

export interface ViewerDataTableExportStatus {
  phase: ViewerDataTableExportPhase;
  message: string;
  issues: ViewerDataTableIssue[];
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

export type ViewerDebugValue =
  | null
  | boolean
  | number
  | string
  | ViewerDebugValue[]
  | { [key: string]: ViewerDebugValue };

export interface ViewerDebugData {
  sampleItem: ViewerDebugValue | null;
  sampleLocalId: number | null;
  selectedItem: ViewerDebugValue | null;
  selectedLocalId: number | null;
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
  loadIfc(source: ModelSourceResult): Promise<void>;
  clearModel(): Promise<void>;
  selectNode(localId: number): Promise<void>;
  getHiddenElements(): ViewerElementIdMap | null;
  showAll(): Promise<void>;
  hideSelection(): Promise<void>;
  isolateSelection(): Promise<void>;
  isolateCategory(category: string): Promise<void>;
  isolateElements(elements: ViewerElementIdMap): Promise<void>;
  hideCategory(category: string): Promise<void>;
  focusSelection(): Promise<void>;
  clearMeasurements(): void;
  clearSections(): void;
  setTool(tool: ViewerTool): void;
}
