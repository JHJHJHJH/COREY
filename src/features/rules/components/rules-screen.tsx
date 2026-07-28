"use client";

import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  CircleAlert,
  LayoutTemplate,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { StatusBar } from "@/components/status-bar/status-bar";
import { InspectorDetailList } from "@/components/status-bar/status-inspector";
import { useViewerRules } from "@/features/rules/rules-provider";
import {
  createEmptyViewerValidationConfig,
  parseViewerValidationConfigText,
  serializeViewerValidationConfig,
} from "@/features/rules/lib/validation";
import {
  listRuleTemplates,
  readRuleTemplate,
  ruleTemplateConfigEndpoint,
  ruleTemplateSourceEndpoint,
} from "@/features/rules/lib/rule-template-api";
import type {
  ViewerRuleTemplateSummary,
  ViewerValidationCheck,
  ViewerValidationRule,
  ViewerValidationTarget,
} from "@/features/viewer/types";

type RulesScreenProps = {
  mode: "modal" | "page";
  onClose?: () => void;
};

type SortColumnKey = "clause" | "ifcType" | "target" | "constraint" | "severity";
type SortDirection = "asc" | "desc";
type RulesSort = { columnKey: SortColumnKey; direction: SortDirection };
type SeverityFilter = "all" | ViewerValidationRule["failSeverity"];
type CheckFilter = "all" | ViewerValidationCheck["kind"];

type RuleRow = {
  clauseId: string;
  clauseTitle: string;
  rule: ViewerValidationRule;
};

/* ------------------------------------------------------------------ */
/* Token-driven class helpers — the workspace leans on the precise      */
/* engineering identity (mono spec data, hairlines, tight radii).       */
/* ------------------------------------------------------------------ */

// Spreadsheet cell: invisible until you reach for it, then a crisp accent ring.
function cellInputClassName(mono = false) {
  return `min-h-8 w-full rounded-[var(--r-control)] border border-transparent bg-transparent px-2 py-1 text-[13px] leading-5 text-[color:var(--foreground)] outline-none transition placeholder:text-[color:var(--muted-ink)]/70 hover:border-[color:var(--viewer-border)] hover:bg-[color:var(--surface-soft)] focus:border-[color:var(--accent)] focus:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50 ${
    mono ? "font-mono tabular-nums" : ""
  }`;
}

function secondaryButtonClassName() {
  return "inline-flex h-9 items-center gap-1.5 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]";
}

function compactButtonClassName() {
  return "inline-flex h-8 items-center gap-1 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2.5 text-xs font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]";
}

function destructiveButtonClassName() {
  return "inline-flex h-8 w-8 items-center justify-center rounded-[var(--r-control)] border border-[#d9a89d] bg-[#fff0ea] text-[#b5432f] transition hover:bg-[#ffe5dc] hover:text-[#962f1f]";
}

function filterSelectClassName() {
  return "h-9 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)]";
}

function severitySelectClassName(severity: ViewerValidationRule["failSeverity"]) {
  const tone =
    severity === "error"
      ? "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]"
      : "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]";
  return `h-8 rounded-[var(--r-chip)] border px-2 text-[11px] font-semibold uppercase tracking-[0.08em] outline-none transition focus:border-[color:var(--accent)] ${tone}`;
}

function severityRailClassName(severity: ViewerValidationRule["failSeverity"]) {
  return severity === "error"
    ? "border-l-[3px] border-l-[color:var(--danger-border)]"
    : "border-l-[3px] border-l-[color:var(--warning-border)]";
}

const headerCellClassName =
  "border-b border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-3 py-2 align-middle";
const bodyCellClassName =
  "border-b border-[color:var(--viewer-border)] px-2 py-1 align-middle";
// Vertical hairline separating the IFC Type / Target / Constraint / Severity columns.
const columnDividerClassName = "border-r border-[color:var(--viewer-border)]";

/* ------------------------------------------------------------------ */
/* Pure helpers                                                         */
/* ------------------------------------------------------------------ */

function canDownloadTemplateSource(template: ViewerRuleTemplateSummary) {
  return (
    Boolean(template.sourceFileName) &&
    template.templateId !== "industry-mapping-bca-column-beam" &&
    template.name !== "BCA - Column + Beam"
  );
}

function enumText(check: ViewerValidationCheck) {
  return check.kind === "enum" ? check.allowedValues.join(", ") : "";
}

function numberValue(value: number | null) {
  return value === null ? "" : String(value);
}

function nextCheckForKind(kind: ViewerValidationCheck["kind"]): ViewerValidationCheck {
  if (kind === "empty") {
    return { kind: "empty" };
  }

  if (kind === "enum") {
    return { kind: "enum", allowedValues: ["Allowed Value"] };
  }

  if (kind === "pattern") {
    return { kind: "pattern", pattern: "", caseInsensitive: false };
  }

  if (kind === "boolean") {
    return { kind: "boolean", expected: true };
  }

  if (kind === "type") {
    return { kind: "type", expectedType: "string" };
  }

  return { kind: "numberRange", min: null, max: null };
}

function parseEnumValues(value: string) {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function describeTarget(target: ViewerValidationTarget) {
  return target.kind === "attribute" ? target.name : `${target.group}·${target.label}`;
}

function describeConstraint(check: ViewerValidationCheck) {
  if (check.kind === "empty") {
    return "required";
  }
  if (check.kind === "enum") {
    return `enum ${check.allowedValues.join(" ")}`;
  }
  if (check.kind === "pattern") {
    return `pattern ${check.pattern}`;
  }
  if (check.kind === "boolean") {
    return `boolean ${check.expected ? "true" : "false"}`;
  }
  if (check.kind === "type") {
    return `type ${check.expectedType}`;
  }
  return `range ${numberValue(check.min)} ${numberValue(check.max)}`;
}

function rowSortValue(row: RuleRow, columnKey: SortColumnKey) {
  switch (columnKey) {
    case "clause":
      return row.clauseTitle;
    case "ifcType":
      return row.rule.ifcType;
    case "target":
      return `${row.rule.target.kind} ${describeTarget(row.rule.target)}`;
    case "constraint":
      return describeConstraint(row.rule.check);
    case "severity":
      return row.rule.failSeverity;
  }
}

function rowMatchesQuery(row: RuleRow, query: string) {
  const haystack = [
    row.clauseTitle,
    row.rule.ifcType,
    row.rule.target.kind,
    describeTarget(row.rule.target),
    row.rule.check.kind,
    describeConstraint(row.rule.check),
    row.rule.failSeverity,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/* ------------------------------------------------------------------ */
/* Sort glyph                                                           */
/* ------------------------------------------------------------------ */

function SortGlyph({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--muted-ink)] opacity-50" />;
  }
  return direction === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" />
  );
}

function SortableHeader({
  label,
  columnKey,
  sort,
  onToggle,
  widthClassName,
}: {
  label: string;
  columnKey: SortColumnKey;
  sort: RulesSort | null;
  onToggle: (columnKey: SortColumnKey) => void;
  widthClassName: string;
}) {
  const active = sort?.columnKey === columnKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      className={`${headerCellClassName} ${widthClassName}`}
    >
      <button
        type="button"
        onClick={() => onToggle(columnKey)}
        className="flex w-full items-center justify-between gap-2 rounded-[var(--r-chip)] text-left outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--foreground)]">
          {label}
        </span>
        <SortGlyph active={active} direction={active ? sort.direction : "asc"} />
      </button>
    </th>
  );
}

/* ------------------------------------------------------------------ */
/* Enum values cell (draft + commit on blur)                            */
/* ------------------------------------------------------------------ */

function EnumValuesCell({
  check,
  onCommit,
}: {
  check: ViewerValidationCheck;
  onCommit: (allowedValues: string[]) => void;
}) {
  const serializedValue = enumText(check);
  const [draftValue, setDraftValue] = useState(serializedValue);

  useEffect(() => {
    setDraftValue(serializedValue);
  }, [serializedValue]);

  return (
    <input
      type="text"
      value={draftValue}
      onChange={(event) => setDraftValue(event.target.value)}
      onBlur={() => onCommit(parseEnumValues(draftValue))}
      className={cellInputClassName(true)}
      placeholder="A, B, C"
      aria-label="Allowed values"
    />
  );
}

function PatternConstraintCell({
  check,
  onCommit,
}: {
  check: Extract<ViewerValidationCheck, { kind: "pattern" }>;
  onCommit: (next: Extract<ViewerValidationCheck, { kind: "pattern" }>) => void;
}) {
  const serializedPattern = check.pattern;
  const [draftPattern, setDraftPattern] = useState(serializedPattern);

  useEffect(() => {
    setDraftPattern(serializedPattern);
  }, [serializedPattern]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <input
        type="text"
        value={draftPattern}
        onChange={(event) => setDraftPattern(event.target.value)}
        onBlur={() =>
          onCommit({
            kind: "pattern",
            pattern: draftPattern.trim(),
            caseInsensitive: check.caseInsensitive,
          })
        }
        className={cellInputClassName(true)}
        placeholder="^EC\d{3}$"
        aria-label="Pattern (regular expression)"
      />
      <button
        type="button"
        onClick={() =>
          onCommit({
            kind: "pattern",
            pattern: draftPattern.trim(),
            caseInsensitive: !check.caseInsensitive,
          })
        }
        className={`h-8 shrink-0 rounded-[var(--r-chip)] border px-1.5 text-[11px] font-semibold transition ${
          check.caseInsensitive
            ? "border-[color:var(--accent)] text-[color:var(--accent)]"
            : "border-transparent text-[color:var(--muted-ink)] hover:border-[color:var(--viewer-border)]"
        }`}
        aria-pressed={check.caseInsensitive}
        aria-label="Toggle case-insensitive matching"
        title="Case-insensitive matching"
      >
        Aa
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Target cell — kind selector + only the relevant inputs              */
/* ------------------------------------------------------------------ */

function TargetCell({
  rule,
  onChange,
}: {
  rule: ViewerValidationRule;
  onChange: (rule: ViewerValidationRule) => void;
}) {
  const target = rule.target;
  return (
    <div className="flex items-center gap-1">
      <select
        value={target.kind}
        onChange={(event) => {
          const kind = event.target.value as ViewerValidationTarget["kind"];
          onChange({
            ...rule,
            target:
              kind === "attribute"
                ? { kind: "attribute", name: target.kind === "attribute" ? target.name : "Name" }
                : {
                    kind: "property",
                    group: "Pset_WallCommon",
                    label: "Reference",
                  },
          });
        }}
        className="h-8 shrink-0 rounded-[var(--r-chip)] border border-transparent bg-transparent px-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-ink)] outline-none transition hover:border-[color:var(--viewer-border)] focus:border-[color:var(--accent)]"
        aria-label="Target kind"
      >
        <option value="attribute">Attr</option>
        <option value="property">Prop</option>
      </select>
      {target.kind === "attribute" ? (
        <input
          value={target.name}
          onChange={(event) =>
            onChange({ ...rule, target: { kind: "attribute", name: event.target.value } })
          }
          className={cellInputClassName(true)}
          placeholder="Name"
          aria-label="Attribute name"
        />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <input
            value={target.group}
            onChange={(event) =>
              onChange({
                ...rule,
                target: { kind: "property", group: event.target.value, label: target.label },
              })
            }
            className={cellInputClassName(true)}
            placeholder="Pset_WallCommon"
            aria-label="Property set"
          />
          <span className="shrink-0 text-xs text-[color:var(--muted-ink)]">·</span>
          <input
            value={target.label}
            onChange={(event) =>
              onChange({
                ...rule,
                target: { kind: "property", group: target.group, label: event.target.value },
              })
            }
            className={cellInputClassName(true)}
            placeholder="Reference"
            aria-label="Property label"
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Constraint cell — kind selector + only the relevant inputs          */
/* ------------------------------------------------------------------ */

function ConstraintCell({
  rule,
  onChange,
}: {
  rule: ViewerValidationRule;
  onChange: (rule: ViewerValidationRule) => void;
}) {
  const check = rule.check;
  return (
    <div className="flex items-center gap-1">
      <select
        value={check.kind}
        onChange={(event) =>
          onChange({
            ...rule,
            check: nextCheckForKind(event.target.value as ViewerValidationCheck["kind"]),
          })
        }
        className="h-8 shrink-0 rounded-[var(--r-chip)] border border-transparent bg-transparent px-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[color:var(--muted-ink)] outline-none transition hover:border-[color:var(--viewer-border)] focus:border-[color:var(--accent)]"
        aria-label="Check kind"
      >
        <option value="empty">Required</option>
        <option value="enum">Enum</option>
        <option value="numberRange">Range</option>
        <option value="pattern">Pattern</option>
        <option value="boolean">Boolean</option>
        <option value="type">Type</option>
      </select>
      {check.kind === "empty" ? (
        <span className="px-1 text-xs text-[color:var(--muted-ink)]">value present</span>
      ) : check.kind === "enum" ? (
        <EnumValuesCell
          check={check}
          onCommit={(allowedValues) => onChange({ ...rule, check: { kind: "enum", allowedValues } })}
        />
      ) : check.kind === "pattern" ? (
        <PatternConstraintCell
          check={check}
          onCommit={(next) => onChange({ ...rule, check: next })}
        />
      ) : check.kind === "boolean" ? (
        <select
          value={check.expected ? "true" : "false"}
          onChange={(event) =>
            onChange({ ...rule, check: { kind: "boolean", expected: event.target.value === "true" } })
          }
          className={`${cellInputClassName(true)} uppercase`}
          aria-label="Expected boolean value"
        >
          <option value="true">TRUE</option>
          <option value="false">FALSE</option>
        </select>
      ) : check.kind === "type" ? (
        <select
          value={check.expectedType}
          onChange={(event) =>
            onChange({
              ...rule,
              check: {
                kind: "type",
                expectedType: event.target.value as Extract<
                  ViewerValidationCheck,
                  { kind: "type" }
                >["expectedType"],
              },
            })
          }
          className={`${cellInputClassName(true)} uppercase`}
          aria-label="Expected value type"
        >
          <option value="string">STRING</option>
          <option value="number">NUMBER</option>
          <option value="boolean">BOOLEAN</option>
        </select>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <input
            type="number"
            value={numberValue(check.min)}
            onChange={(event) =>
              onChange({
                ...rule,
                check: {
                  kind: "numberRange",
                  max: check.max,
                  min: event.target.value === "" ? null : Number(event.target.value),
                },
              })
            }
            className={cellInputClassName(true)}
            placeholder="min"
            aria-label="Minimum value"
          />
          <span className="shrink-0 text-xs text-[color:var(--muted-ink)]">–</span>
          <input
            type="number"
            value={numberValue(check.max)}
            onChange={(event) =>
              onChange({
                ...rule,
                check: {
                  kind: "numberRange",
                  min: check.min,
                  max: event.target.value === "" ? null : Number(event.target.value),
                },
              })
            }
            className={cellInputClassName(true)}
            placeholder="max"
            aria-label="Maximum value"
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A single rule row                                                    */
/* ------------------------------------------------------------------ */

function RuleTableRow({
  row,
  showClause,
  onChange,
  onRemove,
}: {
  row: RuleRow;
  showClause: boolean;
  onChange: (rule: ViewerValidationRule) => void;
  onRemove: () => void;
}) {
  const { rule } = row;
  const railClassName = severityRailClassName(rule.failSeverity);

  return (
    <tr className="transition hover:bg-[color:var(--surface-soft)]">
      {showClause ? (
        <td className={`${bodyCellClassName} ${railClassName}`}>
          <span className="block truncate px-1 text-[13px] font-medium text-[color:var(--foreground)]">
            {row.clauseTitle || "Untitled clause"}
          </span>
        </td>
      ) : null}
      <td className={`${bodyCellClassName} ${columnDividerClassName} ${showClause ? "" : railClassName}`}>
        <input
          value={rule.ifcType}
          onChange={(event) => onChange({ ...rule, ifcType: event.target.value })}
          className={cellInputClassName(true)}
          placeholder="IFCWALL"
          aria-label="IFC type"
        />
      </td>
      <td className={`${bodyCellClassName} ${columnDividerClassName}`}>
        <TargetCell rule={rule} onChange={onChange} />
      </td>
      <td className={`${bodyCellClassName} ${columnDividerClassName}`}>
        <ConstraintCell rule={rule} onChange={onChange} />
      </td>
      <td className={bodyCellClassName}>
        <select
          value={rule.failSeverity}
          onChange={(event) =>
            onChange({
              ...rule,
              failSeverity: event.target.value as ViewerValidationRule["failSeverity"],
            })
          }
          className={severitySelectClassName(rule.failSeverity)}
          aria-label="Fail severity"
        >
          <option value="error">Error</option>
          <option value="warn">Warn</option>
        </select>
      </td>
      <td className={`${bodyCellClassName} text-right`}>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove rule"
          title="Remove rule"
          className={destructiveButtonClassName()}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Templates popover                                                    */
/* ------------------------------------------------------------------ */

function TemplatesPopover({
  templates,
  loading,
  error,
  loadingTemplateId,
  onLoad,
}: {
  templates: ViewerRuleTemplateSummary[];
  loading: boolean;
  error: string | null;
  loadingTemplateId: string | null;
  onLoad: (template: ViewerRuleTemplateSummary) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={secondaryButtonClassName()}
      >
        <LayoutTemplate className="h-4 w-4" />
        Templates
        <ChevronDown className={`h-4 w-4 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close templates"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 z-50 mt-2 w-[min(92vw,30rem)] rounded-[var(--r-panel)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] p-2.5 shadow-[var(--viewer-shadow-lift)]">
            <div className="px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              Starter Templates
            </div>
            {loading ? (
              <div className="px-1 py-2 text-xs text-[color:var(--muted-ink)]">Loading templates…</div>
            ) : error ? (
              <div className="rounded-[var(--r-control)] border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-2.5 py-2 text-xs text-[color:var(--danger-fg)]">
                {error}
              </div>
            ) : templates.length === 0 ? (
              <div className="px-1 py-2 text-xs text-[color:var(--muted-ink)]">No templates available.</div>
            ) : (
              <div className="grid max-h-[60vh] gap-1.5 overflow-auto sm:grid-cols-2">
                {templates.map((template) => {
                  const isLoading = loadingTemplateId === template.templateId;
                  return (
                    <section
                      key={template.templateId}
                      className="rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] p-2.5"
                    >
                      <h2 className="text-sm font-semibold text-[color:var(--foreground)]">{template.name}</h2>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[color:var(--muted-ink)]">
                        {template.description}
                      </p>
                      <p className="mt-1 font-mono text-[11px] tabular-nums text-[color:var(--muted-ink)]">
                        {template.ruleCount} rules
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            onLoad(template);
                            setOpen(false);
                          }}
                          disabled={loadingTemplateId !== null}
                          className={`${compactButtonClassName()} disabled:cursor-wait disabled:opacity-60`}
                        >
                          {isLoading ? "Loading…" : "Load"}
                        </button>
                        <a
                          href={ruleTemplateConfigEndpoint(template.templateId)}
                          download
                          className={compactButtonClassName()}
                        >
                          JSON
                        </a>
                        {canDownloadTemplateSource(template) ? (
                          <a
                            href={ruleTemplateSourceEndpoint(template.templateId)}
                            download
                            className={compactButtonClassName()}
                          >
                            CSV
                          </a>
                        ) : null}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main screen                                                          */
/* ------------------------------------------------------------------ */

export function RulesScreen({ mode, onClose }: RulesScreenProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const {
    config,
    addClause,
    updateClause,
    removeClause,
    addRule,
    updateRule,
    removeRule,
    replaceConfig,
  } = useViewerRules();

  const [importError, setImportError] = useState<string | null>(null);
  const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(null);
  const [starterTemplates, setStarterTemplates] = useState<ViewerRuleTemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [searchText, setSearchText] = useState("");
  const [clauseFilter, setClauseFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [checkFilter, setCheckFilter] = useState<CheckFilter>("all");
  const [sort, setSort] = useState<RulesSort | null>(null);
  const [collapsedClauseIds, setCollapsedClauseIds] = useState<Set<string>>(new Set());

  const totalRuleCount = useMemo(
    () => config.clauses.reduce((count, clause) => count + clause.rules.length, 0),
    [config.clauses],
  );

  const query = searchText.trim().toLowerCase();
  const hasActiveFilters =
    clauseFilter !== "" || severityFilter !== "all" || checkFilter !== "all";
  const isFlat = sort !== null || query !== "";

  const allRows = useMemo<RuleRow[]>(
    () =>
      config.clauses.flatMap((clause) =>
        clause.rules.map((rule) => ({
          clauseId: clause.id,
          clauseTitle: clause.title,
          rule,
        })),
      ),
    [config.clauses],
  );

  const matchedRows = useMemo(
    () =>
      allRows.filter((row) => {
        if (clauseFilter && row.clauseId !== clauseFilter) {
          return false;
        }
        if (severityFilter !== "all" && row.rule.failSeverity !== severityFilter) {
          return false;
        }
        if (checkFilter !== "all" && row.rule.check.kind !== checkFilter) {
          return false;
        }
        if (query && !rowMatchesQuery(row, query)) {
          return false;
        }
        return true;
      }),
    [allRows, clauseFilter, severityFilter, checkFilter, query],
  );

  const flatRows = useMemo(() => {
    if (!sort) {
      return matchedRows;
    }
    const sorted = [...matchedRows].sort((a, b) =>
      rowSortValue(a, sort.columnKey).localeCompare(rowSortValue(b, sort.columnKey), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
    return sort.direction === "desc" ? sorted.reverse() : sorted;
  }, [matchedRows, sort]);

  const visibleClauses = useMemo(
    () =>
      config.clauses
        .map((clause) => ({
          clause,
          rows: matchedRows.filter((row) => row.clauseId === clause.id),
        }))
        .filter(({ rows }) => rows.length > 0 || !hasActiveFilters),
    [config.clauses, matchedRows, hasActiveFilters],
  );

  useEffect(() => {
    const controller = new AbortController();

    setTemplatesLoading(true);
    listRuleTemplates(controller.signal)
      .then((templates) => {
        setStarterTemplates(templates);
        setTemplatesError(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setTemplatesError(
          error instanceof Error ? error.message : "Starter templates could not be listed.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setTemplatesLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  const handleExport = () => {
    const blob = new Blob([serializeViewerValidationConfig(config)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "corey-clauses.json";
    anchor.click();
    URL.revokeObjectURL(href);
  };

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const importedConfig = parseViewerValidationConfigText(await file.text());
      replaceConfig(importedConfig);
      setImportError(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Rules JSON could not be imported.");
    } finally {
      event.target.value = "";
    }
  };

  const handleLoadStarterTemplate = async (template: ViewerRuleTemplateSummary) => {
    try {
      setLoadingTemplateId(template.templateId);
      const importedTemplate = await readRuleTemplate(template.templateId);
      replaceConfig(importedTemplate.config);
      setImportError(null);
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "Starter template could not be loaded.",
      );
    } finally {
      setLoadingTemplateId(null);
    }
  };

  const handleToggleSort = (columnKey: SortColumnKey) => {
    setSort((current) => {
      if (current?.columnKey !== columnKey) {
        return { columnKey, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { columnKey, direction: "desc" };
      }
      return null;
    });
  };

  const toggleClauseCollapse = (clauseId: string) => {
    setCollapsedClauseIds((current) => {
      const next = new Set(current);
      if (next.has(clauseId)) {
        next.delete(clauseId);
      } else {
        next.add(clauseId);
      }
      return next;
    });
  };

  const resetView = () => {
    setSearchText("");
    setClauseFilter("");
    setSeverityFilter("all");
    setCheckFilter("all");
    setSort(null);
  };

  const groupColumnCount = 5;
  const hasRules = totalRuleCount > 0;
  const showNoMatches = hasRules && matchedRows.length === 0;

  return (
    <section
      className={`flex min-h-0 w-full flex-col overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)] ${
        mode === "modal" ? "h-full" : "min-h-[calc(100vh-5rem)]"
      }`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--viewer-border)] bg-[image:var(--viewer-header-bg)] px-5 py-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[color:var(--muted-ink)]">
            COREY Rules
          </div>
          <h1 className="mt-0.5 text-xl font-semibold tracking-tight text-[color:var(--foreground)]">
            Validation clauses
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <TemplatesPopover
            templates={starterTemplates}
            loading={templatesLoading}
            error={templatesError}
            loadingTemplateId={loadingTemplateId}
            onLoad={(template) => void handleLoadStarterTemplate(template)}
          />
          {mode === "page" ? (
            <Link href="/" className={secondaryButtonClassName()}>
              Open COREY
            </Link>
          ) : null}
          {mode === "modal" && onClose ? (
            <button
              type="button"
              aria-label="Close"
              title="Close"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Toolbar */}
      <div className="border-b border-[color:var(--viewer-border)] px-5 py-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleImport}
          className="hidden"
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--muted-ink)]" />
            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search IFC type, target, constraint…"
              aria-label="Search rules"
              className="h-9 w-full rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] pl-9 pr-9 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)]"
            />
            {searchText ? (
              <button
                type="button"
                onClick={() => setSearchText("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[var(--r-chip)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <select
            value={clauseFilter}
            onChange={(event) => setClauseFilter(event.target.value)}
            aria-label="Filter by clause"
            className={filterSelectClassName()}
          >
            <option value="">All clauses</option>
            {config.clauses.map((clause) => (
              <option key={clause.id} value={clause.id}>
                {clause.title || "Untitled clause"}
              </option>
            ))}
          </select>

          <select
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
            aria-label="Filter by severity"
            className={filterSelectClassName()}
          >
            <option value="all">Any severity</option>
            <option value="error">Error</option>
            <option value="warn">Warn</option>
          </select>

          <select
            value={checkFilter}
            onChange={(event) => setCheckFilter(event.target.value as CheckFilter)}
            aria-label="Filter by check"
            className={filterSelectClassName()}
          >
            <option value="all">Any check</option>
            <option value="empty">Required</option>
            <option value="enum">Enum</option>
            <option value="numberRange">Range</option>
            <option value="pattern">Pattern</option>
            <option value="boolean">Boolean</option>
            <option value="type">Type</option>
          </select>

          {isFlat || hasActiveFilters ? (
            <button type="button" onClick={resetView} className={compactButtonClassName()}>
              Reset
            </button>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button type="button" onClick={addClause} className={secondaryButtonClassName()}>
              <Plus className="h-4 w-4" />
              Add clause
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={secondaryButtonClassName()}
            >
              Import
            </button>
            <button type="button" onClick={handleExport} className={secondaryButtonClassName()}>
              Export
            </button>
            <button
              type="button"
              onClick={() => replaceConfig(createEmptyViewerValidationConfig())}
              className={secondaryButtonClassName()}
            >
              Clear all
            </button>
          </div>
        </div>

        {importError ? (
          <div className="mt-3 rounded-[var(--r-control)] border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-3 py-2 text-sm text-[color:var(--danger-fg)]">
            {importError}
          </div>
        ) : null}
      </div>

      {/* Grid */}
      <div className="min-h-0 flex-1 overflow-auto">
        {config.clauses.length === 0 ? (
          <div className="flex h-full items-center justify-center px-5 py-8">
            <div className="max-w-xl rounded-[var(--r-panel)] border border-dashed border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-6 py-8 text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                No clauses yet
              </div>
              <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
                Add your first validation clause
              </div>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted-ink)]">
                Group rules into clauses so failed elements report which clause and checks they broke.
                Or load a starter set from Templates.
              </p>
              <button
                type="button"
                onClick={addClause}
                className={`${secondaryButtonClassName()} mx-auto mt-4`}
              >
                <Plus className="h-4 w-4" />
                Add clause
              </button>
            </div>
          </div>
        ) : showNoMatches ? (
          <div className="flex h-full items-center justify-center px-5 py-8">
            <div className="max-w-xl rounded-[var(--r-panel)] border border-dashed border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-6 py-8 text-center">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                No matching rules
              </div>
              <div className="mt-3 text-lg font-semibold text-[color:var(--foreground)]">
                Every rule is hidden by the current view
              </div>
              <p className="mt-2 text-sm leading-6 text-[color:var(--muted-ink)]">
                Adjust the search or the clause, severity, and check filters to bring rules back.
              </p>
              <button type="button" onClick={resetView} className={`${compactButtonClassName()} mx-auto mt-4`}>
                Reset view
              </button>
            </div>
          </div>
        ) : (
          <table className="min-w-full border-separate border-spacing-0 text-left">
            <thead className="sticky top-0 z-10 bg-[color:var(--panel-bg)]">
              <tr>
                {isFlat ? (
                  <SortableHeader
                    label="Clause"
                    columnKey="clause"
                    sort={sort}
                    onToggle={handleToggleSort}
                    widthClassName="min-w-[12rem]"
                  />
                ) : null}
                <SortableHeader
                  label="IFC Type"
                  columnKey="ifcType"
                  sort={sort}
                  onToggle={handleToggleSort}
                  widthClassName={`min-w-[10rem] ${columnDividerClassName}`}
                />
                <SortableHeader
                  label="Target"
                  columnKey="target"
                  sort={sort}
                  onToggle={handleToggleSort}
                  widthClassName={`min-w-[18rem] ${columnDividerClassName}`}
                />
                <SortableHeader
                  label="Constraint"
                  columnKey="constraint"
                  sort={sort}
                  onToggle={handleToggleSort}
                  widthClassName={`min-w-[16rem] ${columnDividerClassName}`}
                />
                <SortableHeader
                  label="Severity"
                  columnKey="severity"
                  sort={sort}
                  onToggle={handleToggleSort}
                  widthClassName="w-[8rem]"
                />
                <th scope="col" className={`${headerCellClassName} w-[4rem] text-right`}>
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--foreground)]">
                    {/* actions */}
                  </span>
                </th>
              </tr>
            </thead>

            {isFlat ? (
              <tbody>
                {flatRows.map((row) => (
                  <RuleTableRow
                    key={row.rule.id}
                    row={row}
                    showClause
                    onChange={(nextRule) => updateRule(row.clauseId, row.rule.id, nextRule)}
                    onRemove={() => removeRule(row.clauseId, row.rule.id)}
                  />
                ))}
              </tbody>
            ) : (
              visibleClauses.map(({ clause, rows }) => {
                const collapsed = collapsedClauseIds.has(clause.id);
                return (
                  <tbody key={clause.id}>
                    <tr className="bg-[color:var(--panel-bg)]/70">
                      <td colSpan={groupColumnCount} className="border-b border-[color:var(--viewer-border)] px-2 py-1.5">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleClauseCollapse(clause.id)}
                            aria-expanded={!collapsed}
                            aria-label={collapsed ? "Expand clause" : "Collapse clause"}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--r-chip)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                          >
                            {collapsed ? (
                              <ChevronRight className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </button>
                          <input
                            value={clause.title}
                            onChange={(event) =>
                              updateClause(clause.id, { ...clause, title: event.target.value })
                            }
                            className="min-w-0 flex-1 rounded-[var(--r-control)] border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-[color:var(--foreground)] outline-none transition hover:border-[color:var(--viewer-border)] focus:border-[color:var(--accent)] focus:bg-[color:var(--surface-strong)]"
                            placeholder="Clause title"
                            aria-label="Clause title"
                          />
                          <span className="shrink-0 rounded-[var(--r-chip)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2 py-0.5 font-mono text-[11px] tabular-nums text-[color:var(--muted-ink)]">
                            {clause.rules.length}
                          </span>
                          <button
                            type="button"
                            onClick={() => addRule(clause.id)}
                            className={compactButtonClassName()}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Rule
                          </button>
                          <button
                            type="button"
                            onClick={() => removeClause(clause.id)}
                            aria-label="Remove clause"
                            title="Remove clause"
                            className={destructiveButtonClassName()}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {collapsed
                      ? null
                      : rows.length === 0
                        ? (
                          <tr>
                            <td
                              colSpan={groupColumnCount}
                              className="border-b border-[color:var(--viewer-border)] px-4 py-3 text-sm text-[color:var(--muted-ink)]"
                            >
                              No rules yet — add one with the Rule button.
                            </td>
                          </tr>
                        )
                        : rows.map((row) => (
                            <RuleTableRow
                              key={row.rule.id}
                              row={row}
                              showClause={false}
                              onChange={(nextRule) => updateRule(row.clauseId, row.rule.id, nextRule)}
                              onRemove={() => removeRule(row.clauseId, row.rule.id)}
                            />
                          ))}
                  </tbody>
                );
              })
            )}
          </table>
        )}
      </div>

      <StatusBar
        statusTone={importError ? "error" : "success"}
        segments={[
          { id: "clauses", label: `${config.clauses.length} clauses` },
          { id: "rules", label: `${totalRuleCount} rules` },
          ...(isFlat || hasActiveFilters
            ? [{ id: "shown", label: `${matchedRows.length} shown` } as const]
            : []),
          {
            id: "saved",
            label: importError ? "Not saved" : "Saved",
            tone: importError ? "error" : "success",
            icon: importError ? <CircleAlert /> : <Check />,
          },
        ]}
        inspector={
          <InspectorDetailList
            items={[
              { label: "Storage", value: "Auto-saved to this browser profile" },
              { label: "Clauses", value: config.clauses.length },
              { label: "Rules", value: totalRuleCount },
              { label: "Matching view", value: matchedRows.length },
              { label: "Last error", value: importError ?? "None" },
            ]}
          />
        }
      />
    </section>
  );
}
