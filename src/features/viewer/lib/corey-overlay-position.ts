export type CoreyOverlayPoint = {
  x: number;
  y: number;
};

export type CoreyOverlaySize = {
  width: number;
  height: number;
};

export const COREY_OVERLAY_MARGIN = 16;
export const COREY_DRAG_THRESHOLD = 4;

export function clampCoreyOverlayPoint(
  point: CoreyOverlayPoint,
  viewport: CoreyOverlaySize,
  surface: CoreyOverlaySize,
  margin = COREY_OVERLAY_MARGIN,
): CoreyOverlayPoint {
  const maximumX = Math.max(margin, viewport.width - surface.width - margin);
  const maximumY = Math.max(margin, viewport.height - surface.height - margin);
  return {
    x: Math.min(Math.max(point.x, margin), maximumX),
    y: Math.min(Math.max(point.y, margin), maximumY),
  };
}

export function exceededCoreyDragThreshold(deltaX: number, deltaY: number) {
  return Math.hypot(deltaX, deltaY) >= COREY_DRAG_THRESHOLD;
}

export function parseStoredCoreyOverlayPoint(value: string | null): CoreyOverlayPoint | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CoreyOverlayPoint>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x as number, y: parsed.y as number };
  } catch {
    return null;
  }
}
