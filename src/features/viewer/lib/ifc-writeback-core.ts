import type {
  ViewerDataTableColumn,
  ViewerDataTableData,
  ViewerDataTableEdit,
  ViewerDataTableExportStatus,
  ViewerDataTableIssue,
  ViewerDataTableRow,
} from "@/features/viewer/types";
import {
  loadWebIfc,
  readWrappedValue,
  type IfcApiInstance,
  type IfcPropertyLine,
  type IfcPropertySetLine,
  type IfcWrappedValue,
} from "@/features/viewer/lib/ifc-node-core";

type IfcElementLine = Record<string, unknown> & {
  OwnerHistory?: unknown;
  IsDefinedBy?: Array<{ type: number; value: number }>;
  expressID?: number;
};

function resolveOwnerHistoryHandle(line: IfcElementLine) {
  return line?.OwnerHistory ?? null;
}

function buildSimpleType(
  api: IfcApiInstance,
  modelId: number,
  value: unknown,
  currentValue?: IfcWrappedValue | null,
): IfcWrappedValue | null {
  if (value === undefined || value === null) {
    return null;
  }

  const currentTypeName =
    typeof currentValue?.name === "string" && currentValue.name.trim().length > 0
      ? currentValue.name.trim().toUpperCase()
      : null;
  const fallbackTypeName =
    typeof value === "number"
      ? "IFCREAL"
      : typeof value === "boolean"
        ? "IFCBOOLEAN"
        : "IFCLABEL";
  const currentTypeCode = currentTypeName ? api.GetTypeCodeFromName(currentTypeName) : 0;
  const typeCode =
    Number.isFinite(currentTypeCode) && currentTypeCode > 0
      ? currentTypeCode
      : api.GetTypeCodeFromName(fallbackTypeName);

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
  ) as { expressID?: number };
}

function appendRelationHandle(
  handles: Array<{ type: number; value: number }> | undefined,
  expressId: number,
) {
  const nextHandles = Array.isArray(handles) ? [...handles] : [];
  if (nextHandles.some((handle) => handle.type === 5 && handle.value === expressId)) {
    return nextHandles;
  }

  nextHandles.push({ type: 5, value: expressId });
  return nextHandles;
}

function readRowGlobalId(row: ViewerDataTableRow) {
  const globalIdCell = row.cells.globalId;
  if (!globalIdCell || globalIdCell.state !== "present") {
    return null;
  }

  if (typeof globalIdCell.raw === "string" && globalIdCell.raw.trim().length > 0) {
    return globalIdCell.raw.trim();
  }

  if (typeof globalIdCell.text === "string" && globalIdCell.text.trim().length > 0) {
    return globalIdCell.text.trim();
  }

  return null;
}

function readLineGlobalId(line: unknown) {
  if (!line || typeof line !== "object") {
    return null;
  }

  const record = line as Record<string, unknown>;
  const globalId = readWrappedValue(record._guid) ?? readWrappedValue(record.GlobalId);
  return typeof globalId === "string" && globalId.trim().length > 0 ? globalId.trim() : null;
}

function buildExpressIdLookupByGlobalId(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes);
  const lookup = new Map<string, number>();
  const entityPattern = /#(\d+)\s*=\s*IFC[A-Z0-9_]+\s*\(\s*'([^']+)'/g;

  for (const match of text.matchAll(entityPattern)) {
    const expressId = Number(match[1]);
    const globalId = String(match[2] ?? "").trim();
    if (!globalId || !Number.isFinite(expressId)) {
      continue;
    }

    lookup.set(globalId, expressId);
  }

  return lookup;
}

function resolveElementExpressId(
  api: IfcApiInstance,
  modelId: number,
  row: ViewerDataTableRow,
  expressIdLookupByGlobalId: Map<string, number> | null,
) {
  const globalId = readRowGlobalId(row);
  const directLine = api.GetLine(modelId, row.localId, false, false);
  if (!directLine) {
    return globalId ? (expressIdLookupByGlobalId?.get(globalId) ?? null) : null;
  }

  if (!globalId) {
    return row.localId;
  }

  if (readLineGlobalId(directLine) === globalId) {
    return row.localId;
  }

  if (expressIdLookupByGlobalId?.has(globalId)) {
    return expressIdLookupByGlobalId.get(globalId) ?? null;
  }

  if (row.ifcType) {
    const typeCode = api.GetTypeCodeFromName(row.ifcType);
    if (Number.isFinite(typeCode) && typeCode > 0) {
      const ids = api.GetLineIDsWithType(modelId, typeCode);
      for (let index = 0; index < ids.size(); index += 1) {
        const expressId = ids.get(index);
        const line = api.GetLine(modelId, expressId, false, false);
        if (readLineGlobalId(line) === globalId) {
          return expressId;
        }
      }
    }
  }

  return null;
}

async function attachPropertySetToElement(
  api: IfcApiInstance,
  modelId: number,
  ownerHistory: unknown,
  element: IfcElementLine,
  elementId: number,
  propertySet: IfcPropertySetLine,
) {
  if (typeof propertySet.expressID !== "number") {
    return false;
  }

  const relation = buildRelDefinesByProperties(api, modelId, ownerHistory, elementId, propertySet);
  api.WriteLine(modelId, relation);
  if (typeof relation.expressID !== "number") {
    return false;
  }

  element.IsDefinedBy = appendRelationHandle(element.IsDefinedBy, relation.expressID);
  api.WriteLine(modelId, element);
  return true;
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
        currentValue,
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
              property.NominalValue,
            )
          : null;
      api.WriteLine(modelId, property);
      return null;
    }

    if (edit.value.state !== "present") {
      return null;
    }

    property = buildPropertySingleValue(api, modelId, column.binding.label, edit.value.raw);
    api.WriteLine(modelId, property);

    if (propertySet) {
      const existingProperties = Array.isArray(propertySet.HasProperties)
        ? [...propertySet.HasProperties]
        : [];
      existingProperties.push(property);
      propertySet.HasProperties = existingProperties;
      api.WriteLine(modelId, propertySet);
      return null;
    }

    propertySet = buildPropertySet(api, modelId, ownerHistory, column.binding.group, [property]);
    api.WriteLine(modelId, propertySet);
    if (typeof propertySet.expressID !== "number") {
      return {
        rowKey: edit.rowKey,
        columnKey: edit.columnKey,
        message: "Failed to create an IFC property set for export.",
      };
    }

    const attached = await attachPropertySetToElement(
      api,
      modelId,
      ownerHistory,
      element,
      elementId,
      propertySet,
    );
    if (!attached) {
      return {
        rowKey: edit.rowKey,
        columnKey: edit.columnKey,
        message: "Failed to attach the IFC property set to the element.",
      };
    }

    return null;
  } catch (error) {
    return {
      rowKey: edit.rowKey,
      columnKey: edit.columnKey,
      message: error instanceof Error ? error.message : "Failed to write the IFC property.",
    };
  }
}

export async function buildEditedIfcBytes(input: {
  data: ViewerDataTableData;
  bytes: Uint8Array;
  wasm?: {
    path: string;
    absolute?: boolean;
  };
}): Promise<ViewerDataTableExportStatus & { bytes: Uint8Array | null; appliedCount: number }> {
  const liveEdits: ViewerDataTableEdit[] = [];
  for (const row of input.data.rows) {
    for (const [columnKey, cell] of Object.entries(row.cells)) {
      if (cell.source !== "draft") {
        continue;
      }

      liveEdits.push({
        rowKey: row.key,
        columnKey,
        value: {
          raw: cell.raw,
          text: cell.text,
          state: cell.state,
          valueKind: cell.valueKind,
        },
      });
    }
  }

  if (liveEdits.length === 0) {
    return {
      bytes: null,
      appliedCount: 0,
      phase: "error",
      message: "No data-table edits are available to export.",
      issues: [],
    };
  }

  const { IfcAPI } = await loadWebIfc();
  const api = new IfcAPI();
  if (input.wasm) {
    api.SetWasmPath(input.wasm.path, input.wasm.absolute);
  }
  await api.Init();

  const rowMap = new Map(input.data.rows.map((row) => [row.key, row]));
  const columnMap = new Map(input.data.columns.map((column) => [column.key, column]));
  let expressIdLookupByGlobalId: Map<string, number> | null = null;
  const issues: ViewerDataTableIssue[] = [];
  let appliedCount = 0;
  let modelId = -1;

  try {
    modelId = api.OpenModel(input.bytes);

    for (const edit of liveEdits) {
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

      let elementId = resolveElementExpressId(api, modelId, row, null);
      if (elementId === null) {
        expressIdLookupByGlobalId ??= buildExpressIdLookupByGlobalId(input.bytes);
        elementId = resolveElementExpressId(api, modelId, row, expressIdLookupByGlobalId);
      }
      if (elementId === null) {
        issues.push({
          rowKey: edit.rowKey,
          columnKey: edit.columnKey,
          message: `The IFC element could not be resolved for export${readRowGlobalId(row) ? ` (GlobalId: ${readRowGlobalId(row)})` : ""}.`,
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
          ? await applyAttributeEdit(api, modelId, elementId, column, edit)
          : await applyPropertyEdit(api, modelId, elementId, column, edit);
      if (issue) {
        issues.push(issue);
        continue;
      }

      appliedCount += 1;
    }

    const bytes = api.SaveModel(modelId);
    return {
      bytes,
      appliedCount,
      phase: "success",
      message:
        issues.length > 0
          ? `Exported IFC with ${appliedCount} applied edits and ${issues.length} skipped edits. ${issues[0]?.message ?? ""}`.trim()
          : `Exported IFC with ${appliedCount} applied edits.`,
      issues,
    };
  } catch (error) {
    return {
      bytes: null,
      appliedCount,
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
