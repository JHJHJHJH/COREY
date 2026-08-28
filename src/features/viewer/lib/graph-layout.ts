/**
 * Layout forces for the IFC relationship graph.
 *
 * `force-graph` ships no collision force, and its d3 build is a transitive dependency rather than
 * one of ours, so the separation the graph needs is written here. Kept out of the panel component
 * because it is pure geometry over positioned nodes, and therefore testable on its own. The same
 * reasoning covers the rest of this module: the radial rings, the seeding of freshly expanded
 * nodes, and the hold that keeps a settled picture still while new nodes arrive.
 */

/** The subset of a force-simulation node this module reads and writes. */
export interface GraphLayoutNode {
  localId: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
}

const TAU = Math.PI * 2;

/** Repulsion and rest length handed to d3's own charge and link forces. */
export const CHARGE_STRENGTH = -180;
export const LINK_DISTANCE = 110;
/** Gap held between the edges of two nodes. */
export const COLLISION_PADDING = 7;
/** How hard siblings are driven towards an even share of the arc available to them. */
export const SIBLING_SPREAD = 0.35;
/** Relaxation passes of the pair separation per tick. More passes settle dense hubs faster. */
export const COLLISION_ITERATIONS = 2;
/** Distance between consecutive depth rings, measured from the root anchor. */
export const RING_GAP = 150;
/** How firmly a node is held to the ring for its depth. Soft, so collision still wins locally. */
export const RADIAL_STRENGTH = 0.25;
/** Half-width of the wedge kept clear behind a hub, on the bearing back towards its parent. */
export const BACKWARD_CLEARANCE = Math.PI / 5;
/** Ceiling on the per-tick tangential kick, so a distant spoke cannot be flung. */
export const MAX_FAN_IMPULSE = 12;
/** Arc length reserved per freshly seeded node, so a large expansion does not start stacked. */
export const SEED_ARC_SPACING = 26;
/** Seeding never pushes further out than this many ring gaps, however large the expansion. */
export const MAX_SEED_RADIUS_FACTOR = 3;
/** Ticks a settled node is held for after an expansion. */
export const STABILITY_TICKS = 90;
/** Fraction of its velocity a held node keeps at the start of a hold. */
export const STABILITY_DAMPING = 0.12;

const EMPTY_PARENTS: ReadonlyMap<number, number> = new Map();

/** Wraps an angle into `[0, 2π)`. */
function normalizeAngle(angle: number) {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

/** The shortest signed rotation from `from` to `to`, in `(-π, π]`. */
function shortestRotation(from: number, to: number) {
  return normalizeAngle(to - from + Math.PI) - Math.PI;
}

/**
 * Breadth-first depth and parent for every node reachable from the root anchor.
 *
 * First visit wins, so a cycle or a node with several parents — both routine in IFC, where an
 * element can be aggregated under one thing and contained in another — resolves to its shallowest
 * parent. That tolerance is why the layout builds its own tree rather than using `force-graph`'s
 * `dagMode`, which requires an acyclic graph.
 *
 * Nodes unreachable from the root get no entry at all; the forces read that as "no opinion" and
 * leave those nodes to charge and links alone.
 */
export function computeGraphTree(
  rootLocalId: number | null,
  adjacency: Map<number, number[]>,
): { depth: Map<number, number>; parent: Map<number, number> } {
  const depth = new Map<number, number>();
  const parent = new Map<number, number>();
  if (rootLocalId === null) return { depth, parent };

  depth.set(rootLocalId, 0);
  const queue = [rootLocalId];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const currentDepth = depth.get(current) as number;
    for (const neighbour of adjacency.get(current) ?? []) {
      if (depth.has(neighbour)) continue;
      depth.set(neighbour, currentDepth + 1);
      parent.set(neighbour, current);
      queue.push(neighbour);
    }
  }
  return { depth, parent };
}

/**
 * Holds each node on the ring for its depth, centred on the root anchor, so the graph reads as
 * growing outward from where exploration started rather than as an undirected hairball.
 *
 * Scaled by `alpha`, unlike the separation force: the rings are meant to guide the anneal and then
 * get out of the way, leaving collision — which never fades — to hold the final spacing. A level
 * with more nodes than its ring can hold therefore bulges outward instead of jittering.
 *
 * The centre follows the root node's live position rather than the world origin, so this does not
 * fight d3's centering force, which rigidly translates the whole graph every tick.
 */
export function createGraphRadialForce<Node extends GraphLayoutNode>(options: {
  depth: () => Map<number, number>;
  center: () => { x: number; y: number };
  ringGap?: number;
  strength?: number;
}) {
  let nodes: Node[] = [];
  const ringGap = options.ringGap ?? RING_GAP;
  const strength = options.strength ?? RADIAL_STRENGTH;

  const force = (alpha: number) => {
    const depth = options.depth();
    if (depth.size === 0) return;
    const center = options.center();

    for (const node of nodes) {
      const nodeDepth = depth.get(node.localId);
      if (nodeDepth === undefined || nodeDepth === 0) continue;
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;

      let offsetX = (node.x as number) - center.x;
      let offsetY = (node.y as number) - center.y;
      let distance = Math.hypot(offsetX, offsetY);
      if (distance < 1e-6) {
        // Sitting exactly on the root leaves no direction to push along. Pick one from the id so
        // the same graph resolves the same way twice.
        const bearing = (node.localId % 360) * (Math.PI / 180);
        offsetX = Math.cos(bearing);
        offsetY = Math.sin(bearing);
        distance = 1;
      }

      const pull = ((nodeDepth * ringGap - distance) * strength * alpha) / distance;
      node.vx = (node.vx ?? 0) + offsetX * pull;
      node.vy = (node.vy ?? 0) + offsetY * pull;
    }
  };

  force.initialize = (next: Node[]) => {
    nodes = next;
  };
  return force;
}

/**
 * Keeps nodes off each other, in two passes. `force-graph` registers no collision force and its d3
 * build is a transitive dependency rather than one of ours, so both are written here.
 *
 * 1. `fanOutSiblings` — the directed pass. Spreads a hub's children evenly across the arc available
 *    to them. This is what stops children of one parent from crowding together.
 * 2. A uniform-grid pair resolver for everything else: bucket nodes by cell, compare each only
 *    against its own and the neighbouring cells, and nudge apart any pair closer than the sum of
 *    their radii. Charge alone cannot do this — it falls off with distance.
 *
 * Deliberately not scaled by `alpha`, matching d3's own collision force: separation has to keep
 * holding as the simulation cools, not fade out with it.
 */
export function createGraphSeparationForce<Node extends GraphLayoutNode>(options: {
  radiusOf: (node: Node) => number;
  adjacency: () => Map<number, number[]>;
  /**
   * BFS-tree parent per node, from `computeGraphTree`. Supplying it turns the sibling fan-out from
   * a full circle into a cone pointing away from the parent. Omitted, every hub is treated as a
   * root and spreads its neighbours the whole way around.
   */
  parent?: () => Map<number, number>;
  /** Relaxation passes per tick. Defaults to `COLLISION_ITERATIONS`; exposed so it can be tested. */
  iterations?: number;
}) {
  let nodes: Node[] = [];
  let byLocalId = new Map<number, Node>();
  const { radiusOf } = options;
  const iterations = options.iterations ?? COLLISION_ITERATIONS;

  interface Spoke {
    child: Node;
    distance: number;
    angle: number;
    /** Bearing measured from the near rim of the available arc; sector branch only. */
    offset: number;
    /** `offset` clamped into the arc, which is where a spoke behind the hub wants to end up. */
    effective: number;
  }

  /**
   * Slides a child around its own arc. Tangential motion costs the link force nothing, because it
   * leaves the child's distance from the hub unchanged.
   *
   * The lever is capped at a ring gap and the impulse at `MAX_FAN_IMPULSE`: the correction scales
   * with radius, so without a cap a child that has drifted far out — exactly what a freshly
   * expanded one used to do — takes a kick large enough to sling it across the graph.
   */
  const slide = (spoke: Spoke, rotation: number) => {
    const lever = Math.min(spoke.distance, RING_GAP);
    const impulse = Math.max(
      -MAX_FAN_IMPULSE,
      Math.min(MAX_FAN_IMPULSE, rotation * SIBLING_SPREAD * lever),
    );
    // Unit tangent in the direction of increasing bearing.
    spoke.child.vx = (spoke.child.vx ?? 0) - Math.sin(spoke.angle) * impulse;
    spoke.child.vy = (spoke.child.vy ?? 0) + Math.cos(spoke.angle) * impulse;
  };

  /**
   * The directed pass. Siblings crowd because a pair push acts along the line between them, which
   * for two children of the same parent points mostly *at* the parent — straight into the link
   * force, which cancels it. So push them around the hub instead.
   *
   * Where the hub has a parent of its own, the target bearings are not the whole circle but a cone
   * opening away from that parent, with `BACKWARD_CLEARANCE` of clear sky either side of the link
   * the hub was reached by. That is what turns expansion into outward growth: a child is never
   * driven back across its own grandparent. A hub with no parent — the root anchor, or anything
   * unreachable from it — keeps the plain full-circle spread.
   */
  const fanOutSiblings = () => {
    const parents = options.parent?.() ?? EMPTY_PARENTS;

    for (const [hubLocalId, neighbourLocalIds] of options.adjacency()) {
      const hub = byLocalId.get(hubLocalId);
      if (!hub || !Number.isFinite(hub.x) || !Number.isFinite(hub.y)) continue;

      const parentLocalId = parents.get(hubLocalId);
      const spokes: Spoke[] = [];
      const seen = new Set<number>();
      for (const neighbourLocalId of neighbourLocalIds) {
        // A parent is not a sibling, and parallel relations between the same pair are one spoke.
        if (neighbourLocalId === parentLocalId || seen.has(neighbourLocalId)) continue;
        seen.add(neighbourLocalId);
        const child = byLocalId.get(neighbourLocalId);
        if (!child || !Number.isFinite(child.x) || !Number.isFinite(child.y)) continue;
        const offsetX = (child.x as number) - (hub.x as number);
        const offsetY = (child.y as number) - (hub.y as number);
        const distance = Math.hypot(offsetX, offsetY);
        if (distance < 1e-3) continue;
        spokes.push({
          child,
          distance,
          angle: Math.atan2(offsetY, offsetX),
          offset: 0,
          effective: 0,
        });
      }
      if (spokes.length === 0) continue;

      const parentNode = parentLocalId === undefined ? undefined : byLocalId.get(parentLocalId);
      const hasCone =
        parentNode !== undefined &&
        Number.isFinite(parentNode.x) &&
        Number.isFinite(parentNode.y) &&
        Math.hypot(
          (hub.x as number) - (parentNode.x as number),
          (hub.y as number) - (parentNode.y as number),
        ) >= 1e-3;

      if (!hasCone) {
        if (spokes.length < 2) continue;
        spokes.sort((left, right) => left.angle - right.angle);
        const evenShare = TAU / spokes.length;

        for (const [index, current] of spokes.entries()) {
          const next = spokes[(index + 1) % spokes.length];
          if (next === current) continue;
          let gap = next.angle - current.angle;
          if (gap < 0) gap += TAU;
          if (gap >= evenShare) continue;

          const correction = (evenShare - gap) * 0.5;
          slide(current, -correction);
          slide(next, correction);
        }
        continue;
      }

      // The cone: bearings measured from its near rim, so the arc runs 0 -> available.
      const outward = Math.atan2(
        (hub.y as number) - (parentNode.y as number),
        (hub.x as number) - (parentNode.x as number),
      );
      const available = TAU - BACKWARD_CLEARANCE * 2;
      const base = outward - available / 2;

      for (const spoke of spokes) {
        spoke.offset = normalizeAngle(spoke.angle - base);
        // Past the far rim means inside the wedge behind the hub: aim for whichever rim is nearer,
        // so the child leaves the wedge the short way rather than sweeping the whole cone.
        spoke.effective =
          spoke.offset <= available
            ? spoke.offset
            : spoke.offset - available < TAU - spoke.offset
              ? available
              : 0;
      }

      // Ranking by where each spoke belongs, not where it is, keeps a child that has to cross a
      // rim from stealing a slot in the middle of the fan on its way in.
      spokes.sort((left, right) => left.effective - right.effective);
      // The rims are fixed endpoints, so n children get n+1 gaps and sit strictly inside the cone.
      const step = available / (spokes.length + 1);
      for (const [index, spoke] of spokes.entries()) {
        // Both are bearings from the same rim, so the rotation between them is the rotation the
        // child has to make in world bearings too.
        slide(spoke, shortestRotation(spoke.offset, step * (index + 1)));
      }
    }
  };

  const force = () => {
    if (nodes.length < 2) return;
    fanOutSiblings();

    const radii = nodes.map((node) => radiusOf(node) + COLLISION_PADDING / 2);
    const cellSize = Math.max(8, Math.max(...radii) * 2);

    // Following d3's own collision force: relax against the *anticipated* position, `x + vx`, and
    // write only velocities. Each pass therefore sees the previous pass's work without anyone
    // mutating `x`/`y` behind the simulation's back.
    const anticipatedX = (node: Node) => (node.x as number) + (node.vx ?? 0);
    const anticipatedY = (node: Node) => (node.y as number) + (node.vy ?? 0);

    const bucketNodes = () => {
      const buckets = new Map<string, number[]>();
      for (const [index, node] of nodes.entries()) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
        const key = `${Math.floor(anticipatedX(node) / cellSize)}:${Math.floor(
          anticipatedY(node) / cellSize,
        )}`;
        const bucket = buckets.get(key);
        if (bucket) bucket.push(index);
        else buckets.set(key, [index]);
      }
      return buckets;
    };

    const separate = (left: number, right: number) => {
      const a = nodes[left];
      const b = nodes[right];
      const minimum = radii[left] + radii[right];
      let deltaX = anticipatedX(b) - anticipatedX(a);
      let deltaY = anticipatedY(b) - anticipatedY(a);
      let distance = Math.hypot(deltaX, deltaY);
      if (distance === 0) {
        // Exactly coincident: nudge along a stable per-pair direction rather than a random one,
        // so the same graph settles the same way twice.
        deltaX = ((left % 3) - 1) * 0.5 || 0.5;
        deltaY = ((right % 3) - 1) * 0.5 || 0.5;
        distance = Math.hypot(deltaX, deltaY);
      }
      if (distance >= minimum) return;

      const push = (((minimum - distance) / distance) * 0.5) / 2;
      const shiftX = deltaX * push;
      const shiftY = deltaY * push;
      a.vx = (a.vx ?? 0) - shiftX;
      a.vy = (a.vy ?? 0) - shiftY;
      b.vx = (b.vx ?? 0) + shiftX;
      b.vy = (b.vy ?? 0) + shiftY;
    };

    // Each pass re-buckets so it sees the previous pass's work; relaxing against stale positions
    // would just apply the same impulse twice instead of converging.
    for (let pass = 0; pass < iterations; pass += 1) {
      const buckets = bucketNodes();
      for (const [key, bucket] of buckets) {
        const [cellX, cellY] = key.split(":").map(Number);
        // Half the neighbourhood — (0,0), (0,1), (1,-1), (1,0), (1,1) — visits each pair once.
        for (let offsetX = 0; offsetX <= 1; offsetX += 1) {
          for (let offsetY = offsetX === 0 ? 0 : -1; offsetY <= 1; offsetY += 1) {
            const isSelf = offsetX === 0 && offsetY === 0;
            const others = isSelf
              ? bucket
              : buckets.get(`${cellX + offsetX}:${cellY + offsetY}`);
            if (!others) continue;
            for (const left of bucket) {
              for (const right of others) {
                if (isSelf && right <= left) continue;
                separate(left, right);
              }
            }
          }
        }
      }
    }
  };

  force.initialize = (next: Node[]) => {
    nodes = next;
    byLocalId = new Map(next.map((node) => [node.localId, node]));
  };
  return force;
}

/**
 * Gives freshly expanded nodes a starting position next to the hub they came from.
 *
 * Without this they arrive with no coordinates at all, and d3 seeds them on a phyllotaxis spiral
 * around the world origin at a bearing decided by their rank in the node list. A hub several
 * hundred units out therefore gets children born nowhere near it, and the link force drags each one
 * the whole way across the canvas — the long edges that whip in after an expansion.
 *
 * They are laid on an arc opening away from the hub's own parent, matching where the cone in
 * `createGraphSeparationForce` is going to put them anyway, so the simulation refines the fan
 * rather than building it. Pure and deterministic: the same expansion twice gives the same picture.
 */
export function seedNodePositions(options: {
  hub: GraphLayoutNode;
  parent?: GraphLayoutNode | null;
  nodes: GraphLayoutNode[];
  /** Distance from the hub. Widened when the arc is too short to hold everyone. */
  radius?: number;
}) {
  const { hub, parent, nodes } = options;
  if (nodes.length === 0) return;
  if (!Number.isFinite(hub.x) || !Number.isFinite(hub.y)) return;

  const hubX = hub.x as number;
  const hubY = hub.y as number;
  const radius = options.radius ?? RING_GAP;
  const available = TAU - BACKWARD_CLEARANCE * 2;

  let outward: number;
  if (
    parent &&
    Number.isFinite(parent.x) &&
    Number.isFinite(parent.y) &&
    Math.hypot(hubX - (parent.x as number), hubY - (parent.y as number)) >= 1e-3
  ) {
    outward = Math.atan2(hubY - (parent.y as number), hubX - (parent.x as number));
  } else if (Math.hypot(hubX, hubY) >= 1e-3) {
    // No parent to point away from, so grow away from the middle of the graph instead.
    outward = Math.atan2(hubY, hubX);
  } else {
    outward = 0;
  }

  // Wide enough that the children do not start stacked, capped so a full page of them does not
  // fling the ring off screen — collision and the rings settle the rest.
  const arcFit = (nodes.length * SEED_ARC_SPACING) / available;
  const seedRadius = Math.min(Math.max(radius, arcFit), radius * MAX_SEED_RADIUS_FACTOR);

  const step = available / (nodes.length + 1);
  for (const [index, node] of nodes.entries()) {
    const angle = outward - available / 2 + step * (index + 1);
    node.x = hubX + Math.cos(angle) * seedRadius;
    node.y = hubY + Math.sin(angle) * seedRadius;
    node.vx = 0;
    node.vy = 0;
  }
}

/**
 * Damps the nodes that were already placed, for a short spell after an expansion.
 *
 * `force-graph` re-heats to alpha 1 on every change of graph data and offers no way to ask for less,
 * so without this the whole picture re-anneals from scratch each time the reader opens one node.
 * Holding the settled nodes back — rather than pinning them with `fx`/`fy` — lets the new arrivals
 * push in and find room, while the layout the reader was looking at stays where they left it.
 *
 * The damping ramps back to 1 across the hold so the held nodes rejoin gradually instead of
 * regaining full speed on a single frame.
 */
export function createGraphStabilityForce<Node extends GraphLayoutNode>(options?: {
  ticks?: number;
  damping?: number;
}) {
  let nodes: Node[] = [];
  let held = new Set<number>();
  let remaining = 0;
  const totalTicks = options?.ticks ?? STABILITY_TICKS;
  const floor = options?.damping ?? STABILITY_DAMPING;

  const force = () => {
    if (remaining <= 0 || held.size === 0) return;
    const factor = floor + (1 - floor) * (1 - remaining / totalTicks);
    for (const node of nodes) {
      if (!held.has(node.localId)) continue;
      node.vx = (node.vx ?? 0) * factor;
      node.vy = (node.vy ?? 0) * factor;
    }
    remaining -= 1;
    if (remaining <= 0) held = new Set();
  };

  force.initialize = (next: Node[]) => {
    nodes = next;
  };
  /** Starts a fresh hold over `localIds`. Anything not listed — the new nodes — moves freely. */
  force.hold = (localIds: Iterable<number>) => {
    held = new Set(localIds);
    remaining = held.size > 0 ? totalTicks : 0;
  };
  /** True while a hold is still damping. Exposed for tests. */
  force.isHolding = () => remaining > 0;
  return force;
}
