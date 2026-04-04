import type { ItemAttribute, ItemData, ItemsDataConfig, SpatialTreeItem } from "@thatopen/fragments";
import type * as OBC from "@thatopen/components";
import type {
  ViewerCategorySummary,
  ViewerDataTableCell,
  ViewerDataTableColumn,
  ViewerDataTableData,
  ViewerDataTableFilters,
  ViewerDataTableRow,
  ViewerDataTableSort,
  ViewerElementInspection,
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
  },
  {
    key: "globalId",
    label: "GlobalId",
    kind: "base",
    group: null,
  },
  {
    key: "name",
    label: "Name",
    kind: "base",
    group: null,
  },
] satisfies ReadonlyArray<Omit<ViewerDataTableColumn, "populatedRowCount">>;

const VIEWER_DATA_TABLE_ATTRIBUTE_EXCLUSIONS = new Set([
  "type",
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
  missingText = "Missing",
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

  const text = entries
    .map(([label, entry]) => `${humanizeKey(label)}: ${entry.text}`)
    .join(" | ");

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
    return buildInspectionValue(true, value.value, `Missing ${humanizeKey(key)}`);
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
    return buildInspectionValue(true, value.value, `Missing ${humanizeKey(key)}`);
  }

  if (fallbackEntries.length > 1) {
    return combineInspectionValues(
      fallbackEntries.map(([key, value]) => [key, buildInspectionValue(true, value.value)]),
      Object.fromEntries(fallbackEntries.map(([key, value]) => [key, value.value])),
    );
  }

  return buildInspectionValue(false, undefined, "Missing value");
}

function isPropertyContainer(item: ItemData) {
  const type = readAttributeText(item, "type")?.toUpperCase();
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
        readAttributeText(definition, "type") ??
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
        subtitle: readAttributeText(definition, "type"),
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
      "IFC Class",
      hasAttribute(data, "type"),
      readAttribute(data, "type"),
      "Missing IFC type",
      { kind: "attribute", name: "type" },
    ),
    buildRow(
      "GlobalId",
      "GlobalId",
      hasAttribute(data, "GlobalId"),
      readAttribute(data, "GlobalId"),
      "Missing GlobalId",
      { kind: "attribute", name: "GlobalId" },
    ),
    buildRow(
      "Name",
      "Name",
      hasAttribute(data, "Name"),
      readAttribute(data, "Name"),
      "Missing name",
      { kind: "attribute", name: "Name" },
    ),
    buildRow(
      "Description",
      "Description",
      hasAttribute(data, "Description"),
      readAttribute(data, "Description"),
      "Missing description",
      { kind: "attribute", name: "Description" },
    ),
    buildRow(
      "ObjectType",
      "Object Type",
      hasAttribute(data, "ObjectType"),
      readAttribute(data, "ObjectType"),
      "Missing object type",
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

function ensureViewerDataTableColumn(
  columnMap: Map<string, ViewerDataTableColumn>,
  column: Omit<ViewerDataTableColumn, "populatedRowCount">,
) {
  const existing = columnMap.get(column.key);
  if (existing) {
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
  missingText = "Missing",
): ViewerDataTableCell {
  return buildInspectionValue(exists, value, missingText);
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
): ViewerDataTableRow {
  const cells: Record<string, ViewerDataTableCell> = {};

  for (const column of VIEWER_DATA_TABLE_BASE_COLUMNS) {
    ensureViewerDataTableColumn(columnMap, column);
  }

  cells.ifcType = buildViewerDataTableCell(
    hasAttribute(data, "type"),
    readAttribute(data, "type"),
    "Missing",
  );
  cells.globalId = buildViewerDataTableCell(
    hasAttribute(data, "GlobalId"),
    readAttribute(data, "GlobalId"),
    "Missing",
  );
  cells.name = buildViewerDataTableCell(
    hasAttribute(data, "Name"),
    readAttribute(data, "Name"),
    "Missing",
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
    });
    cells[column.key] = mergeViewerDataTableCell(
      cells[column.key],
      buildViewerDataTableCell(true, value.value, "Missing"),
    );
  }

  for (const group of buildPropertyGroups(data)) {
    for (const row of group.rows) {
      const column = ensureViewerDataTableColumn(columnMap, {
        key: buildViewerDataTablePropertyColumnKey(group.title, row.label),
        label: row.label,
        kind: "property",
        group: group.title,
      });
      cells[column.key] = mergeViewerDataTableCell(cells[column.key], row.value);
    }
  }

  const searchParts: string[] = [];
  for (const [columnKey, cell] of Object.entries(cells)) {
    const column = columnMap.get(columnKey);
    if (!column || cell.state !== "present") {
      continue;
    }

    column.populatedRowCount += 1;
    searchParts.push(toViewerDataTableSearchPart(column, cell));
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
    searchText: searchParts.join(" "),
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

  if (orderedIdSet.size === 0 && model.getSpatialStructure) {
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

    for (const [chunkIndex, localId] of chunkIds.entries()) {
      const item = items[chunkIndex];
      if (!item) {
        continue;
      }

      rows.push(buildViewerDataTableRow(model.modelId, localId, item, columnMap));
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
