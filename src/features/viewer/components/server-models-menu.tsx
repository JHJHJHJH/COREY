"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileBox, FolderOpen, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { deleteServerModel, listServerModels } from "@/features/viewer/lib/model-api";
import type { ServerModelSummary } from "@/features/viewer/types";

type ServerModelsMenuProps = {
  onLoadModel: (modelId: string) => void;
  disabled?: boolean;
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

export function ServerModelsMenu({
  onLoadModel,
  disabled,
  variant = "header",
  theme,
}: ServerModelsMenuProps) {
  const isEmptyState = variant === "empty-state";
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ServerModelSummary[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const confirmDelete = useCallback(async (modelId: string) => {
    setDeletingId(modelId);
    setActionError(null);
    try {
      await deleteServerModel(modelId);
      setModels((current) => current.filter((model) => model.modelId !== modelId));
      setPendingDeleteId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "File could not be deleted.");
    } finally {
      setDeletingId(null);
    }
  }, []);

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

  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const dialog =
    open && mounted
      ? createPortal(
          <div
            data-viewer-theme={theme}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 text-[color:var(--foreground)]"
            role="dialog"
            aria-modal="true"
            aria-label="Files"
          >
            <button
              type="button"
              aria-label="Close files dialog"
              onClick={() => setOpen(false)}
              className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm"
            />

            <div className="relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow-lift)]">
              <div className="flex items-center justify-between gap-3 border-b border-[color:var(--viewer-border)] px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <FolderOpen className="h-5 w-5 shrink-0 text-[color:var(--accent)]" />
                  <span className="truncate text-sm font-semibold text-[color:var(--foreground)]">
                    Files
                  </span>
                  <span className="text-xs text-[color:var(--muted-ink)]">
                    {models.length > 0 ? `${models.length} stored` : "server storage"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)]"
                    aria-label="Refresh files"
                  >
                    <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)]"
                    aria-label="Close files dialog"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

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
                  <>
                    {actionError ? (
                      <div className="mb-3 rounded-[var(--r-control)] border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-3 py-2 text-xs text-[color:var(--danger-fg)]">
                        {actionError}
                      </div>
                    ) : null}
                    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {models.map((model) => (
                        <li key={model.modelId} className="group relative">
                          <button
                            type="button"
                            onClick={() => {
                              onLoadModel(model.modelId);
                              setOpen(false);
                            }}
                            title={model.name}
                            className="flex w-full flex-col items-center gap-2 rounded-[var(--r-control)] border border-transparent px-3 py-4 text-center transition hover:border-[color:var(--viewer-border)] hover:bg-[color:var(--surface-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]"
                          >
                            <FileBox className="h-10 w-10 text-[color:var(--accent)] transition group-hover:scale-105" />
                            <span className="line-clamp-2 break-all text-xs font-medium text-[color:var(--foreground)]">
                              {model.name}
                            </span>
                            <span className="text-[10px] text-[color:var(--muted-ink)]">
                              {formatSize(model.size)}
                            </span>
                            <span className="text-[10px] text-[color:var(--muted-ink)]">
                              {new Date(model.uploadedAt).toLocaleDateString()}
                            </span>
                          </button>

                          <div className="absolute right-1 top-1 flex gap-1 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
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
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-[var(--r-control)] border border-[color:var(--danger-border)] bg-[color:var(--panel-bg)]/95 p-2 text-center backdrop-blur-sm">
                              <span className="text-[11px] font-medium text-[color:var(--foreground)]">
                                Delete this file?
                              </span>
                              <div className="flex gap-1.5">
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
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className={`relative ${isEmptyState ? "pointer-events-auto" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="inline-flex h-10 items-center gap-2 rounded-[var(--r-control)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-4 text-sm font-semibold text-[color:var(--foreground)] shadow-sm transition hover:border-[color:var(--viewer-border-strong)] hover:bg-[color:var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FolderOpen className="h-4 w-4" />
        <span>Files</span>
      </button>

      {dialog}
    </div>
  );
}
