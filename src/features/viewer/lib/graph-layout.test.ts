import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKWARD_CLEARANCE,
  COLLISION_PADDING,
  computeGraphTree,
  createGraphRadialForce,
  createGraphSeparationForce,
  createGraphStabilityForce,
  type GraphLayoutNode,
  RING_GAP,
  seedNodePositions,
  STABILITY_DAMPING,
} from "./graph-layout";

function node(localId: number, x: number, y: number): GraphLayoutNode {
  return { localId, x, y, vx: 0, vy: 0 };
}

/** Runs the force to convergence the way the simulation would, integrating velocity into position. */
function settle(
  nodes: GraphLayoutNode[],
  adjacency: Map<number, number[]>,
  { radius = 4, ticks = 400, parent = new Map<number, number>() } = {},
) {
  const force = createGraphSeparationForce<GraphLayoutNode>({
    radiusOf: () => radius,
    adjacency: () => adjacency,
    parent: () => parent,
  });
  force.initialize(nodes);
  for (let tick = 0; tick < ticks; tick += 1) {
    for (const current of nodes) {
      current.vx = 0;
      current.vy = 0;
    }
    force();
    for (const current of nodes) {
      current.x = (current.x ?? 0) + (current.vx ?? 0);
      current.y = (current.y ?? 0) + (current.vy ?? 0);
    }
  }
  return nodes;
}

function bearing(child: GraphLayoutNode, hub: GraphLayoutNode) {
  return Math.atan2((child.y ?? 0) - (hub.y ?? 0), (child.x ?? 0) - (hub.x ?? 0));
}

function smallestGap(children: GraphLayoutNode[], hub: GraphLayoutNode) {
  const angles = children.map((child) => bearing(child, hub)).sort((a, b) => a - b);
  let smallest = Infinity;
  for (const [index, angle] of angles.entries()) {
    const next = angles[(index + 1) % angles.length];
    let gap = next - angle;
    if (gap < 0) gap += Math.PI * 2;
    smallest = Math.min(smallest, gap);
  }
  return smallest;
}

function closestPair(nodes: GraphLayoutNode[]) {
  let closest = Infinity;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      closest = Math.min(
        closest,
        Math.hypot((nodes[j].x ?? 0) - (nodes[i].x ?? 0), (nodes[j].y ?? 0) - (nodes[i].y ?? 0)),
      );
    }
  }
  return closest;
}

test("siblings crowded onto one bearing fan out around their hub", () => {
  const hub = node(0, 0, 0);
  // Eight children bunched into a 20-degree wedge, all 100 from the hub.
  const children = Array.from({ length: 8 }, (_, index) => {
    const angle = (index * (Math.PI / 90)) - Math.PI / 18;
    return node(index + 1, Math.cos(angle) * 100, Math.sin(angle) * 100);
  });
  const adjacency = new Map([[0, children.map((child) => child.localId)]]);

  const gapBefore = smallestGap(children, hub);
  settle([hub, ...children], adjacency);
  const gapAfter = smallestGap(children, hub);

  assert.ok(gapBefore < 0.04, `expected a crowded start, got ${gapBefore}`);
  // An even share of the circle for eight children is 45 degrees.
  const evenShare = (Math.PI * 2) / 8;
  assert.ok(
    gapAfter > evenShare * 0.9,
    `expected roughly even spacing (>${evenShare * 0.9}), got ${gapAfter}`,
  );
});

test("fanning out preserves each child's distance from its hub", () => {
  const hub = node(0, 0, 0);
  const children = Array.from({ length: 6 }, (_, index) => {
    const angle = index * 0.05;
    return node(index + 1, Math.cos(angle) * 120, Math.sin(angle) * 120);
  });
  settle([hub, ...children], new Map([[0, children.map((child) => child.localId)]]));

  for (const child of children) {
    const distance = Math.hypot(child.x ?? 0, child.y ?? 0);
    // Tangential motion must not drag children in or out, or it would fight the link force.
    assert.ok(
      Math.abs(distance - 120) < 12,
      `expected the child to stay ~120 from the hub, got ${distance}`,
    );
  }
});

test("overlapping nodes with no shared hub are still pushed apart", () => {
  const radius = 5;
  const nodes = [node(1, 0, 0), node(2, 1.5, 0), node(3, 0, 1.5)];
  settle(nodes, new Map(), { radius });

  assert.ok(
    closestPair(nodes) >= radius * 2 + COLLISION_PADDING - 1,
    `expected separation of about ${radius * 2 + COLLISION_PADDING}, got ${closestPair(nodes)}`,
  );
});

test("a dense hub separates every one of its children", () => {
  const hub = node(0, 0, 0);
  // 60 children on nearly the same bearing — the storey case that started this.
  const children = Array.from({ length: 60 }, (_, index) =>
    node(index + 1, 100 + (index % 5) * 0.3, index * 0.2),
  );
  const nodes = [hub, ...children];
  settle(nodes, new Map([[0, children.map((child) => child.localId)]]), { radius: 4 });

  const closest = closestPair(children);
  assert.ok(closest > 4 * 2, `expected no child pair closer than a diameter, got ${closest}`);
});

test("the force leaves a single child alone", () => {
  const hub = node(0, 0, 0);
  const only = node(1, 100, 0);
  settle([hub, only], new Map([[0, [1]]]));

  assert.equal(Math.round(only.x ?? 0), 100);
  assert.equal(Math.round(only.y ?? 0), 0);
});

test("a second relaxation pass leaves less overlap than one, per tick", () => {
  const crowded = () => [
    node(1, 0, 0),
    node(2, 2, 0),
    node(3, 4, 0),
    node(4, 1, 2),
    node(5, 3, 2),
  ];
  const radius = 6;

  /** Total overlap left after a single tick, using the anticipated positions the force works on. */
  const overlapAfterOneTick = (iterations: number) => {
    const nodes = crowded();
    const force = createGraphSeparationForce<GraphLayoutNode>({
      radiusOf: () => radius,
      adjacency: () => new Map(),
      iterations,
    });
    force.initialize(nodes);
    force();

    const at = (current: GraphLayoutNode) => ({
      x: (current.x ?? 0) + (current.vx ?? 0),
      y: (current.y ?? 0) + (current.vy ?? 0),
    });
    let overlap = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = at(nodes[i]);
        const b = at(nodes[j]);
        const minimum = radius * 2 + COLLISION_PADDING;
        overlap += Math.max(0, minimum - Math.hypot(b.x - a.x, b.y - a.y));
      }
    }
    return overlap;
  };

  const single = overlapAfterOneTick(1);
  const double = overlapAfterOneTick(2);
  // Before the fix both passes re-bucketed identical positions, so the second added nothing.
  assert.ok(double < single, `expected two passes to beat one, got ${double} vs ${single}`);
});

test("the tree is the shortest route from the root, cycles and all", () => {
  //   0 ── 1 ── 3
  //   │     │
  //   2 ────┘        3 also hangs off 2, two hops away either route.
  const adjacency = new Map([
    [0, [1, 2]],
    [1, [0, 2, 3]],
    [2, [0, 1]],
    [3, [1]],
    [9, [10]],
    [10, [9]],
  ]);
  const { depth, parent } = computeGraphTree(0, adjacency);

  assert.deepEqual([...depth.entries()].sort(), [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 2],
  ]);
  // The cycle 0-1-2-0 must not deepen anything: 2 is reached from the root, not through 1.
  assert.equal(parent.get(2), 0);
  assert.equal(parent.get(3), 1);
  assert.equal(parent.has(0), false);
  // A component the reader has not connected to the anchor gets no opinion at all.
  assert.equal(depth.has(9), false);
});

test("a graph with no anchor yet has no tree", () => {
  const { depth, parent } = computeGraphTree(null, new Map([[0, [1]]]));
  assert.equal(depth.size, 0);
  assert.equal(parent.size, 0);
});

/** Relaxes the radial force alone, integrating velocity into position the way the simulation does. */
function settleRadial(
  nodes: GraphLayoutNode[],
  depth: Map<number, number>,
  { ticks = 400, center = { x: 0, y: 0 } } = {},
) {
  const force = createGraphRadialForce<GraphLayoutNode>({
    depth: () => depth,
    center: () => center,
  });
  force.initialize(nodes);
  for (let tick = 0; tick < ticks; tick += 1) {
    for (const current of nodes) {
      current.vx = 0;
      current.vy = 0;
    }
    force(1);
    for (const current of nodes) {
      current.x = (current.x ?? 0) + (current.vx ?? 0);
      current.y = (current.y ?? 0) + (current.vy ?? 0);
    }
  }
  return nodes;
}

test("each node is drawn onto the ring for its depth", () => {
  const near = node(1, 40, 0); // depth 2, far too close in
  const far = node(2, 0, 900); // depth 1, far too far out
  const settled = node(3, RING_GAP, 0); // already where it belongs
  const stranger = node(4, 33, 44); // no depth: not reachable from the anchor
  const depth = new Map([
    [1, 2],
    [2, 1],
    [3, 1],
  ]);

  settleRadial([near, far, settled, stranger], depth);

  assert.ok(
    Math.abs(Math.hypot(near.x ?? 0, near.y ?? 0) - RING_GAP * 2) < 1,
    `expected the depth-2 node on the second ring, got ${Math.hypot(near.x ?? 0, near.y ?? 0)}`,
  );
  assert.ok(Math.abs(Math.hypot(far.x ?? 0, far.y ?? 0) - RING_GAP) < 1);
  assert.ok(Math.abs(Math.hypot(settled.x ?? 0, settled.y ?? 0) - RING_GAP) < 1);
  // Radial pull is purely radial: bearings are left to the fan-out and the links.
  assert.ok(Math.abs(Math.atan2(near.y ?? 0, near.x ?? 0)) < 1e-9);
  assert.deepEqual({ x: stranger.x, y: stranger.y }, { x: 33, y: 44 });
});

test("the rings are measured from the anchor wherever it has drifted to", () => {
  const child = node(1, 700, 500);
  settleRadial([child], new Map([[1, 1]]), { center: { x: 600, y: 500 } });

  assert.ok(
    Math.abs(Math.hypot((child.x ?? 0) - 600, (child.y ?? 0) - 500) - RING_GAP) < 1,
    `expected a ring gap from the anchor, got ${Math.hypot((child.x ?? 0) - 600, (child.y ?? 0) - 500)}`,
  );
});

test("a hub's children fan into the cone away from its parent, never behind it", () => {
  const parentNode = node(9, -200, 0);
  const hub = node(0, 0, 0);
  // Six children scattered right around the hub, two of them squarely behind it.
  const children = Array.from({ length: 6 }, (_, index) => {
    const angle = (index * Math.PI * 2) / 6;
    return node(index + 1, Math.cos(angle) * 120, Math.sin(angle) * 120);
  });

  const adjacency = new Map<number, number[]>([
    [9, [0]],
    [0, [9, ...children.map((child) => child.localId)]],
    ...children.map((child) => [child.localId, [0]] as [number, number[]]),
  ]);
  const parent = new Map<number, number>([
    [0, 9],
    ...children.map((child) => [child.localId, 0] as [number, number]),
  ]);

  settle([parentNode, hub, ...children], adjacency, { parent });

  // The parent sits at bearing pi from the hub; nothing may come within the clearance of it.
  for (const child of children) {
    const offset = Math.abs(Math.PI - Math.abs(bearing(child, hub)));
    assert.ok(
      offset > BACKWARD_CLEARANCE - 0.02,
      `expected the child clear of the wedge behind the hub, got ${offset} from the parent bearing`,
    );
  }

  // Inside the cone they should be evenly spread: n children make n+1 gaps against the two rims.
  const available = Math.PI * 2 - BACKWARD_CLEARANCE * 2;
  const step = available / (children.length + 1);
  const bearings = children.map((child) => bearing(child, hub)).sort((a, b) => a - b);
  const gaps = [
    bearings[0] - (-available / 2),
    ...bearings.slice(1).map((angle, index) => angle - bearings[index]),
    available / 2 - bearings[bearings.length - 1],
  ];
  for (const gap of gaps) {
    assert.ok(Math.abs(gap - step) < 0.1, `expected even gaps of ${step}, got ${gap}`);
  }
});

test("the anchor itself still spreads its children the whole way around", () => {
  const hub = node(0, 0, 0);
  const children = Array.from({ length: 4 }, (_, index) =>
    node(index + 1, Math.cos(index * 0.05) * 120, Math.sin(index * 0.05) * 120),
  );
  // No parent entry for the hub: it is the root the reader started from.
  settle([hub, ...children], new Map([[0, children.map((child) => child.localId)]]));

  const evenShare = (Math.PI * 2) / 4;
  assert.ok(
    smallestGap(children, hub) > evenShare * 0.9,
    `expected the full circle to be used, got ${smallestGap(children, hub)}`,
  );
});

test("expanded nodes are seeded around their hub, in the cone away from its parent", () => {
  const parentNode = node(9, 0, 0);
  const hub = node(0, 300, 0);
  const fresh: GraphLayoutNode[] = Array.from({ length: 5 }, (_, index) => ({
    localId: index + 1,
  }));

  seedNodePositions({ hub, parent: parentNode, nodes: fresh });

  const available = Math.PI * 2 - BACKWARD_CLEARANCE * 2;
  for (const seeded of fresh) {
    // Next to the hub, not on a spiral around the world origin.
    const distance = Math.hypot((seeded.x ?? 0) - 300, (seeded.y ?? 0) - 0);
    assert.ok(
      Math.abs(distance - RING_GAP) < 1,
      `expected a seed a ring gap from the hub, got ${distance}`,
    );
    // The hub sits at bearing 0 from its parent, so the cone opens along +x.
    const angle = Math.atan2((seeded.y ?? 0) - 0, (seeded.x ?? 0) - 300);
    assert.ok(
      Math.abs(angle) < available / 2,
      `expected the seed inside the cone, got a bearing of ${angle}`,
    );
    assert.ok(Number.isFinite(seeded.x) && seeded.vx === 0 && seeded.vy === 0);
  }
  assert.equal(closestPair(fresh) > 0, true);
});

test("seeding a wide expansion widens the arc rather than stacking it", () => {
  const hub = node(0, 0, 0);
  const few: GraphLayoutNode[] = Array.from({ length: 4 }, (_, index) => ({
    localId: index + 1,
  }));
  const many: GraphLayoutNode[] = Array.from({ length: 100 }, (_, index) => ({
    localId: index + 1,
  }));

  seedNodePositions({ hub, parent: null, nodes: few });
  seedNodePositions({ hub, parent: null, nodes: many });

  const radiusOf = (seeded: GraphLayoutNode) => Math.hypot(seeded.x ?? 0, seeded.y ?? 0);
  assert.ok(Math.abs(radiusOf(few[0]) - RING_GAP) < 1);
  assert.ok(
    radiusOf(many[0]) > RING_GAP && radiusOf(many[0]) <= RING_GAP * 3 + 1,
    `expected a wider but bounded ring, got ${radiusOf(many[0])}`,
  );
  // A whole page of children still starts apart, so collision has nothing to unstack.
  assert.ok(closestPair(many) > 8, `expected room between seeds, got ${closestPair(many)}`);
});

test("seeding the same expansion twice gives the same picture", () => {
  const hub = node(0, 120, -80);
  const parentNode = node(9, 0, 0);
  const first: GraphLayoutNode[] = Array.from({ length: 7 }, (_, index) => ({
    localId: index + 1,
  }));
  const second: GraphLayoutNode[] = Array.from({ length: 7 }, (_, index) => ({
    localId: index + 1,
  }));

  seedNodePositions({ hub, parent: parentNode, nodes: first });
  seedNodePositions({ hub, parent: parentNode, nodes: second });

  assert.deepEqual(first, second);
});

test("a hold damps what was already placed and leaves the new arrivals alone", () => {
  const settled = node(1, 0, 0);
  const arrival = node(2, 0, 0);
  const force = createGraphStabilityForce<GraphLayoutNode>({ ticks: 4 });
  force.initialize([settled, arrival]);
  force.hold([settled.localId]);

  settled.vx = 10;
  settled.vy = -10;
  arrival.vx = 10;
  arrival.vy = -10;
  force();

  assert.deepEqual({ vx: arrival.vx, vy: arrival.vy }, { vx: 10, vy: -10 });
  assert.ok(
    Math.abs((settled.vx as number) - 10 * STABILITY_DAMPING) < 1e-9,
    `expected the first tick damped to the floor, got ${settled.vx}`,
  );
});

test("a hold ramps off and then releases", () => {
  const settled = node(1, 0, 0);
  const force = createGraphStabilityForce<GraphLayoutNode>({ ticks: 4 });
  force.initialize([settled]);
  force.hold([settled.localId]);

  const kept: number[] = [];
  for (let tick = 0; tick < 4; tick += 1) {
    settled.vx = 10;
    force();
    kept.push(settled.vx as number);
  }

  // Each tick gives back a little more, so the held nodes rejoin gradually.
  for (const [index, speed] of kept.slice(1).entries()) {
    assert.ok(speed > kept[index], `expected the damping to ease off, got ${kept}`);
  }
  assert.equal(force.isHolding(), false);

  settled.vx = 10;
  force();
  assert.equal(settled.vx, 10);
});
