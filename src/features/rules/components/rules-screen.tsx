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
  Download,
  LayoutTemplate,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { StatusBar } from "@/components/status-bar/status-bar";
import { InspectorDetailList } from "@/components/status-bar/status-inspector";
import { useViewerRules, useViewerSeverities } from "@/features/rules/rules-provider";
import {
  SEVERITY_RAIL_CLASS,
  SEVERITY_TONE_CLASS,
  severityCssVars,
} from "@/features/viewer/lib/severity-style";
import {
  createEmptyViewerValidationConfig,
  parseViewerValidationConfigText,
  serializeViewerValidationConfig,
} from "@/features/rules/lib/validation";
import {
  deleteRuleTemplate,
  listRuleTemplates,
  readRuleTemplate,
  ruleTemplateConfigEndpoint,
  ruleTemplateSourceEndpoint,
  saveRuleTemplate,
} from "@/features/rules/lib/rule-template-api";
import type {
  ViewerRuleTemplateKind,
  ViewerRuleTemplateSourceKind,
  ViewerRuleTemplateSummary,
  ViewerValidationCheck,
  ViewerValidationClause,
  ViewerValidationRule,
  ViewerValidationSeverity,
  ViewerValidationTarget,
} from "@/features/viewer/types";

type RulesScreenProps = {
  mode: "modal" | "page";
  onClose?: () => void;
};

type SortColumnKey = "clause" | "ifcType" | "subtype" | "target" | "constraint" | "severity";
type SortDirection = "asc" | "desc";
type RulesSort = { columnKey: SortColumnKey; direction: SortDirection };
type SeverityFilter = "all" | ViewerValidationRule["failSeverity"];
type CheckFilter = "all" | ViewerValidationCheck["kind"];

type RuleRow = {
  clauseId: string;
  clauseTitle: string;
  rule: ViewerValidationRule;
};

/**
 * An in-progress "save as template" entry. `clause` is set when the user is saving one
 * clause rather than the whole set, and is what the saved config is built from.
 */
type TemplateDraft = {
  kind: ViewerRuleTemplateKind;
  clause: ViewerValidationClause | null;
  name: string;
  description: string;
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

// Quiet square control for a row's secondary actions — present, but never competing with
// the one worded button that does the main thing.
function iconButtonClassName() {
  return "inline-flex h-7 w-7 items-center justify-center rounded-[var(--r-control)] border border-transparent text-[color:var(--muted-ink)] transition hover:border-[color:var(--viewer-border)] hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)] focus-visible:border-[color:var(--accent)]";
}

function destructiveButtonClassName() {
  return "inline-flex h-8 w-8 items-center justify-center rounded-[var(--r-control)] border border-[#d9a89d] bg-[#fff0ea] text-[#b5432f] transition hover:bg-[#ffe5dc] hover:text-[#962f1f]";
}

function filterSelectClassName() {
  return "h-9 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)]";
}

const severitySelectClassName = `h-8 rounded-[var(--r-chip)] border px-2 text-[11px] font-semibold uppercase tracking-[0.08em] outline-none transition focus:border-[color:var(--accent)] ${SEVERITY_TONE_CLASS}`;

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

  if (kind === "regex") {
    return { kind: "regex", regex: "", caseInsensitive: false };
  }

  if (kind === "boolean") {
    return { kind: "boolean", expected: true };
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
  if (check.kind === "regex") {
    return `regex ${check.regex}`;
  }
  if (check.kind === "boolean") {
    return `boolean ${check.expected ? "true" : "false"}`;
  }
  return `range ${numberValue(check.min)} ${numberValue(check.max)}`;
}

function rowSortValue(row: RuleRow, columnKey: SortColumnKey) {
  switch (columnKey) {
    case "clause":
      return row.clauseTitle;
    case "ifcType":
      return row.rule.ifcType;
    case "subtype":
      return row.rule.subtype ?? "";
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
    row.rule.subtype ?? "",
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

function RegexConstraintCell({
  check,
  onCommit,
}: {
  check: Extract<ViewerValidationCheck, { kind: "regex" }>;
  onCommit: (next: Extract<ViewerValidationCheck, { kind: "regex" }>) => void;
}) {
  const serializedRegex = check.regex;
  const [draftRegex, setDraftRegex] = useState(serializedRegex);

  useEffect(() => {
    setDraftRegex(serializedRegex);
  }, [serializedRegex]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <input
        type="text"
        value={draftRegex}
        onChange={(event) => setDraftRegex(event.target.value)}
        onBlur={() =>
          onCommit({
            kind: "regex",
            regex: draftRegex.trim(),
            caseInsensitive: check.caseInsensitive,
          })
        }
        className={cellInputClassName(true)}
        placeholder="^EC\d{3}$"
        aria-label="Regular expression"
      />
      <button
        type="button"
        onClick={() =>
          onCommit({
            kind: "regex",
            regex: draftRegex.trim(),
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
        <option value="regex">Regex</option>
        <option value="boolean">Boolean</option>
      </select>
      {check.kind === "empty" ? (
        <span className="px-1 text-xs text-[color:var(--muted-ink)]">value present</span>
      ) : check.kind === "enum" ? (
        <EnumValuesCell
          check={check}
          onCommit={(allowedValues) => onChange({ ...rule, check: { kind: "enum", allowedValues } })}
        />
      ) : check.kind === "regex" ? (
        <RegexConstraintCell
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
  const { severities, color: severityColor } = useViewerSeverities();
  const railStyle = severityCssVars(severityColor(rule.failSeverity));
  const railClassName = SEVERITY_RAIL_CLASS;

  return (
    <tr className="transition hover:bg-[color:var(--surface-soft)]">
      {showClause ? (
        <td className={`${bodyCellClassName} ${railClassName}`} style={railStyle}>
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
        <input
          value={rule.subtype ?? ""}
          onChange={(event) => onChange({ ...rule, subtype: event.target.value })}
          className={cellInputClassName(true)}
          placeholder="Any"
          aria-label="Predefined subtype"
          title="Optional PredefinedType filter. Leave blank to apply to every element of this IFC type."
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
              failSeverity: event.target.value,
            })
          }
          className={severitySelectClassName}
          style={severityCssVars(severityColor(rule.failSeverity))}
          aria-label="Fail severity"
        >
          {[...severities].reverse().map((severity) => (
            <option key={severity.id} value={severity.id}>
              {severity.label}
            </option>
          ))}
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

type TemplateSourceFilter = "all" | ViewerRuleTemplateSourceKind;

const TEMPLATE_SOURCE_FILTERS: { id: TemplateSourceFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "user", label: "Yours" },
  { id: "starter", label: "Starter" },
  { id: "industry-mapping", label: "Industry" },
];

function countLabel(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function templateMatchesQuery(template: ViewerRuleTemplateSummary, query: string) {
  return (
    template.name.toLowerCase().includes(query) ||
    template.description.toLowerCase().includes(query)
  );
}

/**
 * The rule mix as a hairline band. Two templates of the same size behave very differently
 * depending on how much of them is an error rather than a warning, and no count shows that —
 * so the library is scannable by shape before it is read. Each band is coloured by the
 * template's own severity definitions, not the reader's.
 */
function SeveritySpine({ template }: { template: ViewerRuleTemplateSummary }) {
  if (template.severityTally.length === 0 || template.ruleCount === 0) {
    return null;
  }

  const label = template.severityTally
    .map((tally) => `${tally.count} ${tally.label.toLowerCase()}`)
    .join(", ");

  return (
    <div
      className="flex h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-[color:var(--viewer-border)]"
      title={label}
      role="img"
      aria-label={`Rule mix: ${label}`}
    >
      {template.severityTally.map((tally) => (
        <span
          key={tally.id}
          style={{
            backgroundColor: tally.color,
            width: `${(tally.count / template.ruleCount) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

function TemplateRow({
  template,
  busy,
  pendingDelete,
  onApply,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  template: ViewerRuleTemplateSummary;
  busy: "apply" | "delete" | null;
  pendingDelete: boolean;
  onApply: () => void;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  // A clause template joins the clauses already there; a config template stands in for all of
  // them. "Load" stays the word for the config case — it is what the button has always said.
  const applyLabel = template.kind === "clause" ? "Insert" : "Load";
  const scale = `${countLabel(
    template.kind === "clause" ? 1 : template.clauseCount,
    "clause",
  )} · ${countLabel(template.ruleCount, "rule")}`;

  if (pendingDelete) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--hairline)] bg-[color:var(--danger-bg)] px-3 py-2.5 text-[color:var(--danger-fg)]">
        <span className="min-w-0 flex-1 truncate text-[13px]">
          Delete &ldquo;{template.name}&rdquo;? This cannot be undone.
        </span>
        <button
          type="button"
          onClick={onConfirmDelete}
          disabled={busy === "delete"}
          className={`${compactButtonClassName()} disabled:cursor-wait disabled:opacity-60`}
        >
          {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Delete
        </button>
        <button
          type="button"
          onClick={onCancelDelete}
          disabled={busy === "delete"}
          className={compactButtonClassName()}
        >
          Keep
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-3 border-b border-[color:var(--hairline)] px-3 py-1.5 transition hover:bg-[color:var(--surface-hover)] focus-within:bg-[color:var(--surface-hover)]">
      <div className="min-w-0 flex-1">
        {/* No "clause" badge: the Insert/Load button already carries that distinction, and
            says it where the reader acts on it. */}
        <div className="truncate text-[13px] font-semibold text-[color:var(--foreground)]">
          {template.name}
        </div>
        {template.description ? (
          <p className="mt-0.5 truncate text-[11px] leading-4 text-[color:var(--muted-ink)]">
            {template.description}
          </p>
        ) : null}
        <div className="mt-1 flex items-center gap-2 sm:hidden">
          <SeveritySpine template={template} />
          <span className="font-mono text-[11px] tabular-nums text-[color:var(--muted-ink)]">
            {scale}
          </span>
        </div>
      </div>

      <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
        <SeveritySpine template={template} />
        <span className="w-[8.5rem] text-right font-mono text-[11px] tabular-nums text-[color:var(--muted-ink)]">
          {scale}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onApply}
          disabled={busy !== null}
          className={`${compactButtonClassName()} w-[4.25rem] justify-center disabled:cursor-wait disabled:opacity-60`}
        >
          {busy === "apply" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : applyLabel}
        </button>
        <a
          href={ruleTemplateConfigEndpoint(template.templateId)}
          download
          aria-label={`Download ${template.name} as JSON`}
          title="Download JSON"
          className={`${iconButtonClassName()} opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`}
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        {canDownloadTemplateSource(template) ? (
          <a
            href={ruleTemplateSourceEndpoint(template.templateId)}
            download
            aria-label={`Download ${template.name} as CSV`}
            title="Download CSV"
            className={`${iconButtonClassName()} font-mono text-[9px] font-semibold opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`}
          >
            CSV
          </a>
        ) : null}
        <button
          type="button"
          onClick={onRequestDelete}
          aria-label={`Delete ${template.name}`}
          title="Delete template"
          className={`${iconButtonClassName()} opacity-0 transition hover:border-[color:var(--danger-border)] hover:bg-[color:var(--danger-bg)] hover:text-[color:var(--danger-fg)] group-hover:opacity-100 focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function TemplatesPopover({
  templates,
  loading,
  error,
  loadingTemplateId,
  deletingTemplateId,
  onApply,
  onDelete,
}: {
  templates: ViewerRuleTemplateSummary[];
  loading: boolean;
  error: string | null;
  loadingTemplateId: string | null;
  deletingTemplateId: string | null;
  onApply: (template: ViewerRuleTemplateSummary) => void;
  onDelete: (template: ViewerRuleTemplateSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<TemplateSourceFilter>("all");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const close = () => {
    setOpen(false);
    setPendingDeleteId(null);
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    searchRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setPendingDeleteId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const sourceCounts = useMemo(() => {
    const counts: Record<TemplateSourceFilter, number> = {
      all: templates.length,
      user: 0,
      starter: 0,
      "industry-mapping": 0,
    };
    for (const template of templates) {
      counts[template.sourceKind] += 1;
    }
    return counts;
  }, [templates]);

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter(
      (template) =>
        (sourceFilter === "all" || template.sourceKind === sourceFilter) &&
        (!needle || templateMatchesQuery(template, needle)),
    );
  }, [templates, query, sourceFilter]);

  // Yours first: the library grows fastest at the end you authored.
  const groups = useMemo(
    () =>
      [
        { id: "user", label: "Yours", items: matched.filter((t) => t.sourceKind === "user") },
        {
          id: "starter",
          label: "Starter",
          items: matched.filter((t) => t.sourceKind === "starter"),
        },
        {
          id: "industry-mapping",
          label: "Industry mapping",
          items: matched.filter((t) => t.sourceKind === "industry-mapping"),
        },
      ].filter((group) => group.items.length > 0),
    [matched],
  );

  const busyFor = (template: ViewerRuleTemplateSummary) => {
    if (loadingTemplateId === template.templateId) return "apply" as const;
    if (deletingTemplateId === template.templateId) return "delete" as const;
    return null;
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
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
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Clause templates"
            className="fixed inset-x-3 bottom-3 z-50 flex max-h-[72vh] flex-col overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] shadow-[var(--viewer-shadow-lift)] sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:mt-2 sm:max-h-[min(32rem,70vh)] sm:w-[min(94vw,46rem)]"
          >
            {/* Sticky control deck — the library scrolls beneath it. */}
            <div className="shrink-0 border-b border-[color:var(--viewer-border)] bg-[image:var(--viewer-header-bg)] px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[10rem] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--muted-ink)]" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search templates"
                    aria-label="Search templates"
                    className="h-8 w-full rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] pl-8 pr-8 text-[13px] text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)]"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      aria-label="Clear search"
                      className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-[var(--r-chip)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-soft)] hover:text-[color:var(--foreground)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>

                <div className="flex items-center gap-0.5 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] p-0.5">
                  {TEMPLATE_SOURCE_FILTERS.map((filter) => {
                    const active = sourceFilter === filter.id;
                    return (
                      <button
                        key={filter.id}
                        type="button"
                        onClick={() => setSourceFilter(filter.id)}
                        aria-pressed={active}
                        disabled={filter.id !== "all" && sourceCounts[filter.id] === 0}
                        className={`rounded-[var(--r-chip)] px-2 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                          active
                            ? "bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
                            : "text-[color:var(--muted-ink)] hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                        }`}
                      >
                        {filter.label}
                        <span className="ml-1 font-mono tabular-nums opacity-70">
                          {sourceCounts[filter.id]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
              {loading ? (
                <div className="px-3 py-8 text-center text-xs text-[color:var(--muted-ink)]">
                  Loading templates…
                </div>
              ) : error ? (
                <div className="m-3 rounded-[var(--r-control)] border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-3 py-2.5 text-xs text-[color:var(--danger-fg)]">
                  {error}
                </div>
              ) : templates.length === 0 ? (
                <div className="px-3 py-10 text-center">
                  <div className="text-[13px] font-semibold text-[color:var(--foreground)]">
                    No templates yet
                  </div>
                  <p className="mx-auto mt-1 max-w-[22rem] text-[11px] leading-4 text-[color:var(--muted-ink)]">
                    Save the clauses you are working on to start the library. Saved sets are
                    shared with everyone on this deployment.
                  </p>
                </div>
              ) : matched.length === 0 ? (
                <div className="px-3 py-10 text-center">
                  <div className="text-[13px] font-semibold text-[color:var(--foreground)]">
                    Nothing matches that search
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      setSourceFilter("all");
                    }}
                    className={`${compactButtonClassName()} mx-auto mt-3`}
                  >
                    Show all templates
                  </button>
                </div>
              ) : (
                groups.map((group) => (
                  <section key={group.id}>
                    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[color:var(--hairline)] bg-[color:var(--panel-bg)] px-3 py-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
                        {group.label}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-[color:var(--muted-ink)]">
                        {group.items.length}
                      </span>
                    </div>
                    {group.items.map((template) => (
                      <TemplateRow
                        key={template.templateId}
                        template={template}
                        busy={busyFor(template)}
                        pendingDelete={pendingDeleteId === template.templateId}
                        onApply={() => {
                          onApply(template);
                          close();
                        }}
                        onRequestDelete={() => setPendingDeleteId(template.templateId)}
                        onCancelDelete={() => setPendingDeleteId(null)}
                        onConfirmDelete={() => {
                          onDelete(template);
                          setPendingDeleteId(null);
                        }}
                      />
                    ))}
                  </section>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Severity editor                                                      */
/* ------------------------------------------------------------------ */

function SeverityEditor({
  severities,
  ruleCounts,
  onAdd,
  onUpdate,
  onRemove,
  onMove,
  onClose,
}: {
  severities: ViewerValidationSeverity[];
  ruleCounts: Record<string, number>;
  onAdd: () => void;
  onUpdate: (severityId: string, next: Partial<ViewerValidationSeverity>) => void;
  onRemove: (severityId: string, remapToId: string) => void;
  onMove: (severityId: string, direction: "up" | "down") => void;
  onClose: () => void;
}) {
  // Most severe first, matching how severities are presented everywhere else.
  const ordered = [...severities].reverse();
  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const pendingRemoval = ordered.find((severity) => severity.id === pendingRemovalId) ?? null;
  const remapCandidates = ordered.filter((severity) => severity.id !== pendingRemovalId);
  const [remapToId, setRemapToId] = useState("");

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <section className="flex max-h-[min(40rem,calc(100vh-2rem))] w-[min(38rem,100%)] flex-col overflow-hidden rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)]">
        <header className="flex items-start justify-between gap-3 border-b border-[color:var(--viewer-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[color:var(--foreground)]">Severities</h2>
            <p className="mt-0.5 text-[11px] text-[color:var(--muted-ink)]">
              Listed most severe first. An element failing at several levels is shown in the colour
              of the highest one.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close severities"
            className={compactButtonClassName()}
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <ul className="space-y-2">
            {ordered.map((severity, index) => (
              <li
                key={severity.id}
                className={`flex items-center gap-2 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2.5 py-2 ${SEVERITY_RAIL_CLASS}`}
                style={severityCssVars(severity.color)}
              >
                <input
                  type="color"
                  value={severity.color}
                  onChange={(event) => onUpdate(severity.id, { color: event.target.value })}
                  aria-label={`${severity.label} colour`}
                  className="h-7 w-9 shrink-0 cursor-pointer rounded border border-[color:var(--viewer-border)] bg-transparent"
                />
                <input
                  value={severity.label}
                  onChange={(event) => onUpdate(severity.id, { label: event.target.value })}
                  aria-label={`${severity.id} label`}
                  className={cellInputClassName(true)}
                />
                <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-[color:var(--muted-ink)]">
                  {ruleCounts[severity.id] ?? 0} rules
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onMove(severity.id, "up")}
                    disabled={index === 0}
                    aria-label={`Make ${severity.label} more severe`}
                    className={`${compactButtonClassName()} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMove(severity.id, "down")}
                    disabled={index === ordered.length - 1}
                    aria-label={`Make ${severity.label} less severe`}
                    className={`${compactButtonClassName()} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingRemovalId(severity.id);
                      setRemapToId(
                        ordered.find((candidate) => candidate.id !== severity.id)?.id ?? "",
                      );
                    }}
                    disabled={ordered.length <= 1}
                    aria-label={`Remove ${severity.label}`}
                    title={
                      ordered.length <= 1 ? "At least one severity is required" : undefined
                    }
                    className={`${compactButtonClassName()} disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <button type="button" onClick={onAdd} className={`${secondaryButtonClassName()} mt-3`}>
            <Plus className="h-4 w-4" />
            Add severity
          </button>

          {pendingRemoval ? (
            <div className="mt-3 rounded-[var(--r-control)] border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-3 py-2.5 text-sm text-[color:var(--danger-fg)]">
              <div className="font-medium">
                Remove &ldquo;{pendingRemoval.label}&rdquo;?
              </div>
              <p className="mt-1 text-[12px]">
                {ruleCounts[pendingRemoval.id] ?? 0} rules use it. Choose the severity they should
                move to.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={remapToId}
                  onChange={(event) => setRemapToId(event.target.value)}
                  aria-label="Move rules to"
                  className={filterSelectClassName()}
                >
                  {remapCandidates.map((severity) => (
                    <option key={severity.id} value={severity.id}>
                      {severity.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    onRemove(pendingRemoval.id, remapToId);
                    setPendingRemovalId(null);
                  }}
                  className={secondaryButtonClassName()}
                >
                  Remove and move rules
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRemovalId(null)}
                  className={compactButtonClassName()}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
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
    insertClauses,
    addSeverity,
    updateSeverity,
    removeSeverity,
    moveSeverity,
    countRulesBySeverity,
  } = useViewerRules();
  const { severities, scale: severityScale } = useViewerSeverities();

  const [importError, setImportError] = useState<string | null>(null);
  const [showSeverityEditor, setShowSeverityEditor] = useState(false);
  const [loadingTemplateId, setLoadingTemplateId] = useState<string | null>(null);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);
  const [starterTemplates, setStarterTemplates] = useState<ViewerRuleTemplateSummary[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesRefreshKey, setTemplatesRefreshKey] = useState(0);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);

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
    // Severity sorts by configured rank, not alphabetically — "error" before "warn" is a
    // coincidence of spelling that stops holding as soon as levels are user-named.
    const sorted = [...matchedRows].sort((a, b) =>
      sort.columnKey === "severity"
        ? severityScale.rank(a.rule.failSeverity) - severityScale.rank(b.rule.failSeverity)
        : rowSortValue(a, sort.columnKey).localeCompare(rowSortValue(b, sort.columnKey), undefined, {
            numeric: true,
            sensitivity: "base",
          }),
    );
    return sort.direction === "desc" ? sorted.reverse() : sorted;
  }, [matchedRows, severityScale, sort]);

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

  // Re-runs whenever a save or delete bumps the key, so the popover reflects the
  // server-derived counts rather than a locally patched copy of the list.
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
          error instanceof Error ? error.message : "Templates could not be listed.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setTemplatesLoading(false);
        }
      });

    return () => controller.abort();
  }, [templatesRefreshKey]);

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

  const handleApplyTemplate = async (template: ViewerRuleTemplateSummary) => {
    try {
      setLoadingTemplateId(template.templateId);
      const importedTemplate = await readRuleTemplate(template.templateId);

      // A clause template joins what is already there; a config template replaces it.
      if (importedTemplate.kind === "clause") {
        insertClauses(importedTemplate.config);
      } else {
        replaceConfig(importedTemplate.config);
      }

      setImportError(null);
      setTemplateNotice(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Template could not be loaded.");
    } finally {
      setLoadingTemplateId(null);
    }
  };

  const handleDeleteTemplate = async (template: ViewerRuleTemplateSummary) => {
    try {
      setDeletingTemplateId(template.templateId);
      await deleteRuleTemplate(template.templateId);
      setImportError(null);
      setTemplateNotice(`Deleted "${template.name}".`);
      setTemplatesRefreshKey((key) => key + 1);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Template could not be deleted.");
    } finally {
      setDeletingTemplateId(null);
    }
  };

  const openTemplateDraft = (clause: ViewerValidationClause | null) => {
    setTemplateNotice(null);
    setTemplateDraft({
      kind: clause ? "clause" : "config",
      clause,
      name: clause
        ? clause.title || "Untitled clause"
        : `Clauses — ${new Date().toLocaleDateString()}`,
      description: "",
    });
  };

  const handleSaveTemplate = async () => {
    if (!templateDraft || !templateDraft.name.trim()) {
      return;
    }

    // A clause template is just a config holding that one clause, so the stored shape,
    // the JSON download and the parser stay the same for both kinds.
    const clauses = templateDraft.clause ? [templateDraft.clause] : config.clauses;

    try {
      setSavingTemplate(true);
      const saved = await saveRuleTemplate({
        name: templateDraft.name.trim(),
        description: templateDraft.description.trim(),
        kind: templateDraft.kind,
        config: { ...config, clauses },
      });

      setTemplateDraft(null);
      setImportError(null);
      setTemplateNotice(`Saved "${saved.name}" to templates.`);
      setTemplatesRefreshKey((key) => key + 1);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Template could not be saved.");
    } finally {
      setSavingTemplate(false);
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

  // IFC type, subtype, target, constraint, severity, actions — the grouped view drops the clause column.
  const groupColumnCount = 6;
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
            deletingTemplateId={deletingTemplateId}
            onApply={(template) => void handleApplyTemplate(template)}
            onDelete={(template) => void handleDeleteTemplate(template)}
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
            {[...severities].reverse().map((severity) => (
              <option key={severity.id} value={severity.id}>
                {severity.label}
              </option>
            ))}
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
            <option value="regex">Regex</option>
            <option value="boolean">Boolean</option>
          </select>

          {isFlat || hasActiveFilters ? (
            <button type="button" onClick={resetView} className={compactButtonClassName()}>
              Reset
            </button>
          ) : null}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSeverityEditor(true)}
              className={secondaryButtonClassName()}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Severities
            </button>
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
              onClick={() => openTemplateDraft(null)}
              disabled={config.clauses.length === 0}
              className={`${secondaryButtonClassName()} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <LayoutTemplate className="h-4 w-4" />
              Save as template
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

        {templateDraft ? (
          <div className="mt-3 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)]">
              {templateDraft.kind === "clause"
                ? "Save clause as template"
                : `Save ${config.clauses.length} clauses as template`}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={templateDraft.name}
                onChange={(event) =>
                  setTemplateDraft((draft) =>
                    draft ? { ...draft, name: event.target.value } : draft,
                  )
                }
                placeholder="Template name"
                aria-label="Template name"
                autoFocus
                className="h-9 min-w-[12rem] flex-1 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)]"
              />
              <input
                value={templateDraft.description}
                onChange={(event) =>
                  setTemplateDraft((draft) =>
                    draft ? { ...draft, description: event.target.value } : draft,
                  )
                }
                placeholder="Description (optional)"
                aria-label="Template description"
                className="h-9 min-w-[12rem] flex-[2] rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-2.5 text-sm text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)]"
              />
              <button
                type="button"
                onClick={() => void handleSaveTemplate()}
                disabled={savingTemplate || !templateDraft.name.trim()}
                className={`${secondaryButtonClassName()} disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {savingTemplate ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </button>
              <button
                type="button"
                onClick={() => setTemplateDraft(null)}
                disabled={savingTemplate}
                className={compactButtonClassName()}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {templateNotice && !importError ? (
          <div className="mt-3 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2 text-sm text-[color:var(--muted-ink)]">
            {templateNotice}
          </div>
        ) : null}

        {importError ? (
          <div className="mt-3 rounded-[var(--r-control)] border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-3 py-2 text-sm text-[color:var(--danger-fg)]">
            {importError}
          </div>
        ) : null}
      </div>

      {showSeverityEditor ? (
        <SeverityEditor
          severities={severities}
          ruleCounts={countRulesBySeverity()}
          onAdd={addSeverity}
          onUpdate={updateSeverity}
          onRemove={removeSeverity}
          onMove={moveSeverity}
          onClose={() => setShowSeverityEditor(false)}
        />
      ) : null}

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
                  label="Subtype"
                  columnKey="subtype"
                  sort={sort}
                  onToggle={handleToggleSort}
                  widthClassName={`min-w-[9rem] ${columnDividerClassName}`}
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
                            onClick={() => openTemplateDraft(clause)}
                            aria-label="Save clause as template"
                            title="Save clause as template"
                            className={compactButtonClassName()}
                          >
                            <LayoutTemplate className="h-3.5 w-3.5" />
                            Template
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
