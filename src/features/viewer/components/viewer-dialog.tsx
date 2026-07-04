"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type ViewerDialogProps = {
  /** Icon rendered before the title (already sized/colored by the caller). */
  icon: React.ReactNode;
  title: React.ReactNode;
  /** Muted text after the title (e.g. model name or item count). */
  subtitle?: React.ReactNode;
  /** Extra header buttons rendered before the close button. */
  headerActions?: React.ReactNode;
  ariaLabel: string;
  onClose: () => void;
  /**
   * Active viewer theme. The dialog is portaled to `document.body` (outside the
   * shell's `data-viewer-theme` subtree), so it must carry the theme itself for
   * the CSS variables to resolve correctly.
   */
  theme?: "light" | "dark";
  children: React.ReactNode;
};

/**
 * Shared modal frame for the viewer's full-screen dialogs (Files, Compare
 * versions). One fixed panel size so every dialog feels like the same window
 * regardless of content.
 */
export function ViewerDialog({
  icon,
  title,
  subtitle,
  headerActions,
  ariaLabel,
  onClose,
  theme,
  children,
}: ViewerDialogProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Only rendered after a user action inside a client component, so
  // `document.body` is always available (no SSR mount gate needed).
  return createPortal(
    <div
      data-viewer-theme={theme}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 text-[color:var(--foreground)]"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        aria-label={`Close ${ariaLabel} dialog`}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-sm"
      />

      <div className="relative flex h-[min(85vh,900px)] w-full max-w-5xl flex-col overflow-hidden rounded-[var(--r-panel)] border border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] shadow-[var(--viewer-shadow-lift)]">
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--viewer-border)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {icon}
            <span className="truncate text-sm font-semibold text-[color:var(--foreground)]">
              {title}
            </span>
            {subtitle ? (
              <span className="truncate text-xs text-[color:var(--muted-ink)]">{subtitle}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-strong)]"
              aria-label={`Close ${ariaLabel} dialog`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {children}
      </div>
    </div>,
    document.body,
  );
}
