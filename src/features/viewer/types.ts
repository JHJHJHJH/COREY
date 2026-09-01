export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export type ViewerTool = "select" | "measure" | "section";

export type ViewerInspectionValueState = "present" | "missing" | "empty" | "null" | "undefined";

/**
 * A user-defined severity level. The set lives in `ViewerValidationConfig.severities`, so ids are
 * open strings rather than a closed union — compile-time exhaustiveness is traded for
 * configurability, and `buildViewerSeverityScale` in `features/viewer/lib/validation-severity.ts`
 * is the runtime replacement for it.
 */
export interface ViewerValidationSeverity {
  /** Stable slug referenced by `ViewerValidationRule.failSeverity`. `"ok"` is reserved. */
  id: string;
  label: string;
  /** Base colour as `#rrggbb`. Every other tone (border, background) is derived from it. */
  color: string;
  /** Rank. Higher is more severe, and wins the colour on an element with several failures. */
  order: number;
}

/** A severity id, resolved against the configured severity list. */
export type ViewerValidationFailureSeverity = string;

/** `"issues"` means "any severity"; `"all"` disables the filter entirely. */
export type ViewerValidationSeverityFilter =
  | "all"
  | "issues"
  | ViewerValidationFailureSeverity;

/** `"ok"` is the reserved non-failure result; anything else is a severity id. */
export type ViewerValidationResult = "ok" | ViewerValidationFailureSeverity;

/** The reserved result id that means "passed"; it can never be used as a severity id. */
export const VIEWER_VALIDATION_OK_RESULT = "ok";

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
      kind: "regex";
      regex: string;
      caseInsensitive: boolean;
    }
  | {
      kind: "boolean";
      expected: boolean;
    };

export interface ViewerValidationRule {
  id: string;
  ifcType: string;
  /**
   * Optional predefined-type filter, ANDed with `ifcType`. Blank or absent means the rule applies
   * to every element of `ifcType`. A subtype mismatch makes the rule inapplicable, never a failure.
   */
  subtype?: string;
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
  version: 4;
  /**
   * The configurable severity levels. Always non-empty after sanitizing, sorted by `order`
   * ascending. Every `ViewerValidationRule.failSeverity` resolves against this list.
   */
  severities: ViewerValidationSeverity[];
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
  /**
   * Elements counted per severity id, keyed by severity. An element is counted once, under its
   * worst severity, so `okCount` plus these totals equals `targetedRowCount`.
   */
  countsBySeverity: Record<string, number>;
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
  subtype: string | null;
  values: Record<string, ViewerValidationValue>;
}

export interface ViewerValidationElementResult {
  modelId: string;
  localId: number;
  result: ViewerValidationFailureSeverity;
  failedClauses: ViewerValidationClauseFailure[];
}

export interface ViewerValidationRunPayload {
  version: 4;
  sourceId: string;
  /** The severity scale the worker ranks failures against. */
  severities: ViewerValidationSeverity[];
  clauses: ViewerValidationClause[];
  rows: ViewerValidationRow[];
}

export interface ViewerValidationRunResult {
  sourceId: string;
  /** Echoed back so consumers can render results without re-reading the rules config. */
  severities: ViewerValidationSeverity[];
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

/**
 * Elements bucketed by their single *worst* severity, keyed by severity id — the 3D view can
 * only paint an element one colour, so the highest-order severity wins.
 */
export type ViewerValidationHighlights = Record<string, ViewerValidationElementMap>;

/**
 * Per-severity membership for filtering, keyed by severity id. An element appears under *every*
 * severity it failed at, so one with both a warn and an error failure is in both sets.
 *
 * This is deliberately different from `ViewerValidationHighlights`, which buckets each element
 * by its single worst severity.
 */
export type ViewerValidationSeverityElements = Record<string, ViewerElementIdMap>;

export type ViewerValidationSeverityRowKeys = Record<string, Set<string>>;

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

export type ViewerGraphNodeKind = "spatial" | "element" | "type" | "property" | "material" | "other";

export type ViewerGraphRelationGroup =
  | "spatial"
  | "type"
  | "property"
  | "association"
  | "connection"
  | "other";

export interface ViewerGraphNode {
  /** Model-scoped renderer id. Local ids are only stable inside one loaded model. */
  id: string;
  modelId: string;
  localId: number;
  globalId: string | null;
  ifcType: string | null;
  label: string;
  kind: ViewerGraphNodeKind;
  hasGeometry: boolean;
}

export interface ViewerGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceLocalId: number;
  targetLocalId: number;
  relation: string;
  relationGroup: ViewerGraphRelationGroup;
  /** Directional relation names observed while expanding either endpoint. */
  rawRelations: string[];
}

export interface ViewerGraphNeighborhoodRequest {
  /** `null` asks the viewport to use the model's first spatial root. */
  anchorLocalId: number | null;
  offset?: number;
  limit?: number;
}

export interface ViewerGraphNeighborhood {
  modelId: string;
  anchorLocalId: number;
  nodes: ViewerGraphNode[];
  edges: ViewerGraphEdge[];
  offset: number;
  nextOffset: number | null;
  totalRelationCount: number;
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
  subtype: string | null;
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

export interface ViewerKnowledgeProperty {
  group: string | null;
  name: string;
  value: string;
}

/** Serializable IFC context only; no That Open or WebGL objects cross the API boundary. */
export interface ViewerKnowledgeContext {
  modelId: string | null;
  expressId: number | null;
  label: string | null;
  ifcType: string | null;
  subtype: string | null;
  properties: ViewerKnowledgeProperty[];
}

export interface KnowledgeChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface KnowledgeChatRequest {
  question: string;
  history: KnowledgeChatTurn[];
  context?: ViewerKnowledgeContext;
}

export type KnowledgeSourceRole =
  | "requirement"
  | "glossary"
  | "ifc_property_guidance"
  | "preparation_guidance"
  | "mapping_guidance"
  | "controlled_value"
  | "change_log"
  | "source_note";

export interface KnowledgeEvidenceLocator {
  page?: number;
  bbox?: [number, number, number, number];
  sheet?: string;
  rowStart?: number;
  rowEnd?: number;
  cells?: string;
}

export interface KnowledgeStructuredField {
  label: string;
  value: string;
}

export interface KnowledgeCitation {
  id: string;
  evidenceId: string;
  documentId: string;
  title: string;
  edition: string | null;
  sourceKind: string;
  sourceRole: KnowledgeSourceRole;
  locator: KnowledgeEvidenceLocator;
  sectionPath: string[];
  excerpt: string;
  officialUrl: string | null;
  structuredFields?: KnowledgeStructuredField[];
  score: number;
}

export type KnowledgeChatStreamEvent =
  | { type: "status"; phase: "retrieving" | "generating" }
  | { type: "sources"; citations: KnowledgeCitation[] }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

export interface KnowledgeStatus {
  available: boolean;
  configured: boolean;
  revisionId: string | null;
  activatedAt: string | null;
  embeddingModel: string | null;
  documentCount: number;
  chunkCount: number;
  sources: Array<{ title: string; fileName: string; sha256: string; edition: string | null }>;
  message: string;
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
  getGraphNeighborhood(
    request: ViewerGraphNeighborhoodRequest,
  ): Promise<ViewerGraphNeighborhood>;
  selectNode(localId: number): Promise<void>;
  selectElements(localIds: number[]): Promise<void>;
  getHiddenElements(): ViewerElementIdMap | null;
  showAll(): Promise<void>;
  hideSelection(): Promise<void>;
  hideElements(localIds: number[]): Promise<void>;
  isolateSelection(): Promise<void>;
  isolateElements(localIds: number[]): Promise<void>;
  isolateCategory(category: string): Promise<void>;
  hideCategory(category: string): Promise<void>;
  focusSelection(): Promise<void>;
  fitModel(): Promise<void>;
  clearMeasurements(): void;
  clearSections(): void;
  setTool(tool: ViewerTool): void;
}
