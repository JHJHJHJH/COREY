"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Loader2, RefreshCw } from "lucide-react";
import { listServerModels } from "@/features/viewer/lib/model-api";
import type { ServerModelSummary } from "@/features/viewer/types";

type ServerModelsMenuProps = {
  onLoadModel: (modelId: string) => void;
  disabled?: boolean;
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ServerModelsMenu({ onLoadModel, disabled }: ServerModelsMenuProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ServerModelSummary[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
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

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4 text-sm font-semibold text-[color:var(--foreground)] transition hover:bg-[color:var(--surface-strong)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Database className="h-4 w-4" />
        <span>Server models</span>
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow)]">
          <div className="flex items-center justify-between border-b border-[color:var(--viewer-border)] px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-ink)]">
              Stored models
            </span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)]"
              aria-label="Refresh server models"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto">
            {loading && models.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-[color:var(--muted-ink)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : error ? (
              <div className="px-3 py-4 text-sm text-[color:var(--danger,#c0392b)]">{error}</div>
            ) : models.length === 0 ? (
              <div className="px-3 py-4 text-sm text-[color:var(--muted-ink)]">
                No models stored on the server yet. Load a file and use “Save to server”.
              </div>
            ) : (
              <ul className="divide-y divide-[color:var(--viewer-border)]">
                {models.map((model) => (
                  <li key={model.modelId}>
                    <button
                      type="button"
                      onClick={() => {
                        onLoadModel(model.modelId);
                        setOpen(false);
                      }}
                      className="flex w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-[color:var(--surface-strong)]"
                    >
                      <span className="truncate text-sm font-medium text-[color:var(--foreground)]">
                        {model.name}
                      </span>
                      <span className="text-xs text-[color:var(--muted-ink)]">
                        {formatSize(model.size)} · {new Date(model.uploadedAt).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
