"use client";

import type {
  ViewerElementInspection,
  ViewerInspectionGroup,
  ViewerInspectionRow,
  ViewerInspectionValue,
  ViewerInspectionValueState,
  ViewerSelection,
  ViewerSelectionDetails,
  ViewerValidationMatch,
  ViewerValidationSummary,
} from "@/features/viewer/types";

function isIssueState(state: ViewerInspectionValueState) {
  return state !== "present";
}

function issueLabel(state: ViewerInspectionValueState) {
  switch (state) {
    case "missing":
      return "Missing";
    case "empty":
      return "Empty";
    case "null":
      return "Null";
    case "undefined":
      return "Undefined";
    default:
      return null;
  }
}

function validationLabel(validation: ViewerValidationMatch | null) {
  if (!validation) {
    return null;
  }

  switch (validation.result) {
    case "ok":
      return "OK";
    case "warn":
      return "Warn";
    case "error":
      return "Error";
  }
}

function rowClass(value: ViewerInspectionValue) {
  if (value.validation?.result === "ok") {
    return "bg-[#edf7f1]";
  }

  if (value.validation?.result === "warn") {
    return "bg-[#fff7ed]";
  }

  if (value.validation?.result === "error") {
    return "bg-[#fff0ea]";
  }

  if (isIssueState(value.state)) {
    return "bg-[#fff7ed]";
  }

  return "bg-white/30";
}

function valueClass(value: ViewerInspectionValue) {
  if (value.validation?.result === "ok") {
    return "text-[#1e6b45]";
  }

  if (value.validation?.result === "warn") {
    return "text-[#7d4414]";
  }

  if (value.validation?.result === "error") {
    return "text-[#8a3e1f]";
  }

  if (isIssueState(value.state)) {
    return "text-[#7d4414]";
  }

  return "text-[color:var(--foreground)]";
}

function badgeClass(value: ViewerInspectionValue) {
  if (value.validation?.result === "ok") {
    return "border-[#8cc3a3] bg-[#edf7f1] text-[#1e6b45]";
  }

  if (value.validation?.result === "warn") {
    return "border-[#d8af80] bg-[#fff1df] text-[#915217]";
  }

  if (value.validation?.result === "error") {
    return "border-[#d3a08e] bg-[#fff0ea] text-[#8a3e1f]";
  }

  if (isIssueState(value.state)) {
    return "border-[#d8af80] bg-[#fff1df] text-[#915217]";
  }

  return "border-[color:var(--viewer-border)] bg-white/70 text-[color:var(--muted-ink)]";
}

function InspectionValueRow({
  label,
  value,
}: {
  label: string;
  value: ViewerInspectionValue;
}) {
  const badge = validationLabel(value.validation) ?? issueLabel(value.state);

  return (
    <div
      className={`grid gap-1.5 px-2.5 py-1.5 md:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] md:items-start md:gap-x-3 ${rowClass(value)}`}
    >
      <div className="min-w-0 break-words text-xs font-semibold uppercase tracking-[0.16em] [overflow-wrap:anywhere] text-[color:var(--muted-ink)]">
        {label}
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-2 md:flex-nowrap md:justify-between">
        <div
          className={`min-w-0 flex-1 break-words text-sm leading-6 [overflow-wrap:anywhere] ${valueClass(value)}`}
        >
          {value.text}
        </div>
        {badge ? (
          <span
            className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${badgeClass(value)}`}
          >
            {badge}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function InspectionRowView({ row }: { row: ViewerInspectionRow }) {
  return <InspectionValueRow label={row.label} value={row.value} />;
}

function PropertySetGroup({ group }: { group: ViewerInspectionGroup }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]">
      <div className="border-b border-[color:var(--viewer-border)] px-2.5 py-2">
        <h3 className="break-words text-sm font-semibold text-[color:var(--foreground)]">
          {group.title}
        </h3>
        {group.subtitle ? (
          <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
            {group.subtitle}
          </div>
        ) : null}
      </div>

      {group.rows.length > 0 ? (
        <div className="divide-y divide-[color:var(--viewer-border)]">
          {group.rows.map((row) => (
            <InspectionRowView key={row.key} row={row} />
          ))}
        </div>
      ) : (
        <div className="px-2.5 py-2.5 text-sm text-[color:var(--muted-ink)]">
          No properties were resolved for this property set.
        </div>
      )}
    </section>
  );
}

function EmptySelectionState() {
  return (
    <section className="rounded-xl border border-dashed border-[color:var(--viewer-border)] bg-white/35 px-3 py-3.5 text-sm text-[color:var(--muted-ink)]">
      Select an element in the viewport or model tree to view its IFC class, attributes, and
      property sets.
    </section>
  );
}

function LoadingState({ selection }: { selection: ViewerSelection }) {
  return (
    <section className="space-y-2">
      <div>
        <div className="text-sm font-semibold text-[color:var(--foreground)]">{selection.label}</div>
        <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
          Loading properties
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-[color:var(--viewer-border)] bg-white/35 px-3 py-3 text-sm text-[color:var(--muted-ink)]">
        Resolving IFC attributes and property sets for the selected element.
      </div>
    </section>
  );
}

function UnavailableState({ selection }: { selection: ViewerSelection }) {
  return (
    <section className="space-y-2">
      <div>
        <div className="text-sm font-semibold text-[color:var(--foreground)]">{selection.label}</div>
        <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
          Properties unavailable
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-[#d8af80] bg-[#fff7ed] px-3 py-3 text-sm text-[#915217]">
        The element is selected, but its IFC attributes or property relations could not be resolved.
      </div>
    </section>
  );
}

function ValidationSummaryBanner({ summary }: { summary: ViewerValidationSummary | null }) {
  if (!summary) {
    return null;
  }

  const tone =
    summary.result === "error"
      ? "border-[#d3a08e] bg-[#fff0ea] text-[#8a3e1f]"
      : summary.result === "warn"
        ? "border-[#d8af80] bg-[#fff7ed] text-[#915217]"
        : "border-[#8cc3a3] bg-[#edf7f1] text-[#1e6b45]";

  return (
    <section className={`rounded-xl border px-3 py-3 ${tone}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em]">Rule Summary</div>
      <div className="mt-2 text-sm">
        {summary.errorCount > 0 ? `${summary.errorCount} error` : "0 error"}
        {" · "}
        {summary.warnCount > 0 ? `${summary.warnCount} warn` : "0 warn"}
        {" · "}
        {summary.okCount > 0 ? `${summary.okCount} ok` : "0 ok"}
      </div>
    </section>
  );
}

function InspectionContent({ inspection }: { inspection: ViewerElementInspection }) {
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div>
          <h2 className="break-words text-base font-semibold text-[color:var(--foreground)]">
            {inspection.title}
          </h2>
          <div className="mt-1 text-xs uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
            Model {inspection.modelId} | Local ID #{inspection.localId}
          </div>
        </div>

        <ValidationSummaryBanner summary={inspection.validationSummary} />

        <div className="overflow-hidden rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]">
          <div className="divide-y divide-[color:var(--viewer-border)]">
            {inspection.summaryRows.map((row) => (
              <InspectionRowView key={row.key} row={row} />
            ))}
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
          Property Sets
        </div>

        {inspection.propertySets.length > 0 ? (
          <div className="space-y-2">
            {inspection.propertySets.map((group) => (
              <PropertySetGroup key={group.key} group={group} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[color:var(--viewer-border)] bg-white/35 px-3 py-3 text-sm text-[color:var(--muted-ink)]">
            No property sets were found for this element.
          </div>
        )}
      </section>
    </div>
  );
}

type PropertiesPanelProps = {
  embedded?: boolean;
  details: ViewerSelectionDetails;
};

export function PropertiesPanel({ embedded = false, details }: PropertiesPanelProps) {
  return (
    <aside
      className={`flex h-full min-h-0 flex-col overflow-hidden ${
        embedded
          ? "bg-[color:var(--panel-bg)]/92"
          : "rounded-[1.75rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)]"
      }`}
    >
      <div className="border-b border-[color:var(--viewer-border)] px-3 py-3">
        <h1 className="text-lg font-semibold text-[color:var(--foreground)]">Properties</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!details.selection ? (
          <EmptySelectionState />
        ) : details.loading && !details.inspection ? (
          <LoadingState selection={details.selection} />
        ) : details.inspection ? (
          <InspectionContent inspection={details.inspection} />
        ) : (
          <UnavailableState selection={details.selection} />
        )}
      </div>
    </aside>
  );
}
