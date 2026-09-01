"use client";

import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { citationRectPercent } from "@/features/viewer/lib/pdf-evidence";
import type { KnowledgeCitation } from "@/features/viewer/types";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";

const documentOptions = {
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  disableRange: false,
  disableStream: true,
  disableAutoFetch: true,
  rangeChunkSize: 256 * 1024,
};
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.25;

function PageNumberInput({
  page,
  total,
  onCommit,
}: {
  page: number;
  total: number;
  onCommit: (page: number) => void;
}) {
  const [value, setValue] = useState(String(page));
  const commit = (event?: FormEvent) => {
    event?.preventDefault();
    const parsed = Number.parseInt(value, 10);
    const next = Number.isFinite(parsed) ? Math.min(total || page, Math.max(1, parsed)) : page;
    setValue(String(next));
    onCommit(next);
  };
  return (
    <form className="flex items-center gap-1 text-[10px]" onSubmit={commit}>
      <label className="sr-only" htmlFor="corey-pdf-page-input">
        PDF page
      </label>
      <input
        id="corey-pdf-page-input"
        inputMode="numeric"
        value={value}
        onBlur={() => commit()}
        onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))}
        className="h-7 w-10 rounded-[var(--r-chip)] border border-[color:var(--viewer-border)] bg-[color:var(--surface-soft)] px-1 text-center tabular-nums outline-none focus:border-[color:var(--accent)]"
      />
      <span className="whitespace-nowrap text-[color:var(--muted-ink)]">/ {total || "—"}</span>
    </form>
  );
}

function LoadingPage({ page, onRetry }: { page: number; onRetry: () => void }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8_000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex min-h-56 flex-col items-center justify-center gap-2 p-8 text-center text-xs text-slate-200">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/25 border-t-white" />
      <strong>{slow ? "This page is taking longer than expected" : `Opening page ${page}`}</strong>
      <span className="max-w-72 text-[10px] text-slate-300">
        {slow
          ? "The conversation remains available while the source loads."
          : "Loading only the evidence needed for this page…"}
      </span>
      {slow ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1 rounded-[var(--r-chip)] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-800"
        >
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      ) : null}
    </div>
  );
}

export function PdfEvidenceViewerInner({ citation }: { citation: KnowledgeCitation }) {
  const targetPage = citation.locator.page ?? 1;
  const [navigation, setNavigation] = useState({
    evidenceId: citation.evidenceId,
    page: targetPage,
  });
  const [numPages, setNumPages] = useState(0);
  const [containerWidth, setContainerWidth] = useState(520);
  const [zoom, setZoom] = useState(1);
  const [pageDimensions, setPageDimensions] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [rendered, setRendered] = useState<{ evidenceId: string; page: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const currentPage =
    navigation.evidenceId === citation.evidenceId ? navigation.page : targetPage;
  const file = useMemo(
    () => ({
      url: `/api/knowledge/documents/${encodeURIComponent(citation.documentId)}/content`,
    }),
    [citation.documentId],
  );
  const renderWidth = Math.max(240, Math.round((containerWidth - 24) * zoom));
  const highlight =
    citation.locator.bbox && pageDimensions
      ? citationRectPercent(
          citation.locator.bbox,
          pageDimensions.width,
          pageDimensions.height,
        )
      : null;
  const highlightVisible =
    rendered?.evidenceId === citation.evidenceId &&
    rendered.page === currentPage &&
    currentPage === targetPage;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const goToPage = (page: number) => {
    const next = Math.min(numPages || page, Math.max(1, page));
    setNavigation({ evidenceId: citation.evidenceId, page: next });
    setRendered(null);
    setPageDimensions(null);
    setError(null);
  };
  const retryLoad = () => {
    setError(null);
    setRendered(null);
    setRetry((value) => value + 1);
  };
  const keyboardNavigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === "ArrowLeft" && currentPage > 1) goToPage(currentPage - 1);
    if (event.key === "ArrowRight" && currentPage < numPages) goToPage(currentPage + 1);
  };
  const toolbarButton =
    "grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r-chip)] text-[color:var(--muted-ink)] transition hover:bg-[color:var(--surface-hover)] hover:text-[color:var(--foreground)] disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <div className="grid h-full min-h-56 grid-rows-[2.75rem_minmax(0,1fr)] overflow-hidden bg-slate-700">
      <div className="flex min-w-0 items-center gap-1 border-b border-[color:var(--viewer-border)] bg-[color:var(--surface-strong)] px-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={currentPage <= 1}
          onClick={() => goToPage(currentPage - 1)}
          className={toolbarButton}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <PageNumberInput
          key={`${citation.evidenceId}-${currentPage}`}
          page={currentPage}
          total={numPages}
          onCommit={goToPage}
        />
        <button
          type="button"
          aria-label="Next page"
          disabled={!numPages || currentPage >= numPages}
          onClick={() => goToPage(currentPage + 1)}
          className={toolbarButton}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}
          className={toolbarButton}
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="w-9 text-center text-[9px] tabular-nums text-[color:var(--muted-ink)]">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}
          className={toolbarButton}
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Fit page width"
          disabled={zoom === 1}
          onClick={() => setZoom(1)}
          className={toolbarButton}
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={viewportRef}
        tabIndex={0}
        onKeyDown={keyboardNavigate}
        className="min-h-0 overflow-auto bg-slate-700 p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--accent)]"
      >
        {error ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-2 p-8 text-center text-xs text-red-100">
            <strong>The evidence page could not be opened.</strong>
            <span className="max-w-sm text-[10px] text-red-200">{error}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={retryLoad}
                className="rounded-[var(--r-chip)] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-800"
              >
                Retry
              </button>
              {citation.officialUrl ? (
                <a
                  href={citation.officialUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-[var(--r-chip)] border border-white/40 px-2.5 py-1.5 text-[10px] text-white"
                >
                  Official PDF
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <Document
            file={file}
            key={`${citation.documentId}-${retry}`}
            loading={<LoadingPage key={`document-${retry}`} page={currentPage} onRetry={retryLoad} />}
            onLoadError={(caught: Error) => setError(caught.message)}
            onLoadSuccess={(document: PDFDocumentProxy) => {
              setNumPages(document.numPages);
              if (currentPage > document.numPages) goToPage(document.numPages);
            }}
            options={documentOptions}
          >
            <div
              className="relative mx-auto min-h-56 bg-white shadow-2xl"
              style={{ width: renderWidth }}
            >
              <Page
                canvasBackground="#ffffff"
                devicePixelRatio={Math.min(window.devicePixelRatio || 1, 1.5)}
                error={<div className="grid min-h-56 place-items-center">Page unavailable.</div>}
                key={`${citation.evidenceId}-${currentPage}-${renderWidth}`}
                loading={<LoadingPage page={currentPage} onRetry={retryLoad} />}
                onLoadError={(caught: Error) => setError(caught.message)}
                onLoadSuccess={(page: PDFPageProxy & { originalWidth?: number; originalHeight?: number }) => {
                  const viewport = page.getViewport({ scale: 1 });
                  setPageDimensions({
                    width: page.originalWidth ?? viewport.width,
                    height: page.originalHeight ?? viewport.height,
                  });
                }}
                onRenderError={(caught: Error) => setError(caught.message)}
                onRenderSuccess={() =>
                  setRendered({ evidenceId: citation.evidenceId, page: currentPage })
                }
                pageNumber={currentPage}
                renderAnnotationLayer={false}
                renderTextLayer={false}
                width={renderWidth}
              />
              {highlight && highlightVisible ? (
                <span
                  aria-label={`Highlighted evidence ${citation.id}`}
                  className="pointer-events-none absolute z-[3] rounded-sm border-2 border-amber-600 bg-amber-300/35 shadow-[0_0_0_1px_rgba(255,255,255,0.6)]"
                  style={highlight}
                />
              ) : null}
            </div>
          </Document>
        )}
      </div>
    </div>
  );
}
