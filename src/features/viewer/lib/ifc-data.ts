import type { ItemAttribute, ItemData, ItemsDataConfig, SpatialTreeItem } from "@thatopen/fragments";
import type * as OBC from "@thatopen/components";
import type {
  ViewerCategorySummary,
  ViewerDataTableCell,
  ViewerDataTableColumnBinding,
  ViewerDataTableColumn,
  ViewerDataTableData,
  ViewerDataTableEditableValueKind,
  ViewerDataTableFilters,
  ViewerDataTableRow,
  ViewerDataTableSort,
  ViewerElementInspection,
  ViewerDebugValue,
  ViewerGraphData,
  ViewerGraphEdge,
  ViewerGraphNode,
  ViewerGraphView,
  ViewerInspectionGroup,
  ViewerInspectionRow,
  ViewerInspectionValue,
  ViewerInspectionValueState,
  ViewerSelection,
  ViewerValidationTarget,
  ViewerTreeNode,
} from "@/features/viewer/types";

type NameMap = Map<number, string>;
type CategoryMap = Map<number, string | null>;

const PROPERTY_VALUE_FALLBACK_EXCLUSIONS = new Set([
  "type",
  "Name",
  "Description",
  "ObjectType",
  "GlobalId",
  "id",
  "expressID",
  "Unit",
  "UsageName",
]);

const VIEWER_DATA_TABLE_BASE_COLUMNS = [
  {
    key: "ifcType",
    label: "IFC Type",
    kind: "base",
    group: null,
    editable: false,
    editableReason: "Identity columns are read-only.",
    binding: {
      kind: "attribute",
      name: "type",
    } satisfies ViewerDataTableColumnBinding,
    valueKind: "string" satisfies ViewerDataTableEditableValueKind,
    origin: "ifc" as const,
    importHeader: null,
  },
  {
    key: "globalId",
    label: "GlobalId",
    kind: "base",
    group: null,
    editable: false,
    editableReason: "Identity columns are read-only.",
    binding: {
      kind: "attribute",
      name: "_guid",
    } satisfies ViewerDataTableColumnBinding,
    valueKind: "string" satisfies ViewerDataTableEditableValueKind,
    origin: "ifc" as const,
    importHeader: null,
  },
  {
    key: "name",
    label: "Name",
    kind: "base",
    group: null,
    editable: false,
    editableReason: "Identity columns are read-only.",
    binding: {
      kind: "attribute",
      name: "Name",
    } satisfies ViewerDataTableColumnBinding,
    valueKind: "string" satisfies ViewerDataTableEditableValueKind,
    origin: "ifc" as const,
    importHeader: null,
  },
] satisfies ReadonlyArray<Omit<ViewerDataTableColumn, "populatedRowCount">>;

const VIEWER_DATA_TABLE_ATTRIBUTE_EXCLUSIONS = new Set([
  "type",
  "_guid",
  "GlobalId",
  "Name",
  "id",
  "expressID",
]);

const DEFAULT_VIEWER_DATA_TABLE_COLUMN_PRIORITY = [
  "attribute:ObjectType",
  "attribute:Description",
  "attribute:PredefinedType",
  "attribute:Tag",
  "attribute:LongName",
  "attribute:OverallHeight",
  "attribute:OverallWidth",
];

const viewerDataTableDataConfig = {
  attributesDefault: true,
  relations: {
    IsDefinedBy: { attributes: true, relations: true },
  },
  relationsDefault: { attributes: false, relations: false },
} satisfies Partial<ItemsDataConfig>;

const DEFAULT_VIEWER_DATA_TABLE_CHUNK_SIZE = 200;

function isItemAttribute(value: ItemAttribute | ItemData[]): value is ItemAttribute {
  return typeof value === "object" && value !== null && "value" in value;
}

function readAttribute(data: ItemData, key: string) {
  const value = data[key];

  if (!value || Array.isArray(value) || !isItemAttribute(value)) {
    return null;
  }

  return value.value;
}

function hasAttribute(data: ItemData, key: string) {
  const value = data[key];
  return Boolean(value && !Array.isArray(value) && isItemAttribute(value));
}

function readAttributeText(data: ItemData, key: string) {
  const value = readAttribute(data, key);
  return typeof value === "string" ? value : null;
}

function readIfcCategory(data: ItemData) {
  return readAttributeText(data, "_category") ?? readAttributeText(data, "type");
}

function hasIfcCategory(data: ItemData) {
  return hasAttribute(data, "_category") || hasAttribute(data, "type");
}

function readIfcGuid(data: ItemData) {
  return readAttribute(data, "_guid") ?? readAttribute(data, "GlobalId");
}

function hasIfcGuid(data: ItemData) {
  return hasAttribute(data, "_guid") || hasAttribute(data, "GlobalId");
}

function readFirstText(data: ItemData, keys: string[]) {
  for (const key of keys) {
    const value = readAttributeText(data, key);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function readRelation(data: ItemData, key: string) {
  const value = data[key];
  return Array.isArray(value) ? value : [];
}

function humanizeKey(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
}

function normalizeValue(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    Object.keys(value as Record<string, unknown>).every((key) => key === "value" || key === "type")
  ) {
    return normalizeValue((value as { value: unknown }).value);
  }

  return value;
}

function getViewerDataTableValueKind(value: unknown): ViewerDataTableEditableValueKind | null {
  const normalized = normalizeValue(value);

  if (typeof normalized === "string") {
    return "string";
  }

  if (typeof normalized === "number" && Number.isFinite(normalized)) {
    return "number";
  }

  if (typeof normalized === "boolean") {
    return "boolean";
  }

  return null;
}

function formatValue(value: unknown): string {
  const normalized = normalizeValue(value);

  if (typeof normalized === "string") {
    return normalized;
  }

  if (
    typeof normalized === "number" ||
    typeof normalized === "boolean" ||
    typeof normalized === "bigint"
  ) {
    return String(normalized);
  }

  if (Array.isArray(normalized)) {
    return normalized.map((entry) => formatValue(entry)).join(", ");
  }

  if (normalized && typeof normalized === "object") {
    try {
      return JSON.stringify(normalized);
    } catch {
      return String(normalized);
    }
  }

  return String(normalized);
}

function buildInspectionValue(
  exists: boolean,
  value: unknown,
  missingText = "MISSING",
): ViewerInspectionValue {
  if (!exists) {
    return { raw: undefined, text: missingText, state: "missing", validation: null };
  }

  const normalized = normalizeValue(value);

  if (normalized === undefined) {
    return { raw: value, text: "Undefined", state: "undefined", validation: null };
  }

  if (normalized === null) {
    return { raw: value, text: "Null", state: "null", validation: null };
  }

  if (typeof normalized === "string" && normalized.trim().length === 0) {
    return { raw: value, text: "Empty string", state: "empty", validation: null };
  }

  if (Array.isArray(normalized) && normalized.length === 0) {
    return { raw: value, text: "Empty list", state: "empty", validation: null };
  }

  if (normalized && typeof normalized === "object" && Object.keys(normalized).length === 0) {
    return { raw: value, text: "Empty object", state: "empty", validation: null };
  }

  return {
    raw: value,
    text: formatValue(normalized),
    state: "present",
    validation: null,
  };
}

function combineInspectionValues(
  entries: [string, ViewerInspectionValue][],
  raw: Record<string, unknown>,
): ViewerInspectionValue {
  const state =
    entries.find(([, entry]) => entry.state !== "present")?.[1].state ?? ("present" satisfies ViewerInspectionValueState);

  const text = entries.map(([label, entry]) => `${label}: ${entry.text}`).join(" | ");

  return {
    raw,
    text,
    state,
    validation: null,
  };
}

function buildRow(
  key: string,
  label: string,
  exists: boolean,
  value: unknown,
  missingText?: string,
  target: ViewerValidationTarget | null = null,
) {
  return {
    key,
    label,
    target,
    value: buildInspectionValue(exists, value, missingText),
  } satisfies ViewerInspectionRow;
}

function toInspectionValueFromDataTableCell(cell: ViewerDataTableCell): ViewerInspectionValue {
  return {
    raw: cell.raw,
    text: cell.text,
    state: cell.state,
    validation: null,
  };
}

function matchesInspectionTarget(
  target: ViewerValidationTarget | null,
  binding: ViewerDataTableColumnBinding | null,
) {
  if (!target || !binding || target.kind !== binding.kind) {
    return false;
  }

  if (target.kind === "attribute" && binding.kind === "attribute") {
    return target.name === binding.name;
  }

  if (target.kind === "property" && binding.kind === "property") {
    return target.group === binding.group && target.label === binding.label;
  }

  return false;
}

function computeInspectionIssueCount(
  summaryRows: ViewerInspectionRow[],
  propertySets: ViewerInspectionGroup[],
) {
  return (
    summaryRows.reduce((count, row) => count + Number(row.value.state !== "present"), 0) +
    propertySets.reduce((count, group) => {
      const rowIssueCount = group.rows.reduce(
        (groupCount, row) => groupCount + Number(row.value.state !== "present"),
        0,
      );
      return count + rowIssueCount + Number(group.rows.length === 0);
    }, 0)
  );
}

function getDirectPropertyValueEntries(item: ItemData) {
  return Object.entries(item).filter(
    (entry): entry is [string, ItemAttribute] => {
      const [key, value] = entry;
      return (
        isItemAttribute(value) &&
        (key === "NominalValue" ||
          key === "EnumerationValues" ||
          key === "ListValues" ||
          key === "PropertyReference" ||
          key.endsWith("Value") ||
          key.endsWith("Values"))
      );
    },
  );
}

function getFallbackPropertyValueEntries(item: ItemData) {
  return Object.entries(item).filter(
    (entry): entry is [string, ItemAttribute] => {
      const [key, value] = entry;
      return isItemAttribute(value) && !PROPERTY_VALUE_FALLBACK_EXCLUSIONS.has(key);
    },
  );
}

function extractPropertyValue(item: ItemData) {
  const directEntries = getDirectPropertyValueEntries(item);

  if (directEntries.length === 1) {
    const [key, value] = directEntries[0];
    return buildInspectionValue(true, value.value, `MISSING ${humanizeKey(key)}`);
  }

  if (directEntries.length > 1) {
    return combineInspectionValues(
      directEntries.map(([key, value]) => [key, buildInspectionValue(true, value.value)]),
      Object.fromEntries(directEntries.map(([key, value]) => [key, value.value])),
    );
  }

  const fallbackEntries = getFallbackPropertyValueEntries(item);

  if (fallbackEntries.length === 1) {
    const [key, value] = fallbackEntries[0];
    return buildInspectionValue(true, value.value, `MISSING ${humanizeKey(key)}`);
  }

  if (fallbackEntries.length > 1) {
    return combineInspectionValues(
      fallbackEntries.map(([key, value]) => [key, buildInspectionValue(true, value.value)]),
      Object.fromEntries(fallbackEntries.map(([key, value]) => [key, value.value])),
    );
  }

  return buildInspectionValue(false, undefined, "MISSING value");
}

function isPropertyContainer(item: ItemData) {
  const type = readIfcCategory(item)?.toUpperCase();
  return (
    readRelation(item, "HasProperties").length > 0 ||
    readRelation(item, "Quantities").length > 0 ||
    type === "IFCPROPERTYSET" ||
    type === "IFCELEMENTQUANTITY"
  );
}

function resolvePropertyDefinitions(relation: ItemData) {
  if (isPropertyContainer(relation)) {
    return [relation];
  }

  const related = readRelation(relation, "RelatingPropertyDefinition").filter(isPropertyContainer);
  if (related.length > 0) {
    return related;
  }

  return Object.values(relation)
    .filter(Array.isArray)
    .flatMap((entries) => entries.filter(isPropertyContainer));
}

function flattenPropertyItem(
  item: ItemData,
  path: string[],
  visited: Set<object>,
  index: number,
): ViewerInspectionRow[] {
  if (visited.has(item)) {
    const fallbackLabel = readFirstText(item, ["Name", "UsageName"]) ?? `Property ${index + 1}`;
    return [
      {
        key: `${path.join("/")}:${fallbackLabel}:cycle`,
        label: [...path, fallbackLabel].join(" / "),
        target: null,
        value: buildInspectionValue(false, undefined, "Circular property reference"),
      },
    ];
  }

  const nextVisited = new Set(visited);
  nextVisited.add(item);

  const label = readFirstText(item, ["Name", "UsageName"]) ?? `Property ${index + 1}`;
  const nestedProperties = readRelation(item, "HasProperties");
  if (nestedProperties.length > 0) {
    return nestedProperties.flatMap((entry, childIndex) =>
      flattenPropertyItem(entry, [...path, label], nextVisited, childIndex),
    );
  }

  const nestedQuantities = readRelation(item, "Quantities");
  if (nestedQuantities.length > 0) {
    return nestedQuantities.flatMap((entry, childIndex) =>
      flattenPropertyItem(entry, [...path, label], nextVisited, childIndex),
    );
  }

  return [
    {
      key: `${path.join("/")}:${label}:${index}`,
      label: [...path, label].join(" / "),
      target: null,
      value: extractPropertyValue(item),
    },
  ];
}

function buildPropertyGroups(data: ItemData) {
  const seen = new Set<object>();
  const groups: ViewerInspectionGroup[] = [];

  for (const relation of readRelation(data, "IsDefinedBy")) {
    for (const definition of resolvePropertyDefinitions(relation)) {
      if (seen.has(definition)) {
        continue;
      }
      seen.add(definition);

      const title =
        readFirstText(definition, ["Name", "LongName"]) ??
        readIfcCategory(definition) ??
        "Unnamed Property Set";
      const rows = [
        ...readRelation(definition, "HasProperties").flatMap((entry, index) =>
          flattenPropertyItem(entry, [], new Set<object>(), index),
        ),
        ...readRelation(definition, "Quantities").flatMap((entry, index) =>
          flattenPropertyItem(entry, [], new Set<object>(), index),
        ),
      ];
      const issueCount =
        rows.reduce((count, row) => count + Number(row.value.state !== "present"), 0) +
        Number(rows.length === 0);

      groups.push({
        key: `${title}:${groups.length}`,
        title,
        subtitle: readIfcCategory(definition),
        rows: rows.map((row) => ({
          ...row,
          target: {
            kind: "property",
            group: title,
            label: row.label,
          },
        })),
        issueCount,
      });
    }
  }

  return groups;
}

export function buildSelectionInspection(
  selection: ViewerSelection,
  data: ItemData,
): ViewerElementInspection {
  const title =
    readFirstText(data, ["Name", "ObjectType"]) ??
    (selection.label.trim().length > 0 ? selection.label : null) ??
    selection.category ??
    `#${selection.localId}`;
  const summaryRows = [
    buildRow(
      "type",
      "type",
      hasIfcCategory(data),
      readIfcCategory(data),
      "MISSING IFC type",
      { kind: "attribute", name: "type" },
    ),
    buildRow(
      "GlobalId",
      "GlobalId",
      hasIfcGuid(data),
      readIfcGuid(data),
      "MISSING GlobalId",
      { kind: "attribute", name: "guid" },
    ),
    buildRow(
      "Name",
      "Name",
      hasAttribute(data, "Name"),
      readAttribute(data, "Name"),
      "MISSING name",
      { kind: "attribute", name: "Name" },
    ),
    buildRow(
      "Description",
      "Description",
      hasAttribute(data, "Description"),
      readAttribute(data, "Description"),
      "MISSING description",
      { kind: "attribute", name: "Description" },
    ),
    buildRow(
      "ObjectType",
      "ObjectType",
      hasAttribute(data, "ObjectType"),
      readAttribute(data, "ObjectType"),
      "MISSING object type",
      { kind: "attribute", name: "ObjectType" },
    ),
  ];
  const propertySets = buildPropertyGroups(data);
  const issueCount =
    summaryRows.reduce((count, row) => count + Number(row.value.state !== "present"), 0) +
    propertySets.reduce((count, group) => count + group.issueCount, 0);

  return {
    title,
    modelId: selection.modelId,
    localId: selection.localId,
    summaryRows,
    propertySets,
    issueCount,
    validationSummary: null,
  };
}

export function applyViewerDataTableToInspection(
  inspection: ViewerElementInspection | null,
  data: ViewerDataTableData | null,
): ViewerElementInspection | null {
  if (!inspection || !data) {
    return inspection;
  }

  const rowKey = `${inspection.modelId}:${inspection.localId}`;
  const row = data.rows.find((entry) => entry.key === rowKey);
  if (!row) {
    return inspection;
  }

  const columnMap = new Map(data.columns.map((column) => [column.key, column]));
  const appliedColumnKeys = new Set<string>();

  const summaryRows = inspection.summaryRows.map((summaryRow) => {
    for (const [columnKey, cell] of Object.entries(row.cells)) {
      const column = columnMap.get(columnKey);
      if (!column || !matchesInspectionTarget(summaryRow.target, column.binding)) {
        continue;
      }

      appliedColumnKeys.add(columnKey);
      return {
        ...summaryRow,
        value: toInspectionValueFromDataTableCell(cell),
      };
    }

    return summaryRow;
  });

  const propertySets = inspection.propertySets.map((group) => {
    const nextRows = group.rows.map((groupRow) => {
      for (const [columnKey, cell] of Object.entries(row.cells)) {
        const column = columnMap.get(columnKey);
        if (!column || !matchesInspectionTarget(groupRow.target, column.binding)) {
          continue;
        }

        appliedColumnKeys.add(columnKey);
        return {
          ...groupRow,
          value: toInspectionValueFromDataTableCell(cell),
        };
      }

      return groupRow;
    });

    return {
      ...group,
      rows: nextRows,
      issueCount: nextRows.reduce((count, groupRow) => count + Number(groupRow.value.state !== "present"), 0) + Number(nextRows.length === 0),
    };
  });

  const propertySetMap = new Map(propertySets.map((group) => [group.title, group]));
  const importedColumns = data.columns.filter(
    (column) =>
      column.origin === "import" &&
      column.binding?.kind === "property" &&
      row.cells[column.key] &&
      !appliedColumnKeys.has(column.key),
  );

  for (const column of importedColumns) {
    const cell = row.cells[column.key];
    const binding = column.binding;
    if (!cell || !binding || binding.kind !== "property") {
      continue;
    }

    const existingGroup = propertySetMap.get(binding.group);
    const nextRow = {
      key: `${binding.group}:${binding.label}:import`,
      label: binding.label,
      target: {
        kind: "property",
        group: binding.group,
        label: binding.label,
      } satisfies ViewerValidationTarget,
      value: toInspectionValueFromDataTableCell(cell),
    } satisfies ViewerInspectionRow;

    if (existingGroup) {
      if (existingGroup.rows.some((groupRow) => groupRow.label === binding.label)) {
        continue;
      }

      existingGroup.rows = [...existingGroup.rows, nextRow];
      existingGroup.issueCount =
        existingGroup.rows.reduce((count, groupRow) => count + Number(groupRow.value.state !== "present"), 0) +
        Number(existingGroup.rows.length === 0);
      continue;
    }

    const nextGroup = {
      key: `${binding.group}:import`,
      title: binding.group,
      subtitle: "IFCPROPERTYSET",
      rows: [nextRow],
      issueCount: Number(nextRow.value.state !== "present"),
    } satisfies ViewerInspectionGroup;
    propertySets.push(nextGroup);
    propertySetMap.set(nextGroup.title, nextGroup);
  }

  return {
    ...inspection,
    summaryRows,
    propertySets,
    issueCount: computeInspectionIssueCount(summaryRows, propertySets),
  };
}

function ensureViewerDataTableColumn(
  columnMap: Map<string, ViewerDataTableColumn>,
  column: Omit<ViewerDataTableColumn, "populatedRowCount">,
) {
  const existing = columnMap.get(column.key);
  if (existing) {
    if (!existing.valueKind && column.valueKind) {
      existing.valueKind = column.valueKind;
    }

    if (!existing.binding && column.binding) {
      existing.binding = column.binding;
    }

    if (!existing.editable && column.editable) {
      existing.editable = true;
      existing.editableReason = column.editableReason;
    } else if (existing.editableReason === null && column.editableReason) {
      existing.editableReason = column.editableReason;
    }

    return existing;
  }

  const created = {
    ...column,
    populatedRowCount: 0,
  } satisfies ViewerDataTableColumn;
  columnMap.set(column.key, created);
  return created;
}

function mergeViewerDataTableCell(
  current: ViewerDataTableCell | undefined,
  next: ViewerDataTableCell,
): ViewerDataTableCell {
  if (!current) {
    return next;
  }

  if (current.text === next.text && current.state === next.state) {
    return current;
  }

  const text = [...new Set([current.text, next.text])].join(" | ");
  const state =
    current.state === "present" && next.state === "present"
      ? "present"
      : current.state !== "present"
        ? current.state
        : next.state;

  return {
    raw: [current.raw, next.raw],
    text,
    state,
    source: current.source,
    binding: current.binding ?? next.binding,
    valueKind: current.valueKind ?? next.valueKind,
    original: null,
  };
}

function buildViewerDataTableAttributeColumnKey(attributeName: string) {
  return `attribute:${attributeName}`;
}

function buildViewerDataTablePropertyColumnKey(group: string, label: string) {
  return `property:${group}::${label}`;
}

function buildViewerDataTableCell(
  exists: boolean,
  value: unknown,
  missingText = "MISSING",
  options?: {
    binding?: ViewerDataTableColumnBinding | null;
    valueKind?: ViewerDataTableEditableValueKind | null;
  },
): ViewerDataTableCell {
  const inspectionValue = buildInspectionValue(exists, value, missingText);

  return {
    raw: inspectionValue.raw,
    text: inspectionValue.text,
    state: inspectionValue.state,
    source: "ifc",
    binding: options?.binding ?? null,
    valueKind: options?.valueKind ?? getViewerDataTableValueKind(value),
    original: null,
  };
}

function buildViewerDataTableSearchText(
  columns: ViewerDataTableColumn[],
  cells: Record<string, ViewerDataTableCell>,
) {
  const columnMap = new Map(columns.map((column) => [column.key, column]));
  const searchParts: string[] = [];

  for (const [columnKey, cell] of Object.entries(cells)) {
    const column = columnMap.get(columnKey);
    if (!column || cell.state !== "present") {
      continue;
    }

    searchParts.push(toViewerDataTableSearchPart(column, cell));
  }

  return searchParts.join(" ");
}

function toViewerDataTableSearchPart(column: ViewerDataTableColumn, cell: ViewerDataTableCell) {
  const parts = [column.group, column.label, cell.text].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return parts.join(" ").toLowerCase();
}

function buildViewerDataTableRow(
  modelId: string,
  localId: number,
  data: ItemData,
  columnMap: Map<string, ViewerDataTableColumn>,
  fallbackIfcType: string | null,
): ViewerDataTableRow {
  const cells: Record<string, ViewerDataTableCell> = {};

  for (const column of VIEWER_DATA_TABLE_BASE_COLUMNS) {
    ensureViewerDataTableColumn(columnMap, column);
  }

  cells.ifcType = buildViewerDataTableCell(
    hasIfcCategory(data),
    readIfcCategory(data),
    "MISSING",
    {
      binding: {
        kind: "attribute",
        name: "type",
      },
      valueKind: "string",
    },
  );
  if (cells.ifcType.state !== "present" && fallbackIfcType) {
    cells.ifcType = buildViewerDataTableCell(true, fallbackIfcType, "MISSING", {
      binding: {
        kind: "attribute",
        name: "type",
      },
      valueKind: "string",
    });
  }
  cells.globalId = buildViewerDataTableCell(
    hasIfcGuid(data),
    readIfcGuid(data),
    "MISSING",
    {
      binding: {
        kind: "attribute",
        name: "_guid",
      },
      valueKind: "string",
    },
  );
  cells.name = buildViewerDataTableCell(
    hasAttribute(data, "Name"),
    readAttribute(data, "Name"),
    "MISSING",
    {
      binding: {
        kind: "attribute",
        name: "Name",
      },
      valueKind: "string",
    },
  );

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) || !isItemAttribute(value) || VIEWER_DATA_TABLE_ATTRIBUTE_EXCLUSIONS.has(key)) {
      continue;
    }

    const column = ensureViewerDataTableColumn(columnMap, {
      key: buildViewerDataTableAttributeColumnKey(key),
      label: humanizeKey(key),
      kind: "attribute",
      group: "IFC Attributes",
      editable: getViewerDataTableValueKind(value.value) !== null,
      editableReason:
        getViewerDataTableValueKind(value.value) !== null
          ? null
          : "Only scalar IFC attribute values can be edited.",
      binding: {
        kind: "attribute",
        name: key,
      },
      valueKind: getViewerDataTableValueKind(value.value),
      origin: "ifc",
      importHeader: null,
    });
    cells[column.key] = mergeViewerDataTableCell(
      cells[column.key],
      buildViewerDataTableCell(true, value.value, "MISSING", {
        binding: column.binding,
        valueKind: column.valueKind,
      }),
    );
  }

  for (const group of buildPropertyGroups(data)) {
    for (const row of group.rows) {
      const rowValueKind = getViewerDataTableValueKind(row.value.raw);
      const column = ensureViewerDataTableColumn(columnMap, {
        key: buildViewerDataTablePropertyColumnKey(group.title, row.label),
        label: row.label,
        kind: "property",
        group: group.title,
        editable: rowValueKind !== null,
        editableReason:
          rowValueKind !== null ? null : "Only scalar property values can be edited.",
        binding: {
          kind: "property",
          group: group.title,
          label: row.label,
        },
        valueKind: rowValueKind,
        origin: "ifc",
        importHeader: null,
      });
      cells[column.key] = mergeViewerDataTableCell(
        cells[column.key],
        {
          raw: row.value.raw,
          text: row.value.text,
          state: row.value.state,
          source: "ifc",
          binding: column.binding,
          valueKind: column.valueKind,
          original: null,
        },
      );
    }
  }

  for (const [columnKey, cell] of Object.entries(cells)) {
    const column = columnMap.get(columnKey);
    if (!column || cell.state !== "present") {
      continue;
    }

    column.populatedRowCount += 1;
  }

  const ifcType = cells.ifcType.state === "present" ? cells.ifcType.text : null;
  const label =
    (cells.name.state === "present" ? cells.name.text : null) ??
    readFirstText(data, ["ObjectType"]) ??
    ifcType ??
    `#${localId}`;

  return {
    key: `${modelId}:${localId}`,
    modelId,
    localId,
    selection: {
      modelId,
      localId,
      label,
      category: ifcType,
    },
    cells,
    searchText: buildViewerDataTableSearchText([...columnMap.values()], cells),
    ifcType,
  };
}

function sortViewerDataTableColumns(columns: ViewerDataTableColumn[]) {
  return [...columns].sort((left, right) => {
    if (left.kind !== right.kind) {
      if (left.kind === "attribute") {
        return -1;
      }

      if (right.kind === "attribute") {
        return 1;
      }
    }

    if (left.populatedRowCount !== right.populatedRowCount) {
      return right.populatedRowCount - left.populatedRowCount;
    }

    const groupComparison = (left.group ?? "").localeCompare(right.group ?? "", undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (groupComparison !== 0) {
      return groupComparison;
    }

    return left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function toSortableValue(value: unknown) {
  const normalized = normalizeValue(value);

  if (typeof normalized === "number") {
    return normalized;
  }

  if (typeof normalized === "boolean") {
    return normalized ? 1 : 0;
  }

  if (typeof normalized === "bigint") {
    return Number(normalized);
  }

  if (typeof normalized === "string") {
    const trimmed = normalized.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }

    return trimmed.toLowerCase();
  }

  if (Array.isArray(normalized)) {
    return normalized.map((entry) => formatValue(entry)).join(" | ").toLowerCase();
  }

  if (normalized && typeof normalized === "object") {
    try {
      return JSON.stringify(normalized).toLowerCase();
    } catch {
      return String(normalized).toLowerCase();
    }
  }

  return "";
}

function compareViewerDataTableCells(
  left: ViewerDataTableCell | undefined,
  right: ViewerDataTableCell | undefined,
  direction: ViewerDataTableSort["direction"],
) {
  const leftPresent = left?.state === "present";
  const rightPresent = right?.state === "present";

  if (leftPresent !== rightPresent) {
    return leftPresent ? -1 : 1;
  }

  if (!left || !right) {
    return 0;
  }

  const leftValue = toSortableValue(left.raw);
  const rightValue = toSortableValue(right.raw);

  let comparison = 0;
  if (typeof leftValue === "number" && typeof rightValue === "number") {
    comparison = leftValue - rightValue;
  } else {
    comparison = String(leftValue).localeCompare(String(rightValue), undefined, {
      numeric: true,
      sensitivity: "base",
    });
  }

  return direction === "asc" ? comparison : -comparison;
}

export async function buildViewerDataTable(
  model: {
    modelId: string;
    getItemsIdsWithGeometry?: () => Promise<number[]>;
    getSpatialStructure?: () => Promise<SpatialTreeItem>;
    getLocalIds?: () => Promise<number[]>;
    getItemsCategories?: (ids: number[]) => (string | null)[];
    getItemsData: (ids: number[], config?: Partial<ItemsDataConfig>) => Promise<ItemData[]>;
  },
  options?: {
    chunkSize?: number;
    onProgress?: (input: { processedRowCount: number; totalRowCount: number }) => void;
  },
) {
  const orderedIdSet = new Set<number>();

  if (model.getItemsIdsWithGeometry) {
    try {
      for (const localId of await model.getItemsIdsWithGeometry()) {
        orderedIdSet.add(localId);
      }
    } catch (error) {
      console.warn("Failed to resolve geometry item IDs for data table indexing", error);
    }
  }

  if (model.getSpatialStructure) {
    try {
      const spatialTree = await model.getSpatialStructure();
      collectLocalIds(spatialTree, orderedIdSet);
    } catch (error) {
      console.warn("Failed to resolve spatial structure IDs for data table indexing", error);
    }
  }

  if (orderedIdSet.size === 0 && model.getLocalIds) {
    try {
      for (const localId of await model.getLocalIds()) {
        orderedIdSet.add(localId);
      }
    } catch (error) {
      console.warn("Failed to resolve model local IDs for data table indexing", error);
    }
  }

  const orderedIds = [...orderedIdSet].sort((left, right) => left - right);
  const columnMap = new Map<string, ViewerDataTableColumn>(
    VIEWER_DATA_TABLE_BASE_COLUMNS.map((column) => [
      column.key,
      {
        ...column,
        populatedRowCount: 0,
      } satisfies ViewerDataTableColumn,
    ]),
  );
  const rows: ViewerDataTableRow[] = [];

  if (orderedIds.length === 0) {
    return {
      rows,
      columns: VIEWER_DATA_TABLE_BASE_COLUMNS.map((column) => ({
        ...column,
        populatedRowCount: 0,
      })),
      ifcTypes: [],
    } satisfies ViewerDataTableData;
  }

  const chunkSize = Math.max(1, options?.chunkSize ?? DEFAULT_VIEWER_DATA_TABLE_CHUNK_SIZE);

  for (let index = 0; index < orderedIds.length; index += chunkSize) {
    const chunkIds = orderedIds.slice(index, index + chunkSize);
    const items = await model.getItemsData(chunkIds, viewerDataTableDataConfig);
    const categories = model.getItemsCategories?.(chunkIds) ?? [];

    for (const [chunkIndex, localId] of chunkIds.entries()) {
      const item = items[chunkIndex];
      if (!item) {
        continue;
      }

      rows.push(
        buildViewerDataTableRow(
          model.modelId,
          localId,
          item,
          columnMap,
          categories[chunkIndex] ?? null,
        ),
      );
    }

    options?.onProgress?.({
      processedRowCount: Math.min(index + chunkIds.length, orderedIds.length),
      totalRowCount: orderedIds.length,
    });
  }

  const dynamicColumns = sortViewerDataTableColumns(
    [...columnMap.values()].filter((column) => column.kind !== "base"),
  );
  const ifcTypes = [...new Set(rows.map((row) => row.ifcType).filter((value): value is string => Boolean(value)))].sort(
    (left, right) =>
      left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
  );

  return {
    rows,
    columns: [
      ...VIEWER_DATA_TABLE_BASE_COLUMNS.map((column) => columnMap.get(column.key) ?? {
        ...column,
        populatedRowCount: 0,
      }),
      ...dynamicColumns,
    ],
    ifcTypes,
  } satisfies ViewerDataTableData;
}

export function getDefaultViewerDataTableColumnKeys(
  columns: ViewerDataTableColumn[],
  maxDynamicColumns = 6,
) {
  const baseKeys = columns.filter((column) => column.kind === "base").map((column) => column.key);
  const dynamicColumns = columns.filter((column) => column.kind !== "base");

  const prioritizedColumns = [...dynamicColumns].sort((left, right) => {
    const leftPriority = DEFAULT_VIEWER_DATA_TABLE_COLUMN_PRIORITY.indexOf(left.key);
    const rightPriority = DEFAULT_VIEWER_DATA_TABLE_COLUMN_PRIORITY.indexOf(right.key);
    const normalizedLeftPriority = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
    const normalizedRightPriority = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;

    if (normalizedLeftPriority !== normalizedRightPriority) {
      return normalizedLeftPriority - normalizedRightPriority;
    }

    if (left.populatedRowCount !== right.populatedRowCount) {
      return right.populatedRowCount - left.populatedRowCount;
    }

    return left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  return [
    ...baseKeys,
    ...prioritizedColumns
      .filter((column) => column.populatedRowCount > 0)
      .slice(0, Math.max(0, maxDynamicColumns))
      .map((column) => column.key),
  ];
}

export function filterViewerDataTableRows(
  rows: ViewerDataTableRow[],
  filters: ViewerDataTableFilters,
) {
  const normalizedQuery = filters.query.trim().toLowerCase();
  const normalizedIfcType = filters.ifcType.trim();

  return rows.filter((row) => {
    if (normalizedIfcType.length > 0 && row.ifcType !== normalizedIfcType) {
      return false;
    }

    if (normalizedQuery.length > 0 && !row.searchText.includes(normalizedQuery)) {
      return false;
    }

    return true;
  });
}

export function sortViewerDataTableRows(
  rows: ViewerDataTableRow[],
  sort: ViewerDataTableSort | null,
) {
  if (!sort) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    const comparison = compareViewerDataTableCells(
      left.cells[sort.columnKey],
      right.cells[sort.columnKey],
      sort.direction,
    );
    if (comparison !== 0) {
      return comparison;
    }

    return left.localId - right.localId;
  });
}

function buildLabel(
  localId: number | null,
  category: string | null,
  names: NameMap,
  fallback: string,
) {
  if (localId !== null) {
    const named = names.get(localId);

    if (typeof named === "string" && named.trim().length > 0) {
      return named;
    }
  }

  if (category) {
    return category;
  }

  if (localId !== null) {
    return `#${localId}`;
  }

  return fallback;
}

function collectLocalIds(node: SpatialTreeItem, collector: Set<number>) {
  if (node.localId !== null) {
    collector.add(node.localId);
  }

  for (const child of node.children ?? []) {
    collectLocalIds(child, collector);
  }
}

function toTreeNode(
  modelId: string,
  node: SpatialTreeItem,
  names: NameMap,
  fallback: string,
): ViewerTreeNode {
  const localId = node.localId;
  const label = buildLabel(localId, node.category, names, fallback);
  const key =
    localId === null
      ? `${modelId}:virtual:${label.replaceAll(/\s+/g, "-").toLowerCase()}`
      : `${modelId}:${localId}`;

  return {
    key,
    localId,
    category: node.category,
    label,
    children: (node.children ?? []).map((child) => toTreeNode(modelId, child, names, fallback)),
  };
}

export async function buildViewerTree(
  model: {
    modelId: string;
    getItemsData: (
      ids: number[],
      config?: {
        attributesDefault: boolean;
        relationsDefault: { attributes: boolean; relations: boolean };
      },
    ) => Promise<ItemData[]>;
    getSpatialStructure: () => Promise<SpatialTreeItem>;
  },
  fallbackRootLabel: string,
) {
  const spatialTree = await model.getSpatialStructure();
  const localIds = new Set<number>();
  collectLocalIds(spatialTree, localIds);

  const orderedIds = [...localIds];
  const items = await model.getItemsData(orderedIds, {
    attributesDefault: true,
    relationsDefault: { attributes: false, relations: false },
  });

  const names = new Map<number, string>();
  for (const [index, localId] of orderedIds.entries()) {
    const item = items[index];
    if (!item) continue;

    const name = readAttribute(item, "Name") ?? readAttribute(item, "ObjectType");
    if (typeof name === "string" && name.trim().length > 0) {
      names.set(localId, name);
    }
  }

  return [toTreeNode(model.modelId, spatialTree, names, fallbackRootLabel)];
}

export function getPrimarySelection(modelIdMap: OBC.ModelIdMap, labels: NameMap, categories: CategoryMap) {
  for (const [modelId, localIds] of Object.entries(modelIdMap)) {
    for (const localId of localIds) {
      const label = labels.get(localId) ?? `#${localId}`;

      return {
        modelId,
        localId,
        label,
        category: categories.get(localId) ?? null,
      } satisfies ViewerSelection;
    }
  }

  return null;
}

export function countItems(map: OBC.ModelIdMap | null | undefined) {
  if (!map) {
    return 0;
  }

  let total = 0;
  for (const localIds of Object.values(map)) {
    total += localIds.size;
  }
  return total;
}

export function buildSingleItemMap(modelId: string, localId: number): OBC.ModelIdMap {
  return {
    [modelId]: new Set([localId]),
  };
}

export async function buildCategorySummary(
  model: {
    getItemsWithGeometryCategories: () => Promise<(string | null)[]>;
    getItemsOfCategories: (categories: RegExp[]) => Promise<Record<string, number[]>>;
  },
) {
  const categories = await model.getItemsWithGeometryCategories();
  const uniqueCategories = [...new Set(categories.filter((value): value is string => Boolean(value)))].sort();

  const summary: ViewerCategorySummary[] = [];
  for (const category of uniqueCategories) {
    const matched = await model.getItemsOfCategories([new RegExp(`^${category}$`)]);
    const count = Object.values(matched).reduce((total, ids) => total + ids.length, 0);
    summary.push({ category, count });
  }

  return summary;
}

export function readNameMaps(data: ItemData, localId: number, labels: NameMap, categories: CategoryMap) {
  const labelCandidate = readAttribute(data, "Name") ?? readAttribute(data, "ObjectType");
  const categoryCandidate = readAttribute(data, "type");

  if (typeof labelCandidate === "string" && labelCandidate.trim()) {
    labels.set(localId, labelCandidate);
  }

  if (typeof categoryCandidate === "string" && categoryCandidate.trim()) {
    categories.set(localId, categoryCandidate);
  }
}

export function formatBytes(value: number) {
  if (value === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** exponent;

  return `${amount.toFixed(amount >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatTreeNodeCount(nodes: ViewerTreeNode[]) {
  let count = 0;

  const visit = (node: ViewerTreeNode) => {
    count += 1;
    for (const child of node.children) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return count;
}

export function filterTree(
  nodes: ViewerTreeNode[],
  query: string,
  categoryFilter?: ReadonlySet<string> | null,
): ViewerTreeNode[] {
  const trimmed = query.trim().toLowerCase();
  const activeCategoryFilter = categoryFilter && categoryFilter.size > 0 ? categoryFilter : null;

  if (!trimmed && !activeCategoryFilter) {
    return nodes;
  }

  const prune = (node: ViewerTreeNode): ViewerTreeNode | null => {
    const children = node.children
      .map((child) => prune(child))
      .filter((child): child is ViewerTreeNode => child !== null);

    const matchesQuery =
      !trimmed ||
      node.label.toLowerCase().includes(trimmed) ||
      node.category?.toLowerCase().includes(trimmed) === true;
    const matchesCategory =
      !activeCategoryFilter ||
      (node.category !== null && activeCategoryFilter.has(node.category));

    if ((matchesQuery && matchesCategory) || children.length > 0) {
      return {
        ...node,
        children,
      };
    }

    return null;
  };

  return nodes
    .map((node) => prune(node))
    .filter((node): node is ViewerTreeNode => node !== null);
}

const DEFAULT_VIEWER_GRAPH_MAX_VISIBLE_NODES = 900;

function normalizeGraphSearchText(parts: Array<string | number | null | undefined>) {
  return parts
    .filter((part): part is string | number => part !== null && part !== undefined)
    .map((part) => String(part).trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function inferModelIdFromTree(nodes: ViewerTreeNode[]) {
  const queue = [...nodes];

  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) {
      continue;
    }

    if (node.localId !== null) {
      const suffix = `:${node.localId}`;
      if (node.key.endsWith(suffix)) {
        return node.key.slice(0, -suffix.length);
      }
    }

    queue.push(...node.children);
  }

  return null;
}

function reserveGraphKey(usedKeys: Set<string>, preferredKey: string, fallbackKey: string) {
  if (!usedKeys.has(preferredKey)) {
    usedKeys.add(preferredKey);
    return preferredKey;
  }

  let index = 1;
  let nextKey = `${preferredKey}:graph:${fallbackKey}`;
  while (usedKeys.has(nextKey)) {
    index += 1;
    nextKey = `${preferredKey}:graph:${fallbackKey}:${index}`;
  }

  usedKeys.add(nextKey);
  return nextKey;
}

function addViewerGraphNode(input: {
  nodes: ViewerGraphNode[];
  edges: ViewerGraphEdge[];
  nodeByKey: Map<string, ViewerGraphNode>;
  modelId: string;
  key: string;
  parentKey: string | null;
  localId: number | null;
  rowKey: string | null;
  kind: ViewerGraphNode["kind"];
  label: string;
  category: string | null;
  depth: number;
  searchText: string;
  relation?: ViewerGraphEdge["relation"];
}) {
  const node = {
    key: input.key,
    modelId: input.modelId,
    localId: input.localId,
    rowKey: input.rowKey,
    kind: input.kind,
    label: input.label,
    category: input.category,
    depth: input.depth,
    parentKey: input.parentKey,
    childKeys: [],
    directChildCount: 0,
    descendantCount: 0,
    searchText: input.searchText,
  } satisfies ViewerGraphNode;

  input.nodes.push(node);
  input.nodeByKey.set(node.key, node);

  if (input.parentKey) {
    const parent = input.nodeByKey.get(input.parentKey);
    parent?.childKeys.push(node.key);
    input.edges.push({
      key: `${input.parentKey}->${node.key}`,
      sourceKey: input.parentKey,
      targetKey: node.key,
      relation: input.relation ?? "contains",
    });
  }

  return node;
}

function getViewerGraphRowSearchParts(row: ViewerDataTableRow | null) {
  if (!row) {
    return [];
  }

  return [
    row.selection.label,
    row.ifcType,
    row.localId,
    `#${row.localId}`,
    row.searchText,
  ];
}

function buildFallbackGraphFromRows(input: {
  modelId: string;
  modelLabel: string;
  data: ViewerDataTableData;
  usedKeys: Set<string>;
  nodes: ViewerGraphNode[];
  edges: ViewerGraphEdge[];
  nodeByKey: Map<string, ViewerGraphNode>;
  rootKeys: string[];
}) {
  const rootKey = reserveGraphKey(input.usedKeys, `${input.modelId}:graph:model`, "model");
  addViewerGraphNode({
    nodes: input.nodes,
    edges: input.edges,
    nodeByKey: input.nodeByKey,
    modelId: input.modelId,
    key: rootKey,
    parentKey: null,
    localId: null,
    rowKey: null,
    kind: "model",
    label: input.modelLabel,
    category: null,
    depth: 0,
    searchText: normalizeGraphSearchText([input.modelLabel, input.modelId]),
  });
  input.rootKeys.push(rootKey);

  for (const row of input.data.rows) {
    const rowKey = reserveGraphKey(input.usedKeys, row.key, `row-${row.localId}`);
    addViewerGraphNode({
      nodes: input.nodes,
      edges: input.edges,
      nodeByKey: input.nodeByKey,
      modelId: row.modelId,
      key: rowKey,
      parentKey: rootKey,
      localId: row.localId,
      rowKey: row.key,
      kind: "element",
      label: row.selection.label,
      category: row.ifcType,
      depth: 1,
      searchText: normalizeGraphSearchText(getViewerGraphRowSearchParts(row)),
    });
  }
}

function finalizeViewerGraphData(input: {
  nodes: ViewerGraphNode[];
  edges: ViewerGraphEdge[];
  rootKeys: string[];
}) {
  const nodeByKey = new Map(input.nodes.map((node) => [node.key, node]));
  let maxDepth = 0;

  for (let index = input.nodes.length - 1; index >= 0; index -= 1) {
    const node = input.nodes[index];
    node.directChildCount = node.childKeys.length;
    node.descendantCount = node.childKeys.reduce((count, childKey) => {
      const child = nodeByKey.get(childKey);
      return count + (child ? child.descendantCount + 1 : 0);
    }, 0);
    maxDepth = Math.max(maxDepth, node.depth);
  }

  return {
    nodes: input.nodes,
    edges: input.edges,
    rootKeys: input.rootKeys,
    totalNodeCount: input.nodes.length,
    totalEdgeCount: input.edges.length,
    maxDepth,
  } satisfies ViewerGraphData;
}

export function buildViewerGraphData(input: {
  tree: ViewerTreeNode[];
  data: ViewerDataTableData | null;
  modelId?: string | null;
  modelLabel?: string | null;
}) {
  const modelId =
    input.modelId ??
    input.data?.rows[0]?.modelId ??
    inferModelIdFromTree(input.tree) ??
    "model";
  const modelLabel = input.modelLabel ?? modelId;
  const rowsByIdentity = new Map(
    (input.data?.rows ?? []).map((row) => [`${row.modelId}:${row.localId}`, row]),
  );
  const nodes: ViewerGraphNode[] = [];
  const edges: ViewerGraphEdge[] = [];
  const nodeByKey = new Map<string, ViewerGraphNode>();
  const usedKeys = new Set<string>();
  const rootKeys: string[] = [];

  const visitTreeNode = (
    treeNode: ViewerTreeNode,
    depth: number,
    parentKey: string | null,
    pathKey: string,
  ) => {
    const key = reserveGraphKey(usedKeys, treeNode.key, pathKey);
    const row =
      treeNode.localId === null
        ? null
        : rowsByIdentity.get(`${modelId}:${treeNode.localId}`) ?? null;
    const label = row?.selection.label ?? treeNode.label;
    const category = row?.ifcType ?? treeNode.category;
    const kind: ViewerGraphNode["kind"] =
      treeNode.localId === null ? "spatial" : row ? "element" : "spatial";

    addViewerGraphNode({
      nodes,
      edges,
      nodeByKey,
      modelId,
      key,
      parentKey,
      localId: treeNode.localId,
      rowKey: row?.key ?? null,
      kind,
      label,
      category,
      depth,
      searchText: normalizeGraphSearchText([
        label,
        category,
        treeNode.localId,
        treeNode.localId !== null ? `#${treeNode.localId}` : null,
        ...getViewerGraphRowSearchParts(row),
      ]),
    });

    if (!parentKey) {
      rootKeys.push(key);
    }

    treeNode.children.forEach((child, index) => {
      visitTreeNode(child, depth + 1, key, `${pathKey}-${index}`);
    });
  };

  input.tree.forEach((root, index) => {
    visitTreeNode(root, 0, null, `root-${index}`);
  });

  if (nodes.length === 0 && input.data) {
    buildFallbackGraphFromRows({
      modelId,
      modelLabel,
      data: input.data,
      usedKeys,
      nodes,
      edges,
      nodeByKey,
      rootKeys,
    });
  }

  return finalizeViewerGraphData({ nodes, edges, rootKeys });
}

export function getViewerGraphExpandableNodeKeys(graph: ViewerGraphData) {
  return new Set(graph.nodes.filter((node) => node.childKeys.length > 0).map((node) => node.key));
}

export function getDefaultViewerGraphCollapsedKeys(
  graph: ViewerGraphData,
  expandedDepth = Number.POSITIVE_INFINITY,
) {
  return new Set(
    graph.nodes
      .filter((node) => node.childKeys.length > 0 && node.depth >= expandedDepth)
      .map((node) => node.key),
  );
}

export function getViewerGraphSelectedNodeKey(
  graph: ViewerGraphData,
  selectedLocalId: number | null | undefined,
) {
  if (selectedLocalId === null || selectedLocalId === undefined) {
    return null;
  }

  return graph.nodes.find((node) => node.localId === selectedLocalId)?.key ?? null;
}

export function getViewerGraphNodePathKeys(graph: ViewerGraphData, nodeKey: string | null) {
  const pathKeys = new Set<string>();
  if (!nodeKey) {
    return pathKeys;
  }

  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  let current = nodeByKey.get(nodeKey) ?? null;

  while (current) {
    pathKeys.add(current.key);
    current = current.parentKey ? nodeByKey.get(current.parentKey) ?? null : null;
  }

  return pathKeys;
}

export function buildViewerGraphView(
  graph: ViewerGraphData,
  options: {
    collapsedKeys: ReadonlySet<string>;
    query: string;
    selectedLocalId?: number | null;
    maxVisibleNodes?: number;
  },
): ViewerGraphView {
  const normalizedQuery = options.query.trim().toLowerCase();
  const maxVisibleNodes = Math.max(
    1,
    options.maxVisibleNodes ?? DEFAULT_VIEWER_GRAPH_MAX_VISIBLE_NODES,
  );
  const nodeByKey = new Map(graph.nodes.map((node) => [node.key, node]));
  const matchedNodeKeys = new Set<string>();
  const searchVisibleKeys = new Set<string>();
  const addPathKeys = (nodeKey: string | null, collector: Set<string>) => {
    let current = nodeKey ? nodeByKey.get(nodeKey) ?? null : null;

    while (current) {
      collector.add(current.key);
      current = current.parentKey ? nodeByKey.get(current.parentKey) ?? null : null;
    }
  };

  if (normalizedQuery) {
    for (const node of graph.nodes) {
      if (!node.searchText.includes(normalizedQuery)) {
        continue;
      }

      matchedNodeKeys.add(node.key);
      addPathKeys(node.key, searchVisibleKeys);
    }
  }

  const selectedNodeKey = getViewerGraphSelectedNodeKey(graph, options.selectedLocalId);
  const selectedPathKeys = new Set<string>();
  addPathKeys(selectedNodeKey, selectedPathKeys);
  const visibleNodes: ViewerGraphNode[] = [];
  let omittedNodeCount = 0;

  const visit = (nodeKey: string) => {
    const node = nodeByKey.get(nodeKey);
    if (!node) {
      return;
    }

    if (normalizedQuery && !searchVisibleKeys.has(node.key)) {
      return;
    }

    if (visibleNodes.length < maxVisibleNodes) {
      visibleNodes.push(node);
    } else {
      omittedNodeCount += 1;
    }

    if (!normalizedQuery && options.collapsedKeys.has(node.key)) {
      return;
    }

    for (const childKey of node.childKeys) {
      visit(childKey);
    }
  };

  for (const rootKey of graph.rootKeys) {
    visit(rootKey);
  }

  const visibleKeySet = new Set(visibleNodes.map((node) => node.key));
  const visibleEdges = graph.edges.filter(
    (edge) => visibleKeySet.has(edge.sourceKey) && visibleKeySet.has(edge.targetKey),
  );

  return {
    nodes: visibleNodes,
    edges: visibleEdges,
    matchedNodeKeys,
    selectedPathKeys,
    selectedNodeKey,
    matchCount: matchedNodeKeys.size,
    omittedNodeCount,
  } satisfies ViewerGraphView;
}

function buildDebugTruncationNote(count: number, kind: string) {
  return `... ${count} more ${kind}`;
}

export function sanitizeViewerDebugValue(
  value: unknown,
  options?: {
    maxDepth?: number;
    maxArrayLength?: number;
    maxObjectEntries?: number;
  },
): ViewerDebugValue {
  const maxDepth = options?.maxDepth ?? 5;
  const maxArrayLength = options?.maxArrayLength ?? 12;
  const maxObjectEntries = options?.maxObjectEntries ?? 16;
  const seen = new WeakSet<object>();

  const visit = (input: unknown, depth: number): ViewerDebugValue => {
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean"
    ) {
      return input;
    }

    if (typeof input === "number") {
      return Number.isFinite(input) ? input : String(input);
    }

    if (typeof input === "bigint" || typeof input === "symbol" || typeof input === "function") {
      return String(input);
    }

    if (depth >= maxDepth) {
      return `[Max depth ${maxDepth}]`;
    }

    if (Array.isArray(input)) {
      const items = input.slice(0, maxArrayLength).map((entry) => visit(entry, depth + 1));
      if (input.length > maxArrayLength) {
        items.push(buildDebugTruncationNote(input.length - maxArrayLength, "items"));
      }
      return items;
    }

    if (input instanceof Set) {
      return visit([...input], depth + 1);
    }

    if (input instanceof Map) {
      const output: Record<string, ViewerDebugValue> = {};
      const entries = [...input.entries()];

      for (const [key, entryValue] of entries.slice(0, maxObjectEntries)) {
        output[String(key)] = visit(entryValue, depth + 1);
      }

      if (entries.length > maxObjectEntries) {
        output.__truncated__ = buildDebugTruncationNote(
          entries.length - maxObjectEntries,
          "entries",
        );
      }

      return output;
    }

    if (ArrayBuffer.isView(input)) {
      if ("length" in input && typeof input.length === "number") {
        return {
          type: input.constructor.name,
          length: input.length,
        };
      }

      return {
        type: input.constructor.name,
        byteLength: input.byteLength,
      };
    }

    if (typeof input === "object") {
      if (seen.has(input)) {
        return "[Circular]";
      }

      seen.add(input);

      const output: Record<string, ViewerDebugValue> = {};
      const entries = Object.entries(input);

      for (const [key, entryValue] of entries.slice(0, maxObjectEntries)) {
        output[key] = visit(entryValue, depth + 1);
      }

      if (entries.length > maxObjectEntries) {
        output.__truncated__ = buildDebugTruncationNote(
          entries.length - maxObjectEntries,
          "fields",
        );
      }

      return output;
    }

    return String(input);
  };

  return visit(value, 0);
}

export function buildViewerTreeDebugSample(
  nodes: ViewerTreeNode[],
  options?: {
    maxRoots?: number;
    maxDepth?: number;
    maxChildren?: number;
  },
): ViewerDebugValue {
  const maxRoots = options?.maxRoots ?? 1;
  const maxDepth = options?.maxDepth ?? 2;
  const maxChildren = options?.maxChildren ?? 4;

  const walk = (node: ViewerTreeNode, depth: number): ViewerDebugValue => {
    const sampleChildren = node.children.slice(0, maxChildren).map((child) => walk(child, depth + 1));

    return {
      key: node.key,
      localId: node.localId,
      label: node.label,
      category: node.category,
      childCount: node.children.length,
      children:
        depth >= maxDepth
          ? node.children.length > 0
            ? [`[${node.children.length} child nodes omitted]`]
            : []
          : sampleChildren,
      ...(node.children.length > maxChildren
        ? {
            truncatedChildCount: node.children.length - maxChildren,
          }
        : {}),
    };
  };

  if (nodes.length === 0) {
    return [];
  }

  return nodes.slice(0, maxRoots).map((node) => walk(node, 0));
}
