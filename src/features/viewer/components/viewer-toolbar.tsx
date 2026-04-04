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

function iconClassName(selected = false) {
  return selected
    ? "text-[color:var(--accent-ink)]"
    : "text-[color:var(--muted-ink)] group-hover:text-[color:var(--foreground)]";
}

function SelectIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="m6 4 11 7-6 1.5L9.5 18z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MeasureIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M5 15.5 15.5 5 19 8.5 8.5 19H5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m11 9 4 4" strokeLinecap="round" />
    </svg>
  );
}

function SectionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M4 18 18 4" strokeLinecap="round" />
      <path d="M7 19h10a2 2 0 0 0 2-2V7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 5h6" strokeLinecap="round" />
    </svg>
  );
}

function FocusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M9 5H5v4M15 5h4v4M19 15v4h-4M9 19H5v-4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

function HideIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M4 12s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m4 4 16 16" strokeLinecap="round" />
    </svg>
  );
}

function IsolateIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="4.5" y="4.5" width="15" height="15" rx="2.5" />
      <rect x="9" y="9" width="6" height="6" rx="1.25" />
    </svg>
  );
}

function ShowAllIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.25" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.25" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="1.25" />
      <rect x="13.5" y="13.5" width="6" height="6" rx="1.25" />
    </svg>
  );
}

function ClearSectionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M4 18 18 4" strokeLinecap="round" />
      <path d="m7 17 3-3M14 10l3-3" strokeLinecap="round" />
      <path d="m6 6 12 12" strokeLinecap="round" />
    </svg>
  );
}

function ClearMeasureIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M5 15.5 15.5 5 19 8.5 8.5 19H5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6l12 12" strokeLinecap="round" />
    </svg>
  );
}

const toolIcons: Record<ViewerTool, (props: { className?: string }) => React.JSX.Element> = {
  select: SelectIcon,
  measure: MeasureIcon,
  section: SectionIcon,
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
      className="group flex h-9 w-9 items-center justify-center rounded-xl bg-[color:var(--surface-strong)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
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
              className={`group flex h-9 w-9 items-center justify-center rounded-xl transition ${
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
          <FocusIcon className="h-4 w-4" />
        </ActionButton>
        <ActionButton
          label="Hide selection"
          disabled={disabled || !session.selected}
          onClick={onHideSelection}
        >
          <HideIcon className="h-4 w-4" />
        </ActionButton>
        <ActionButton
          label="Isolate selection"
          disabled={disabled || !session.selected}
          onClick={onIsolateSelection}
        >
          <IsolateIcon className="h-4 w-4" />
        </ActionButton>
        <ActionButton label="Show all" disabled={disabled} onClick={onShowAll}>
          <ShowAllIcon className="h-4 w-4" />
        </ActionButton>
        <ActionButton
          label="Clear sections"
          disabled={disabled || session.sectionCount === 0}
          onClick={onClearSections}
        >
          <ClearSectionIcon className="h-4 w-4" />
        </ActionButton>
        <ActionButton
          label="Clear measurements"
          disabled={disabled || session.measurementCount === 0}
          onClick={onClearMeasurements}
        >
          <ClearMeasureIcon className="h-4 w-4" />
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
