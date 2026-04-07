"use client";

import {
  CircleOff,
  EyeOff,
  Focus,
  LayoutGrid,
  type LucideIcon,
  MousePointer2,
  Ruler,
  ScanSearch,
  Slice,
} from "lucide-react";
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

function iconClassName(selected = false) {
  return selected
    ? "text-[color:var(--accent-ink)]"
    : "text-[color:var(--muted-ink)] group-hover:text-[color:var(--foreground)]";
}

const toolIcons: Record<ViewerTool, LucideIcon> = {
  select: MousePointer2,
  measure: Ruler,
  section: Slice,
};

type ActionButtonProps = {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

function ActionButton({ label, disabled, onClick, children }: ActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="group flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl bg-[color:var(--surface-strong)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

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
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start justify-between gap-2 p-2 sm:p-3">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/95 px-2 py-2 shadow-[var(--viewer-shadow)] backdrop-blur">
        {Object.entries(toolLabels).map(([tool, label]) => {
          const selected = session.activeTool === tool;
          const Icon = toolIcons[tool as ViewerTool];

          return (
            <button
              key={tool}
              type="button"
              aria-label={label}
              title={label}
              disabled={disabled}
              onClick={() => onToolChange(tool as ViewerTool)}
              className={`group flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl transition ${
                selected
                  ? "bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
                  : "bg-transparent text-[color:var(--muted-ink)] hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Icon className={`h-4 w-4 ${iconClassName(selected)}`} />
            </button>
          );
        })}
      </div>

      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/95 px-2 py-2 shadow-[var(--viewer-shadow)] backdrop-blur">
        <ActionButton
          label="Focus selection"
          disabled={disabled || !session.selected}
          onClick={onFocusSelection}
        >
          <Focus className="h-4 w-4" />
        </ActionButton>
        <ActionButton
          label="Hide selection"
          disabled={disabled || !session.selected}
          onClick={onHideSelection}
        >
          <EyeOff className="h-4 w-4" />
        </ActionButton>
        <ActionButton
          label="Isolate selection"
          disabled={disabled || !session.selected}
          onClick={onIsolateSelection}
        >
          <ScanSearch className="h-4 w-4" />
        </ActionButton>
        <ActionButton label="Show all" disabled={disabled} onClick={onShowAll}>
          <LayoutGrid className="h-4 w-4" />
        </ActionButton>
        <ActionButton
          label="Clear sections"
          disabled={disabled || session.sectionCount === 0}
          onClick={onClearSections}
        >
          <CircleOff className="h-4 w-4" />
        </ActionButton>
        <ActionButton
          label="Clear measurements"
          disabled={disabled || session.measurementCount === 0}
          onClick={onClearMeasurements}
        >
          <CircleOff className="h-4 w-4" />
        </ActionButton>
      </div>

      <div className="pointer-events-auto min-w-0 rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/95 px-3 py-2 shadow-[var(--viewer-shadow)] backdrop-blur">
        <div className="max-w-[min(28rem,60vw)] truncate text-sm font-medium text-[color:var(--foreground)]">
          {status.message}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[color:var(--muted-ink)]">
          <span>{session.selected ? `Selected: ${session.selected.label}` : "No selection"}</span>
          <span>{session.sectionCount} sections</span>
          <span>{session.measurementCount} measures</span>
          <span>{session.hiddenItemCount} hidden</span>
        </div>
      </div>
    </div>
  );
}
