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
  ViewerValidationSeverity,
  ViewerValidationSeverityTally,
  ViewerValidationSummary,
  ViewerValidationTarget,
  ViewerValidationValue,
} from "@/features/viewer/types";
import { VIEWER_VALIDATION_OK_RESULT } from "@/features/viewer/types";
import {
  buildViewerSeverityScale,
  type ViewerSeverityScale,
} from "@/features/viewer/lib/severity-scale";

export const VIEWER_VALIDATION_CONFIG_VERSION = 4 as const;

const LEGACY_VIEWER_VALIDATION_CONFIG_VERSION = 1 as const;
/** Clause-based, `pattern` checks, no configurable severities. */
const CLAUSE_VIEWER_VALIDATION_CONFIG_VERSION = 2 as const;
/** `regex` checks, but severities still fixed to warn/error. */
const PREVIOUS_VIEWER_VALIDATION_CONFIG_VERSION = 3 as const;

/**
 * Seeded severity list. The ids and colours match what warn/error rendered as before severities
 * became configurable, so an existing install looks unchanged after migrating.
 */
export const DEFAULT_VIEWER_VALIDATION_SEVERITIES: readonly ViewerValidationSeverity[] = [
  { id: "warn", label: "Warn", color: "#d29a2f", order: 1 },
  { id: "error", label: "Error", color: "#bb5a36", order: 2 },
];

/** `"ok"` is the reserved non-failure result and can never name a severity. */
const RESERVED_SEVERITY_IDS: ReadonlySet<string> = new Set([VIEWER_VALIDATION_OK_RESULT]);
const SEVERITY_HEX_PATTERN = /^#[0-9a-f]{6}$/;
const DEFAULT_SEVERITY_COLOR = "#6b7280";
/** Cycled when adding a severity so consecutive new levels do not all look alike. */
const NEW_SEVERITY_COLORS = ["#6b7280", "#2f7fd2", "#7c5cd6", "#1f9d6b", "#c2417a", "#b0761c"];
const MAX_SEVERITIES = 12;

export const VIEWER_VALIDATION_STORAGE_KEY = "corey.validation-rules.v1";

const DEFAULT_VALIDATION_CHUNK_SIZE = 250;
const LEGACY_MIGRATION_CLAUSE_TITLE = "Migrated clause";

const EMPTY_VALUE_STATES: ReadonlySet<ViewerInspectionValueState> = new Set([
  "missing",
  "empty",
  "null",
  "undefined",
]);

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

type CompiledViewerValidationTargetMap = Map<string, CompiledViewerValidationRule[]>;

/**
 * Keyed by applicability (`buildViewerValidationApplicabilityKey`) rather than by IFC type alone,
 * so rules scoped to a predefined subtype sit in their own bucket. Use
 * `resolveCompiledRulesForElement` to look rules up: an element is served by both its subtype
 * bucket and the `any subtype` bucket for its IFC type.
 */
type CompiledViewerValidationRuleMap = Map<string, CompiledViewerValidationTargetMap>;

export type CompiledViewerValidationRuleCache = Map<
  string,
  CompiledViewerValidationTargetMap | null
>;

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

const TRUE_BOOLEAN_TOKENS: ReadonlySet<string> = new Set([
  "true",
  "1",
  "yes",
  "y",
  ".t.",
  "t",
]);

const FALSE_BOOLEAN_TOKENS: ReadonlySet<string> = new Set([
  "false",
  "0",
  "no",
  "n",
  ".f.",
  "f",
]);

function coerceBoolean(value: string): boolean | null {
  const token = normalizeToken(value);
  if (TRUE_BOOLEAN_TOKENS.has(token)) {
    return true;
  }

  if (FALSE_BOOLEAN_TOKENS.has(token)) {
    return false;
  }

  return null;
}

function compileAnchoredRegex(regex: string, caseInsensitive: boolean): RegExp | null {
  try {
    return new RegExp(`^(?:${regex})$`, caseInsensitive ? "i" : "");
  } catch {
    return null;
  }
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

/**
 * Resolves a stored severity id against the configured scale. An unknown id lands on the most
 * severe level rather than being silently downgraded — the previous fixed coercion to `"error"`
 * would have made any custom id impossible to round-trip.
 */
function sanitizeValidationFailureSeverity(
  scale: ViewerSeverityScale,
  value: unknown,
): ViewerValidationFailureSeverity {
  return typeof value === "string" ? scale.resolve(value) : scale.fallbackId;
}

function slugifySeverityId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Normalizes the configured severity list: valid ids and colours, no duplicates, no reserved
 * ids, densely renumbered `order`, and never empty — the rest of the app assumes at least one
 * severity exists.
 */
export function sanitizeViewerValidationSeverities(input: unknown): ViewerValidationSeverity[] {
  const entries = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const sanitized: ViewerValidationSeverity[] = [];

  for (const entry of entries) {
    if (!isRecord(entry)) {
      continue;
    }

    const id = slugifySeverityId(String(entry.id ?? ""));
    if (!id || RESERVED_SEVERITY_IDS.has(id) || seen.has(id)) {
      continue;
    }

    const color = String(entry.color ?? "").trim().toLowerCase();
    const label = normalizeStoredText(String(entry.label ?? ""));
    const order = typeof entry.order === "number" && Number.isFinite(entry.order)
      ? entry.order
      : sanitized.length;

    seen.add(id);
    sanitized.push({
      id,
      label: label || id,
      color: SEVERITY_HEX_PATTERN.test(color) ? color : DEFAULT_SEVERITY_COLOR,
      order,
    });

    if (sanitized.length >= MAX_SEVERITIES) {
      break;
    }
  }

  if (sanitized.length === 0) {
    return DEFAULT_VIEWER_VALIDATION_SEVERITIES.map((severity) => ({ ...severity }));
  }

  return sanitized
    .sort((left, right) => left.order - right.order)
    .map((severity, index) => ({ ...severity, order: index + 1 }));
}

/**
 * Keeps the user's own definitions when a config arrives from an import or a starter template:
 * ids they already have keep their label, colour and rank, and ids only the incoming config
 * knows about are appended above them.
 */
export function mergeViewerValidationSeverities(
  current: ViewerValidationSeverity[],
  incoming: ViewerValidationSeverity[],
): ViewerValidationSeverity[] {
  const currentById = new Map(current.map((severity) => [severity.id, severity]));
  const merged = [...current];

  for (const severity of incoming) {
    if (!currentById.has(severity.id)) {
      merged.push(severity);
    }
  }

  return sanitizeViewerValidationSeverities(merged);
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
    subtype: typeof row.subtype === "string" && row.subtype.trim().length > 0 ? row.subtype : null,
    values,
  };
}

function sanitizeValidationRuleFailure(scale: ViewerSeverityScale, input: unknown): ViewerValidationRuleFailure {
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
    result: sanitizeValidationFailureSeverity(scale, input.result),
    description,
  };
}

function sanitizeValidationClauseFailure(scale: ViewerSeverityScale, input: unknown): ViewerValidationClauseFailure {
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
    result: sanitizeValidationFailureSeverity(scale, input.result),
    rules: Array.isArray(input.rules)
      ? input.rules.map((failure) => sanitizeValidationRuleFailure(scale, failure))
      : [],
  };
}

function sanitizeValidationElementResult(scale: ViewerSeverityScale, input: unknown): ViewerValidationElementResult {
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
    result: sanitizeValidationFailureSeverity(scale, input.result),
    failedClauses: Array.isArray(input.failedClauses)
      ? input.failedClauses.map((failure) => sanitizeValidationClauseFailure(scale, failure))
      : [],
  };
}

function compareValidationResult(
  scale: ViewerSeverityScale,
  left: ViewerValidationResult,
  right: ViewerValidationResult,
) {
  return scale.rank(left) - scale.rank(right);
}

function readInspectionAttributeText(inspection: ViewerElementInspection, name: string) {
  const row = inspection.summaryRows.find(
    (entry) => entry.target?.kind === "attribute" && normalizeToken(entry.target.name) === name,
  );
  return row?.value.state === "present" ? row.value.text : null;
}

function getInspectionIfcType(inspection: ViewerElementInspection) {
  return readInspectionAttributeText(inspection, "type");
}

function getInspectionSubtype(inspection: ViewerElementInspection) {
  return resolveIfcSubtype(
    readInspectionAttributeText(inspection, "predefinedtype"),
    readInspectionAttributeText(inspection, "objecttype"),
  );
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

  if (check.kind === "regex") {
    return {
      kind: "regex",
      regex: normalizeStoredText(String(check.regex ?? "")),
      caseInsensitive: Boolean(check.caseInsensitive),
    };
  }

  if (check.kind === "boolean") {
    return {
      kind: "boolean",
      expected: typeof check.expected === "boolean" ? check.expected : true,
    };
  }

  throw new Error(`Unsupported rule check kind: ${String(check.kind)}`);
}

function sanitizeRule(scale: ViewerSeverityScale, rule: unknown): ViewerValidationRule {
  if (!isRecord(rule)) {
    throw new Error("Each rule entry must be an object.");
  }

  const ifcType = normalizeStoredText(String(rule.ifcType ?? ""));
  const subtype = normalizeStoredText(String(rule.subtype ?? ""));
  const failSeverity = sanitizeValidationFailureSeverity(scale, rule.failSeverity);

  return {
    id: typeof rule.id === "string" && rule.id.trim().length > 0 ? rule.id : createRuleId(),
    ifcType,
    // Omitted when blank so rules authored without a subtype serialize exactly as before.
    ...(subtype ? { subtype } : {}),
    target: sanitizeTarget(rule.target),
    check: sanitizeCheck(rule.check),
    failSeverity,
  };
}

function sanitizeClause(scale: ViewerSeverityScale, clause: unknown): ViewerValidationClause {
  if (!isRecord(clause)) {
    throw new Error("Each clause entry must be an object.");
  }

  const title = normalizeStoredText(String(clause.title ?? "")) || "Untitled clause";
  const rules = Array.isArray(clause.rules) ? clause.rules : [];

  return {
    id: typeof clause.id === "string" && clause.id.trim().length > 0 ? clause.id : createClauseId(),
    title,
    rules: rules.map((rule) => sanitizeRule(scale, rule)),
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

  if (rule.check.kind === "regex") {
    const regex = normalizeStoredText(rule.check.regex);
    if (!regex || !compileAnchoredRegex(regex, rule.check.caseInsensitive)) {
      return false;
    }
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
  subtype: string | null,
  target: ViewerValidationTarget | null,
  compiledRules: CompiledViewerValidationRuleMap,
) {
  if (!ifcType || !target) {
    return null;
  }

  const rulesForElement = resolveCompiledRulesForElement(compiledRules, ifcType, subtype);
  if (!rulesForElement) {
    return null;
  }

  return rulesForElement.get(buildViewerValidationTargetId(target)) ?? null;
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

  if (rule.check.kind === "regex") {
    const regex = compileAnchoredRegex(rule.check.regex, rule.check.caseInsensitive);
    if (!regex) {
      return rule.failSeverity;
    }

    return regex.test(value.text) ? "ok" : rule.failSeverity;
  }

  if (rule.check.kind === "boolean") {
    const booleanValue = coerceBoolean(value.text);
    if (booleanValue === null) {
      return rule.failSeverity;
    }

    return booleanValue === rule.check.expected ? "ok" : rule.failSeverity;
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

function aggregateClauseFailures(
  scale: ViewerSeverityScale,
  ruleFailures: ViewerValidationRuleFailure[],
) {
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
      scale.rank(failure.result) > scale.rank(existing.result) ? failure.result : existing.result;
    existing.rules.push(failure);
  }

  return [...grouped.values()];
}

function summarizeValidation(
  scale: ViewerSeverityScale,
  matches: ViewerValidationMatch[],
): ViewerValidationSummary | null {
  if (matches.length === 0) {
    return null;
  }

  let result: ViewerValidationResult | null = null;
  let okCount = 0;
  // Seeded with every configured severity so callers can render a stable set of counters even
  // when a severity has no failures.
  const countsBySeverity: Record<string, number> = Object.fromEntries(
    scale.ids.map((id) => [id, 0]),
  );
  const failedRuleMatches: ViewerValidationRuleFailure[] = [];

  for (const match of matches) {
    result =
      result === null || compareValidationResult(scale, match.result, result) > 0
        ? match.result
        : result;

    if (match.result === VIEWER_VALIDATION_OK_RESULT) {
      okCount += 1;
    } else {
      countsBySeverity[match.result] = (countsBySeverity[match.result] ?? 0) + 1;
    }

    for (const clauseFailure of match.clauseFailures) {
      failedRuleMatches.push(...clauseFailure.rules);
    }
  }

  const failedClauses = aggregateClauseFailures(scale, failedRuleMatches);

  return {
    result,
    targetedRowCount: matches.length,
    okCount,
    countsBySeverity,
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
  subtype: string | null,
) {
  if (!ifcType) {
    return propertySets;
  }

  const rulesForType = resolveCompiledRulesForElement(compiledRules, ifcType, subtype);
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
  scale: ViewerSeverityScale,
  rows: ViewerInspectionRow[],
  compiledRules: CompiledViewerValidationRuleMap,
  ifcType: string | null,
  subtype: string | null,
  matches: ViewerValidationMatch[],
) {
  return rows.map((row) => {
    const rules = findRulesForTarget(ifcType, subtype, row.target, compiledRules);
    if (!rules || rules.length === 0) {
      return {
        ...row,
        value: cloneValidationValue(row.value, null),
      };
    }

    const failedRuleMatches: ViewerValidationRuleFailure[] = [];
    let result: ViewerValidationResult = VIEWER_VALIDATION_OK_RESULT;

    for (const compiledRule of rules) {
      const evaluation = evaluateRuleAgainstValue(toValidationValue(row.value), compiledRule.rule);
      if (evaluation === VIEWER_VALIDATION_OK_RESULT) {
        continue;
      }

      failedRuleMatches.push(toRuleFailure(compiledRule, evaluation));
      result = scale.rank(evaluation) > scale.rank(result) ? evaluation : result;
    }

    const match = {
      result,
      failedRuleCount: failedRuleMatches.length,
      clauseFailures: aggregateClauseFailures(scale, failedRuleMatches),
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

function migrateLegacyRegexCheck(check: unknown) {
  if (!isRecord(check) || check.kind !== "pattern") {
    return check;
  }

  return {
    ...check,
    kind: "regex",
    regex: check.pattern,
  };
}

function migrateLegacyRegexRule(rule: unknown) {
  if (!isRecord(rule)) {
    return rule;
  }

  return {
    ...rule,
    check: migrateLegacyRegexCheck(rule.check),
  };
}

function migrateLegacyRegexClause(clause: unknown) {
  if (!isRecord(clause)) {
    return clause;
  }

  return {
    ...clause,
    rules: Array.isArray(clause.rules) ? clause.rules.map(migrateLegacyRegexRule) : clause.rules,
  };
}

function migrateLegacyViewerValidationConfig(input: unknown): ViewerValidationConfig | null {
  if (!isRecord(input) || input.version !== LEGACY_VIEWER_VALIDATION_CONFIG_VERSION) {
    return null;
  }

  const rules = Array.isArray(input.rules) ? input.rules : [];
  const severities = defaultViewerValidationSeverities();
  const scale = buildViewerSeverityScale(severities);

  return {
    version: VIEWER_VALIDATION_CONFIG_VERSION,
    severities,
    clauses: [
      {
        id: createClauseId(),
        title: LEGACY_MIGRATION_CLAUSE_TITLE,
        rules: rules.map((rule) => sanitizeRule(scale, migrateLegacyRegexRule(rule))),
      },
    ],
  };
}

export function defaultViewerValidationSeverities(): ViewerValidationSeverity[] {
  return DEFAULT_VIEWER_VALIDATION_SEVERITIES.map((severity) => ({ ...severity }));
}

export function createEmptyViewerValidationConfig(): ViewerValidationConfig {
  return {
    version: VIEWER_VALIDATION_CONFIG_VERSION,
    severities: defaultViewerValidationSeverities(),
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

/** A new severity, ranked as the most severe and given a distinct default colour. */
export function createViewerValidationSeverity(
  existing: ViewerValidationSeverity[],
): ViewerValidationSeverity {
  const used = new Set(existing.map((severity) => severity.id));
  let index = existing.length + 1;
  let id = `severity-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `severity-${index}`;
  }

  const maxOrder = existing.reduce((highest, severity) => Math.max(highest, severity.order), 0);
  const palette = NEW_SEVERITY_COLORS[existing.length % NEW_SEVERITY_COLORS.length];

  return { id, label: `Severity ${index}`, color: palette, order: maxOrder + 1 };
}

export function createViewerValidationClause(): ViewerValidationClause {
  return {
    id: createClauseId(),
    title: "New clause",
    rules: [createViewerValidationRule()],
  };
}

/**
 * Counts a config's rules per severity, most severe first, dropping severities nothing uses.
 *
 * Each entry carries the colour the config itself defines, so a template can be rendered in its
 * own severity language rather than being recoloured by whoever is reading it.
 */
export function countViewerValidationRulesBySeverity(
  config: ViewerValidationConfig,
): ViewerValidationSeverityTally[] {
  const counts = new Map<string, number>();
  for (const clause of config.clauses) {
    for (const rule of clause.rules) {
      counts.set(rule.failSeverity, (counts.get(rule.failSeverity) ?? 0) + 1);
    }
  }

  return [...config.severities]
    .sort((left, right) => right.order - left.order)
    .map((severity) => ({
      id: severity.id,
      label: severity.label,
      color: severity.color,
      count: counts.get(severity.id) ?? 0,
    }))
    .filter((tally) => tally.count > 0);
}

/**
 * Re-identifies clauses that are about to be inserted into an existing config. A clause
 * template inserted twice, or a clause saved from the very config it is going back into,
 * would otherwise collide with the copy already there.
 */
export function cloneViewerValidationClauses(
  clauses: ViewerValidationClause[],
): ViewerValidationClause[] {
  return clauses.map((clause) => ({
    ...clause,
    id: createClauseId(),
    rules: clause.rules.map((rule) => ({ ...rule, id: createRuleId() })),
  }));
}

export function normalizeIfcType(value: string) {
  return normalizeToken(value);
}

function normalizeIfcSubtype(value: string | null | undefined) {
  return normalizeToken(value ?? "");
}

/**
 * The subtype a rule's `subtype` filter is matched against. IFC puts the real subtype name in
 * `ObjectType` whenever `PredefinedType` is `USERDEFINED`, which is how IFC-SG models carry
 * project-specific types, so both pipelines resolve it the same way here.
 */
export function resolveIfcSubtype(
  predefinedType: string | null | undefined,
  objectType: string | null | undefined,
): string | null {
  const predefined = normalizeStoredText(predefinedType ?? "");
  if (predefined && normalizeToken(predefined) !== "userdefined") {
    return predefined;
  }

  return normalizeStoredText(objectType ?? "") || predefined || null;
}

/**
 * Sole owner of the compiled-rule bucket key format. An empty subtype is the `any subtype` bucket,
 * which is what every rule authored before subtypes existed lands in.
 */
export function buildViewerValidationApplicabilityKey(
  ifcType: string | null | undefined,
  subtype: string | null | undefined,
) {
  return `${normalizeIfcType(ifcType ?? "")}::${normalizeIfcSubtype(subtype)}`;
}

/**
 * Rules that apply to an element, ANDing the IFC type with the predefined subtype: the element gets
 * the rules written for its exact subtype plus those written for any subtype of the same IFC type.
 *
 * Models routinely carry 100k+ elements, so the common shapes avoid allocating — a merged map is
 * built only when both buckets are populated, and `cache` (keyed by applicability) lets per-element
 * loops skip the merge entirely after the first element of each type/subtype pair.
 */
export function resolveCompiledRulesForElement(
  compiled: CompiledViewerValidationRuleMap,
  ifcType: string | null | undefined,
  subtype: string | null | undefined,
  cache?: CompiledViewerValidationRuleCache,
): CompiledViewerValidationTargetMap | null {
  const normalizedIfcType = normalizeIfcType(ifcType ?? "");
  if (!normalizedIfcType) {
    return null;
  }

  const normalizedSubtype = normalizeIfcSubtype(subtype);
  const cacheKey = `${normalizedIfcType}::${normalizedSubtype}`;
  const cached = cache?.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const anySubtypeRules = compiled.get(buildViewerValidationApplicabilityKey(normalizedIfcType, ""));
  const subtypeRules = normalizedSubtype
    ? compiled.get(buildViewerValidationApplicabilityKey(normalizedIfcType, normalizedSubtype))
    : undefined;

  let resolved: CompiledViewerValidationTargetMap | null;
  if (!subtypeRules || subtypeRules.size === 0) {
    resolved = anySubtypeRules ?? null;
  } else if (!anySubtypeRules || anySubtypeRules.size === 0) {
    resolved = subtypeRules;
  } else {
    resolved = new Map(anySubtypeRules);
    for (const [targetId, rules] of subtypeRules.entries()) {
      const existing = resolved.get(targetId);
      resolved.set(targetId, existing ? [...existing, ...rules] : rules);
    }
  }

  cache?.set(cacheKey, resolved);

  return resolved;
}

export function buildViewerValidationTargetId(target: ViewerValidationTarget) {
  if (target.kind === "attribute") {
    return `attribute:${normalizeValidationAttributeName(target.name)}`;
  }

  return `property:${normalizeToken(target.group)}::${normalizeToken(target.label)}`;
}

export function buildViewerValidationRuleKey(
  rule: Pick<ViewerValidationRule, "ifcType" | "subtype" | "target">,
) {
  return `${buildViewerValidationApplicabilityKey(rule.ifcType, rule.subtype)}::${buildViewerValidationTargetId(rule.target)}`;
}

export function describeViewerValidationRule(rule: ViewerValidationRule) {
  const targetLabel = ruleTargetLabel(rule.target);

  if (rule.check.kind === "empty") {
    return `${targetLabel} is required`;
  }

  if (rule.check.kind === "enum") {
    return `${targetLabel} must be one of ${rule.check.allowedValues.join(", ")}`;
  }

  if (rule.check.kind === "regex") {
    return `${targetLabel} must match /${rule.check.regex}/${rule.check.caseInsensitive ? "i" : ""}`;
  }

  if (rule.check.kind === "boolean") {
    return `${targetLabel} must be ${rule.check.expected ? "TRUE" : "FALSE"}`;
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

export function sanitizeViewerValidationConfig(config: {
  severities?: unknown;
  clauses: unknown[];
}): ViewerValidationConfig {
  const severities = sanitizeViewerValidationSeverities(config.severities);
  const scale = buildViewerSeverityScale(severities);

  return {
    version: VIEWER_VALIDATION_CONFIG_VERSION,
    severities,
    clauses: config.clauses.map((clause) => sanitizeClause(scale, clause)),
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

  const version = input.version;
  if (
    version !== CLAUSE_VIEWER_VALIDATION_CONFIG_VERSION &&
    version !== PREVIOUS_VIEWER_VALIDATION_CONFIG_VERSION &&
    version !== VIEWER_VALIDATION_CONFIG_VERSION
  ) {
    throw new Error(`Rules JSON version must be ${VIEWER_VALIDATION_CONFIG_VERSION}.`);
  }

  if (!Array.isArray(input.clauses)) {
    throw new Error("Rules JSON must contain a clauses array.");
  }

  // v2 spelled the regex check `pattern`; v2 and v3 both predate configurable severities, so the
  // sanitizer seeds the default warn/error list for them.
  const clauses =
    version === CLAUSE_VIEWER_VALIDATION_CONFIG_VERSION
      ? input.clauses.map((clause) => migrateLegacyRegexClause(clause))
      : input.clauses;
  const severities =
    version === VIEWER_VALIDATION_CONFIG_VERSION
      ? input.severities
      : defaultViewerValidationSeverities();

  return sanitizeViewerValidationConfig({ severities, clauses });
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
    severities: input.severities,
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
    severities: config.severities,
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

  const severities = sanitizeViewerValidationSeverities(input.severities);
  const scale = buildViewerSeverityScale(severities);
  const failedClauses = Array.isArray(input.failedClauses)
    ? input.failedClauses.map((failure) => sanitizeValidationClauseFailure(scale, failure))
    : [];

  return {
    sourceId,
    severities,
    results: Array.isArray(input.results)
      ? input.results.map((result) => sanitizeValidationElementResult(scale, result))
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

  for (const clause of clauses) {
    for (const rule of clause.rules.filter(isRunnableRule)) {
      const applicabilityKey = buildViewerValidationApplicabilityKey(rule.ifcType, rule.subtype);
      const targetId = buildViewerValidationTargetId(rule.target);
      const rulesForApplicability =
        compiled.get(applicabilityKey) ?? new Map<string, CompiledViewerValidationRule[]>();
      const compiledRulesForTarget = rulesForApplicability.get(targetId) ?? [];

      compiledRulesForTarget.push({
        clauseId: clause.id,
        clauseTitle: clause.title,
        description: describeViewerValidationRule(rule),
        rule,
      });

      rulesForApplicability.set(targetId, compiledRulesForTarget);
      compiled.set(applicabilityKey, rulesForApplicability);
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

  const ruleCache: CompiledViewerValidationRuleCache = new Map();

  for (const row of data.rows) {
    if (!row.ifcType) {
      continue;
    }

    const rulesForType = resolveCompiledRulesForElement(
      compiledRules,
      row.ifcType,
      row.subtype,
      ruleCache,
    );
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
      subtype: row.subtype,
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
  const scale = buildViewerSeverityScale(payload.severities);
  const compiledRules = compileViewerValidationRules(payload.clauses);
  const results: ViewerValidationElementResult[] = [];
  const allRuleFailures: ViewerValidationRuleFailure[] = [];
  const totalRowCount = payload.rows.length;
  const chunkSize = Math.max(1, options?.chunkSize ?? DEFAULT_VALIDATION_CHUNK_SIZE);
  const ruleCache: CompiledViewerValidationRuleCache = new Map();

  for (let index = 0; index < payload.rows.length; index += chunkSize) {
    if (options?.signal?.aborted) {
      throw new DOMException("Validation cancelled", "AbortError");
    }

    const chunk = payload.rows.slice(index, index + chunkSize);
    for (const row of chunk) {
      if (!row.ifcType) {
        continue;
      }

      const rulesForType = resolveCompiledRulesForElement(
        compiledRules,
        row.ifcType,
        row.subtype,
        ruleCache,
      );
      if (!rulesForType) {
        continue;
      }

      let result: ViewerValidationFailureSeverity | null = null;
      const failedRuleMatches: ViewerValidationRuleFailure[] = [];

      for (const [targetId, rulesForTarget] of rulesForType.entries()) {
        const value = row.values[targetId] ?? missingValidationValue();

        for (const compiledRule of rulesForTarget) {
          const evaluation = evaluateRuleAgainstValue(value, compiledRule.rule);

          if (evaluation === VIEWER_VALIDATION_OK_RESULT) {
            continue;
          }

          failedRuleMatches.push(toRuleFailure(compiledRule, evaluation));
          result =
            result === null || scale.rank(evaluation) > scale.rank(result) ? evaluation : result;
        }
      }

      if (result) {
        const failedClauses = aggregateClauseFailures(scale, failedRuleMatches);
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

  const failedClauses = aggregateClauseFailures(scale, allRuleFailures);

  return {
    sourceId: payload.sourceId,
    severities: scale.list,
    results,
    failedClauseCount: failedClauses.length,
    failedClauses,
  };
}

/**
 * Buckets each element under its single worst severity, so the 3D view paints an element with
 * several failures in the colour of the highest-order severity it hit.
 */
export function groupViewerValidationResultsBySeverity(
  severities: ViewerValidationSeverity[],
  results: ViewerValidationElementResult[],
): ViewerValidationHighlights {
  const scale = buildViewerSeverityScale(severities);
  const highlights: ViewerValidationHighlights = Object.fromEntries(
    scale.ids.map((id) => [id, {} as ViewerValidationElementMap]),
  );

  for (const result of results) {
    const bucket = highlights[scale.resolve(result.result)];
    if (!bucket) {
      continue;
    }

    const modelIds = bucket[result.modelId] ?? [];
    modelIds.push(result.localId);
    bucket[result.modelId] = modelIds;
  }

  return highlights;
}

export function applyViewerValidationToInspection(
  inspection: ViewerElementInspection | null,
  clauses: ViewerValidationClause[],
  severities: ViewerValidationSeverity[],
) {
  if (!inspection) {
    return null;
  }

  const scale = buildViewerSeverityScale(severities);
  const compiledRules = compileViewerValidationRules(clauses);
  const inspectionIfcType = getInspectionIfcType(inspection);
  const inspectionSubtype = getInspectionSubtype(inspection);
  const matches: ViewerValidationMatch[] = [];
  const summaryRows = applyValidationToInspectionRows(
    scale,
    inspection.summaryRows,
    compiledRules,
    inspectionIfcType,
    inspectionSubtype,
    matches,
  );
  const propertySetsWithMissingRows = appendMissingValidationPropertyRows(
    inspection.propertySets,
    compiledRules,
    inspectionIfcType,
    inspectionSubtype,
  );
  const propertySets: ViewerInspectionGroup[] = propertySetsWithMissingRows.map((group) => {
    const rows = applyValidationToInspectionRows(
      scale,
      group.rows,
      compiledRules,
      inspectionIfcType,
      inspectionSubtype,
      matches,
    );

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
    validationSummary: summarizeValidation(scale, matches),
  };
}
