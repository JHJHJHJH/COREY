import type {
  ViewerDataTableColumnBinding,
  ViewerDataTableEditableValueKind,
  ViewerInspectionValueState,
  ViewerValidationFailureSeverity,
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
  withinGlobalIds?: string[];
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

export interface CoreyMcpVector3 {
  x: number;
  y: number;
  z: number;
}

export interface CoreyMcpBounds {
  min: CoreyMcpVector3;
  max: CoreyMcpVector3;
  center: CoreyMcpVector3;
  size: CoreyMcpVector3;
}

export type CoreyMcpSpatialRelation = "aggregates" | "contains";

export interface CoreyMcpSpatialNode {
  globalId: string;
  expressId: number;
  ifcType: string;
  name: string | null;
  parentGlobalId: string | null;
  relation: CoreyMcpSpatialRelation | null;
  childCount: number;
  hasGeometry: boolean;
}

export interface CoreyMcpSpatialIndex {
  nodes: Record<string, CoreyMcpSpatialNode>;
  children: Record<string, string[]>;
  roots: string[];
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
  revision: string;
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
      method: "list_spatial_children";
      params: { parentGlobalId?: string; cursor?: string; limit?: number };
    }
  | {
      method: "get_geometry";
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
