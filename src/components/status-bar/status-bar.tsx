"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { StatusInspector } from "@/components/status-bar/status-inspector";

export type StatusTone = "default" | "muted" | "success" | "warn" | "error";

export type StatusSegment = {
  id: string;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** The text shown in the bar, e.g. "18 columns". */
  label: ReactNode;
  tone?: StatusTone;
  /** Optional longer description surfaced via title/aria for narrow widths. */
  title?: string;
};

const TONE_CLASS: Record<StatusTone, string> = {
  default: "text-[color:var(--foreground)]",
  muted: "text-[color:var(--muted-ink)]",
  success: "text-[color:var(--success-fg)]",
  warn: "text-[color:var(--warning-fg)]",
  error: "text-[color:var(--danger-fg)]",
};

const DOT_CLASS: Record<StatusTone, string> = {
  default: "bg-[color:var(--muted-ink)]",
  muted: "bg-[color:var(--muted-ink)]",
  success: "bg-[color:var(--success-fg)]",
  warn: "bg-[color:var(--warning-fg)]",
  error: "bg-[color:var(--danger-fg)]",
};

type StatusBarProps = {
  /** Plain-language live state, always visible in the bar. */
  segments: StatusSegment[];
  /** A small leading status dot, e.g. derived from a load/validation phase. */
  statusTone?: StatusTone;
  /** Detail content revealed by the Inspect toggle. Omit to hide the toggle. */
  inspector?: ReactNode;
  inspectorLabel?: string;
  /** Extra controls pinned to the right of the bar (e.g. a theme toggle). */
  trailing?: ReactNode;
  /** Where the bar sits, which flips the inspector reveal direction. */
  placement?: "top" | "bottom";
  className?: string;
};

/**
 * Slim, single-line status bar pinned to the bottom of a screen. Shows
 * compact, plain-language segments and an optional Inspect toggle that
 * expands a detail surface (JSON, raw messages, internals) above the bar.
 */
export function StatusBar({
  segments,
  statusTone,
  inspector,
  inspectorLabel = "Inspect",
  trailing,
  placement = "bottom",
  className,
}: StatusBarProps) {
  const [open, setOpen] = useState(false);
  const inspectorId = useId();
  const isTop = placement === "top";

  const inspectorNode = inspector ? (
    <StatusInspector open={open} id={inspectorId} borderSide={isTop ? "top" : "bottom"}>
      {inspector}
    </StatusInspector>
  ) : null;

  return (
    <div
      className={`shrink-0 ${isTop ? "border-b" : "border-t"} border-[color:var(--viewer-border)] bg-[color:var(--panel-bg)] ${className ?? ""}`}
    >
      {isTop ? null : inspectorNode}

      <div className="flex h-9 items-center gap-3 px-4">
        {statusTone ? (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[statusTone]}`}
            aria-hidden
          />
        ) : null}

        <div className="flex min-w-0 flex-1 items-center gap-x-3 overflow-x-auto text-xs whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {segments.map((segment) => (
            <span
              key={segment.id}
              title={segment.title}
              className={`inline-flex shrink-0 items-center gap-1.5 ${TONE_CLASS[segment.tone ?? "muted"]}`}
            >
              {segment.icon ? (
                <span
                  className="inline-flex h-3.5 w-3.5 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5"
                  aria-hidden
                >
                  {segment.icon}
                </span>
              ) : null}
              {segment.label}
            </span>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {trailing}
          {inspector ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls={inspectorId}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] text-[color:var(--muted-ink)] transition hover:text-[color:var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--accent)]"
            >
              {inspectorLabel}
              {(isTop ? !open : open) ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>
          ) : null}
        </div>
      </div>

      {isTop ? inspectorNode : null}
    </div>
  );
}
