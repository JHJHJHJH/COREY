import type {
  ViewerDataTableData,
  ViewerElementInspection,
  ViewerInspectionGroup,
  ViewerInspectionRow,
  ViewerInspectionValue,
  ViewerInspectionValueState,
  ViewerValidationCheck,
  ViewerValidationClause,
  ViewerValidationClauseFailure,
  ViewerValidationConfig,
  ViewerValidationElementMap,
  ViewerValidationElementResult,
  ViewerValidationFailureSeverity,
  ViewerValidationHighlights,
  ViewerValidationMatch,
  ViewerValidationResult,
  ViewerValidationRow,
  ViewerValidationRule,
  ViewerValidationRuleFailure,
  ViewerValidationRunPayload,
  ViewerValidationRunResult,
  ViewerValidationSummary,
  ViewerValidationTarget,
  ViewerValidationValue,
} from "@/features/viewer/types";

export const VIEWER_VALIDATION_CONFIG_VERSION = 2 as const;

const LEGACY_VIEWER_VALIDATION_CONFIG_VERSION = 1 as const;

export const VIEWER_VALIDATION_STORAGE_KEY = "corey.validation-rules.v1";

const DEFAULT_VALIDATION_CHUNK_SIZE = 250;
const LEGACY_MIGRATION_CLAUSE_TITLE = "Migrated clause";

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

type CompiledViewerValidationRule = {
  clauseId: string;
  clauseTitle: string;
  description: string;
  rule: ViewerValidationRule;
};

type CompiledViewerValidationRuleMap = Map<string, Map<string, CompiledViewerValidationRule[]>>;

function createValidationId(prefix: "rule" | "clause") {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function createRuleId() {
  return createValidationId("rule");
}

function createClauseId() {
  return createValidationId("clause");
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

function missingInspectionValue(): ViewerInspectionValue {
  return {
    raw: undefined,
    text: "MISSING",
    state: "missing",
    validation: null,
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

function sanitizeValidationFailureSeverity(value: unknown): ViewerValidationFailureSeverity {
  return value === "warn" ? "warn" : "error";
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

function sanitizeValidationRuleFailure(input: unknown): ViewerValidationRuleFailure {
  if (!isRecord(input)) {
    throw new Error("Each validation rule failure must be an object.");
  }

  const clauseId = normalizeStoredText(String(input.clauseId ?? ""));
  const clauseTitle = normalizeStoredText(String(input.clauseTitle ?? "")) || "Untitled clause";
  const ruleId = normalizeStoredText(String(input.ruleId ?? ""));
  const description = normalizeStoredText(String(input.description ?? ""));

  if (!clauseId || !ruleId || !description) {
    throw new Error("Each validation rule failure requires clauseId, ruleId, and description.");
  }

  return {
    clauseId,
    clauseTitle,
    ruleId,
    result: sanitizeValidationFailureSeverity(input.result),
    description,
  };
}

function sanitizeValidationClauseFailure(input: unknown): ViewerValidationClauseFailure {
  if (!isRecord(input)) {
    throw new Error("Each validation clause failure must be an object.");
  }

  const clauseId = normalizeStoredText(String(input.clauseId ?? ""));
  const clauseTitle = normalizeStoredText(String(input.clauseTitle ?? "")) || "Untitled clause";
  if (!clauseId) {
    throw new Error("Each validation clause failure requires a clauseId.");
  }

  return {
    clauseId,
    clauseTitle,
    result: sanitizeValidationFailureSeverity(input.result),
    rules: Array.isArray(input.rules)
      ? input.rules.map((failure) => sanitizeValidationRuleFailure(failure))
      : [],
  };
}

function sanitizeValidationElementResult(input: unknown): ViewerValidationElementResult {
  if (!isRecord(input)) {
    throw new Error("Each validation element result must be an object.");
  }

  const modelId = normalizeStoredText(String(input.modelId ?? ""));
  const localId = coerceFiniteNumber(input.localId);
  if (!modelId || localId === null) {
    throw new Error("Each validation element result requires modelId and localId.");
  }

  return {
    modelId,
    localId: Math.trunc(localId),
    result: sanitizeValidationFailureSeverity(input.result),
    failedClauses: Array.isArray(input.failedClauses)
      ? input.failedClauses.map((failure) => sanitizeValidationClauseFailure(failure))
      : [],
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

function sanitizeClause(clause: unknown): ViewerValidationClause {
  if (!isRecord(clause)) {
    throw new Error("Each clause entry must be an object.");
  }

  const title = normalizeStoredText(String(clause.title ?? "")) || "Untitled clause";
  const rules = Array.isArray(clause.rules) ? clause.rules : [];

  return {
    id: typeof clause.id === "string" && clause.id.trim().length > 0 ? clause.id : createClauseId(),
    title,
    rules: rules.map((rule) => sanitizeRule(rule)),
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

function normalizeValidationAttributeName(value: string) {
  const normalized = normalizeToken(value);

  if (normalized === "_guid" || normalized === "guid" || normalized === "globalid") {
    return "globalid";
  }

  return normalized;
}

function findRulesForTarget(
  ifcType: string | null,
  target: ViewerValidationTarget | null,
  compiledRules: CompiledViewerValidationRuleMap,
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

function ruleTargetLabel(target: ViewerValidationTarget) {
  if (target.kind === "attribute") {
    return target.name;
  }

  return `${target.group} > ${target.label}`;
}

function uniqueRuleFailures(ruleFailures: ViewerValidationRuleFailure[]) {
  const unique = new Map<string, ViewerValidationRuleFailure>();

  for (const failure of ruleFailures) {
    unique.set(`${failure.clauseId}::${failure.ruleId}`, failure);
  }

  return [...unique.values()];
}

function aggregateClauseFailures(ruleFailures: ViewerValidationRuleFailure[]) {
  const grouped = new Map<string, ViewerValidationClauseFailure>();

  for (const failure of uniqueRuleFailures(ruleFailures)) {
    const existing = grouped.get(failure.clauseId);
    if (!existing) {
      grouped.set(failure.clauseId, {
        clauseId: failure.clauseId,
        clauseTitle: failure.clauseTitle,
        result: failure.result,
        rules: [failure],
      });
      continue;
    }

    existing.result =
      VALIDATION_RESULT_PRIORITY[failure.result] > VALIDATION_RESULT_PRIORITY[existing.result]
        ? failure.result
        : existing.result;
    existing.rules.push(failure);
  }

  return [...grouped.values()];
}

function summarizeValidation(matches: ViewerValidationMatch[]): ViewerValidationSummary | null {
  if (matches.length === 0) {
    return null;
  }

  let result: ViewerValidationResult | null = null;
  let okCount = 0;
  let warnCount = 0;
  let errorCount = 0;
  const failedRuleMatches: ViewerValidationRuleFailure[] = [];

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

    for (const clauseFailure of match.clauseFailures) {
      failedRuleMatches.push(...clauseFailure.rules);
    }
  }

  const failedClauses = aggregateClauseFailures(failedRuleMatches);

  return {
    result,
    targetedRowCount: matches.length,
    okCount,
    warnCount,
    errorCount,
    failedClauseCount: failedClauses.length,
    failedClauses,
  };
}

function toRuleFailure(
  compiledRule: CompiledViewerValidationRule,
  result: ViewerValidationFailureSeverity,
): ViewerValidationRuleFailure {
  return {
    clauseId: compiledRule.clauseId,
    clauseTitle: compiledRule.clauseTitle,
    ruleId: compiledRule.rule.id,
    result,
    description: compiledRule.description,
  };
}

function countInspectionGroupIssues(rows: ViewerInspectionRow[]) {
  return (
    rows.reduce((count, row) => count + Number(row.value.state !== "present"), 0) +
    Number(rows.length === 0)
  );
}

function countInspectionIssues(
  summaryRows: ViewerInspectionRow[],
  propertySets: ViewerInspectionGroup[],
) {
  return (
    summaryRows.reduce((count, row) => count + Number(row.value.state !== "present"), 0) +
    propertySets.reduce((count, group) => count + group.issueCount, 0)
  );
}

function buildMissingPropertyInspectionRow(
  target: Extract<ViewerValidationTarget, { kind: "property" }>,
  targetId: string,
): ViewerInspectionRow {
  return {
    key: `validation-missing:${targetId}`,
    label: target.label,
    target,
    value: missingInspectionValue(),
  };
}

function appendMissingValidationPropertyRows(
  propertySets: ViewerInspectionGroup[],
  compiledRules: CompiledViewerValidationRuleMap,
  ifcType: string | null,
) {
  if (!ifcType) {
    return propertySets;
  }

  const rulesForType = compiledRules.get(normalizeIfcType(ifcType));
  if (!rulesForType) {
    return propertySets;
  }

  const existingTargetIds = new Set<string>();
  for (const group of propertySets) {
    for (const row of group.rows) {
      if (row.target?.kind === "property") {
        existingTargetIds.add(buildViewerValidationTargetId(row.target));
      }
    }
  }

  const missingRowsByGroup = new Map<string, ViewerInspectionRow[]>();
  const missingGroupTitles = new Map<string, string>();

  for (const [targetId, rules] of rulesForType.entries()) {
    const target = rules[0]?.rule.target;
    if (!target || target.kind !== "property" || existingTargetIds.has(targetId)) {
      continue;
    }

    const groupKey = normalizeToken(target.group);
    const rows = missingRowsByGroup.get(groupKey) ?? [];
    rows.push(buildMissingPropertyInspectionRow(target, targetId));
    missingRowsByGroup.set(groupKey, rows);
    missingGroupTitles.set(groupKey, target.group);
  }

  if (missingRowsByGroup.size === 0) {
    return propertySets;
  }

  const appliedGroupKeys = new Set<string>();
  const nextPropertySets = propertySets.map((group) => {
    const groupKey = normalizeToken(group.title);
    const missingRows = missingRowsByGroup.get(groupKey);
    if (!missingRows) {
      return group;
    }

    appliedGroupKeys.add(groupKey);
    const rows = [...group.rows, ...missingRows];

    return {
      ...group,
      rows,
      issueCount: countInspectionGroupIssues(rows),
    };
  });

  for (const [groupKey, rows] of missingRowsByGroup.entries()) {
    if (appliedGroupKeys.has(groupKey)) {
      continue;
    }

    nextPropertySets.push({
      key: `validation-missing-group:${groupKey}`,
      title: missingGroupTitles.get(groupKey) ?? "Missing Property Set",
      subtitle: "Missing property set",
      rows,
      issueCount: countInspectionGroupIssues(rows),
    });
  }

  return nextPropertySets;
}

function applyValidationToInspectionRows(
  rows: ViewerInspectionRow[],
  compiledRules: CompiledViewerValidationRuleMap,
  ifcType: string | null,
  matches: ViewerValidationMatch[],
) {
  return rows.map((row) => {
    const rules = findRulesForTarget(ifcType, row.target, compiledRules);
    if (!rules || rules.length === 0) {
      return {
        ...row,
        value: cloneValidationValue(row.value, null),
      };
    }

    const failedRuleMatches: ViewerValidationRuleFailure[] = [];
    let result: ViewerValidationResult = "ok";

    for (const compiledRule of rules) {
      const evaluation = evaluateRuleAgainstValue(toValidationValue(row.value), compiledRule.rule);
      if (evaluation === "ok") {
        continue;
      }

      failedRuleMatches.push(toRuleFailure(compiledRule, evaluation));
      result =
        VALIDATION_RESULT_PRIORITY[evaluation] > VALIDATION_RESULT_PRIORITY[result]
          ? evaluation
          : result;
    }

    const match = {
      result,
      failedRuleCount: failedRuleMatches.length,
      clauseFailures: aggregateClauseFailures(failedRuleMatches),
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

function migrateLegacyViewerValidationConfig(input: unknown): ViewerValidationConfig | null {
  if (!isRecord(input) || input.version !== LEGACY_VIEWER_VALIDATION_CONFIG_VERSION) {
    return null;
  }

  const rules = Array.isArray(input.rules) ? input.rules : [];

  return {
    version: VIEWER_VALIDATION_CONFIG_VERSION,
    clauses: [
      {
        id: createClauseId(),
        title: LEGACY_MIGRATION_CLAUSE_TITLE,
        rules: rules.map((rule) => sanitizeRule(rule)),
      },
    ],
  };
}

export function createEmptyViewerValidationConfig(): ViewerValidationConfig {
  return {
    version: VIEWER_VALIDATION_CONFIG_VERSION,
    clauses: [],
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

export function createViewerValidationClause(): ViewerValidationClause {
  return {
    id: createClauseId(),
    title: "New clause",
    rules: [createViewerValidationRule()],
  };
}

export function normalizeIfcType(value: string) {
  return normalizeToken(value);
}

export function buildViewerValidationTargetId(target: ViewerValidationTarget) {
  if (target.kind === "attribute") {
    return `attribute:${normalizeValidationAttributeName(target.name)}`;
  }

  return `property:${normalizeToken(target.group)}::${normalizeToken(target.label)}`;
}

export function buildViewerValidationRuleKey(rule: Pick<ViewerValidationRule, "ifcType" | "target">) {
  return `${normalizeIfcType(rule.ifcType)}::${buildViewerValidationTargetId(rule.target)}`;
}

export function describeViewerValidationRule(rule: ViewerValidationRule) {
  const targetLabel = ruleTargetLabel(rule.target);

  if (rule.check.kind === "empty") {
    return `${targetLabel} is required`;
  }

  if (rule.check.kind === "enum") {
    return `${targetLabel} must be one of ${rule.check.allowedValues.join(", ")}`;
  }

  if (rule.check.min !== null && rule.check.max !== null) {
    return `${targetLabel} must be between ${rule.check.min} and ${rule.check.max}`;
  }

  if (rule.check.min !== null) {
    return `${targetLabel} must be at least ${rule.check.min}`;
  }

  return `${targetLabel} must be at most ${rule.check.max}`;
}

export function flattenViewerValidationClauses(clauses: ViewerValidationClause[]) {
  return clauses.flatMap((clause) => clause.rules);
}

export function sanitizeViewerValidationConfig(config: ViewerValidationConfig): ViewerValidationConfig {
  return {
    version: VIEWER_VALIDATION_CONFIG_VERSION,
    clauses: config.clauses.map((clause) => sanitizeClause(clause)),
  };
}

export function parseViewerValidationConfig(input: unknown): ViewerValidationConfig {
  if (!isRecord(input)) {
    throw new Error("Rules JSON must be an object.");
  }

  if (input.version === LEGACY_VIEWER_VALIDATION_CONFIG_VERSION) {
    throw new Error(
      `Rules JSON version ${LEGACY_VIEWER_VALIDATION_CONFIG_VERSION} is no longer supported. Import a version ${VIEWER_VALIDATION_CONFIG_VERSION} clause-based config.`,
    );
  }

  if (input.version !== VIEWER_VALIDATION_CONFIG_VERSION) {
    throw new Error(`Rules JSON version must be ${VIEWER_VALIDATION_CONFIG_VERSION}.`);
  }

  if (!Array.isArray(input.clauses)) {
    throw new Error("Rules JSON must contain a clauses array.");
  }

  return sanitizeViewerValidationConfig({
    version: VIEWER_VALIDATION_CONFIG_VERSION,
    clauses: input.clauses.map((clause) => sanitizeClause(clause)),
  });
}

export function parseStoredViewerValidationConfig(input: unknown): ViewerValidationConfig {
  const migrated = migrateLegacyViewerValidationConfig(input);
  if (migrated) {
    return sanitizeViewerValidationConfig(migrated);
  }

  return parseViewerValidationConfig(input);
}

export function parseViewerValidationRunPayload(input: unknown): ViewerValidationRunPayload {
  if (!isRecord(input)) {
    throw new Error("Validation payload must be an object.");
  }

  const config = parseViewerValidationConfig({
    version: input.version,
    clauses: input.clauses,
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
    clauses: config.clauses,
    rows: input.rows.map((row) => sanitizeValidationRow(row)),
  };
}

export function parseViewerValidationRunResult(
  input: unknown,
  expectedSourceId?: string,
): ViewerValidationRunResult {
  if (!isRecord(input)) {
    throw new Error("Validation result must be an object.");
  }

  const sourceId = normalizeStoredText(String(input.sourceId ?? ""));
  if (!sourceId) {
    throw new Error("Validation result requires a sourceId.");
  }

  if (expectedSourceId && sourceId !== expectedSourceId) {
    throw new Error("Validation result does not match this model.");
  }

  const failedClauses = Array.isArray(input.failedClauses)
    ? input.failedClauses.map((failure) => sanitizeValidationClauseFailure(failure))
    : [];

  return {
    sourceId,
    results: Array.isArray(input.results)
      ? input.results.map((result) => sanitizeValidationElementResult(result))
      : [],
    failedClauseCount:
      typeof input.failedClauseCount === "number" && Number.isFinite(input.failedClauseCount)
        ? Math.max(0, Math.trunc(input.failedClauseCount))
        : failedClauses.length,
    failedClauses,
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

export function parseStoredViewerValidationConfigText(text: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Rules JSON could not be parsed.");
  }

  return parseStoredViewerValidationConfig(parsed);
}

export function serializeViewerValidationConfig(config: ViewerValidationConfig) {
  return JSON.stringify(sanitizeViewerValidationConfig(config), null, 2);
}

export function compileViewerValidationRules(clauses: ViewerValidationClause[]) {
  const compiled: CompiledViewerValidationRuleMap = new Map();

  for (const clause of clauses.map((entry) => sanitizeClause(entry))) {
    for (const rule of clause.rules.filter(isRunnableRule)) {
      const normalizedIfcType = normalizeIfcType(rule.ifcType);
      const targetId = buildViewerValidationTargetId(rule.target);
      const rulesForType = compiled.get(normalizedIfcType) ?? new Map<string, CompiledViewerValidationRule[]>();
      const compiledRulesForTarget = rulesForType.get(targetId) ?? [];

      compiledRulesForTarget.push({
        clauseId: clause.id,
        clauseTitle: clause.title,
        description: describeViewerValidationRule(rule),
        rule,
      });

      rulesForType.set(targetId, compiledRulesForTarget);
      compiled.set(normalizedIfcType, rulesForType);
    }
  }

  return compiled;
}

export function buildViewerValidationRows(
  data: ViewerDataTableData,
  clauses: ViewerValidationClause[],
) {
  const compiledRules = compileViewerValidationRules(clauses);
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
  const compiledRules = compileViewerValidationRules(payload.clauses);
  const results: ViewerValidationElementResult[] = [];
  const allRuleFailures: ViewerValidationRuleFailure[] = [];
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
      const failedRuleMatches: ViewerValidationRuleFailure[] = [];

      for (const [targetId, rulesForTarget] of rulesForType.entries()) {
        const value = row.values[targetId] ?? missingValidationValue();

        for (const compiledRule of rulesForTarget) {
          const evaluation = evaluateRuleAgainstValue(value, compiledRule.rule);

          if (evaluation === "ok") {
            continue;
          }

          failedRuleMatches.push(toRuleFailure(compiledRule, evaluation));
          result =
            result === null || VALIDATION_RESULT_PRIORITY[evaluation] > VALIDATION_RESULT_PRIORITY[result]
              ? evaluation
              : result;
        }
      }

      if (result) {
        const failedClauses = aggregateClauseFailures(failedRuleMatches);
        allRuleFailures.push(...failedRuleMatches);
        results.push({
          modelId: row.modelId,
          localId: row.localId,
          result,
          failedClauses,
        });
      }
    }

    options?.onProgress?.({
      processedRowCount: Math.min(index + chunk.length, totalRowCount),
      totalRowCount,
    });
  }

  const failedClauses = aggregateClauseFailures(allRuleFailures);

  return {
    sourceId: payload.sourceId,
    results,
    failedClauseCount: failedClauses.length,
    failedClauses,
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
  clauses: ViewerValidationClause[],
) {
  if (!inspection) {
    return null;
  }

  const compiledRules = compileViewerValidationRules(clauses);
  const inspectionIfcType = getInspectionIfcType(inspection);
  const matches: ViewerValidationMatch[] = [];
  const summaryRows = applyValidationToInspectionRows(
    inspection.summaryRows,
    compiledRules,
    inspectionIfcType,
    matches,
  );
  const propertySetsWithMissingRows = appendMissingValidationPropertyRows(
    inspection.propertySets,
    compiledRules,
    inspectionIfcType,
  );
  const propertySets: ViewerInspectionGroup[] = propertySetsWithMissingRows.map((group) => {
    const rows = applyValidationToInspectionRows(group.rows, compiledRules, inspectionIfcType, matches);

    return {
      ...group,
      rows,
      issueCount: countInspectionGroupIssues(rows),
    };
  });

  return {
    ...inspection,
    summaryRows,
    propertySets,
    issueCount: countInspectionIssues(summaryRows, propertySets),
    validationSummary: summarizeValidation(matches),
  };
}
