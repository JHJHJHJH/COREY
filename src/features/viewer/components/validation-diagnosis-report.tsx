"use client";

import { CircleAlert, FileSpreadsheet, History, X } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ModelMetadata,
  ViewerSelection,
  ViewerValidationDiagnosisClause,
  ViewerValidationDiagnosisElement,
  ViewerValidationDiagnosisReport,
  ViewerValidationReportSummary,
} from "@/features/viewer/types";

type ValidationDiagnosisReportProps = {
  metadata: ModelMetadata | null;
  report: ViewerValidationDiagnosisReport | null;
  currentReport: ViewerValidationDiagnosisReport | null;
  savedReports: ViewerValidationReportSummary[];
  activeSavedReportId: string | null;
  validationPhase: "idle" | "running" | "ready" | "error";
  validationMessage: string;
  statusMessage?: string;
  activeSelection: ViewerSelection | null;
  onExport: () => void;
  onShowClauseInTable: (clauseId: string) => void;
  onUseCurrentReport: () => void;
  onRestoreReport: (reportId: string) => void;
  onSelectElement: (element: ViewerValidationDiagnosisElement) => void;
  onClose: () => void;
};

function severityTone(result: "warn" | "error") {
  return result === "error"
    ? "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]"
    : "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]";
}

function formatSavedReportDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function SavedReportPicker({
  currentReport,
  savedReports,
  activeSavedReportId,
  onUseCurrentReport,
  onRestoreReport,
}: {
  currentReport: ViewerValidationDiagnosisReport | null;
  savedReports: ViewerValidationReportSummary[];
  activeSavedReportId: string | null;
  onUseCurrentReport: () => void;
  onRestoreReport: (reportId: string) => void;
}) {
  if (!currentReport && savedReports.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 border-t border-[color:var(--viewer-border)] pt-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
        <History className="h-3.5 w-3.5" />
        Saved Runs
      </div>
      <div className="mt-2 flex max-w-full gap-2 overflow-x-auto pb-1">
        {currentReport ? (
          <button
            type="button"
            onClick={onUseCurrentReport}
            className={`shrink-0 rounded-xl border px-3 py-2 text-left text-xs transition ${
              activeSavedReportId
                ? "border-[color:var(--viewer-border)] bg-white/70 text-[color:var(--foreground)] hover:bg-[color:var(--surface-strong)]"
                : "border-[color:var(--success-border)] bg-[color:var(--success-bg)] text-[color:var(--success-fg)]"
            }`}
          >
            <div className="font-semibold">Current Run</div>
            <div className="mt-1 text-[11px] opacity-80">
              {currentReport.flaggedElementCount} flagged · {currentReport.failedClauseCount} clauses
            </div>
          </button>
        ) : null}
        {savedReports.map((savedReport) => (
          <button
            key={savedReport.reportId}
            type="button"
            onClick={() => onRestoreReport(savedReport.reportId)}
            className={`shrink-0 rounded-xl border px-3 py-2 text-left text-xs transition ${
              activeSavedReportId === savedReport.reportId
                ? "border-[color:var(--success-border)] bg-[color:var(--success-bg)] text-[color:var(--success-fg)]"
                : "border-[color:var(--viewer-border)] bg-white/70 text-[color:var(--foreground)] hover:bg-[color:var(--surface-strong)]"
            }`}
          >
            <div className="font-semibold">{formatSavedReportDate(savedReport.createdAt)}</div>
            <div className="mt-1 text-[11px] opacity-80">
              {savedReport.flaggedElementCount} flagged · {savedReport.failedClauseCount} clauses
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function summaryCard({
  label,
  value,
  tone = "border-[color:var(--viewer-border)] bg-white/70 text-[color:var(--foreground)]",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <section className={`rounded-[1.25rem] border px-4 py-4 ${tone}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </section>
  );
}

function EmptyState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="max-w-2xl rounded-[1.5rem] border border-dashed border-[color:var(--viewer-border)] bg-white/55 px-8 py-8 text-center">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
          Clause Diagnosis
        </div>
        <div className="mt-3 text-xl font-semibold text-[color:var(--foreground)]">{title}</div>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted-ink)]">{message}</p>
      </div>
    </div>
  );
}

function ClauseListItem({
  clause,
  active,
  onSelect,
}: {
  clause: ViewerValidationDiagnosisClause;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-[1.1rem] border px-3 py-3 text-left transition ${
        active
          ? severityTone(clause.result)
          : "border-[color:var(--viewer-border)] bg-white/70 text-[color:var(--foreground)] hover:bg-[color:var(--surface-strong)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold">{clause.clauseTitle}</div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.16em] opacity-80">
            {clause.result} · {clause.ruleDescriptions.length} checks
          </div>
        </div>
        <div className="shrink-0 rounded-full border border-current/15 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]">
          {clause.elementCount}
        </div>
      </div>
    </button>
  );
}

function ClauseDetails({
  clause,
  activeSelection,
  onExport,
  onShowClauseInTable,
  onSelectElement,
}: {
  clause: ViewerValidationDiagnosisClause;
  activeSelection: ViewerSelection | null;
  onExport: () => void;
  onShowClauseInTable: (clauseId: string) => void;
  onSelectElement: (element: ViewerValidationDiagnosisElement) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <section className="rounded-[1.25rem] border border-[color:var(--viewer-border)] bg-white/70 px-4 py-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-[color:var(--foreground)]">
                {clause.clauseTitle}
              </h2>
              <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${severityTone(clause.result)}`}>
                {clause.result}
              </span>
            </div>
            <div className="mt-2 text-sm text-[color:var(--muted-ink)]">
              {clause.elementCount} failing element{clause.elementCount === 1 ? "" : "s"} ·{" "}
              {clause.ruleDescriptions.length} failed check
              {clause.ruleDescriptions.length === 1 ? "" : "s"}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onShowClauseInTable(clause.clauseId)}
              className="rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
            >
              View In Table
            </button>
            <button
              type="button"
              onClick={() => onSelectElement(clause.elements[0])}
              className="rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
            >
              Focus First Element
            </button>
            <button
              type="button"
              onClick={onExport}
              className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export Excel
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          {clause.ruleDescriptions.map((description) => (
            <div
              key={description}
              className="rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2 text-sm text-[color:var(--foreground)]"
            >
              {description}
            </div>
          ))}
        </div>
      </section>

      <section className="min-h-0 flex-1 overflow-hidden rounded-[1.25rem] border border-[color:var(--viewer-border)] bg-white/70">
        <div className="border-b border-[color:var(--viewer-border)] px-4 py-3">
          <div className="text-sm font-semibold text-[color:var(--foreground)]">Failing Elements</div>
          <div className="mt-1 text-xs text-[color:var(--muted-ink)]">
            Select a row to jump to the element in the model and inspect its properties.
          </div>
        </div>

        <div className="min-h-0 overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-left">
            <thead className="sticky top-0 z-10 bg-[color:var(--panel-bg)]">
              <tr>
                <th className="border-b border-[color:var(--viewer-border)] px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
                  Element
                </th>
                <th className="border-b border-[color:var(--viewer-border)] px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
                  IFC Type
                </th>
                <th className="border-b border-[color:var(--viewer-border)] px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
                  GlobalId
                </th>
                <th className="border-b border-[color:var(--viewer-border)] px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
                  Local ID
                </th>
                <th className="border-b border-[color:var(--viewer-border)] px-3 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
                  Failed Checks
                </th>
              </tr>
            </thead>
            <tbody>
              {clause.elements.map((element) => {
                const selected =
                  activeSelection?.modelId === element.modelId &&
                  activeSelection?.localId === element.localId;

                return (
                  <tr
                    key={`${element.modelId}:${element.localId}`}
                    onClick={() => onSelectElement(element)}
                    className={`cursor-pointer transition hover:bg-white/55 ${
                      selected ? "bg-[#e7f3ee]" : "bg-transparent"
                    }`}
                  >
                    <td className="border-b border-[color:var(--viewer-border)] px-3 py-3 align-top">
                      <div className="font-medium text-[color:var(--foreground)]">{element.label}</div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
                        {element.result}
                        {element.category ? ` · ${element.category}` : ""}
                      </div>
                    </td>
                    <td className="border-b border-[color:var(--viewer-border)] px-3 py-3 align-top text-sm text-[color:var(--foreground)]">
                      {element.ifcType ?? "—"}
                    </td>
                    <td className="border-b border-[color:var(--viewer-border)] px-3 py-3 align-top font-mono text-[12px] text-[color:var(--foreground)]">
                      {element.globalId ?? "—"}
                    </td>
                    <td className="border-b border-[color:var(--viewer-border)] px-3 py-3 align-top text-sm text-[color:var(--foreground)]">
                      #{element.localId}
                    </td>
                    <td className="border-b border-[color:var(--viewer-border)] px-3 py-3 align-top text-sm text-[color:var(--foreground)]">
                      {element.failedRuleDescriptions.join(" · ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function ValidationDiagnosisReport({
  metadata,
  report,
  currentReport,
  savedReports,
  activeSavedReportId,
  validationPhase,
  validationMessage,
  statusMessage = "",
  activeSelection,
  onExport,
  onShowClauseInTable,
  onUseCurrentReport,
  onRestoreReport,
  onSelectElement,
  onClose,
}: ValidationDiagnosisReportProps) {
  const [selectedClauseId, setSelectedClauseId] = useState("");
  const effectiveSelectedClauseId =
    report?.clauses.some((clause) => clause.clauseId === selectedClauseId)
      ? selectedClauseId
      : report?.clauses[0]?.clauseId ?? "";

  const activeClause = useMemo(
    () => report?.clauses.find((clause) => clause.clauseId === effectiveSelectedClauseId) ?? null,
    [effectiveSelectedClauseId, report],
  );

  return (
    <div className="flex h-screen min-h-0 flex-col bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="border-b border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/95 px-5 py-4 backdrop-blur">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CircleAlert className="h-5 w-5 text-[color:var(--danger-fg)]" />
              <h1 className="text-xl font-semibold tracking-tight">Clause Diagnosis Report</h1>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted-ink)]">
              <span className="rounded-full border border-[color:var(--viewer-border)] bg-white/75 px-3 py-1.5">
                {metadata?.name ?? "No model loaded"}
              </span>
              <span className="rounded-full border border-[color:var(--viewer-border)] bg-white/75 px-3 py-1.5">
                Validation {validationPhase}
              </span>
              <span className="rounded-full border border-[color:var(--viewer-border)] bg-white/75 px-3 py-1.5">
                {validationMessage}
              </span>
            </div>
            {statusMessage ? (
              <div className="mt-2 text-xs text-[color:var(--muted-ink)]">{statusMessage}</div>
            ) : null}
            <SavedReportPicker
              currentReport={currentReport}
              savedReports={savedReports}
              activeSavedReportId={activeSavedReportId}
              onUseCurrentReport={onUseCurrentReport}
              onRestoreReport={onRestoreReport}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onExport}
              disabled={!report || report.flaggedElementCount === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-2 text-sm font-medium text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
            >
              <X className="h-4 w-4" />
              Close
            </button>
          </div>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden px-5 py-5">
        {!metadata ? (
          <EmptyState
            title="Load a model to diagnose clause errors"
            message="The diagnosis report uses the current validation result and model rows. Open an IFC file and run validation first."
          />
        ) : validationPhase === "running" && !activeSavedReportId ? (
          <EmptyState
            title="Validation is still running"
            message={validationMessage}
          />
        ) : validationPhase === "error" && !activeSavedReportId ? (
          <EmptyState
            title="Validation could not be completed"
            message={validationMessage}
          />
        ) : !report || report.flaggedElementCount === 0 ? (
          <EmptyState
            title="No clause errors to diagnose"
            message={validationMessage}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col gap-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {summaryCard({
                label: "Failed Clauses",
                value: String(report.failedClauseCount),
                tone: "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]",
              })}
              {summaryCard({
                label: "Flagged Elements",
                value: String(report.flaggedElementCount),
              })}
              {summaryCard({
                label: "Error Elements",
                value: String(report.errorElementCount),
                tone: "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]",
              })}
              {summaryCard({
                label: "Warn Elements",
                value: String(report.warnElementCount),
                tone: "border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]",
              })}
            </div>

            <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
              <section className="min-h-0 overflow-hidden rounded-[1.25rem] border border-[color:var(--viewer-border)] bg-white/70">
                <div className="border-b border-[color:var(--viewer-border)] px-4 py-3">
                  <div className="text-sm font-semibold text-[color:var(--foreground)]">Clauses</div>
                  <div className="mt-1 text-xs text-[color:var(--muted-ink)]">
                    Select a clause to review failing elements and navigate to the model.
                  </div>
                </div>
                <div className="max-h-full space-y-2 overflow-y-auto px-3 py-3">
                  {report.clauses.map((clause) => (
                    <ClauseListItem
                      key={clause.clauseId}
                      clause={clause}
                      active={activeClause?.clauseId === clause.clauseId}
                      onSelect={() => setSelectedClauseId(clause.clauseId)}
                    />
                  ))}
                </div>
              </section>

              {activeClause ? (
                <ClauseDetails
                  clause={activeClause}
                  activeSelection={activeSelection}
                  onExport={onExport}
                  onShowClauseInTable={onShowClauseInTable}
                  onSelectElement={onSelectElement}
                />
              ) : (
                <EmptyState
                  title="Select a clause to begin diagnosis"
                  message="Each clause groups failing elements and the checks they broke."
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
