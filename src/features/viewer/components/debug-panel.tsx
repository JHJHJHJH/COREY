"use client";

import { Bug, ChevronDown, ChevronUp, Moon, Sun } from "lucide-react";
import { useMemo, useState } from "react";
import type { ModelMetadata, ViewerDebugValue } from "@/features/viewer/types";

type DebugTabId = "raw" | "selection" | "row" | "tree";
type ViewerTheme = "light" | "dark";

type DebugPanelProps = {
  metadata: ModelMetadata | null;
  viewerTheme: ViewerTheme;
  rawItemSample: ViewerDebugValue | null;
  rawItemLabel: string;
  selectionSample: ViewerDebugValue | null;
  rowSample: ViewerDebugValue | null;
  treeSample: ViewerDebugValue | null;
  onToggleTheme: () => void;
};

type DebugTab = {
  id: DebugTabId;
  label: string;
  value: ViewerDebugValue | null;
  emptyMessage: string;
};

export function DebugPanel({
  metadata,
  viewerTheme,
  rawItemSample,
  rawItemLabel,
  selectionSample,
  rowSample,
  treeSample,
  onToggleTheme,
}: DebugPanelProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DebugTabId>("raw");

  const tabs = useMemo<DebugTab[]>(
    () => [
      {
        id: "raw",
        label: "Raw IFC",
        value: rawItemSample,
        emptyMessage: "Load a model to inspect the raw parsed IFC item payload.",
      },
      {
        id: "selection",
        label: "Selection",
        value: selectionSample,
        emptyMessage: "Select an element to inspect the normalized selection payload.",
      },
      {
        id: "row",
        label: "Row",
        value: rowSample,
        emptyMessage: "Load a model to inspect an indexed data table row.",
      },
      {
        id: "tree",
        label: "Tree",
        value: treeSample,
        emptyMessage: "Load a model to inspect a sample of the spatial tree.",
      },
    ],
    [rawItemSample, rowSample, selectionSample, treeSample],
  );

  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const formattedValue = useMemo(
    () => (active.value !== null ? JSON.stringify(active.value, null, 2) : null),
    [active.value],
  );

  return (
    <aside className="pointer-events-none absolute right-3 bottom-3 z-20 flex flex-col items-end gap-2">
      {open ? (
        <div className="pointer-events-auto w-[min(30rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/96 shadow-[var(--viewer-shadow)] backdrop-blur">
          <div className="flex items-center justify-between gap-3 border-b border-[color:var(--viewer-border)] px-3 py-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
                <Bug className="h-4 w-4" />
                IFC Debug
              </div>
              <div className="mt-1 truncate text-[11px] text-[color:var(--muted-ink)]">
                {metadata ? `${metadata.name} · ${rawItemLabel}` : "No parsed IFC data available"}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Collapse debug panel"
              title="Collapse debug panel"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[color:var(--surface-strong)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 p-3">
            <div className="flex flex-wrap gap-2">
              {tabs.map((tab) => {
                const selected = tab.id === active.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
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
              <pre className="max-h-[24rem] overflow-auto rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--debug-code-bg)] p-3 text-[11px] leading-5 whitespace-pre-wrap break-all text-[color:var(--debug-code-fg)]">
                {formattedValue}
              </pre>
            ) : (
              <div className="rounded-xl border border-dashed border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-3 py-4 text-sm text-[color:var(--muted-ink)]">
                {active.emptyMessage}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={viewerTheme === "dark" ? "Use light theme" : "Use dark theme"}
          title={viewerTheme === "dark" ? "Use light theme" : "Use dark theme"}
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/96 text-[color:var(--foreground)] shadow-[var(--viewer-shadow)] backdrop-blur transition hover:bg-[color:var(--surface-hover)]"
        >
          {viewerTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Collapse debug panel" : "Open IFC debug panel"}
          title={open ? "Collapse debug panel" : "Open IFC debug panel"}
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/96 text-[color:var(--foreground)] shadow-[var(--viewer-shadow)] backdrop-blur transition hover:bg-[color:var(--surface-hover)]"
        >
          {open ? <ChevronUp className="h-4 w-4" /> : <Bug className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  );
}
