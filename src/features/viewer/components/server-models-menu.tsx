"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  FileBox,
  FileUp,
  FolderOpen,
  GitCompareArrows,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  deleteModelVersions,
  deleteServerModel,
  listModelVersions,
  listServerModels,
  uploadModelVersion,
} from "@/features/viewer/lib/model-api";
import { ViewerDialog } from "@/features/viewer/components/viewer-dialog";
import type {
  ModelVersionChangeSummary,
  ServerModelSummary,
  ServerModelVersionSummary,
} from "@/features/viewer/types";

type ServerModelsMenuProps = {
  onLoadModel: (modelId: string) => void;
  /** Opens the version-compare panel for a stored model with 2+ versions. */
  onCompareModel?: (model: ServerModelSummary) => void;
  disabled?: boolean;
  disabledReason?: string;
  /**
   * `header` renders the bordered toolbar button; `empty-state` renders the
   * call-to-action used on the start screen. Both open the same Files dialog.
   */
  variant?: "header" | "empty-state";
  /**
   * Active viewer theme. The dialog is portaled to `document.body` (outside the
   * shell's `data-viewer-theme` subtree), so it must carry the theme itself for
   * the CSS variables to resolve correctly.
   */
  theme?: "light" | "dark";
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One-glance form for the catalog row: `+2 −1 ~12 vs v3`. */
function compactChangeText(summary: ModelVersionChangeSummary | null | undefined) {
  if (!summary || summary.failed) {
    return null;
  }
  return `+${summary.addedCount} −${summary.removedCount} ~${summary.changedCount} vs v${summary.comparedToVersion}`;
}

function changeSummaryText(summary: ModelVersionChangeSummary | null, isOldest: boolean) {
  if (!summary) {
    return isOldest ? "Initial upload" : "No summary";
  }
  if (summary.failed) {
    return `Summary unavailable (vs v${summary.comparedToVersion})`;
  }
  return `+${summary.addedCount} added · −${summary.removedCount} removed · ~${summary.changedCount} changed (vs v${summary.comparedToVersion})`;
}

function changeSummaryTooltip(summary: ModelVersionChangeSummary | null) {
  if (!summary || summary.failed) {
    return undefined;
  }
  const parts: string[] = [];
  if (summary.examples.added.length > 0) {
    parts.push(`Added: ${summary.examples.added.join(", ")}`);
  }
  if (summary.examples.removed.length > 0) {
    parts.push(`Removed: ${summary.examples.removed.join(", ")}`);
  }
  if (summary.examples.changed.length > 0) {
    parts.push(`Changed: ${summary.examples.changed.join(", ")}`);
  }
  parts.push(`${summary.baseElementCount} → ${summary.targetElementCount} elements`);
  return parts.join("\n");
}

export function ServerModelsMenu({
  onLoadModel,
  onCompareModel,
  disabled,
  disabledReason,
  variant = "header",
  theme,
}: ServerModelsMenuProps) {
  const isEmptyState = variant === "empty-state";
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ServerModelSummary[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [versionUploadTargetId, setVersionUploadTargetId] = useState<string | null>(null);
  const versionFileInputRef = useRef<HTMLInputElement | null>(null);

  // Version history accordion: one model's history can be dropped open at a time.
  const [expandedModelId, setExpandedModelId] = useState<string | null>(null);
  const [versions, setVersions] = useState<ServerModelVersionSummary[] | null>(null);
  const [selectedVersions, setSelectedVersions] = useState<Set<number>>(new Set());
  const [pendingVersionDelete, setPendingVersionDelete] = useState(false);
  const [deletingVersions, setDeletingVersions] = useState(false);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const confirmDelete = useCallback(
    async (modelId: string) => {
      setDeletingId(modelId);
      setActionError(null);
      try {
        await deleteServerModel(modelId);
        setModels((current) => current.filter((model) => model.modelId !== modelId));
        setPendingDeleteId(null);
        if (expandedModelId === modelId) {
          setExpandedModelId(null);
          setVersions(null);
          setSelectedVersions(new Set());
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "File could not be deleted.");
      } finally {
        setDeletingId(null);
      }
    },
    [expandedModelId],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setActionError(null);
    setPendingDeleteId(null);
    try {
      setModels(await listServerModels());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Server models could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadVersions = useCallback(async (modelId: string) => {
    setVersions(null);
    try {
      setVersions(await listModelVersions(modelId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Model versions could not be loaded.");
    }
  }, []);

  const toggleVersionHistory = useCallback(
    (modelId: string) => {
      setActionError(null);
      setPendingVersionDelete(false);
      setSelectedVersions(new Set());
      if (expandedModelId === modelId) {
        setExpandedModelId(null);
        setVersions(null);
        return;
      }
      setExpandedModelId(modelId);
      void loadVersions(modelId);
    },
    [expandedModelId, loadVersions],
  );

  const handleVersionFileSelected = useCallback(
    async (file: File | null) => {
      const modelId = versionUploadTargetId;
      setVersionUploadTargetId(null);
      if (!file || !modelId) {
        return;
      }

      setActionError(null);
      setLoading(true);
      try {
        await uploadModelVersion(modelId, file.name, file);
        setModels(await listServerModels());
        if (expandedModelId === modelId) {
          setVersions(await listModelVersions(modelId));
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Version could not be uploaded.");
      } finally {
        setLoading(false);
      }
    },
    [expandedModelId, versionUploadTargetId],
  );

  const confirmVersionDelete = useCallback(async () => {
    if (!expandedModelId || selectedVersions.size === 0) {
      return;
    }

    setDeletingVersions(true);
    setActionError(null);
    try {
      const remaining = await deleteModelVersions(expandedModelId, [...selectedVersions]);
      setVersions(remaining);
      setSelectedVersions(new Set());
      setPendingVersionDelete(false);
      setModels(await listServerModels());
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Versions could not be deleted.");
    } finally {
      setDeletingVersions(false);
    }
  }, [expandedModelId, selectedVersions]);

  useEffect(() => {
    if (open) {
      void refresh();
    } else {
      setExpandedModelId(null);
      setVersions(null);
      setSelectedVersions(new Set());
      setPendingVersionDelete(false);
    }
  }, [open, refresh]);

  const toggleVersionSelected = (versionNumber: number) => {
    setPendingVersionDelete(false);
    setSelectedVersions((current) => {
      const next = new Set(current);
      if (next.has(versionNumber)) {
        next.delete(versionNumber);
      } else {
        next.add(versionNumber);
      }
      return next;
    });
  };

  const allSelected =
    versions !== null && versions.length > 0 && selectedVersions.size >= versions.length;
  const oldestVersionNumber =
    versions && versions.length > 0 ? versions[versions.length - 1].versionNumber : null;

  const renderVersionHistory = (model: ServerModelSummary) => (
    <div className="border-t border-[color:var(--viewer-border)] px-3 pb-2.5 pt-2">
      {!versions ? (
        <div className="flex items-center gap-2 py-2 pl-11 text-xs text-[color:var(--muted-ink)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading versions…
        </div>
      ) : (
        <>
          <ul className="ml-11 flex flex-col divide-y divide-[color:var(--viewer-border)]">
            {versions.map((version) => (
              <li key={version.versionId} className="flex items-center gap-3 py-1.5">
                <input
                  type="checkbox"
                  checked={selectedVersions.has(version.versionNumber)}
                  onChange={() => toggleVersionSelected(version.versionNumber)}
                  disabled={versions.length === 1}
                  title={
                    versions.length === 1
                      ? "A model must keep at least one version"
                      : `Select v${version.versionNumber}`
                  }
                  aria-label={`Select v${version.versionNumber}`}
                  className="h-3.5 w-3.5 shrink-0 accent-[color:var(--accent)] disabled:cursor-not-allowed"
                />
                <span className="w-8 shrink-0 text-center text-[10px] font-semibold tabular-nums text-[color:var(--muted-ink)]">
                  v{version.versionNumber}
                </span>
                <div className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[11px] text-[color:var(--foreground)]"
                    title={changeSummaryTooltip(version.changeSummary)}
                  >
                    {changeSummaryText(
                      version.changeSummary,
                      version.versionNumber === oldestVersionNumber,
                    )}
                  </span>
                  {version.label ? (
                    <span className="block truncate text-[10px] text-[color:var(--muted-ink)]">
                      {version.label}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-[color:var(--muted-ink)]">
                  {formatSize(version.size)}
                </span>
                <span className="shrink-0 text-[10px] text-[color:var(--muted-ink)]">
                  {new Date(version.uploadedAt).toLocaleString()}
                </span>
                <a
                  href={`/api/models/${model.modelId}/versions/${version.versionNumber}/file`}
                  download={`${model.name.replace(/\.ifc$/i, "")}.v${version.versionNumber}.ifc`}
                  title={`Download v${version.versionNumber}`}
                  aria-label={`Download v${version.versionNumber}`}
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"
                >
                  <Download className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>

          <div className="ml-11 flex flex-wrap items-center gap-2 border-t border-[color:var(--viewer-border)] pt-2">
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setVersionUploadTargetId(model.modelId);
                versionFileInputRef.current?.click();
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-2.5 text-[11px] font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]"
            >
              <FileUp className="h-3 w-3" />
              Upload new version
            </button>
            {onCompareModel && versions.length >= 2 ? (
              <button
                type="button"
                onClick={() => {
                  onCompareModel(model);
                  setOpen(false);
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-2.5 text-[11px] font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)]"
              >
                <GitCompareArrows className="h-3 w-3" />
                Compare versions
              </button>
            ) : null}

            <div className="ml-auto flex items-center gap-2">
              {allSelected && versions.length > 1 ? (
                <span className="text-[10px] text-[color:var(--muted-ink)]">
                  Keep at least one version.
                </span>
              ) : null}
              {pendingVersionDelete ? (
                <>
                  <span className="text-[11px] font-medium text-[color:var(--foreground)]">
                    Delete {selectedVersions.size}{" "}
                    {selectedVersions.size === 1 ? "version" : "versions"}?
                  </span>
                  <button
                    type="button"
                    onClick={() => void confirmVersionDelete()}
                    disabled={deletingVersions}
                    className="inline-flex h-7 items-center gap-1.5 rounded-[var(--r-control)] border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-2.5 text-[11px] font-semibold text-[color:var(--danger-fg)] transition hover:opacity-90 disabled:opacity-60"
                  >
                    {deletingVersions ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingVersionDelete(false)}
                    disabled={deletingVersions}
                    className="inline-flex h-7 items-center rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-2.5 text-[11px] font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setPendingVersionDelete(true)}
                  disabled={selectedVersions.size === 0 || allSelected}
                  title={
                    allSelected
                      ? "A model must keep at least one version"
                      : selectedVersions.size === 0
                        ? "Select versions to delete"
                        : undefined
                  }
                  className="inline-flex h-7 items-center gap-1.5 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-2.5 text-[11px] font-semibold text-[color:var(--foreground)] transition hover:border-[color:var(--danger-border)] hover:bg-[color:var(--danger-bg)] hover:text-[color:var(--danger-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete selected{selectedVersions.size > 0 ? ` (${selectedVersions.size})` : ""}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );

  const modelsView = (
    <>
      {actionError ? (
        <div className="mb-3 rounded-[var(--r-control)] border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-3 py-2 text-xs text-[color:var(--danger-fg)]">
          {actionError}
        </div>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {models.map((model) => {
          const expanded = expandedModelId === model.modelId;
          const compactChange =
            (model.versionCount ?? 1) > 1 ? compactChangeText(model.latestChangeSummary) : null;

          return (
            <li
              key={model.modelId}
              className="rounded-md border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)]"
            >
              <div className="group relative flex items-center gap-3 rounded-md px-3 py-2 transition hover:bg-[color:var(--surface-hover)]">
                <button
                  type="button"
                  onClick={() => {
                    onLoadModel(model.modelId);
                    setOpen(false);
                  }}
                  title={`Load ${model.name}`}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
                >
                  <FileBox className="h-8 w-8 shrink-0 text-[color:var(--accent)] transition group-hover:scale-105" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-[color:var(--foreground)]">
                      {model.name}
                    </span>
                    <span className="block truncate text-[11px] text-[color:var(--muted-ink)]">
                      {formatSize(model.size)} · {new Date(model.uploadedAt).toLocaleDateString()}
                      {compactChange ? ` · ${compactChange}` : ""}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleVersionHistory(model.modelId)}
                  aria-expanded={expanded}
                  title={`Version history of ${model.name}`}
                  aria-label={`Version history of ${model.name}`}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"
                >
                  v{model.latestVersion ?? model.versionCount ?? 1}
                  <ChevronDown
                    className={`h-3 w-3 transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
                  />
                </button>

                <div className="flex shrink-0 gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setVersionUploadTargetId(model.modelId);
                      versionFileInputRef.current?.click();
                    }}
                    title={`Upload new version of ${model.name}`}
                    aria-label={`Upload new version of ${model.name}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] text-[color:var(--muted-ink)] shadow-sm transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                  >
                    <FileUp className="h-3.5 w-3.5" />
                  </button>
                  {onCompareModel && (model.versionCount ?? 1) > 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        onCompareModel(model);
                        setOpen(false);
                      }}
                      title={`Compare versions of ${model.name}`}
                      aria-label={`Compare versions of ${model.name}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] text-[color:var(--muted-ink)] shadow-sm transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                    >
                      <GitCompareArrows className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <a
                    href={`/api/models/${model.modelId}/file`}
                    download={model.name}
                    title={`Download ${model.name}`}
                    aria-label={`Download ${model.name}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] text-[color:var(--muted-ink)] shadow-sm transition hover:bg-[color:var(--surface-strong)] hover:text-[color:var(--foreground)]"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setActionError(null);
                      setPendingDeleteId(model.modelId);
                    }}
                    title={`Delete ${model.name}`}
                    aria-label={`Delete ${model.name}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] text-[color:var(--muted-ink)] shadow-sm transition hover:border-[color:var(--danger-border)] hover:bg-[color:var(--danger-bg)] hover:text-[color:var(--danger-fg)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {pendingDeleteId === model.modelId ? (
                  <div className="absolute inset-0 flex items-center justify-end gap-2 rounded-md border border-[color:var(--danger-border)] bg-[color:var(--panel-bg)]/95 px-3 backdrop-blur-sm">
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[color:var(--foreground)]">
                      Delete {model.name}?
                    </span>
                    <div className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => void confirmDelete(model.modelId)}
                        disabled={deletingId === model.modelId}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-2 text-[11px] font-semibold text-[color:var(--danger-fg)] transition hover:opacity-90 disabled:opacity-60"
                      >
                        {deletingId === model.modelId ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : null}
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(null)}
                        disabled={deletingId === model.modelId}
                        className="inline-flex h-7 items-center rounded-md border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-2 text-[11px] font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-hover)] disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {expanded ? renderVersionHistory(model) : null}
            </li>
          );
        })}
      </ul>
    </>
  );

  const dialog = open ? (
    <ViewerDialog
      icon={<FolderOpen className="h-5 w-5 shrink-0 text-[color:var(--accent)]" />}
      title="Files"
      subtitle={models.length > 0 ? `${models.length} stored` : "server storage"}
      headerActions={
        <button
          type="button"
          onClick={() => {
            void refresh();
            if (expandedModelId) {
              void loadVersions(expandedModelId);
            }
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)]"
          aria-label="Refresh files"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      }
      ariaLabel="Files"
      onClose={() => setOpen(false)}
      theme={theme}
    >
      <input
        ref={versionFileInputRef}
        type="file"
        accept=".ifc"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          void handleVersionFileSelected(file);
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading && models.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[color:var(--muted-ink)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : error ? (
          <div className="py-12 text-center text-sm text-[color:var(--danger-fg,#c0392b)]">
            {error}
          </div>
        ) : models.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-[color:var(--muted-ink)]">
            <FolderOpen className="h-8 w-8 opacity-60" />
            No models stored on the server yet. Upload an IFC file to save it here.
          </div>
        ) : (
          modelsView
        )}
      </div>
    </ViewerDialog>
  ) : null;

  return (
    <div className={`relative ${isEmptyState ? "pointer-events-auto" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        aria-label={disabled && disabledReason ? `Files (${disabledReason})` : "Files"}
        className="inline-flex h-10 items-center gap-2 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-4 text-sm font-semibold text-[color:var(--foreground)] shadow-sm transition hover:border-[color:var(--viewer-border-strong)] hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FolderOpen className="h-4 w-4" />
        <span>Files</span>
      </button>

      {dialog}
    </div>
  );
}
