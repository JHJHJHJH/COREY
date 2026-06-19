"use client";

import { useState, type ReactNode } from "react";
import type { ViewerDebugValue } from "@/features/viewer/types";

type StatusInspectorProps = {
  /** Whether the inspector is expanded. Controlled by the parent StatusBar. */
  open: boolean;
  /** Ties the panel to its toggle button for assistive tech. */
  id: string;
  /** Which edge carries the divider toward the bar (default "bottom"). */
  borderSide?: "top" | "bottom";
  children: ReactNode;
};

/**
 * Collapsible detail surface that expands upward from the bottom status bar.
 * Uses the grid-rows 1fr/0fr trick so the reveal animates height without a
 * fixed max-height, and respects reduced-motion via `motion-reduce`.
 */
export function StatusInspector({ open, id, borderSide = "bottom", children }: StatusInspectorProps) {
  return (
    <div
      id={id}
      className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        <div
          className={`max-h-[60vh] overflow-auto bg-[color:var(--panel-bg)] px-4 py-3 ${
            borderSide === "top" ? "border-t" : "border-b"
          } border-[color:var(--viewer-border)]`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export type InspectorDetail = {
  label: string;
  value: ReactNode;
};

type InspectorDetailListProps = {
  items: InspectorDetail[];
};

/**
 * Labeled key/value list for the lighter inspectors (data table, clauses,
 * report) that surface internal fields without a full JSON dump.
 */
export function InspectorDetailList({ items }: InspectorDetailListProps) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="font-semibold tracking-[0.04em] text-[color:var(--muted-ink)] uppercase">
            {item.label}
          </dt>
          <dd className="min-w-0 break-words text-[color:var(--foreground)]">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type JsonInspectorTab = {
  id: string;
  label: string;
  value: ViewerDebugValue | null;
  emptyMessage: string;
};

type JsonInspectorTabsProps = {
  tabs: JsonInspectorTab[];
};

/**
 * Tabbed JSON viewer extracted from the former floating DebugPanel. Each tab
 * pretty-prints a `ViewerDebugValue` into a themed <pre>, or shows guidance
 * when the value is absent.
 */
export function JsonInspectorTabs({ tabs }: JsonInspectorTabsProps) {
  const [activeId, setActiveId] = useState(() => tabs[0]?.id);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  if (!active) {
    return null;
  }

  const formattedValue = active.value != null ? JSON.stringify(active.value, null, 2) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const selected = tab.id === active.id;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveId(tab.id)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-[0.08em] transition ${
                selected
                  ? "border-[color:var(--accent)] bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
                  : "border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] text-[color:var(--muted-ink)] hover:text-[color:var(--foreground)]"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {formattedValue ? (
        <pre className="max-h-[24rem] overflow-auto rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--debug-code-bg)] p-3 text-[11px] leading-5 break-all whitespace-pre-wrap text-[color:var(--debug-code-fg)]">
          {formattedValue}
        </pre>
      ) : (
        <div className="rounded-xl border border-dashed border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-4 text-sm text-[color:var(--muted-ink)]">
          {active.emptyMessage}
        </div>
      )}
    </div>
  );
}
