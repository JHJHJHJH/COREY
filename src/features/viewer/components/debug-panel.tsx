"use client";

import { Bug, ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";
import type { ModelMetadata, ViewerDebugValue } from "@/features/viewer/types";

type DebugTabId = "raw" | "selection" | "row" | "tree";

type DebugPanelProps = {
  metadata: ModelMetadata | null;
  rawItemSample: ViewerDebugValue | null;
  rawItemLabel: string;
  selectionSample: ViewerDebugValue | null;
  rowSample: ViewerDebugValue | null;
  treeSample: ViewerDebugValue | null;
};

type DebugTab = {
  id: DebugTabId;
  label: string;
  value: ViewerDebugValue | null;
  emptyMessage: string;
};

export function DebugPanel({
  metadata,
  rawItemSample,
  rawItemLabel,
  selectionSample,
  rowSample,
  treeSample,
}: DebugPanelProps) {
  const [open, setOpen] = useState(true);
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
    <aside className="pointer-events-auto absolute right-3 bottom-3 z-20 w-[min(30rem,calc(100vw-2.5rem))]">
      <div className="overflow-hidden rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]/96 shadow-[var(--viewer-shadow)] backdrop-blur">
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
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Collapse debug panel" : "Expand debug panel"}
            title={open ? "Collapse debug panel" : "Expand debug panel"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[color:var(--surface-strong)] text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>

        {open ? (
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
              <pre className="max-h-[24rem] overflow-auto rounded-xl border border-[color:var(--viewer-border)] bg-[#f6f0e6] p-3 text-[11px] leading-5 whitespace-pre-wrap break-all text-[#30261e]">
                {formattedValue}
              </pre>
            ) : (
              <div className="rounded-xl border border-dashed border-[color:var(--viewer-border)] bg-white/35 px-3 py-4 text-sm text-[color:var(--muted-ink)]">
                {active.emptyMessage}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
