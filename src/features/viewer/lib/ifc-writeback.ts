"use client";

import type {
  ViewerDataTableColumn,
  ViewerDataTableData,
  ViewerDataTableDraft,
  ViewerDataTableEdit,
  ViewerDataTableExportStatus,
  ViewerDataTableIssue,
} from "@/features/viewer/types";

type WebIfcModule = {
  IfcAPI: new () => IfcApiInstance;
};

type IfcWrappedValue = {
  type?: number;
  value?: unknown;
};

type IfcPropertyLine = {
  Name?: unknown;
  NominalValue?: IfcWrappedValue | null;
};

type IfcPropertySetLine = {
  Name?: unknown;
  HasProperties?: unknown[];
};

type IfcElementLine = Record<string, unknown> & {
  OwnerHistory?: unknown;
};

type IfcApiInstance = {
  properties: {
    getPropertySets: (
      modelId: number,
      elementId: number,
      recursive?: boolean,
      includeTypeProperties?: boolean,
    ) => Promise<unknown[]>;
  };
  SetWasmPath: (path: string, absolute?: boolean) => void;
  Init: () => Promise<void>;
  OpenModel: (bytes: Uint8Array) => number;
  GetLine: (modelId: number, expressId: number, flatten?: boolean, inverse?: boolean) => unknown;
  GetTypeCodeFromName: (typeName: string) => number;
  CreateIfcEntity: (modelId: number, type: number, ...args: unknown[]) => unknown;
  CreateIfcType: (modelId: number, type: number, value: unknown) => unknown;
  CreateIFCGloballyUniqueId: (modelId: number) => unknown;
  WriteLine: (modelId: number, line: unknown) => void;
  SaveModel: (modelId: number) => Uint8Array;
  CloseModel: (modelId: number) => void;
};

function downloadBytes(bytes: Uint8Array, fileName: string, type: string) {
  const buffer = new Uint8Array(bytes).buffer;
  const blob = new Blob([buffer], { type });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
}

async function loadWebIfc(): Promise<WebIfcModule> {
  return (await import("web-ifc")) as unknown as WebIfcModule;
}

function readWrappedValue(value: unknown) {
  if (value && typeof value === "object" && "value" in value) {
    return (value as IfcWrappedValue).value;
  }

  return value;
}

function resolveOwnerHistoryHandle(line: IfcElementLine) {
  return line?.OwnerHistory ?? null;
}

function buildSimpleType(
  api: IfcApiInstance,
  modelId: number,
  value: unknown,
  currentType?: number | null,
): IfcWrappedValue | null {
  if (value === undefined || value === null) {
    return null;
  }

  const typeCode =
    currentType ??
    (typeof value === "number"
      ? api.GetTypeCodeFromName("IFCREAL")
      : typeof value === "boolean"
        ? api.GetTypeCodeFromName("IFCBOOLEAN")
        : api.GetTypeCodeFromName("IFCLABEL"));

  return api.CreateIfcType(modelId, typeCode, value) as IfcWrappedValue;
}

function findPropertyByLabel(pset: IfcPropertySetLine, label: string) {
  const properties = Array.isArray(pset?.HasProperties) ? pset.HasProperties : [];
  return (
    properties.find((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      return String(readWrappedValue((entry as IfcPropertyLine).Name) ?? "") === label;
    }) ?? null
  ) as IfcPropertyLine | null;
}

async function findPropertySet(api: IfcApiInstance, modelId: number, elementId: number, group: string) {
  const propertySets = await api.properties.getPropertySets(modelId, elementId, true, true);
  return (
    propertySets.find((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }

      return String(readWrappedValue((entry as IfcPropertySetLine).Name) ?? "") === group;
    }) ?? null
  ) as IfcPropertySetLine | null;
}

function buildPropertySingleValue(
  api: IfcApiInstance,
  modelId: number,
  label: string,
  raw: unknown,
) {
  return api.CreateIfcEntity(
    modelId,
    api.GetTypeCodeFromName("IFCPROPERTYSINGLEVALUE"),
    api.CreateIfcType(modelId, api.GetTypeCodeFromName("IFCIDENTIFIER"), label),
    null,
    buildSimpleType(api, modelId, raw),
    null,
  ) as IfcPropertyLine;
}

function buildPropertySet(
  api: IfcApiInstance,
  modelId: number,
  ownerHistory: unknown,
  group: string,
  properties: unknown[],
) {
  return api.CreateIfcEntity(
    modelId,
    api.GetTypeCodeFromName("IFCPROPERTYSET"),
    api.CreateIFCGloballyUniqueId(modelId),
    ownerHistory,
    api.CreateIfcType(modelId, api.GetTypeCodeFromName("IFCLABEL"), group),
    null,
    properties,
  ) as IfcPropertySetLine;
}

function buildRelDefinesByProperties(
  api: IfcApiInstance,
  modelId: number,
  ownerHistory: unknown,
  elementId: number,
  propertySet: unknown,
) {
  return api.CreateIfcEntity(
    modelId,
    api.GetTypeCodeFromName("IFCRELDEFINESBYPROPERTIES"),
    api.CreateIFCGloballyUniqueId(modelId),
    ownerHistory,
    null,
    null,
    [{ type: 5, value: elementId }],
    propertySet,
  );
}

async function applyAttributeEdit(
  api: IfcApiInstance,
  modelId: number,
  elementId: number,
  column: ViewerDataTableColumn,
  edit: ViewerDataTableEdit,
): Promise<ViewerDataTableIssue | null> {
  if (!column.binding || column.binding.kind !== "attribute") {
    return {
      rowKey: edit.rowKey,
      columnKey: edit.columnKey,
      message: "Skipped an attribute edit without a valid binding.",
    };
  }

  const line = api.GetLine(modelId, elementId, false, false) as IfcElementLine | null;
  if (!line) {
    return {
      rowKey: edit.rowKey,
      columnKey: edit.columnKey,
      message: "The IFC element could not be resolved for export.",
    };
  }

  const currentValue = line[column.binding.name] as IfcWrappedValue | null | undefined;

  try {
    if (edit.value.state !== "present") {
      line[column.binding.name] = null;
    } else {
      line[column.binding.name] = buildSimpleType(
        api,
        modelId,
        edit.value.raw,
        typeof currentValue?.type === "number" ? currentValue.type : null,
      );
    }
    api.WriteLine(modelId, line);
    return null;
  } catch (error) {
    return {
      rowKey: edit.rowKey,
      columnKey: edit.columnKey,
      message: error instanceof Error ? error.message : "Failed to write the IFC attribute.",
    };
  }
}

async function applyPropertyEdit(
  api: IfcApiInstance,
  modelId: number,
  elementId: number,
  column: ViewerDataTableColumn,
  edit: ViewerDataTableEdit,
): Promise<ViewerDataTableIssue | null> {
  if (!column.binding || column.binding.kind !== "property") {
    return {
      rowKey: edit.rowKey,
      columnKey: edit.columnKey,
      message: "Skipped a property edit without a valid binding.",
    };
  }

  const element = api.GetLine(modelId, elementId, false, false) as IfcElementLine | null;
  if (!element) {
    return {
      rowKey: edit.rowKey,
      columnKey: edit.columnKey,
      message: "The IFC element could not be resolved for export.",
    };
  }

  const ownerHistory = resolveOwnerHistoryHandle(element);

  try {
    let propertySet = await findPropertySet(api, modelId, elementId, column.binding.group);
    let property = propertySet ? findPropertyByLabel(propertySet, column.binding.label) : null;

    if (property) {
      property.NominalValue =
        edit.value.state === "present"
          ? buildSimpleType(
              api,
              modelId,
              edit.value.raw,
              typeof property.NominalValue?.type === "number" ? property.NominalValue.type : null,
            )
          : null;
      api.WriteLine(modelId, property);
      return null;
    }

    if (edit.value.state !== "present") {
      return null;
    }

    property = buildPropertySingleValue(
      api,
      modelId,
      column.binding.label,
      edit.value.raw,
    ) as IfcPropertyLine;

    if (propertySet) {
      const existingProperties = Array.isArray(propertySet.HasProperties)
        ? [...propertySet.HasProperties]
        : [];
      existingProperties.push(property);
      propertySet.HasProperties = existingProperties;
      api.WriteLine(modelId, propertySet);
      return null;
    }

    propertySet = buildPropertySet(
      api,
      modelId,
      ownerHistory,
      column.binding.group,
      [property],
    ) as IfcPropertySetLine;
    const relation = buildRelDefinesByProperties(api, modelId, ownerHistory, elementId, propertySet);
    api.WriteLine(modelId, relation);
    return null;
  } catch (error) {
    return {
      rowKey: edit.rowKey,
      columnKey: edit.columnKey,
      message: error instanceof Error ? error.message : "Failed to write the IFC property.",
    };
  }
}

export async function exportEditedIfc(input: {
  baseData: ViewerDataTableData;
  draft: ViewerDataTableDraft | null;
  bytes: Uint8Array;
  fileName: string;
}): Promise<ViewerDataTableExportStatus> {
  if (!input.draft || input.draft.edits.length === 0) {
    return {
      phase: "error",
      message: "No imported edits are available to export.",
      issues: [],
    };
  }

  const { IfcAPI } = await loadWebIfc();
  const api = new IfcAPI();
  api.SetWasmPath("/wasm/", true);
  await api.Init();

  const rowMap = new Map(input.baseData.rows.map((row) => [row.key, row]));
  const columnMap = new Map(input.baseData.columns.map((column) => [column.key, column]));
  const issues: ViewerDataTableIssue[] = [];
  let appliedCount = 0;
  let modelId = -1;

  try {
    modelId = api.OpenModel(input.bytes);

    for (const edit of input.draft.edits) {
      const row = rowMap.get(edit.rowKey);
      const column = columnMap.get(edit.columnKey);
      if (!row || !column) {
        issues.push({
          rowKey: edit.rowKey,
          columnKey: edit.columnKey,
          message: "Skipped an edit because its row or column no longer exists.",
        });
        continue;
      }

      if (!column.editable || !column.binding) {
        issues.push({
          rowKey: edit.rowKey,
          columnKey: edit.columnKey,
          message: column.editableReason ?? "This column cannot be written back to IFC.",
        });
        continue;
      }

      const issue =
        column.binding.kind === "attribute"
          ? await applyAttributeEdit(api, modelId, row.localId, column, edit)
          : await applyPropertyEdit(api, modelId, row.localId, column, edit);
      if (issue) {
        issues.push(issue);
        continue;
      }

      appliedCount += 1;
    }

    const bytes = api.SaveModel(modelId);
    downloadBytes(bytes, input.fileName, "application/octet-stream");

    return {
      phase: issues.length > 0 ? "success" : "success",
      message:
        issues.length > 0
          ? `Exported IFC with ${appliedCount} applied edits and ${issues.length} skipped edits.`
          : `Exported IFC with ${appliedCount} applied edits.`,
      issues,
    };
  } catch (error) {
    return {
      phase: "error",
      message: error instanceof Error ? error.message : "Failed to export the edited IFC.",
      issues,
    };
  } finally {
    if (modelId >= 0) {
      api.CloseModel(modelId);
    }
  }
}
