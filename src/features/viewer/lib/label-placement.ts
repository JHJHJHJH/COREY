/**
 * Collision-based label placement for the relationship graph.
 *
 * Spacing cannot solve label overlap: labels render at a fixed pixel size, so in graph units one
 * is `width / zoom` wide — around 128 units for a typical `IFCFURNISHINGELEMENT #448178` against a
 * link distance of 110. Eight children on a hub already have less arc each than one label needs,
 * and a hundred would need a ring radius of ~2000. No repulsion setting closes that gap.
 *
 * So labels are *placed* rather than spaced, the way map renderers do it: walk them in priority
 * order and skip any whose box overlaps one already placed. Because a label's footprint in graph
 * units shrinks as the view zooms in, more of them fit — and appear — the closer the user looks.
 */

export interface LabelBox {
  /** Left edge, in whatever space the caller measures in — screen pixels here. */
  x: number;
  /** Top edge. */
  y: number;
  width: number;
  height: number;
}

export interface LabelCandidate<T> {
  subject: T;
  box: LabelBox;
  /**
   * Higher wins a contested box. Callers rank the labels that matter — the selection, the node
   * under the pointer, search hits — above the merely well-connected.
   */
  priority: number;
}

/**
 * Axis-aligned bounds of a `width` x `height` box rotated by `angle` radians. Rotated text needs
 * this: measuring a near-vertical label by its unrotated width would give it a wide, short box —
 * the opposite of the space it really occupies — and let stacked labels through.
 */
export function rotatedLabelBounds(width: number, height: number, angle: number) {
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

function intersects(left: LabelBox, right: LabelBox) {
  return (
    left.x < right.x + right.width &&
    right.x < left.x + left.width &&
    left.y < right.y + right.height &&
    right.y < left.y + left.height
  );
}

/**
 * Returns the candidates that fit, highest priority first. Ties keep the order they arrived in, so
 * a stable input ordering gives a stable picture frame to frame rather than labels flickering as
 * equal-ranked candidates trade places.
 */
export function placeLabels<T>(
  candidates: LabelCandidate<T>[],
  options?: { limit?: number; padding?: number },
): LabelCandidate<T>[] {
  const padding = options?.padding ?? 0;
  const limit = options?.limit ?? Number.POSITIVE_INFINITY;
  if (candidates.length === 0 || limit <= 0) return [];

  const ranked = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) =>
      right.candidate.priority - left.candidate.priority || left.index - right.index,
    );

  const placed: LabelCandidate<T>[] = [];
  const claimed: LabelBox[] = [];
  for (const { candidate } of ranked) {
    if (placed.length >= limit) break;
    const box = padding
      ? {
          x: candidate.box.x - padding,
          y: candidate.box.y - padding,
          width: candidate.box.width + padding * 2,
          height: candidate.box.height + padding * 2,
        }
      : candidate.box;
    if (claimed.some((taken) => intersects(taken, box))) continue;
    claimed.push(box);
    placed.push(candidate);
  }

  return placed;
}
