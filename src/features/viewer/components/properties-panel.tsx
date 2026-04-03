"use client";

import type { ItemAttribute, ItemData } from "@thatopen/fragments";
import type { ViewerSelectionDetails, ViewerSessionState } from "@/features/viewer/types";

const MAX_RENDER_DEPTH = 6;
const MAX_ARRAY_ITEMS = 24;

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

type PropertyGroupProps = {
  label: string;
  data: ItemData;
  depth?: number;
  ancestors?: Set<object>;
};

function PropertyGroup({ label, data, depth = 0, ancestors = new Set<object>() }: PropertyGroupProps) {
  if (depth >= MAX_RENDER_DEPTH) {
    return (
      <section
        className="rounded-2xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] p-4"
        style={{ marginLeft: `${depth * 8}px` }}
      >
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[color:var(--muted-ink)]">
          {label}
        </div>
        <div className="mt-3 text-sm text-[color:var(--muted-ink)]">
          Nested relations were truncated to keep the panel responsive.
        </div>
      </section>
    );
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(data);
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
                  <>
                    {value.slice(0, MAX_ARRAY_ITEMS).map((entry, index) =>
                      nextAncestors.has(entry) ? (
                        <section
                          key={`${key}-${index}`}
                          className="rounded-2xl border border-dashed border-[color:var(--viewer-border)] px-4 py-3 text-sm text-[color:var(--muted-ink)]"
                          style={{ marginLeft: `${(depth + 1) * 8}px` }}
                        >
                          {key} {index + 1} references data already shown above.
                        </section>
                      ) : (
                        <PropertyGroup
                          key={`${key}-${index}`}
                          label={`${key} ${index + 1}`}
                          data={entry}
                          depth={depth + 1}
                          ancestors={nextAncestors}
                        />
                      ),
                    )}
                    {value.length > MAX_ARRAY_ITEMS ? (
                      <div className="text-sm text-[color:var(--muted-ink)]">
                        Showing {MAX_ARRAY_ITEMS} of {value.length} values.
                      </div>
                    ) : null}
                  </>
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
  embedded?: boolean;
  details: ViewerSelectionDetails;
  session: ViewerSessionState;
};

export function PropertiesPanel({ embedded = false, details, session }: PropertiesPanelProps) {
  return (
    <aside
      className={`flex h-full min-h-0 flex-col overflow-hidden ${
        embedded
          ? "bg-[color:var(--panel-bg)]/92"
          : "rounded-[1.75rem] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)]"
      }`}
    >
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

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
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
        ) : details.selection && details.loading ? (
          <section className="rounded-2xl border border-dashed border-[color:var(--viewer-border)] px-4 py-6 text-sm text-[color:var(--muted-ink)]">
            Loading element properties...
          </section>
        ) : details.selection ? (
          <section className="rounded-2xl border border-dashed border-[color:var(--viewer-border)] px-4 py-6 text-sm text-[color:var(--muted-ink)]">
            Detailed properties are unavailable for this selection.
          </section>
        ) : (
          <section className="rounded-2xl border border-dashed border-[color:var(--viewer-border)] px-4 py-6 text-sm text-[color:var(--muted-ink)]">
            Click an element in the viewport or tree to inspect attributes, relationships, and property sets.
          </section>
        )}
      </div>
    </aside>
  );
}
