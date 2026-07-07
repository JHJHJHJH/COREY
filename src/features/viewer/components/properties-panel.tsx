"use client";

import { CircleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { inspectionTargetKey } from "@/features/viewer/lib/ifc-data";
import type {
  ViewerElementInspection,
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

/** Version-diff status of a row: red = removed, green = added, orange = modified. */
export type PropertyDiffTone = "added" | "removed" | "modified";

const diffToneRowBg: Record<PropertyDiffTone, string> = {
  added: "bg-[color:var(--success-bg)]",
  removed: "bg-[color:var(--danger-bg)]",
  modified: "bg-[color:var(--warning-bg)]",
};

const diffToneRowFg: Record<PropertyDiffTone, string> = {
  added: "text-[color:var(--success-fg)]",
  removed: "text-[color:var(--danger-fg)]",
  modified: "text-[color:var(--warning-fg)]",
};

const diffToneBadge: Record<PropertyDiffTone, string> = {
  added:
    "border-[color:var(--success-border)] bg-[color:var(--success-bg)] text-[color:var(--success-fg)]",
  removed:
    "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]",
  modified:
    "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]",
};

const diffToneLabel: Record<PropertyDiffTone, string> = {
  added: "added",
  removed: "removed",
  modified: "changed",
};

function rowClass(value: ViewerInspectionValue, tone: PropertyDiffTone | null) {
  if (value.validation?.result === "ok") {
    return "bg-[color:var(--success-bg)]";
  }

  if (value.validation?.result === "warn") {
    return "bg-[color:var(--warning-bg)]";
  }

  if (value.validation?.result === "error") {
    return "bg-[color:var(--danger-bg)]";
  }

  if (tone) {
    return diffToneRowBg[tone];
  }

  return "bg-[color:var(--surface-soft)]";
}

function valueClass(value: ViewerInspectionValue, tone: PropertyDiffTone | null) {
  if (value.validation?.result === "ok") {
    return "text-[color:var(--success-fg)]";
  }

  if (value.validation?.result === "warn") {
    return "text-[color:var(--warning-fg)]";
  }

  if (value.validation?.result === "error") {
    return "text-[color:var(--danger-fg)]";
  }

  if (tone) {
    return diffToneRowFg[tone];
  }

  return "text-[color:var(--foreground)]";
}

export function DiffBadge({ tone, count }: { tone: PropertyDiffTone; count?: number }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${diffToneBadge[tone]}`}
    >
      {count !== undefined ? `${count} ` : ""}
      {diffToneLabel[tone]}
    </span>
  );
}

function summaryFlagClass(result: ViewerValidationMatch["result"]) {
  if (result === "ok") {
    return "border-[color:var(--success-border)] bg-[color:var(--success-bg)] text-[color:var(--success-fg)]";
  }

  if (result === "warn") {
    return "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]";
  }

  return "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]";
}

function popupTone(result: ValidationPopupPayload["result"]) {
  if (result === "error") {
    return "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]";
  }

  if (result === "warn") {
    return "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]";
  }

  return "border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] text-[color:var(--foreground)]";
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
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"
      aria-label={title}
      title={title}
    >
      <CircleAlert className="h-3.5 w-3.5" />
    </button>
  );
}

function ValidationSummaryFlag({
  label,
  result,
  count,
}: {
  label: string;
  result: ViewerValidationMatch["result"];
  count: number;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${summaryFlagClass(result)}`}
    >
      {count} {label}
    </span>
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
  tone = null,
  onOpenDetails,
}: {
  label: string;
  value: ViewerInspectionValue;
  tone?: PropertyDiffTone | null;
  onOpenDetails: (payload: Omit<ValidationPopupPayload, "selectionKey">) => void;
}) {
  const failedClauseCount = value.validation?.clauseFailures.length ?? 0;
  const validation = value.validation;

  return (
    <div
      className={`grid gap-1.5 px-2.5 py-1.5 md:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] md:items-start md:gap-x-3 ${rowClass(value, tone)}`}
    >
      <div className="min-w-0 break-words text-xs font-semibold tracking-[0.08em] [overflow-wrap:anywhere] text-[color:var(--muted-ink)]">
        {label}
      </div>
      <div className="flex min-w-0 flex-wrap items-start gap-2 md:flex-nowrap md:justify-between">
        <div
          className={`min-w-0 flex-1 break-words text-sm leading-6 [overflow-wrap:anywhere] ${valueClass(value, tone)}`}
        >
          {value.text}
        </div>
        {tone ? <DiffBadge tone={tone} /> : null}
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

function rowDiffTone(
  row: ViewerInspectionRow,
  highlightTargets?: ReadonlyMap<string, PropertyDiffTone> | null,
): PropertyDiffTone | null {
  if (!row.target || !highlightTargets) {
    return null;
  }

  return highlightTargets.get(inspectionTargetKey(row.target)) ?? null;
}

function InspectionRowView({
  row,
  highlightTargets,
  onOpenDetails,
}: {
  row: ViewerInspectionRow;
  highlightTargets?: ReadonlyMap<string, PropertyDiffTone> | null;
  onOpenDetails: (payload: Omit<ValidationPopupPayload, "selectionKey">) => void;
}) {
  return (
    <InspectionValueRow
      label={row.label}
      value={row.value}
      tone={rowDiffTone(row, highlightTargets)}
      onOpenDetails={onOpenDetails}
    />
  );
}

function PropertySetGroup({
  group,
  highlightTargets,
  onOpenDetails,
}: {
  group: ViewerInspectionGroup;
  highlightTargets?: ReadonlyMap<string, PropertyDiffTone> | null;
  onOpenDetails: (payload: Omit<ValidationPopupPayload, "selectionKey">) => void;
}) {
  const toneCounts: Record<PropertyDiffTone, number> = { modified: 0, added: 0, removed: 0 };
  if (highlightTargets) {
    for (const row of group.rows) {
      const tone = rowDiffTone(row, highlightTargets);
      if (tone) {
        toneCounts[tone] += 1;
      }
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]">
      <div className="flex items-start justify-between gap-2 border-b border-[color:var(--viewer-border)] px-2.5 py-2">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold text-[color:var(--foreground)]">
            {group.title}
          </h3>
          {group.subtitle ? (
            <div className="mt-1 text-[11px] tracking-[0.08em] text-[color:var(--muted-ink)]">
              {group.subtitle}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {(["modified", "added", "removed"] as const).map((tone) =>
            toneCounts[tone] > 0 ? (
              <DiffBadge key={tone} tone={tone} count={toneCounts[tone]} />
            ) : null,
          )}
        </div>
      </div>

      {group.rows.length > 0 ? (
        <div className="divide-y divide-[color:var(--viewer-border)]">
          {group.rows.map((row) => (
            <InspectionRowView
              key={row.key}
              row={row}
              highlightTargets={highlightTargets}
              onOpenDetails={onOpenDetails}
            />
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

      <div className="rounded-xl border border-dashed border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] px-3 py-3 text-sm text-[color:var(--warning-fg)]">
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
      ? "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]"
      : summary.result === "warn"
        ? "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]"
        : "border-[color:var(--success-border)] bg-[color:var(--success-bg)] text-[color:var(--success-fg)]";

  return (
    <section className={`rounded-xl border px-3 py-3 ${tone}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em]">Validation Summary</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <ValidationSummaryFlag label="error" result="error" count={summary.errorCount} />
        <ValidationSummaryFlag label="warn" result="warn" count={summary.warnCount} />
        <ValidationSummaryFlag label="ok" result="ok" count={summary.okCount} />
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

function InspectionContent({
  inspection,
  highlightTargets,
  onOpenDetails,
}: {
  inspection: ViewerElementInspection;
  highlightTargets?: ReadonlyMap<string, PropertyDiffTone> | null;
  onOpenDetails: (payload: Omit<ValidationPopupPayload, "selectionKey">) => void;
}) {
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

        <ValidationSummaryBanner summary={inspection.validationSummary} onOpenDetails={onOpenDetails} />

        <div className="overflow-hidden rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)]">
          <div className="divide-y divide-[color:var(--viewer-border)]">
            {inspection.summaryRows.map((row) => (
              <InspectionRowView
                key={row.key}
                row={row}
                highlightTargets={highlightTargets}
                onOpenDetails={onOpenDetails}
              />
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
              <PropertySetGroup
                key={group.key}
                group={group}
                highlightTargets={highlightTargets}
                onOpenDetails={onOpenDetails}
              />
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
  /** Slimmer header without the shell's floating-button inset (e.g. compare overlay sidebar). */
  compact?: boolean;
  /** Rendered on the right side of the "Properties" header row. */
  headerAccessory?: React.ReactNode;
  /** Rows keyed by `inspectionTargetKey` render with the mapped diff tone. */
  highlightTargets?: ReadonlyMap<string, PropertyDiffTone> | null;
  details: ViewerSelectionDetails;
};

export function PropertiesPanel({
  embedded = false,
  compact = false,
  headerAccessory,
  highlightTargets,
  details,
}: PropertiesPanelProps) {
  const selectionKey = details.selection
    ? `${details.selection.modelId}:${details.selection.localId}`
    : "none";
  const [popupPayload, setPopupPayload] = useState<ValidationPopupPayload | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const activePopup = popupPayload?.selectionKey === selectionKey ? popupPayload : null;

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
        embedded || compact
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
        className={`flex items-center justify-between gap-2 border-b border-[color:var(--viewer-border)] px-3 ${
          compact ? "py-2" : "py-3"
        } ${embedded && !compact ? "pl-12" : ""}`}
      >
        <h1
          className={`font-semibold text-[color:var(--foreground)] ${
            compact ? "text-xs" : "text-lg"
          }`}
        >
          Properties
        </h1>
        {headerAccessory}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {!details.selection ? (
          <EmptySelectionState />
        ) : details.loading && !details.inspection ? (
          <LoadingState selection={details.selection} />
        ) : details.inspection ? (
          <InspectionContent
            inspection={details.inspection}
            highlightTargets={highlightTargets}
            onOpenDetails={openValidationPopup}
          />
        ) : (
          <UnavailableState selection={details.selection} />
        )}
      </div>
    </aside>
  );
}
