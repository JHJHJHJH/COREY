"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  GitCompareArrows,
  Loader2,
} from "lucide-react";
import { ViewerDialog } from "@/features/viewer/components/viewer-dialog";
import { listModelVersions } from "@/features/viewer/lib/model-api";
import { compareModelVersionsViaApi } from "@/features/viewer/lib/model-compare-api";
import type {
  ModelCompareChangedElement,
  ModelCompareElementRef,
  ModelCompareResult,
  ModelCompareValidationEntry,
  ServerModelVersionSummary,
  ViewerValidationClause,
} from "@/features/viewer/types";

type ModelComparePanelProps = {
  model: { modelId: string; name: string };
  /** Active rule clauses; when non-empty the compare includes a validation diff. */
  clauses: ViewerValidationClause[];
  /** True when the compared model is currently loaded, enabling row → viewport selection. */
  canSelectElements: boolean;
  onSelectElement: (element: ModelCompareElementRef) => void;
  /** Opens the side-by-side 3D view for the versions of the current result. */
  onOpenVisualCompare: (request: {
    baseVersion: number;
    targetVersion: number;
    result: ModelCompareResult;
  }) => void;
  onClose: () => void;
  /**
   * Active viewer theme. The dialog is portaled to `document.body` (outside the
   * shell's `data-viewer-theme` subtree), so it must carry the theme itself.
   */
  theme?: "light" | "dark";
};

type ComparePhase = "idle" | "running" | "ready" | "error";

type CompareSectionKey =
  | "added"
  | "removed"
  | "changed"
  | "resolved"
  | "introduced"
  | "stillFailing";

function formatVersionOption(version: ServerModelVersionSummary) {
  const date = new Date(version.uploadedAt).toLocaleDateString();
  const summary = version.changeSummary;
  const changes =
    summary && !summary.failed
      ? ` · +${summary.addedCount} −${summary.removedCount} ~${summary.changedCount}`
      : "";
  return `v${version.versionNumber} · ${date}${version.label ? ` · ${version.label}` : ""}${changes}`;
}

function CountChip({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-semibold ${
        tone === "danger" && value > 0
          ? "border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] text-[color:var(--danger-fg)]"
          : tone === "success" && value > 0
            ? "border-[color:var(--success-border)] bg-[color:var(--success-bg)] text-[color:var(--success-fg)]"
            : "border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] text-[color:var(--foreground)]"
      }`}
    >
      <span className="tabular-nums">{value}</span>
      <span className="font-medium text-[color:var(--muted-ink)]">{label}</span>
    </span>
  );
}

function ElementRow({
  element,
  detail,
  canSelect,
  onSelect,
  children,
}: {
  element: ModelCompareElementRef;
  detail?: string | null;
  canSelect: boolean;
  onSelect: (element: ModelCompareElementRef) => void;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-left">
        <span className="font-medium text-[color:var(--foreground)]">
          {element.name ?? element.globalId}
        </span>
        <span className="ml-2 text-[11px] text-[color:var(--muted-ink)]">{element.ifcType}</span>
      </span>
      {detail ? (
        <span className="shrink-0 text-[11px] text-[color:var(--muted-ink)]">{detail}</span>
      ) : null}
    </>
  );

  return (
    <li className="rounded-md border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]">
      {canSelect ? (
        <button
          type="button"
          onClick={() => onSelect(element)}
          title={`Select ${element.name ?? element.globalId} in the viewport`}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs transition hover:bg-[color:var(--surface-strong)]"
        >
          {body}
        </button>
      ) : (
        <div className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs">{body}</div>
      )}
      {children}
    </li>
  );
}

function ChangedElementRow({
  element,
  canSelect,
  onSelect,
}: {
  element: ModelCompareChangedElement;
  canSelect: boolean;
  onSelect: (element: ModelCompareElementRef) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-md border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)]">
      <div className="flex items-center gap-1 pr-2.5">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse field changes" : "Expand field changes"}
          className="inline-flex h-8 w-7 shrink-0 items-center justify-center text-[color:var(--muted-ink)] transition hover:text-[color:var(--foreground)]"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={() => (canSelect ? onSelect(element) : setExpanded((value) => !value))}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-xs transition hover:text-[color:var(--accent)]"
        >
          <span className="min-w-0 flex-1 truncate text-left">
            <span className="font-medium text-[color:var(--foreground)]">
              {element.name ?? element.globalId}
            </span>
            <span className="ml-2 text-[11px] text-[color:var(--muted-ink)]">{element.ifcType}</span>
          </span>
          <span className="shrink-0 text-[11px] text-[color:var(--muted-ink)]">
            {element.fields.length}
            {element.fieldsTruncated ? "+" : ""} {element.fields.length === 1 ? "field" : "fields"}
          </span>
        </button>
      </div>
      {expanded ? (
        <div className="border-t border-[color:var(--viewer-border)] px-2.5 py-2">
          <ul className="flex flex-col gap-1.5">
            {element.fields.map((field) => (
              <li key={field.field} className="text-[11px]">
                <span className="font-semibold text-[color:var(--foreground)]">{field.label}</span>
                <span className="ml-2 text-[color:var(--muted-ink)] line-through">
                  {field.base?.text ?? "—"}
                </span>
                <span className="mx-1.5 text-[color:var(--muted-ink)]">→</span>
                <span className="text-[color:var(--foreground)]">{field.target?.text ?? "—"}</span>
              </li>
            ))}
            {element.fieldsTruncated ? (
              <li className="text-[11px] text-[color:var(--muted-ink)]">
                More field changes were truncated.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

function validationDetail(entry: ModelCompareValidationEntry) {
  const clauseTitles = entry.clauses.map((clause) => clause.clauseTitle).join(", ");
  const flag = entry.elementAdded ? " · new element" : entry.elementRemoved ? " · element removed" : "";
  return `${entry.severity.toUpperCase()} · ${clauseTitles}${flag}`;
}

export function ModelComparePanel({
  model,
  clauses,
  canSelectElements,
  onSelectElement,
  onOpenVisualCompare,
  onClose,
  theme,
}: ModelComparePanelProps) {
  const [versions, setVersions] = useState<ServerModelVersionSummary[] | null>(null);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [targetVersion, setTargetVersion] = useState<number | null>(null);
  const [phase, setPhase] = useState<ComparePhase>("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ModelCompareResult | null>(null);
  const [openSection, setOpenSection] = useState<CompareSectionKey>("changed");
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await listModelVersions(model.modelId);
        if (cancelled) {
          return;
        }
        setVersions(loaded);
        // Default to comparing the previous version against the latest.
        if (loaded.length >= 2) {
          setTargetVersion(loaded[0].versionNumber);
          setBaseVersion(loaded[1].versionNumber);
        }
      } catch (err) {
        if (!cancelled) {
          setVersionsError(
            err instanceof Error ? err.message : "Model versions could not be loaded.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      abortControllerRef.current?.abort();
    };
  }, [model.modelId]);

  const runCompare = useCallback(async () => {
    if (baseVersion === null || targetVersion === null || baseVersion === targetVersion) {
      setPhase("error");
      setMessage("Pick two different versions to compare.");
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setPhase("running");
    setMessage(`Comparing v${baseVersion} against v${targetVersion} on the server…`);
    setResult(null);

    try {
      const compareResult = await compareModelVersionsViaApi(
        {
          modelId: model.modelId,
          baseVersion,
          targetVersion,
          clauses,
        },
        controller.signal,
      );
      setResult(compareResult);
      setPhase("ready");
      setMessage("");
      setOpenSection(
        compareResult.summary.changedCount > 0
          ? "changed"
          : compareResult.summary.addedCount > 0
            ? "added"
            : "removed",
      );
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Model compare failed.");
    }
  }, [baseVersion, clauses, model.modelId, targetVersion]);

  const sections = useMemo(() => {
    if (!result) {
      return [];
    }

    const structural: Array<{
      key: CompareSectionKey;
      title: string;
      count: number;
      truncatedNote: boolean;
      entries: ModelCompareElementRef[] | ModelCompareChangedElement[] | ModelCompareValidationEntry[];
    }> = [
      {
        key: "changed",
        title: "Changed",
        count: result.summary.changedCount,
        truncatedNote: result.changed.length < result.summary.changedCount,
        entries: result.changed,
      },
      {
        key: "added",
        title: "Added",
        count: result.summary.addedCount,
        truncatedNote: result.added.length < result.summary.addedCount,
        entries: result.added,
      },
      {
        key: "removed",
        title: "Removed",
        count: result.summary.removedCount,
        truncatedNote: result.removed.length < result.summary.removedCount,
        entries: result.removed,
      },
    ];

    if (result.validation) {
      structural.push(
        {
          key: "resolved",
          title: "Resolved failures",
          count: result.validation.resolved.length,
          truncatedNote: false,
          entries: result.validation.resolved,
        },
        {
          key: "introduced",
          title: "New failures",
          count: result.validation.introduced.length,
          truncatedNote: false,
          entries: result.validation.introduced,
        },
        {
          key: "stillFailing",
          title: "Still failing",
          count: result.validation.stillFailing.length,
          truncatedNote: false,
          entries: result.validation.stillFailing,
        },
      );
    }

    return structural;
  }, [result]);

  return (
    <ViewerDialog
      icon={<GitCompareArrows className="h-5 w-5 shrink-0 text-[color:var(--accent)]" />}
      title="Compare versions"
      subtitle={model.name}
      ariaLabel="Compare versions"
      onClose={onClose}
      theme={theme}
    >
      <div className="flex flex-wrap items-end gap-2 border-b border-[color:var(--viewer-border)] px-4 py-3">
          {versionsError ? (
            <span className="text-xs text-[color:var(--danger-fg)]">{versionsError}</span>
          ) : !versions ? (
            <span className="inline-flex items-center gap-2 text-xs text-[color:var(--muted-ink)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading versions…
            </span>
          ) : versions.length < 2 ? (
            <span className="text-xs text-[color:var(--muted-ink)]">
              This model has only one stored version. Upload a new version to compare.
            </span>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-[color:var(--muted-ink)]">
                Base (before)
                <select
                  value={baseVersion ?? ""}
                  onChange={(event) => setBaseVersion(Number(event.target.value))}
                  className="h-9 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-2 text-xs font-medium text-[color:var(--foreground)]"
                >
                  {versions.map((version) => (
                    <option key={version.versionId} value={version.versionNumber}>
                      {formatVersionOption(version)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-[color:var(--muted-ink)]">
                Target (after)
                <select
                  value={targetVersion ?? ""}
                  onChange={(event) => setTargetVersion(Number(event.target.value))}
                  className="h-9 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-2 text-xs font-medium text-[color:var(--foreground)]"
                >
                  {versions.map((version) => (
                    <option key={version.versionId} value={version.versionNumber}>
                      {formatVersionOption(version)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => void runCompare()}
                disabled={phase === "running"}
                className="inline-flex h-9 items-center gap-2 rounded-[var(--r-control)] bg-[color:var(--accent)] px-4 text-xs font-semibold text-[color:var(--accent-ink)] shadow-sm transition hover:bg-[color:var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phase === "running" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <GitCompareArrows className="h-3.5 w-3.5" />
                )}
                Compare
              </button>
              {phase === "ready" && result ? (
                <button
                  type="button"
                  onClick={() =>
                    onOpenVisualCompare({
                      baseVersion: result.baseVersion,
                      targetVersion: result.targetVersion,
                      result,
                    })
                  }
                  title="Open the compared versions side by side in 3D"
                  className="inline-flex h-9 items-center gap-2 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-4 text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]"
                >
                  <Columns2 className="h-3.5 w-3.5" />
                  Visual compare
                </button>
              ) : null}
              {clauses.length === 0 ? (
                <span className="text-[11px] text-[color:var(--muted-ink)]">
                  No clauses configured — validation diff will be skipped.
                </span>
              ) : null}
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {phase === "running" ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-[color:var(--muted-ink)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {message}
            </div>
          ) : phase === "error" ? (
            <div className="py-12 text-center text-sm text-[color:var(--danger-fg)]">{message}</div>
          ) : !result ? (
            <div className="py-12 text-center text-sm text-[color:var(--muted-ink)]">
              Pick a base and target version, then run the comparison. The diff is computed on the
              server from the stored files.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                <CountChip label="changed" value={result.summary.changedCount} />
                <CountChip label="added" value={result.summary.addedCount} />
                <CountChip label="removed" value={result.summary.removedCount} />
                {result.validation ? (
                  <>
                    <CountChip
                      label="resolved"
                      value={result.validation.resolved.length}
                      tone="success"
                    />
                    <CountChip
                      label="new failures"
                      value={result.validation.introduced.length}
                      tone="danger"
                    />
                    <CountChip label="still failing" value={result.validation.stillFailing.length} />
                  </>
                ) : null}
                <span className="ml-auto text-[11px] text-[color:var(--muted-ink)]">
                  {result.summary.baseElementCount} → {result.summary.targetElementCount} elements
                </span>
              </div>

              {result.validation ? (
                <p className="text-[11px] text-[color:var(--muted-ink)]">
                  Validation: {result.validation.base.failedElementCount} failing elements in v
                  {result.baseVersion} → {result.validation.target.failedElementCount} in v
                  {result.targetVersion}.
                </p>
              ) : null}

              {result.summary.warnings.length > 0 ? (
                <ul className="flex flex-col gap-1 rounded-md border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-3 py-2 text-[11px] text-[color:var(--muted-ink)]">
                  {result.summary.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}

              {sections.map((section) => (
                <section key={section.key}>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenSection((current) => (current === section.key ? "changed" : section.key))
                    }
                    aria-expanded={openSection === section.key}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)]"
                  >
                    {openSection === section.key ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {section.title}
                    <span className="tabular-nums text-[color:var(--muted-ink)]">{section.count}</span>
                  </button>
                  {openSection === section.key ? (
                    section.entries.length === 0 ? (
                      <p className="px-6 py-2 text-[11px] text-[color:var(--muted-ink)]">
                        Nothing in this list.
                      </p>
                    ) : (
                      <ul className="mt-1 flex flex-col gap-1 pl-6">
                        {section.key === "changed"
                          ? (section.entries as ModelCompareChangedElement[]).map((element) => (
                              <ChangedElementRow
                                key={element.globalId}
                                element={element}
                                canSelect={canSelectElements}
                                onSelect={onSelectElement}
                              />
                            ))
                          : section.key === "added" || section.key === "removed"
                            ? (section.entries as ModelCompareElementRef[]).map((element) => (
                                <ElementRow
                                  key={element.globalId}
                                  element={element}
                                  canSelect={canSelectElements && section.key !== "removed"}
                                  onSelect={onSelectElement}
                                />
                              ))
                            : (section.entries as ModelCompareValidationEntry[]).map((entry) => (
                                <ElementRow
                                  key={entry.globalId}
                                  element={entry}
                                  detail={validationDetail(entry)}
                                  canSelect={canSelectElements && !entry.elementRemoved}
                                  onSelect={onSelectElement}
                                />
                              ))}
                        {section.truncatedNote ? (
                          <li className="px-2.5 py-1 text-[11px] text-[color:var(--muted-ink)]">
                            List truncated; counts reflect the full diff.
                          </li>
                        ) : null}
                      </ul>
                    )
                  ) : null}
                </section>
              ))}
            </div>
          )}
      </div>
    </ViewerDialog>
  );
}
