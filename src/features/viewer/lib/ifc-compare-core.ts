import type {
  ModelCompareChangedElement,
  ModelCompareElementRef,
  ModelCompareFieldChange,
  ViewerInspectionValueState,
  ViewerDataTableEditableValueKind,
  ViewerValidationClause,
  ViewerValidationRow,
  ViewerValidationValue,
} from "@/features/viewer/types";
import {
  loadWebIfc,
  readWrappedValue,
  type IfcApiInstance,
  type IfcPropertyLine,
  type IfcPropertySetLine,
} from "@/features/viewer/lib/ifc-node-core";
import {
  buildViewerValidationTargetId,
  compileViewerValidationRules,
  normalizeIfcType,
} from "@/features/rules/lib/validation";

/**
 * Server-side IFC snapshot and diff engine for model version compare.
 *
 * A snapshot captures, per element, the same value surface the data table
 * indexes on the client: simple own attributes plus IsDefinedBy property-set
 * single values. Elements are keyed by GlobalId so two versions of the same
 * model can be diffed even when express ids shift between exports.
 */

export type IfcSnapshotValue = {
  raw: unknown;
  text: string;
  state: ViewerInspectionValueState;
  valueKind: ViewerDataTableEditableValueKind | null;
};

export type IfcElementSnapshot = {
  globalId: string;
  expressId: number;
  ifcType: string;
  name: string | null;
  attributes: Record<string, IfcSnapshotValue>;
  properties: Record<string, IfcSnapshotValue>;
};

export type IfcModelSnapshot = {
  elements: Map<string, IfcElementSnapshot>;
  warnings: string[];
};

export type IfcSnapshotDiff = {
  baseElementCount: number;
  targetElementCount: number;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  truncated: boolean;
  added: ModelCompareElementRef[];
  removed: ModelCompareElementRef[];
  changed: ModelCompareChangedElement[];
};

export const COMPARE_MAX_ENTRIES_PER_LIST = 2000;
export const COMPARE_MAX_FIELD_CHANGES_PER_ELEMENT = 100;

const SKIPPED_ATTRIBUTE_KEYS = new Set(["expressID", "type", "GlobalId", "OwnerHistory"]);

type IfcHandle = { type: number; value: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHandle(value: unknown): value is IfcHandle {
  return isRecord(value) && value.type === 5 && typeof value.value === "number";
}

function formatSimpleValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => formatSimpleValue(readWrappedValue(entry))).join(", ");
  }

  return String(value);
}

/**
 * Mirrors the data table's cell semantics (`buildInspectionValue` in
 * ifc-data.ts) so states line up with what validation rules expect.
 */
function toSnapshotValue(value: unknown): IfcSnapshotValue {
  const normalized = readWrappedValue(value);
  const valueKind =
    typeof normalized === "string"
      ? "string"
      : typeof normalized === "number"
        ? "number"
        : typeof normalized === "boolean"
          ? "boolean"
          : null;

  if (normalized === undefined) {
    return { raw: undefined, text: "Undefined", state: "undefined", valueKind };
  }

  if (normalized === null) {
    return { raw: null, text: "Null", state: "null", valueKind };
  }

  if (typeof normalized === "string" && normalized.trim().length === 0) {
    return { raw: normalized, text: "Empty string", state: "empty", valueKind };
  }

  if (Array.isArray(normalized) && normalized.length === 0) {
    return { raw: normalized, text: "Empty list", state: "empty", valueKind };
  }

  return {
    raw: normalized,
    text: formatSimpleValue(normalized),
    state: "present",
    valueKind,
  };
}

function readStringValue(value: unknown): string | null {
  const normalized = readWrappedValue(value);
  return typeof normalized === "string" && normalized.trim().length > 0
    ? normalized.trim()
    : null;
}

function readElementAttributes(line: Record<string, unknown>): Record<string, IfcSnapshotValue> {
  const attributes: Record<string, IfcSnapshotValue> = {};

  for (const [key, value] of Object.entries(line)) {
    if (SKIPPED_ATTRIBUTE_KEYS.has(key)) {
      continue;
    }

    if (isHandle(value)) {
      continue;
    }

    if (Array.isArray(value) && value.some((entry) => isHandle(entry))) {
      continue;
    }

    if (isRecord(value) && !("value" in value) && !Array.isArray(value)) {
      continue;
    }

    attributes[key] = toSnapshotValue(value);
  }

  return attributes;
}

function collectPropertySetValues(
  api: IfcApiInstance,
  modelId: number,
  singleValueTypeCode: number,
): Map<number, Record<string, IfcSnapshotValue>> {
  const relCode = api.GetTypeCodeFromName("IFCRELDEFINESBYPROPERTIES");
  const psetCode = api.GetTypeCodeFromName("IFCPROPERTYSET");
  const propertiesByElement = new Map<number, Record<string, IfcSnapshotValue>>();
  const relIds = api.GetLineIDsWithType(modelId, relCode);

  for (let index = 0; index < relIds.size(); index += 1) {
    const rel = api.GetLine(modelId, relIds.get(index), false, false) as {
      RelatingPropertyDefinition?: unknown;
      RelatedObjects?: unknown[];
    } | null;
    if (!rel || !isHandle(rel.RelatingPropertyDefinition)) {
      continue;
    }

    const psetId = rel.RelatingPropertyDefinition.value;
    if (api.GetLineType(modelId, psetId) !== psetCode) {
      continue;
    }

    const pset = api.GetLine(modelId, psetId, false, false) as IfcPropertySetLine | null;
    const psetName = pset ? readStringValue(pset.Name) : null;
    if (!pset || !psetName) {
      continue;
    }

    const values: Record<string, IfcSnapshotValue> = {};
    for (const propertyHandle of Array.isArray(pset.HasProperties) ? pset.HasProperties : []) {
      if (!isHandle(propertyHandle)) {
        continue;
      }

      if (api.GetLineType(modelId, propertyHandle.value) !== singleValueTypeCode) {
        continue;
      }

      const property = api.GetLine(modelId, propertyHandle.value, false, false) as
        | IfcPropertyLine
        | null;
      const propertyName = property ? readStringValue(property.Name) : null;
      if (!property || !propertyName) {
        continue;
      }

      values[`${psetName}::${propertyName}`] = toSnapshotValue(property.NominalValue ?? null);
    }

    if (Object.keys(values).length === 0) {
      continue;
    }

    for (const related of Array.isArray(rel.RelatedObjects) ? rel.RelatedObjects : []) {
      if (!isHandle(related)) {
        continue;
      }

      const existing = propertiesByElement.get(related.value);
      if (existing) {
        Object.assign(existing, values);
      } else {
        propertiesByElement.set(related.value, { ...values });
      }
    }
  }

  return propertiesByElement;
}

export async function buildIfcElementSnapshots(bytes: Uint8Array): Promise<IfcModelSnapshot> {
  const { IfcAPI } = await loadWebIfc();
  const api = new IfcAPI();
  await api.Init();

  const elements = new Map<string, IfcElementSnapshot>();
  const warnings: string[] = [];
  let duplicateCount = 0;
  let missingGlobalIdCount = 0;
  let modelId = -1;

  try {
    modelId = api.OpenModel(bytes);

    const productCode = api.GetTypeCodeFromName("IFCPRODUCT");
    const singleValueCode = api.GetTypeCodeFromName("IFCPROPERTYSINGLEVALUE");
    const productIds = api.GetLineIDsWithType(modelId, productCode, true);
    const propertiesByElement = collectPropertySetValues(api, modelId, singleValueCode);
    const snapshotsByExpressId = new Map<number, IfcElementSnapshot>();

    for (let index = 0; index < productIds.size(); index += 1) {
      const expressId = productIds.get(index);
      const line = api.GetLine(modelId, expressId, false, false) as Record<
        string,
        unknown
      > | null;
      if (!line) {
        continue;
      }

      const globalId = readStringValue(line.GlobalId);
      if (!globalId) {
        missingGlobalIdCount += 1;
        continue;
      }

      if (elements.has(globalId)) {
        duplicateCount += 1;
        continue;
      }

      const snapshot: IfcElementSnapshot = {
        globalId,
        expressId,
        ifcType: api.GetNameFromTypeCode(api.GetLineType(modelId, expressId)),
        name: readStringValue(line.Name),
        attributes: readElementAttributes(line),
        properties: propertiesByElement.get(expressId) ?? {},
      };
      elements.set(globalId, snapshot);
      snapshotsByExpressId.set(expressId, snapshot);
    }
  } finally {
    if (modelId >= 0) {
      api.CloseModel(modelId);
    }
  }

  if (missingGlobalIdCount > 0) {
    warnings.push(`Skipped ${missingGlobalIdCount} elements without a GlobalId.`);
  }

  if (duplicateCount > 0) {
    warnings.push(
      `Encountered ${duplicateCount} duplicate GlobalIds; only the first occurrence of each was compared.`,
    );
  }

  return { elements, warnings };
}

function toElementRef(
  base: IfcElementSnapshot | null,
  target: IfcElementSnapshot | null,
): ModelCompareElementRef {
  const primary = target ?? base;
  return {
    globalId: primary?.globalId ?? "",
    ifcType: primary?.ifcType ?? "",
    name: primary?.name ?? base?.name ?? null,
    baseExpressId: base?.expressId ?? null,
    targetExpressId: target?.expressId ?? null,
  };
}

function compareRefs(a: ModelCompareElementRef, b: ModelCompareElementRef) {
  return (
    a.ifcType.localeCompare(b.ifcType) ||
    (a.name ?? "").localeCompare(b.name ?? "") ||
    a.globalId.localeCompare(b.globalId)
  );
}

function snapshotValuesEqual(a: IfcSnapshotValue | null, b: IfcSnapshotValue | null) {
  if (!a || !b) {
    return a === b;
  }

  return a.text === b.text && a.state === b.state;
}

function toCompareValue(value: IfcSnapshotValue | null) {
  return value ? { text: value.text, state: value.state } : null;
}

function diffElementFields(
  base: IfcElementSnapshot,
  target: IfcElementSnapshot,
): ModelCompareFieldChange[] {
  const fields: ModelCompareFieldChange[] = [];

  if (base.ifcType !== target.ifcType) {
    fields.push({
      field: "attribute:type",
      label: "IFC type",
      base: { text: base.ifcType, state: "present" },
      target: { text: target.ifcType, state: "present" },
    });
  }

  const attributeKeys = new Set([
    ...Object.keys(base.attributes),
    ...Object.keys(target.attributes),
  ]);
  for (const key of attributeKeys) {
    const baseValue = base.attributes[key] ?? null;
    const targetValue = target.attributes[key] ?? null;
    if (!snapshotValuesEqual(baseValue, targetValue)) {
      fields.push({
        field: `attribute:${key}`,
        label: key,
        base: toCompareValue(baseValue),
        target: toCompareValue(targetValue),
      });
    }
  }

  const propertyKeys = new Set([
    ...Object.keys(base.properties),
    ...Object.keys(target.properties),
  ]);
  for (const key of propertyKeys) {
    const baseValue = base.properties[key] ?? null;
    const targetValue = target.properties[key] ?? null;
    if (!snapshotValuesEqual(baseValue, targetValue)) {
      fields.push({
        field: `property:${key}`,
        label: key,
        base: toCompareValue(baseValue),
        target: toCompareValue(targetValue),
      });
    }
  }

  return fields;
}

export function diffIfcElementSnapshots(
  base: IfcModelSnapshot,
  target: IfcModelSnapshot,
  limits?: {
    maxEntriesPerList?: number;
    maxFieldChangesPerElement?: number;
  },
): IfcSnapshotDiff {
  const maxEntries = limits?.maxEntriesPerList ?? COMPARE_MAX_ENTRIES_PER_LIST;
  const maxFields = limits?.maxFieldChangesPerElement ?? COMPARE_MAX_FIELD_CHANGES_PER_ELEMENT;

  const added: ModelCompareElementRef[] = [];
  const removed: ModelCompareElementRef[] = [];
  const changed: ModelCompareChangedElement[] = [];
  let addedCount = 0;
  let removedCount = 0;
  let changedCount = 0;

  for (const [globalId, targetElement] of target.elements) {
    if (!base.elements.has(globalId)) {
      addedCount += 1;
      added.push(toElementRef(null, targetElement));
    }
  }

  for (const [globalId, baseElement] of base.elements) {
    const targetElement = target.elements.get(globalId);
    if (!targetElement) {
      removedCount += 1;
      removed.push(toElementRef(baseElement, null));
      continue;
    }

    const fields = diffElementFields(baseElement, targetElement);
    if (fields.length === 0) {
      continue;
    }

    changedCount += 1;
    changed.push({
      ...toElementRef(baseElement, targetElement),
      fields: fields.slice(0, maxFields),
      fieldsTruncated: fields.length > maxFields,
    });
  }

  added.sort(compareRefs);
  removed.sort(compareRefs);
  changed.sort(compareRefs);

  const truncated =
    added.length > maxEntries || removed.length > maxEntries || changed.length > maxEntries;

  return {
    baseElementCount: base.elements.size,
    targetElementCount: target.elements.size,
    addedCount,
    removedCount,
    changedCount,
    truncated,
    added: added.slice(0, maxEntries),
    removed: removed.slice(0, maxEntries),
    changed: changed.slice(0, maxEntries),
  };
}

const MISSING_SNAPSHOT_VALUE: ViewerValidationValue = {
  text: "MISSING",
  state: "missing",
  valueKind: null,
};

function resolveSnapshotTargetValue(
  element: IfcElementSnapshot,
  targetId: string,
  propertiesByLowercaseKey: Map<string, IfcSnapshotValue>,
): ViewerValidationValue {
  if (targetId === "attribute:type") {
    return { text: element.ifcType, state: "present", valueKind: "string" };
  }

  if (targetId === "attribute:globalid") {
    return { text: element.globalId, state: "present", valueKind: "string" };
  }

  if (targetId.startsWith("attribute:")) {
    const wanted = targetId.slice("attribute:".length);
    for (const [key, value] of Object.entries(element.attributes)) {
      if (key.toLowerCase() === wanted) {
        return value;
      }
    }
    return MISSING_SNAPSHOT_VALUE;
  }

  if (targetId.startsWith("property:")) {
    return propertiesByLowercaseKey.get(targetId.slice("property:".length)) ?? MISSING_SNAPSHOT_VALUE;
  }

  return MISSING_SNAPSHOT_VALUE;
}

/**
 * Builds validation rows from a snapshot the same way the client builds them
 * from indexed data-table rows (`buildViewerValidationRows`): one row per
 * element whose IFC type has rules, with values keyed by normalized targetId.
 */
export function buildSnapshotValidationRows(
  snapshot: IfcModelSnapshot,
  clauses: ViewerValidationClause[],
  modelId: string,
): ViewerValidationRow[] {
  const compiledRules = compileViewerValidationRules(clauses);
  const rows: ViewerValidationRow[] = [];

  for (const element of snapshot.elements.values()) {
    const rulesForType = compiledRules.get(normalizeIfcType(element.ifcType));
    if (!rulesForType || rulesForType.size === 0) {
      continue;
    }

    // Property targetIds are lowercased (`property:group::label`); snapshot
    // properties keep original casing, so index them lowercased per element.
    const propertiesByLowercaseKey = new Map<string, IfcSnapshotValue>();
    for (const [key, value] of Object.entries(element.properties)) {
      const separatorIndex = key.indexOf("::");
      propertiesByLowercaseKey.set(
        buildViewerValidationTargetId({
          kind: "property",
          group: separatorIndex >= 0 ? key.slice(0, separatorIndex) : key,
          label: separatorIndex >= 0 ? key.slice(separatorIndex + 2) : "",
        }).slice("property:".length),
        value,
      );
    }

    const values: Record<string, ViewerValidationValue> = {};
    for (const targetId of rulesForType.keys()) {
      values[targetId] = resolveSnapshotTargetValue(element, targetId, propertiesByLowercaseKey);
    }

    rows.push({
      modelId,
      localId: element.expressId,
      ifcType: element.ifcType,
      values,
    });
  }

  return rows;
}
