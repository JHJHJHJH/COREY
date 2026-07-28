import {
  buildIfcElementSnapshots,
  type IfcModelSnapshot,
  type IfcSnapshotValue,
} from "@/features/viewer/lib/ifc-compare-core";
import type {
  ViewerDataTableCell,
  ViewerDataTableColumn,
  ViewerDataTableData,
  ViewerDataTableRow,
} from "@/features/viewer/types";

function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .trim();
}

function cell(
  value: IfcSnapshotValue,
  binding: ViewerDataTableColumn["binding"],
): ViewerDataTableCell {
  return {
    raw: value.raw,
    text: value.text,
    state: value.state,
    source: "ifc",
    binding,
    valueKind: value.valueKind,
    original: null,
  };
}

function presentString(value: string): ViewerDataTableCell {
  return {
    raw: value,
    text: value,
    state: "present",
    source: "ifc",
    binding: null,
    valueKind: "string",
    original: null,
  };
}

function ensureColumn(
  columns: Map<string, ViewerDataTableColumn>,
  input: Omit<ViewerDataTableColumn, "populatedRowCount">,
  value: IfcSnapshotValue,
) {
  const existing = columns.get(input.key);
  if (existing) {
    if (!existing.valueKind && value.valueKind) existing.valueKind = value.valueKind;
    if (value.state === "present") existing.populatedRowCount += 1;
    return existing;
  }

  const created: ViewerDataTableColumn = {
    ...input,
    populatedRowCount: value.state === "present" ? 1 : 0,
  };
  columns.set(input.key, created);
  return created;
}

function buildSearchText(
  columns: Map<string, ViewerDataTableColumn>,
  cells: Record<string, ViewerDataTableCell>,
) {
  return Object.entries(cells)
    .filter(([, value]) => value.state === "present")
    .map(([key, value]) => {
      const column = columns.get(key);
      return [column?.group, column?.label, value.text].filter(Boolean).join(" ").toLowerCase();
    })
    .join(" ");
}

const BASE_COLUMNS: ViewerDataTableColumn[] = [
  {
    key: "ifcType",
    label: "IFC Type",
    kind: "base",
    group: null,
    populatedRowCount: 0,
    editable: false,
    editableReason: "IFC type is derived from the element category and cannot be edited.",
    binding: { kind: "attribute", name: "type" },
    valueKind: "string",
    origin: "ifc",
    importHeader: null,
  },
  {
    key: "globalId",
    label: "GlobalId",
    kind: "base",
    group: null,
    populatedRowCount: 0,
    editable: false,
    editableReason: "GlobalId is used to resolve edited rows back to IFC elements.",
    binding: { kind: "attribute", name: "_guid" },
    valueKind: "string",
    origin: "ifc",
    importHeader: null,
  },
  {
    key: "name",
    label: "Name",
    kind: "base",
    group: null,
    populatedRowCount: 0,
    editable: true,
    editableReason: null,
    binding: { kind: "attribute", name: "Name" },
    valueKind: "string",
    origin: "ifc",
    importHeader: null,
  },
];

export function buildViewerDataTableFromSnapshot(
  snapshot: IfcModelSnapshot,
  modelName: string,
): ViewerDataTableData {
  const columnMap = new Map(BASE_COLUMNS.map((column) => [column.key, { ...column }]));
  const rows: ViewerDataTableRow[] = [];

  for (const element of snapshot.elements.values()) {
    const nameValue = element.attributes.Name ?? {
      raw: element.name,
      text: element.name ?? "MISSING",
      state: element.name ? ("present" as const) : ("missing" as const),
      valueKind: "string" as const,
    };
    const cells: Record<string, ViewerDataTableCell> = {
      ifcType: {
        ...presentString(element.ifcType),
        binding: { kind: "attribute", name: "type" },
      },
      globalId: {
        ...presentString(element.globalId),
        binding: { kind: "attribute", name: "_guid" },
      },
      name: cell(nameValue, { kind: "attribute", name: "Name" }),
    };
    columnMap.get("ifcType")!.populatedRowCount += 1;
    columnMap.get("globalId")!.populatedRowCount += 1;
    if (nameValue.state === "present") columnMap.get("name")!.populatedRowCount += 1;

    for (const [name, value] of Object.entries(element.attributes)) {
      if (name === "Name") continue;
      const binding = { kind: "attribute" as const, name };
      const column = ensureColumn(
        columnMap,
        {
          key: `attribute:${name}`,
          label: humanize(name),
          kind: "attribute",
          group: "IFC Attributes",
          editable: value.valueKind !== null,
          editableReason: value.valueKind
            ? null
            : "Only scalar IFC attribute values can be edited.",
          binding,
          valueKind: value.valueKind,
          origin: "ifc",
          importHeader: null,
        },
        value,
      );
      cells[column.key] = cell(value, binding);
    }

    for (const [key, value] of Object.entries(element.properties)) {
      const separator = key.indexOf("::");
      const group = separator >= 0 ? key.slice(0, separator) : key;
      const label = separator >= 0 ? key.slice(separator + 2) : key;
      const binding = { kind: "property" as const, group, label };
      const column = ensureColumn(
        columnMap,
        {
          key: `property:${group}::${label}`,
          label,
          kind: "property",
          group,
          editable: value.valueKind !== null,
          editableReason: value.valueKind
            ? null
            : "Only scalar property values can be edited.",
          binding,
          valueKind: value.valueKind,
          origin: "ifc",
          importHeader: null,
        },
        value,
      );
      cells[column.key] = cell(value, binding);
    }

    const label = element.name ?? element.ifcType ?? `#${element.expressId}`;
    const row: ViewerDataTableRow = {
      key: `${modelName}:${element.expressId}`,
      modelId: modelName,
      localId: element.expressId,
      selection: {
        modelId: modelName,
        localId: element.expressId,
        label,
        category: element.ifcType,
      },
      cells,
      searchText: "",
      ifcType: element.ifcType,
    };
    row.searchText = buildSearchText(columnMap, cells);
    rows.push(row);
  }

  const dynamic = [...columnMap.values()]
    .filter((column) => column.kind !== "base")
    .sort(
      (left, right) =>
        (left.kind === "attribute" ? 0 : 1) - (right.kind === "attribute" ? 0 : 1) ||
        (left.group ?? "").localeCompare(right.group ?? "") ||
        left.label.localeCompare(right.label),
    );

  return {
    rows,
    columns: [...BASE_COLUMNS.map((column) => columnMap.get(column.key)!), ...dynamic],
    ifcTypes: [...new Set(rows.map((row) => row.ifcType).filter(Boolean) as string[])].sort(),
  };
}

export async function buildHeadlessViewerModelData(bytes: Uint8Array, modelName: string) {
  const snapshot = await buildIfcElementSnapshots(bytes);
  return {
    snapshot,
    data: buildViewerDataTableFromSnapshot(snapshot, modelName),
  };
}
