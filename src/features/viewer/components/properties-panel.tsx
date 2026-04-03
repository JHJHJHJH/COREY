"use client";

import type { ItemAttribute, ItemData } from "@thatopen/fragments";
import type { ViewerSelectionDetails, ViewerSessionState } from "@/features/viewer/types";

function isItemAttribute(value: ItemAttribute | ItemData[]): value is ItemAttribute {
  return typeof value === "object" && value !== null && "value" in value;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function PropertyGroup({ label, data, depth = 0 }: { label: string; data: ItemData; depth?: number }) {
  const entries = Object.entries(data);

  return (
    <section
      className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] p-4"
      style={{ marginLeft: `${depth * 8}px` }}
    >
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
        {label}
      </div>
      <div className="mt-3 space-y-3">
        {entries.map(([key, value]) => {
          if (Array.isArray(value)) {
            return (
              <div key={key} className="space-y-2">
                <div className="text-sm font-semibold text-[color:var(--foreground)]">{key}</div>
                {value.length === 0 ? (
                  <div className="text-sm text-[color:var(--muted-ink)]">No values</div>
                ) : (
                  value.map((entry, index) => (
                    <PropertyGroup
                      key={`${key}-${index}`}
                      label={`${key} ${index + 1}`}
                      data={entry}
                      depth={depth + 1}
                    />
                  ))
                )}
              </div>
            );
          }

          return (
            <div
              key={key}
              className="grid gap-1 border-b border-[color:var(--viewer-border)] pb-3 last:border-b-0 last:pb-0"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
                {key}
              </div>
              <div className="break-words text-sm text-[color:var(--foreground)]">
                {isItemAttribute(value) ? formatValue(value.value) : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type PropertiesPanelProps = {
  details: ViewerSelectionDetails;
  session: ViewerSessionState;
};

export function PropertiesPanel({ details, session }: PropertiesPanelProps) {
  return (
    <aside className="flex h-full min-h-[20rem] flex-col overflow-hidden rounded-[1.75rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)]">
      <div className="border-b border-[color:var(--viewer-border)] px-5 py-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
          Properties
        </div>
        <h2 className="mt-2 text-lg font-semibold text-[color:var(--foreground)]">
          {details.selection?.label ?? "Select an element"}
        </h2>
        <div className="mt-2 flex flex-wrap gap-2 text-xs text-[color:var(--muted-ink)]">
          <span>{details.selection?.category ?? "No IFC class"}</span>
          <span>Tool: {session.activeTool}</span>
        </div>
      </div>

      <div className="grid gap-4 overflow-y-auto px-5 py-4">
        {details.selection ? (
          <section className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
              Selection
            </div>
            <div className="mt-3 space-y-2 text-sm text-[color:var(--foreground)]">
              <div>Model ID: {details.selection.modelId}</div>
              <div>Local ID: {details.selection.localId}</div>
              <div>Label: {details.selection.label}</div>
            </div>
          </section>
        ) : null}

        {details.data ? (
          <PropertyGroup label="Element Data" data={details.data} />
        ) : (
          <section className="rounded-2xl border border-dashed border-[color:var(--viewer-border)] px-4 py-6 text-sm text-[color:var(--muted-ink)]">
            Click an element in the viewport or tree to inspect attributes, relationships, and property sets.
          </section>
        )}
      </div>
    </aside>
  );
}
