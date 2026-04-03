"use client";

import type { ViewerSessionState, ViewerStatus, ViewerTool } from "@/features/viewer/types";

type ViewerToolbarProps = {
  disabled: boolean;
  session: ViewerSessionState;
  status: ViewerStatus;
  onToolChange: (tool: ViewerTool) => void;
  onFocusSelection: () => void;
  onShowAll: () => void;
  onHideSelection: () => void;
  onIsolateSelection: () => void;
  onClearSections: () => void;
  onClearMeasurements: () => void;
};

const toolLabels: Record<ViewerTool, string> = {
  select: "Select",
  measure: "Measure",
  section: "Section",
};

export function ViewerToolbar({
  disabled,
  session,
  status,
  onToolChange,
  onFocusSelection,
  onShowAll,
  onHideSelection,
  onIsolateSelection,
  onClearSections,
  onClearMeasurements,
}: ViewerToolbarProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-3 p-3">
      <div className="pointer-events-auto inline-flex flex-wrap gap-2 rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/95 p-2 shadow-[var(--viewer-shadow)] backdrop-blur">
        {Object.entries(toolLabels).map(([tool, label]) => {
          const selected = session.activeTool === tool;

          return (
            <button
              key={tool}
              type="button"
              disabled={disabled}
              onClick={() => onToolChange(tool as ViewerTool)}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                selected
                  ? "bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
                  : "bg-transparent text-[color:var(--muted-ink)] hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/95 p-2 shadow-[var(--viewer-shadow)] backdrop-blur">
        <button
          type="button"
          disabled={disabled || !session.selected}
          onClick={onFocusSelection}
          className="rounded-xl bg-[color:var(--surface-strong)] px-3 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Focus
        </button>
        <button
          type="button"
          disabled={disabled || !session.selected}
          onClick={onHideSelection}
          className="rounded-xl bg-[color:var(--surface-strong)] px-3 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Hide
        </button>
        <button
          type="button"
          disabled={disabled || !session.selected}
          onClick={onIsolateSelection}
          className="rounded-xl bg-[color:var(--surface-strong)] px-3 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Isolate
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onShowAll}
          className="rounded-xl bg-[color:var(--surface-strong)] px-3 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Show all
        </button>
        <button
          type="button"
          disabled={disabled || session.sectionCount === 0}
          onClick={onClearSections}
          className="rounded-xl bg-[color:var(--surface-strong)] px-3 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear sections
        </button>
        <button
          type="button"
          disabled={disabled || session.measurementCount === 0}
          onClick={onClearMeasurements}
          className="rounded-xl bg-[color:var(--surface-strong)] px-3 py-2 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear measures
        </button>
      </div>

      <div className="pointer-events-auto rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/95 px-4 py-3 shadow-[var(--viewer-shadow)] backdrop-blur">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
          Viewer Status
        </div>
        <div className="mt-1 text-sm font-medium text-[color:var(--foreground)]">{status.message}</div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-[color:var(--muted-ink)]">
          <span>{session.selected ? `Selected: ${session.selected.label}` : "No selection"}</span>
          <span>{session.sectionCount} sections</span>
          <span>{session.measurementCount} measures</span>
          <span>{session.hiddenItemCount} hidden</span>
        </div>
      </div>
    </div>
  );
}
