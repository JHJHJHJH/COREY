import type { CSSProperties } from "react";

import type { ViewerValidationSeverity } from "@/features/viewer/types";

/**
 * Severity colours are user-configured, so they cannot be baked into the `--danger-*` /
 * `--warning-*` token triples. Each element instead carries one base colour and the tones are
 * derived from it in `globals.css`. See the `.sev-*` classes there for the light/dark recipes.
 */
export const SEVERITY_TONE_CLASS = "sev-tone";
export const SEVERITY_TEXT_CLASS = "sev-fg";
export const SEVERITY_SURFACE_CLASS = "sev-bg";
export const SEVERITY_DOT_CLASS = "sev-dot";
export const SEVERITY_RAIL_CLASS = "sev-rail";

/**
 * Inline custom property carrying the base colour. Must sit on the same element as the `.sev-*`
 * class — the derived properties are substituted at computed-value time, so setting the base on
 * an ancestor would not reach them.
 */
export function severityCssVars(color: string | null | undefined): CSSProperties {
  return color ? ({ "--sev-base": color } as CSSProperties) : {};
}

export function severityStyleProps(severity: ViewerValidationSeverity | null | undefined) {
  return {
    className: SEVERITY_TONE_CLASS,
    style: severityCssVars(severity?.color),
  };
}
