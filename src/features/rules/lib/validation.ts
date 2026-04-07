import type {
  ViewerDataTableData,
  ViewerElementInspection,
  ViewerInspectionGroup,
  ViewerInspectionRow,
  ViewerInspectionValue,
  ViewerInspectionValueState,
  ViewerValidationCheck,
  ViewerValidationConfig,
  ViewerValidationElementMap,
  ViewerValidationElementResult,
  ViewerValidationFailureSeverity,
  ViewerValidationHighlights,
  ViewerValidationMatch,
  ViewerValidationResult,
  ViewerValidationRow,
  ViewerValidationRule,
  ViewerValidationRunPayload,
  ViewerValidationRunResult,
  ViewerValidationSummary,
  ViewerValidationTarget,
  ViewerValidationValue,
} from "@/features/viewer/types";

export const VIEWER_VALIDATION_CONFIG_VERSION = 1 as const;

export const VIEWER_VALIDATION_STORAGE_KEY = "bca-ifc.validation-rules.v1";

const DEFAULT_VALIDATION_CHUNK_SIZE = 250;

const EMPTY_VALUE_STATES: ReadonlySet<ViewerInspectionValueState> = new Set([
  "missing",
  "empty",
  "null",
  "undefined",
]);

const VALIDATION_RESULT_PRIORITY: Record<ViewerValidationResult, number> = {
  ok: 0,
  warn: 1,
  error: 2,
};

const VALID_INSPECTION_STATES: ReadonlySet<ViewerInspectionValueState> = new Set([
  "present",
  "missing",
  "empty",
  "null",
  "undefined",
]);

function createRuleId() {
  return globalThis.crypto?.randomUUID?.() ?? `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function normalizeStoredText(value: string) {
  return value.trim();
}

function sanitizeAllowedValues(values: string[]) {
  return [...new Set(values.map(normalizeStoredText).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }

  return null;
}

function cloneValidationValue(
  value: ViewerInspectionValue,
  validation: ViewerValidationMatch | null,
): ViewerInspectionValue {
  return {
    ...value,
    validation,
  };
}

function missingValidationValue(): ViewerValidationValue {
  return {
    text: "MISSING",
    state: "missing",
  };
}

function sanitizeValidationValue(value: unknown): ViewerValidationValue {
  if (!isRecord(value)) {
    return missingValidationValue();
  }

  const state = VALID_INSPECTION_STATES.has(value.state as ViewerInspectionValueState)
    ? (value.state as ViewerInspectionValueState)
    : "missing";

  return {
    text: typeof value.text === "string" ? value.text : "MISSING",
    state,
  };
}

function sanitizeValidationRow(row: unknown): ViewerValidationRow {
  if (!isRecord(row)) {
    throw new Error("Each validation row must be an object.");
  }

  if (typeof row.modelId !== "string" || row.modelId.trim().length === 0) {
    throw new Error("Each validation row requires a modelId.");
  }

  if (typeof row.localId !== "number" || !Number.isFinite(row.localId)) {
    throw new Error("Each validation row requires a numeric localId.");
  }

  const values: Record<string, ViewerValidationValue> = {};
  if (isRecord(row.values)) {
    for (const [targetId, value] of Object.entries(row.values)) {
      values[targetId] = sanitizeValidationValue(value);
    }
  }

  return {
    modelId: row.modelId,
    localId: row.localId,
    ifcType: typeof row.ifcType === "string" && row.ifcType.trim().length > 0 ? row.ifcType : null,
    values,
  };
}

function compareValidationResult(left: ViewerValidationResult, right: ViewerValidationResult) {
  return VALIDATION_RESULT_PRIORITY[left] - VALIDATION_RESULT_PRIORITY[right];
}

function getInspectionIfcType(inspection: ViewerElementInspection) {
  const row = inspection.summaryRows.find(
    (entry) => entry.target?.kind === "attribute" && normalizeToken(entry.target.name) === "type",
  );
  return row?.value.state === "present" ? row.value.text : null;
}

function sanitizeTarget(target: unknown): ViewerValidationTarget {
  if (!isRecord(target) || typeof target.kind !== "string") {
    throw new Error("Each rule target must define a kind.");
  }

  if (target.kind === "attribute") {
    return {
      kind: "attribute",
      name: normalizeStoredText(String(target.name ?? "")),
    };
  }

  if (target.kind === "property") {
    return {
      kind: "property",
      group: normalizeStoredText(String(target.group ?? "")),
      label: normalizeStoredText(String(target.label ?? "")),
    };
  }

  throw new Error(`Unsupported rule target kind: ${String(target.kind)}`);
}

function sanitizeCheck(check: unknown): ViewerValidationCheck {
  if (!isRecord(check) || typeof check.kind !== "string") {
    throw new Error("Each rule must define a check.");
  }

  if (check.kind === "empty") {
    return { kind: "empty" };
  }

  if (check.kind === "enum") {
    const rawValues = Array.isArray(check.allowedValues) ? check.allowedValues : [];
    return {
      kind: "enum",
      allowedValues: sanitizeAllowedValues(rawValues.map((value) => String(value ?? ""))),
    };
  }

  if (check.kind === "numberRange") {
    return {
      kind: "numberRange",
      min: coerceFiniteNumber(check.min),
      max: coerceFiniteNumber(check.max),
    };
  }

  throw new Error(`Unsupported rule check kind: ${String(check.kind)}`);
}

function sanitizeRule(rule: unknown): ViewerValidationRule {
  if (!isRecord(rule)) {
    throw new Error("Each rule entry must be an object.");
  }

  const ifcType = normalizeStoredText(String(rule.ifcType ?? ""));
  const failSeverity =
    rule.failSeverity === "warn" || rule.failSeverity === "error" ? rule.failSeverity : "error";

  return {
    id: typeof rule.id === "string" && rule.id.trim().length > 0 ? rule.id : createRuleId(),
    ifcType,
    target: sanitizeTarget(rule.target),
    check: sanitizeCheck(rule.check),
    failSeverity,
  };
}

function isRunnableRule(rule: ViewerValidationRule) {
  if (!normalizeStoredText(rule.ifcType)) {
    return false;
  }

  if (rule.target.kind === "attribute") {
    if (!normalizeStoredText(rule.target.name)) {
      return false;
    }
  } else if (!normalizeStoredText(rule.target.group) || !normalizeStoredText(rule.target.label)) {
    return false;
  }

  if (rule.check.kind === "enum" && rule.check.allowedValues.length === 0) {
    return false;
  }

  if (rule.check.kind === "numberRange" && rule.check.min === null && rule.check.max === null) {
    return false;
  }

  return true;
}

function findRuleForTarget(
  ifcType: string | null,
  target: ViewerValidationTarget | null,
  compiledRules: Map<string, Map<string, ViewerValidationRule>>,
) {
  if (!ifcType || !target) {
    return null;
  }

  const rulesForType = compiledRules.get(normalizeIfcType(ifcType));
  if (!rulesForType) {
    return null;
  }

  return rulesForType.get(buildViewerValidationTargetId(target)) ?? null;
}

function evaluateRuleAgainstValue(
  value: ViewerValidationValue,
  rule: ViewerValidationRule,
): ViewerValidationResult {
  if (EMPTY_VALUE_STATES.has(value.state)) {
    return rule.failSeverity;
  }

  if (rule.check.kind === "empty") {
    return "ok";
  }

  if (rule.check.kind === "enum") {
    const normalizedValue = normalizeToken(value.text);
    return rule.check.allowedValues.some((entry) => normalizeToken(entry) === normalizedValue)
      ? "ok"
      : rule.failSeverity;
  }

  const numericValue = coerceFiniteNumber(value.text);
  if (numericValue === null) {
    return rule.failSeverity;
  }

  if (rule.check.min !== null && numericValue < rule.check.min) {
    return rule.failSeverity;
  }

  if (rule.check.max !== null && numericValue > rule.check.max) {
    return rule.failSeverity;
  }

  return "ok";
}

function toValidationValue(
  value: Pick<ViewerInspectionValue, "text" | "state"> | undefined,
): ViewerValidationValue {
  if (!value) {
    return missingValidationValue();
  }

  return {
    text: value.text,
    state: value.state,
  };
}

function summarizeValidation(matches: ViewerValidationMatch[]): ViewerValidationSummary | null {
  if (matches.length === 0) {
    return null;
  }

  let result: ViewerValidationResult | null = null;
  let okCount = 0;
  let warnCount = 0;
  let errorCount = 0;

  for (const match of matches) {
    result =
      result === null || compareValidationResult(match.result, result) > 0 ? match.result : result;

    if (match.result === "ok") {
      okCount += 1;
    } else if (match.result === "warn") {
      warnCount += 1;
    } else {
      errorCount += 1;
    }
  }

  return {
    result,
    targetedRowCount: matches.length,
    okCount,
    warnCount,
    errorCount,
  };
}

function applyValidationToInspectionRows(
  rows: ViewerInspectionRow[],
  compiledRules: Map<string, Map<string, ViewerValidationRule>>,
  ifcType: string | null,
  matches: ViewerValidationMatch[],
) {
  return rows.map((row) => {
    const rule = findRuleForTarget(ifcType, row.target, compiledRules);
    if (!rule) {
      return {
        ...row,
        value: cloneValidationValue(row.value, null),
      };
    }

    const result = evaluateRuleAgainstValue(toValidationValue(row.value), rule);
    const match = {
      result,
      ruleId: rule.id,
    } satisfies ViewerValidationMatch;

    matches.push(match);

    return {
      ...row,
      value: cloneValidationValue(row.value, match),
    };
  });
}

function buildRowTargetKeyToColumnKey(data: ViewerDataTableData) {
  const map = new Map<string, string>();

  map.set(buildViewerValidationTargetId({ kind: "attribute", name: "type" }), "ifcType");
  map.set(buildViewerValidationTargetId({ kind: "attribute", name: "GlobalId" }), "globalId");
  map.set(buildViewerValidationTargetId({ kind: "attribute", name: "Name" }), "name");

  for (const column of data.columns) {
    if (column.kind === "attribute" && column.key.startsWith("attribute:")) {
      map.set(
        buildViewerValidationTargetId({
          kind: "attribute",
          name: column.key.slice("attribute:".length),
        }),
        column.key,
      );
      continue;
    }

    if (column.kind === "property" && column.group) {
      map.set(
        buildViewerValidationTargetId({
          kind: "property",
          group: column.group,
          label: column.label,
        }),
        column.key,
      );
    }
  }

  return map;
}

function buildCompactRowValue(
  row: ViewerDataTableData["rows"][number],
  columnKey: string | undefined,
): ViewerValidationValue {
  if (!columnKey) {
    return missingValidationValue();
  }

  const cell = row.cells[columnKey];
  if (!cell) {
    return missingValidationValue();
  }

  return {
    text: cell.text,
    state: cell.state,
  };
}

export function createEmptyViewerValidationConfig(): ViewerValidationConfig {
  return {
    version: VIEWER_VALIDATION_CONFIG_VERSION,
    rules: [],
  };
}

export function createViewerValidationRule(): ViewerValidationRule {
  return {
    id: createRuleId(),
    ifcType: "IFCWALL",
    target: {
      kind: "attribute",
      name: "Name",
    },
    check: {
      kind: "empty",
    },
    failSeverity: "error",
  };
}

export function normalizeIfcType(value: string) {
  return normalizeToken(value);
}

export function buildViewerValidationTargetId(target: ViewerValidationTarget) {
  if (target.kind === "attribute") {
    return `attribute:${normalizeToken(target.name)}`;
  }

  return `property:${normalizeToken(target.group)}::${normalizeToken(target.label)}`;
}

export function buildViewerValidationRuleKey(rule: Pick<ViewerValidationRule, "ifcType" | "target">) {
  return `${normalizeIfcType(rule.ifcType)}::${buildViewerValidationTargetId(rule.target)}`;
}

export function sanitizeViewerValidationConfig(config: ViewerValidationConfig): ViewerValidationConfig {
  return {
    version: VIEWER_VALIDATION_CONFIG_VERSION,
    rules: config.rules.map((rule) => sanitizeRule(rule)),
  };
}

export function parseViewerValidationConfig(input: unknown): ViewerValidationConfig {
  if (!isRecord(input)) {
    throw new Error("Rules JSON must be an object.");
  }

  if (input.version !== VIEWER_VALIDATION_CONFIG_VERSION) {
    throw new Error(`Rules JSON version must be ${VIEWER_VALIDATION_CONFIG_VERSION}.`);
  }

  if (!Array.isArray(input.rules)) {
    throw new Error("Rules JSON must contain a rules array.");
  }

  return sanitizeViewerValidationConfig({
    version: VIEWER_VALIDATION_CONFIG_VERSION,
    rules: input.rules.map((rule) => sanitizeRule(rule)),
  });
}

export function parseViewerValidationRunPayload(input: unknown): ViewerValidationRunPayload {
  if (!isRecord(input)) {
    throw new Error("Validation payload must be an object.");
  }

  const config = parseViewerValidationConfig({
    version: input.version,
    rules: input.rules,
  });

  if (typeof input.sourceId !== "string" || input.sourceId.trim().length === 0) {
    throw new Error("Validation payload requires a sourceId.");
  }

  if (!Array.isArray(input.rows)) {
    throw new Error("Validation payload requires a rows array.");
  }

  return {
    version: config.version,
    sourceId: input.sourceId,
    rules: config.rules,
    rows: input.rows.map((row) => sanitizeValidationRow(row)),
  };
}

export function parseViewerValidationConfigText(text: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Rules JSON could not be parsed.");
  }

  return parseViewerValidationConfig(parsed);
}

export function serializeViewerValidationConfig(config: ViewerValidationConfig) {
  return JSON.stringify(sanitizeViewerValidationConfig(config), null, 2);
}

export function compileViewerValidationRules(rules: ViewerValidationRule[]) {
  const compiled = new Map<string, Map<string, ViewerValidationRule>>();

  for (const rule of rules.map((entry) => sanitizeRule(entry)).filter(isRunnableRule)) {
    const normalizedIfcType = normalizeIfcType(rule.ifcType);
    const rulesForType = compiled.get(normalizedIfcType) ?? new Map<string, ViewerValidationRule>();
    rulesForType.set(buildViewerValidationTargetId(rule.target), rule);
    compiled.set(normalizedIfcType, rulesForType);
  }

  return compiled;
}

export function buildViewerValidationRows(
  data: ViewerDataTableData,
  rules: ViewerValidationRule[],
) {
  const compiledRules = compileViewerValidationRules(rules);
  const targetKeyToColumnKey = buildRowTargetKeyToColumnKey(data);
  const rows: ViewerValidationRow[] = [];

  for (const row of data.rows) {
    if (!row.ifcType) {
      continue;
    }

    const rulesForType = compiledRules.get(normalizeIfcType(row.ifcType));
    if (!rulesForType || rulesForType.size === 0) {
      continue;
    }

    const values: Record<string, ViewerValidationValue> = {};
    for (const targetId of rulesForType.keys()) {
      values[targetId] = buildCompactRowValue(row, targetKeyToColumnKey.get(targetId));
    }

    rows.push({
      modelId: row.modelId,
      localId: row.localId,
      ifcType: row.ifcType,
      values,
    });
  }

  return rows;
}

export async function evaluateViewerValidationPayload(
  payload: ViewerValidationRunPayload,
  options?: {
    chunkSize?: number;
    onProgress?: (input: { processedRowCount: number; totalRowCount: number }) => void;
    signal?: AbortSignal;
  },
): Promise<ViewerValidationRunResult> {
  const compiledRules = compileViewerValidationRules(payload.rules);
  const results: ViewerValidationElementResult[] = [];
  const totalRowCount = payload.rows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? DEFAULT_VALIDATION_CHUNK_SIZE);

  for (let index = 0; index < payload.rows.length; index += chunkSize) {
    if (options?.signal?.aborted) {
      throw new DOMException("Validation cancelled", "AbortError");
    }

    const chunk = payload.rows.slice(index, index + chunkSize);
    for (const row of chunk) {
      const ifcType = row.ifcType ? normalizeIfcType(row.ifcType) : null;
      if (!ifcType) {
        continue;
      }

      const rulesForType = compiledRules.get(ifcType);
      if (!rulesForType) {
        continue;
      }

      let result: ViewerValidationFailureSeverity | null = null;
      const matchedRuleIds: string[] = [];

      for (const [targetId, rule] of rulesForType.entries()) {
        const evaluation = evaluateRuleAgainstValue(
          row.values[targetId] ?? missingValidationValue(),
          rule,
        );

        if (evaluation === "ok") {
          continue;
        }

        matchedRuleIds.push(rule.id);
        result =
          result === null || VALIDATION_RESULT_PRIORITY[evaluation] > VALIDATION_RESULT_PRIORITY[result]
            ? evaluation
            : result;
      }

      if (result) {
        results.push({
          modelId: row.modelId,
          localId: row.localId,
          result,
          matchedRuleIds,
        });
      }
    }

    options?.onProgress?.({
      processedRowCount: Math.min(index + chunk.length, totalRowCount),
      totalRowCount,
    });
  }

  return {
    sourceId: payload.sourceId,
    results,
  };
}

export function groupViewerValidationResultsBySeverity(
  results: ViewerValidationElementResult[],
): ViewerValidationHighlights {
  const warn: ViewerValidationElementMap = {};
  const error: ViewerValidationElementMap = {};

  for (const result of results) {
    const bucket = result.result === "error" ? error : warn;
    const modelIds = bucket[result.modelId] ?? [];
    modelIds.push(result.localId);
    bucket[result.modelId] = modelIds;
  }

  return { warn, error };
}

export function applyViewerValidationToInspection(
  inspection: ViewerElementInspection | null,
  rules: ViewerValidationRule[],
) {
  if (!inspection) {
    return null;
  }

  const compiledRules = compileViewerValidationRules(rules);
  const inspectionIfcType = getInspectionIfcType(inspection);
  const matches: ViewerValidationMatch[] = [];
  const summaryRows = applyValidationToInspectionRows(
    inspection.summaryRows,
    compiledRules,
    inspectionIfcType,
    matches,
  );
  const propertySets: ViewerInspectionGroup[] = inspection.propertySets.map((group) => ({
    ...group,
    rows: applyValidationToInspectionRows(group.rows, compiledRules, inspectionIfcType, matches),
  }));

  return {
    ...inspection,
    summaryRows,
    propertySets,
    validationSummary: summarizeValidation(matches),
  };
}
