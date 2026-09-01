"use client";

import dynamic from "next/dynamic";
import type { KnowledgeCitation } from "@/features/viewer/types";

const PdfEvidenceViewerInner = dynamic(
  () =>
    import("@/features/viewer/components/pdf-evidence-viewer-inner").then(
      (module) => module.PdfEvidenceViewerInner,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="grid h-full min-h-56 place-items-center text-xs text-[color:var(--muted-ink)]">
        Loading document viewer…
      </div>
    ),
  },
);

export function PdfEvidenceViewer({ citation }: { citation: KnowledgeCitation }) {
  return <PdfEvidenceViewerInner citation={citation} />;
}
