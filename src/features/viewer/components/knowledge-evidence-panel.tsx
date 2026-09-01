"use client";

import { ExternalLink, FileSpreadsheet, X } from "lucide-react";
import { PdfEvidenceViewer } from "@/features/viewer/components/pdf-evidence-viewer";
import { formatKnowledgeLocator } from "@/features/viewer/lib/pdf-evidence";
import type { KnowledgeCitation } from "@/features/viewer/types";

function CitationCard({
  citation,
  active,
  onSelect,
}: {
  citation: KnowledgeCitation;
  active: boolean;
  onSelect: (citation: KnowledgeCitation) => void;
}) {
  return (
    <article
      className={`relative rounded-[var(--r-control)] border p-3 transition ${
        active
          ? "border-[color:var(--accent)] bg-[color:var(--accent-wash)]"
          : "border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] hover:border-[color:var(--viewer-border-strong)]"
      }`}
    >
      <button
        type="button"
        aria-label={`Show ${citation.id} in the evidence viewer`}
        onClick={() => onSelect(citation)}
        className="absolute inset-0 z-10 rounded-[var(--r-control)]"
      />
      <div className="relative z-20 pointer-events-none">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-ink)]">
          <span className="rounded-[var(--r-chip)] bg-[color:var(--accent)] px-1.5 py-0.5 text-[color:var(--accent-ink)]">
            {citation.id}
          </span>
          <span>{formatKnowledgeLocator(citation.locator)}</span>
        </div>
        <div className="mt-2 text-xs font-semibold text-[color:var(--foreground)]">
          {citation.title}
        </div>
        <p className="mt-1.5 line-clamp-3 text-[11px] leading-4 text-[color:var(--muted-ink)]">
          {citation.excerpt}
        </p>
        {citation.officialUrl ? (
          <a
            href={citation.officialUrl}
            target="_blank"
            rel="noreferrer"
            className="pointer-events-auto relative z-30 mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-[color:var(--accent)]"
          >
            Official source <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
    </article>
  );
}

export function KnowledgeEvidencePanel({
  citations,
  selected,
  onClose,
  onSelect,
}: {
  citations: KnowledgeCitation[];
  selected: KnowledgeCitation | null;
  onClose: () => void;
  onSelect: (citation: KnowledgeCitation) => void;
}) {
  return (
    <aside
      aria-label="Knowledge evidence viewer"
      className="grid h-full min-h-0 grid-rows-[3.5rem_minmax(15rem,1fr)_auto_minmax(0,0.55fr)] overflow-hidden bg-[color:var(--panel-bg)]"
    >
      <header className="flex items-center justify-between gap-3 border-b border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-4">
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[color:var(--muted-ink)]">
            Evidence
          </div>
          <div className="truncate text-xs font-semibold text-[color:var(--foreground)]">
            {selected ? formatKnowledgeLocator(selected.locator) : "Sources used"}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close evidence viewer"
          onClick={onClose}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r-control)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)]"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {selected?.locator.page ? (
        <PdfEvidenceViewer citation={selected} />
      ) : selected ? (
        <div className="min-h-0 overflow-auto bg-[color:var(--surface-soft)] p-5">
          <FileSpreadsheet className="h-7 w-7 text-[color:var(--accent)]" />
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[color:var(--accent)]">
            {formatKnowledgeLocator(selected.locator)}
          </div>
          <h3 className="mt-1 text-sm font-semibold">{selected.title}</h3>
          {selected.structuredFields?.length ? (
            <dl className="mt-4 overflow-hidden rounded-[var(--r-control)] border border-[color:var(--viewer-border)]">
              {selected.structuredFields.map((field, index) => (
                <div
                  key={`${field.label}-${index}`}
                  className="grid grid-cols-[minmax(7rem,0.38fr)_minmax(0,1fr)] border-b border-[color:var(--viewer-border)] last:border-b-0"
                >
                  <dt className="bg-[color:var(--surface-strong)] px-3 py-2 text-[10px] font-semibold text-[color:var(--muted-ink)]">
                    {field.label}
                  </dt>
                  <dd className="m-0 break-words px-3 py-2 text-[11px] text-[color:var(--foreground)]">
                    {field.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <blockquote className="mt-4 border-l-2 border-[color:var(--accent)] pl-3 text-xs leading-5 text-[color:var(--muted-ink)]">
              {selected.excerpt}
            </blockquote>
          )}
        </div>
      ) : (
        <div className="grid min-h-60 place-items-center p-8 text-center text-xs leading-5 text-[color:var(--muted-ink)]">
          Select a citation to open its exact PDF page or workbook row.
        </div>
      )}

      {selected ? (
        <div className="border-y border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-4 py-2.5">
          <div className="text-[10px] font-bold text-[color:var(--accent)]">{selected.id}</div>
          <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-[color:var(--muted-ink)]">
            {selected.excerpt}
          </p>
        </div>
      ) : (
        <div />
      )}

      <div className="min-h-0 space-y-2 overflow-y-auto p-3">
        {citations.map((citation) => (
          <CitationCard
            key={citation.evidenceId}
            citation={citation}
            active={citation.evidenceId === selected?.evidenceId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </aside>
  );
}
