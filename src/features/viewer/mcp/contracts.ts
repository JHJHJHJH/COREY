import type {
  ViewerDataTableColumnBinding,
  ViewerDataTableEditableValueKind,
  ViewerInspectionValueState,
  ViewerValidationClauseFailure,
  ViewerValidationFailureSeverity,
  ViewerValidationResult,
} from "@/features/viewer/types";

export type CoreyMcpTarget =
  | { kind: "session"; sessionId: string }
  | { kind: "stored"; modelId: string };

export type CoreyMcpFieldRef = ViewerDataTableColumnBinding;

export type CoreyMcpFieldPredicate =
  | {
      field: CoreyMcpFieldRef;
      operator: "exists" | "missing";
    }
  | {
      field: CoreyMcpFieldRef;
      operator: "eq" | "neq" | "contains" | "gt" | "gte" | "lt" | "lte";
      value: string | number | boolean;
    }
  | {
      field: CoreyMcpFieldRef;
      operator: "in";
      value: Array<string | number | boolean>;
    };

export interface CoreyMcpElementQuery {
  text?: string;
  ifcTypes?: string[];
  validation?: Array<"ok" | ViewerValidationFailureSeverity>;
  where?: CoreyMcpFieldPredicate[];
  cursor?: string;
  limit?: number;
}

export interface CoreyMcpExpectedValue {
  state: ViewerInspectionValueState;
  value?: string | number | boolean | null;
}

export interface CoreyMcpDraftEditRequest {
  globalId: string;
  field: CoreyMcpFieldRef;
  expected: CoreyMcpExpectedValue;
  value: string | number | boolean | null;
}

export interface CoreyMcpFieldDescriptor {
  field: CoreyMcpFieldRef;
  key: string;
  label: string;
  group: string | null;
  editable: boolean;
  editableReason: string | null;
  valueKind: ViewerDataTableEditableValueKind | null;
  populatedRowCount: number;
}

export interface CoreyMcpElementSummary {
  globalId: string | null;
  ifcType: string | null;
  name: string;
  localId: number;
  /** The element's single worst validation result. */
  validation: ViewerValidationResult;
  /** Every validation result the element belongs to, ordered by severity. */
  validationSeverities: ViewerValidationResult[];
}

export interface CoreyMcpValidationIssueSummary {
  globalId: string | null;
  ifcType: string | null;
  name: string | null;
  /** The element's single worst failure severity. */
  severity: ViewerValidationFailureSeverity;
  /** Every failure severity present on the element, ordered by severity. */
  severities: ViewerValidationFailureSeverity[];
  failedClauses: ViewerValidationClauseFailure[];
}

export interface CoreyMcpValidationSummary {
  rowCount: number;
  /** Unique elements with at least one validation issue. */
  evaluatedIssueCount: number;
  okCount: number;
  /** Elements with at least one warning; may overlap with errorCount. */
  warnCount: number;
  /** Elements with at least one error; may overlap with warnCount. */
  errorCount: number;
  failedClauseCount: number;
  failedClauses: ViewerValidationClauseFailure[];
}

export interface CoreyMcpQueryResult<Item> {
  total: number;
  items: Item[];
  nextCursor: string | null;
}

export interface CoreyMcpSessionDescriptor {
  sessionId: string;
  connectedAt: string;
  phase: "idle" | "loading" | "loaded" | "error";
  model: {
    name: string;
    sourceId: string | null;
    serverModelId: string | null;
    rowCount: number;
    columnCount: number;
    draftEditCount: number;
  } | null;
  selectedGlobalIds: string[];
  hiddenItemCount: number;
  revision: number;
}

export type CoreyMcpBridgeCommand =
  | {
      method: "get_model_summary";
      params: Record<string, never>;
    }
  | {
      method: "query_elements";
      params: { query?: CoreyMcpElementQuery };
    }
  | {
      method: "get_elements";
      params: { globalIds: string[] };
    }
  | {
      method: "get_validation_summary";
      params: Record<string, never>;
    }
  | {
      method: "query_validation_issues";
      params: {
        severities?: Array<"warn" | "error">;
        clauseIds?: string[];
        ifcTypes?: string[];
        cursor?: string;
        limit?: number;
      };
    }
  | {
      method: "apply_draft_edits";
      params: { edits: CoreyMcpDraftEditRequest[] };
    }
  | {
      method: "update_view";
      params: {
        action: "select" | "focus" | "hide" | "isolate" | "show_all" | "fit_model";
        globalIds?: string[];
        ifcType?: string;
      };
    }
  | {
      method: "open_stored_model";
      params: { modelId: string };
    }
  | {
      method: "refresh_draft";
      params: { modelId: string };
    };

export type CoreyMcpBrowserMessage =
  | {
      type: "hello";
      descriptor: CoreyMcpSessionDescriptor;
    }
  | {
      type: "state";
      descriptor: CoreyMcpSessionDescriptor;
    }
  | {
      type: "result";
      requestId: string;
      ok: true;
      value: unknown;
    }
  | {
      type: "result";
      requestId: string;
      ok: false;
      error: string;
    };

export type CoreyMcpServerMessage = {
  type: "command";
  requestId: string;
  command: CoreyMcpBridgeCommand;
};
