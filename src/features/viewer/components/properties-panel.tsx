"use client";

import { CircleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildPropertiesPanelViewModel } from "@/features/viewer/lib/properties-panel-insights";
import type {
  ViewerInspectionGroup,
  ViewerInspectionRow,
  ViewerInspectionValue,
  ViewerSelection,
  ViewerSelectionDetails,
  ViewerValidationClauseFailure,
  ViewerValidationMatch,
  ViewerValidationSummary,
} from "@/features/viewer/types";

type ValidationPopupPayload = {
  id: string;
  selectionKey: string;
  title: string;
  subtitle: string | null;
  clauseFailures: ViewerValidationClauseFailure[];
  result: ViewerValidationMatch["result"] | ViewerValidationSummary["result"];
};

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

  return "border-[color:var(--viewer-border)] bg-white/70 text-[color:var(--muted-ink)]";
}

function popupTone(result: ValidationPopupPayload["result"]) {
  if (result === "error") {
    return "border-[#d3a08e] bg-[#fff0ea] text-[#8a3e1f]";
  }

  if (result === "warn") {
    return "border-[#d8af80] bg-[#fff7ed] text-[#915217]";
  }

  return "border-[color:var(--viewer-border)] bg-white text-[color:var(--foreground)]";
}

function ValidationDetailsButton({
  title,
  onClick,
}: {
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--viewer-border)] bg-white/75 text-[color:var(--muted-ink)] transition hover:bg-white hover:text-[color:var(--foreground)]"
      aria-label={title}
      title={title}
    >
      <CircleAlert className="h-3.5 w-3.5" />
    </button>
  );
}

function ClauseFailureList({
  clauseFailures,
}: {
  clauseFailures: ViewerValidationClauseFailure[];
}) {
  if (clauseFailures.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1 text-[11px] leading-5 text-[color:var(--muted-ink)]">
      {clauseFailures.map((clauseFailure) => (
        <div
          key={clauseFailure.clauseId}
          className="rounded-lg border border-[color:var(--viewer-border)] bg-white/65 px-2 py-1.5"
        >
          <div className="font-semibold text-[color:var(--foreground)]">{clauseFailure.clauseTitle}</div>
          <div>{clauseFailure.rules.map((rule) => rule.description).join(" · ")}</div>
        </div>
      ))}
    </div>
  );
}

function ValidationDetailsPopup({
  payload,
  onClose,
}: {
  payload: ValidationPopupPayload;
  onClose: () => void;
}) {
  return (
    <section
      className={`absolute inset-x-3 top-16 z-20 max-h-[min(32rem,calc(100%-5rem))] overflow-hidden rounded-2xl border shadow-[0_22px_50px_rgba(15,23,42,0.22)] ${popupTone(payload.result)}`}
    >
      <div className="flex items-start justify-between gap-3 border-b border-black/10 px-3 py-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.18em]">Validation Details</div>
          <div className="mt-1 text-sm font-semibold">{payload.title}</div>
          {payload.subtitle ? <div className="mt-1 text-xs opacity-80">{payload.subtitle}</div> : null}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl border border-black/10 bg-white/65 transition hover:bg-white"
            aria-label="Close validation details"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="max-h-[24rem] overflow-y-auto px-3 py-3">
        <ClauseFailureList clauseFailures={payload.clauseFailures} />
      </div>
    </section>
  );
}

function InspectionValueRow({
  label,
  value,
  onOpenDetails,
}: {
  label: string;
  value: ViewerInspectionValue;
  onOpenDetails: (payload: Omit<ValidationPopupPayload, "selectionKey">) => void;
}) {
  const badge = validationLabel(value.validation);
  const failedClauseCount = value.validation?.clauseFailures.length ?? 0;
  const validation = value.validation;

  return (
    <div
      className={`grid gap-1.5 px-2.5 py-1.5 md:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] md:items-start md:gap-x-3 ${rowClass(value)}`}
    >
      <div className="min-w-0 break-words text-xs font-semibold tracking-[0.08em] [overflow-wrap:anywhere] text-[color:var(--muted-ink)]">
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
        {failedClauseCount > 0 && validation ? (
          <ValidationDetailsButton
            title={failedClauseCount === 1 ? "View 1 failed clause" : `View ${failedClauseCount} failed clauses`}
            onClick={() =>
              onOpenDetails({
                id: `row:${label}`,
                title: label,
                subtitle: value.text,
                clauseFailures: validation.clauseFailures,
                result: validation.result,
              })
            }
          />
        ) : null}
      </div>
    </div>
  );
}

function InspectionRowView({
  row,
  onOpenDetails,
}: {
  row: ViewerInspectionRow;
  onOpenDetails: (payload: Omit<ValidationPopupPayload, "selectionKey">) => void;
}) {
  return <InspectionValueRow label={row.label} value={row.value} onOpenDetails={onOpenDetails} />;
}

function PropertySetGroup({
  group,
  onOpenDetails,
}: {
  group: ViewerInspectionGroup;
  onOpenDetails: (payload: Omit<ValidationPopupPayload, "selectionKey">) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]">
      <div className="border-b border-[color:var(--viewer-border)] px-2.5 py-2">
        <h3 className="break-words text-sm font-semibold text-[color:var(--foreground)]">
          {group.title}
        </h3>
        {group.subtitle ? (
          <div className="mt-1 text-[11px] tracking-[0.08em] text-[color:var(--muted-ink)]">
            {group.subtitle}
          </div>
        ) : null}
      </div>

      {group.rows.length > 0 ? (
        <div className="divide-y divide-[color:var(--viewer-border)]">
          {group.rows.map((row) => (
            <InspectionRowView key={row.key} row={row} onOpenDetails={onOpenDetails} />
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

function ValidationSummaryBanner({
  summary,
  onOpenDetails,
}: {
  summary: ViewerValidationSummary | null;
  onOpenDetails: (payload: Omit<ValidationPopupPayload, "selectionKey">) => void;
}) {
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
      <div className="text-xs font-semibold uppercase tracking-[0.18em]">Validation Summary</div>
      <div className="mt-2 text-sm">
        {summary.errorCount > 0 ? `${summary.errorCount} error` : "0 error"}
        {" · "}
        {summary.warnCount > 0 ? `${summary.warnCount} warn` : "0 warn"}
        {" · "}
        {summary.okCount > 0 ? `${summary.okCount} ok` : "0 ok"}
      </div>
      {summary.failedClauseCount > 0 ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="text-sm">Failed clauses: {summary.failedClauseCount}</div>
          <ValidationDetailsButton
            title={
              summary.failedClauseCount === 1
                ? "View 1 failed clause"
                : `View ${summary.failedClauseCount} failed clauses`
            }
            onClick={() =>
              onOpenDetails({
                id: "summary",
                title: "Selected element issues",
                subtitle:
                  summary.failedClauseCount === 1
                    ? "1 failed clause"
                    : `${summary.failedClauseCount} failed clauses`,
                clauseFailures: summary.failedClauses,
                result: summary.result,
              })
            }
          />
        </div>
      ) : null}
    </section>
  );
}

function InsightMetricList({
  rows,
}: {
  rows: ReadonlyArray<{ label: string; value: string }>;
}) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]">
      <div className="divide-y divide-[color:var(--viewer-border)]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid gap-1.5 px-2.5 py-2 md:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] md:items-start md:gap-x-3"
          >
            <div className="min-w-0 break-words text-xs font-semibold tracking-[0.08em] [overflow-wrap:anywhere] text-[color:var(--muted-ink)]">
              {row.label}
            </div>
            <div className="min-w-0 break-words text-sm leading-6 [overflow-wrap:anywhere] text-[color:var(--foreground)]">
              {row.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InspectionContent({
  details,
  showEmptyRows,
  onToggleShowEmptyRows,
  onOpenDetails,
}: {
  details: ViewerSelectionDetails;
  showEmptyRows: boolean;
  onToggleShowEmptyRows: () => void;
  onOpenDetails: (payload: Omit<ValidationPopupPayload, "selectionKey">) => void;
}) {
  const viewModel = buildPropertiesPanelViewModel(details, { showEmptyRows });
  const inspection = details.inspection;
  if (!viewModel || !inspection || !details.selection) {
    return null;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[color:var(--viewer-border)] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(244,247,255,0.96))] px-3 py-3.5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-[#b7c8ff] bg-[#edf4ff] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#244a9a]">
                {viewModel.summary.ifcClass}
              </span>
              <span className="inline-flex items-center rounded-full border border-[color:var(--viewer-border)] bg-white/80 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--muted-ink)]">
                {viewModel.summary.localIdLabel}
              </span>
              {viewModel.summary.issueCount > 0 ? (
                <span className="inline-flex items-center rounded-full border border-[#d8af80] bg-[#fff7ed] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#915217]">
                  {viewModel.summary.issueCount} issue{viewModel.summary.issueCount === 1 ? "" : "s"}
                </span>
              ) : null}
            </div>
            <h2 className="mt-3 break-words text-base font-semibold text-[color:var(--foreground)]">
              {viewModel.summary.title}
            </h2>
            {viewModel.summary.subtitle ? (
              <div className="mt-1 text-sm text-[color:var(--muted-ink)]">{viewModel.summary.subtitle}</div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 text-xs uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
          Model {inspection.modelId} · Local ID {viewModel.summary.localIdLabel}
        </div>
      </section>

      <ValidationSummaryBanner summary={inspection.validationSummary} onOpenDetails={onOpenDetails} />

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
            Key Attributes
          </div>
          <button
            type="button"
            onClick={onToggleShowEmptyRows}
            className="text-[11px] font-semibold text-[#244a9a] transition hover:text-[#1d3f82]"
          >
            {showEmptyRows ? "Hide empty attributes" : "Show empty attributes"}
          </button>
        </div>

        {viewModel.keyAttributeRows.length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]">
            <div className="divide-y divide-[color:var(--viewer-border)]">
              {viewModel.keyAttributeRows.map((row) => (
                <InspectionRowView key={row.key} row={row} onOpenDetails={onOpenDetails} />
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[color:var(--viewer-border)] bg-white/35 px-3 py-3 text-sm text-[color:var(--muted-ink)]">
            No high-value attributes are available for this element.
          </div>
        )}

        {!showEmptyRows && viewModel.hiddenEmptyRowCount > 0 ? (
          <div className="text-xs text-[color:var(--muted-ink)]">
            {viewModel.hiddenEmptyRowCount} empty attribute{viewModel.hiddenEmptyRowCount === 1 ? "" : "s"} hidden to keep this panel focused.
          </div>
        ) : null}
      </section>

      {viewModel.graphContextRows.length > 0 ? (
        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
            Graph Context
          </div>
          <InsightMetricList rows={viewModel.graphContextRows} />
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
          Property Sets
        </div>

        {viewModel.propertySets.length > 0 ? (
          <div className="space-y-2">
            {viewModel.propertySets.map((group) => (
              <PropertySetGroup key={group.key} group={group} onOpenDetails={onOpenDetails} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[color:var(--viewer-border)] bg-white/35 px-3 py-3 text-sm text-[color:var(--muted-ink)]">
            No populated property sets were found for this element.
          </div>
        )}
      </section>

      {viewModel.rawAttributeRows.length > 0 ? (
        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
            Raw Identifiers
          </div>
          <div className="overflow-hidden rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]">
            <div className="divide-y divide-[color:var(--viewer-border)]">
              {viewModel.rawAttributeRows.map((row) => (
                <InspectionRowView key={row.key} row={row} onOpenDetails={onOpenDetails} />
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

type PropertiesPanelProps = {
  embedded?: boolean;
  details: ViewerSelectionDetails;
};

export function PropertiesPanel({ embedded = false, details }: PropertiesPanelProps) {
  const selectionKey = details.selection
    ? `${details.selection.modelId}:${details.selection.localId}`
    : "none";
  const [popupPayload, setPopupPayload] = useState<ValidationPopupPayload | null>(null);
  const [showEmptyRowsBySelection, setShowEmptyRowsBySelection] = useState<Record<string, boolean>>({});
  const popupRef = useRef<HTMLDivElement | null>(null);
  const activePopup = popupPayload?.selectionKey === selectionKey ? popupPayload : null;
  const showEmptyRows = showEmptyRowsBySelection[selectionKey] ?? false;

  useEffect(() => {
    if (!activePopup) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!popupRef.current?.contains(event.target as Node)) {
        setPopupPayload(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPopupPayload(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePopup]);

  const openValidationPopup = (payload: Omit<ValidationPopupPayload, "selectionKey">) => {
    setPopupPayload({
      ...payload,
      selectionKey,
    });
  };

  return (
    <aside
      className={`flex h-full min-h-0 flex-col overflow-hidden ${
        embedded
          ? "relative bg-[color:var(--panel-bg)]/92"
          : "relative rounded-[1.75rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)]"
      }`}
    >
      {activePopup ? (
        <div ref={popupRef}>
          <ValidationDetailsPopup
            payload={activePopup}
            onClose={() => setPopupPayload(null)}
          />
        </div>
      ) : null}

      <div
        className={`border-b border-[color:var(--viewer-border)] px-3 py-3 ${
          embedded ? "pl-12" : ""
        }`}
      >
        <h1 className="text-lg font-semibold text-[color:var(--foreground)]">Properties</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!details.selection ? (
          <EmptySelectionState />
        ) : details.loading && !details.inspection ? (
          <LoadingState selection={details.selection} />
        ) : details.inspection ? (
          <InspectionContent
            details={details}
            showEmptyRows={showEmptyRows}
            onToggleShowEmptyRows={() =>
              setShowEmptyRowsBySelection((current) => ({
                ...current,
                [selectionKey]: !(current[selectionKey] ?? false),
              }))
            }
            onOpenDetails={openValidationPopup}
          />
        ) : (
          <UnavailableState selection={details.selection} />
        )}
      </div>
    </aside>
  );
}
