import type { CSSProperties } from "react";
import type { KnowledgeCitation } from "@/features/viewer/types";

export function citationRectPercent(
  bbox: readonly number[],
  pageWidth: number,
  pageHeight: number,
): CSSProperties {
  const [rawX0, rawY0, rawX1, rawY1] = bbox;
  const x0 = Math.max(0, Math.min(pageWidth, Math.min(rawX0, rawX1) - 3));
  const y0 = Math.max(0, Math.min(pageHeight, Math.min(rawY0, rawY1) - 3));
  const x1 = Math.max(x0, Math.min(pageWidth, Math.max(rawX0, rawX1) + 3));
  const y1 = Math.max(y0, Math.min(pageHeight, Math.max(rawY0, rawY1) + 3));
  return {
    left: `${(x0 / pageWidth) * 100}%`,
    top: `${(y0 / pageHeight) * 100}%`,
    width: `${((x1 - x0) / pageWidth) * 100}%`,
    height: `${((y1 - y0) / pageHeight) * 100}%`,
  };
}

export function formatKnowledgeLocator(locator: KnowledgeCitation["locator"]) {
  if (locator.page) return `Page ${locator.page}`;
  if (locator.sheet) {
    if (locator.cells) return `${locator.sheet} · ${locator.cells}`;
    if (locator.rowStart) {
      return locator.rowEnd && locator.rowEnd !== locator.rowStart
        ? `${locator.sheet} · rows ${locator.rowStart}–${locator.rowEnd}`
        : `${locator.sheet} · row ${locator.rowStart}`;
    }
    return locator.sheet;
  }
  return "Source location";
}
