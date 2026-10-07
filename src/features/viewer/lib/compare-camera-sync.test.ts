import assert from "node:assert/strict";
import { after, before, test, type TestContext } from "node:test";
import CameraControls from "camera-controls";
import * as THREE from "three";
import { synchronizeCompareCameras } from "./compare-camera-sync";

const originalDOMRect = Object.getOwnPropertyDescriptor(globalThis, "DOMRect");

before(() => {
  // CameraControls constructs a rectangle even without a DOM element. The
  // cameras and their damping/events remain the real library implementation.
  Object.defineProperty(globalThis, "DOMRect", {
    configurable: true,
    value: class {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
      ) {}
    },
  });
  CameraControls.install({ THREE });
});

after(() => {
  if (originalDOMRect) {
    Object.defineProperty(globalThis, "DOMRect", originalDOMRect);
  } else {
    Reflect.deleteProperty(globalThis, "DOMRect");
  }
});

function createPair(t: TestContext) {
  const createControls = () => {
    const controls = new CameraControls(new THREE.PerspectiveCamera(50, 1, 0.01, 10000));
    controls.smoothTime = 0.15;
    void controls.setLookAt(18, 16, 18, 0, 0, 0, false);
    controls.update(0);
    return controls;
  };
  const base = createControls();
  const target = createControls();
  t.after(() => {
    base.dispose();
    target.dispose();
  });
  return { base, target };
}

function assertSameView(base: CameraControls, target: CameraControls) {
  for (const getter of ["getPosition", "getTarget", "getFocalOffset"] as const) {
    const baseValue = base[getter](new THREE.Vector3(), false);
    const targetValue = target[getter](new THREE.Vector3(), false);
    assert.ok(baseValue.distanceTo(targetValue) < 1e-8, `${getter} differs`);
  }
  assert.ok(base.camera.position.distanceTo(target.camera.position) < 1e-8, "rendered positions differ");
  assert.ok(1 - Math.abs(base.camera.quaternion.dot(target.camera.quaternion)) < 1e-8, "orientations differ");
  assert.ok(Math.abs(base.camera.zoom - target.camera.zoom) < 1e-8, "zoom differs");
}

test("opening a comparison aligns target to the base's current rendered state", (t) => {
  const { base, target } = createPair(t);
  void target.setLookAt(80, 50, 20, 5, 5, 5, false);
  void base.setFocalOffset(2, -1, 0.5, false);
  void base.zoomTo(1.5, false);
  base.update(0);
  target.update(0);
  void base.dollyTo(8, true);
  base.update(1 / 60);

  t.after(synchronizeCompareCameras(base, target));

  assertSameView(base, target);
  assert.ok(base.getPosition(new THREE.Vector3()).distanceTo(base.getPosition(new THREE.Vector3(), false)) > 1);
});

for (const pane of ["base", "target"] as const) {
  test(`${pane} drives smooth orbit, pan, and dolly without losing its destination`, (t) => {
    const pair = createPair(t);
    t.after(synchronizeCompareCameras(pair.base, pair.target));
    const source = pair[pane];
    const follower = pane === "base" ? pair.target : pair.base;

    void source.rotate(0.8, 0.15, true);
    void source.moveTo(4, 3, -2, true);
    void source.dollyTo(12, true);
    const endPosition = source.getPosition(new THREE.Vector3());
    const endTarget = source.getTarget(new THREE.Vector3());
    source.dispatchEvent({ type: "controlend" });

    for (let frame = 0; frame < 100; frame += 1) {
      // The follower can tick before or after the source on any frame.
      if (frame % 2 === 0) follower.update(1 / 60);
      source.update(1 / 60);
      assertSameView(pair.base, pair.target);
      follower.update(1 / 60);
      assertSameView(pair.base, pair.target);
      assert.ok(source.getPosition(new THREE.Vector3()).distanceTo(endPosition) < 1e-8);
      assert.ok(source.getTarget(new THREE.Vector3()).distanceTo(endTarget) < 1e-8);
    }
    assert.ok(source.camera.position.distanceTo(endPosition) < 1e-4);
  });
}

test("wheel-style control events switch the source without a drag-start event", (t) => {
  const { base, target } = createPair(t);
  t.after(synchronizeCompareCameras(base, target));

  for (const source of [target, base, target]) {
    // An immediate distance change emits neither controlstart nor
    // transitionstart: only the wheel-style control event transfers ownership.
    source.distance *= 0.8;
    source.dispatchEvent({ type: "control" });
    const endPosition = source.getPosition(new THREE.Vector3());
    source.update(1 / 60);
    assertSameView(base, target);
    assert.ok(source.getPosition(new THREE.Vector3()).distanceTo(endPosition) < 1e-8);
  }
});

test("drag-start takes over while the other pane is still damping", (t) => {
  const { base, target } = createPair(t);
  t.after(synchronizeCompareCameras(base, target));
  void base.dollyTo(8, true);
  base.update(1 / 60);

  target.dispatchEvent({ type: "controlstart" });
  target.azimuthAngle += 0.6;
  const targetDestination = target.getPosition(new THREE.Vector3());
  // The old source's pending animation must not overwrite the new input.
  base.update(1 / 60);
  assert.ok(target.getPosition(new THREE.Vector3()).distanceTo(targetDestination) < 1e-8);
  target.update(1 / 60);
  assertSameView(base, target);
});

test("animated zoom and focal offset stay synchronized", (t) => {
  const { base, target } = createPair(t);
  t.after(synchronizeCompareCameras(base, target));
  void target.zoomTo(2.5, true);
  void target.setFocalOffset(3, -2, 1, true);

  for (let frame = 0; frame < 100; frame += 1) {
    target.update(1 / 60);
    assertSameView(base, target);
    base.update(1 / 60);
    assertSameView(base, target);
  }
  assert.ok(Math.abs(target.camera.zoom - 2.5) < 1e-4);
});

test("focus and reset transitions can drive opposite panes", async (t) => {
  const { base, target } = createPair(t);
  t.after(synchronizeCompareCameras(base, target));
  const elementBox = new THREE.Box3(new THREE.Vector3(1, 2, 3), new THREE.Vector3(2, 3, 4));
  const modelBox = new THREE.Box3(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 20, 20));

  for (const [source, box] of [[target, elementBox], [base, modelBox]] as const) {
    const fitted = source.fitToBox(box, true);
    for (let frame = 0; frame < 160; frame += 1) {
      source.update(1 / 60);
      assertSameView(base, target);
    }
    await fitted;
  }
});

test("synchronization does not resolve a pan transition before it has rested", async (t) => {
  const { base, target } = createPair(t);
  t.after(synchronizeCompareCameras(base, target));
  let rested = false;
  const transition = base.moveTo(30, 20, 10, true).then(() => { rested = true; });
  base.update(1 / 60);
  await Promise.resolve();
  assert.equal(rested, false);
  for (let frame = 0; frame < 160; frame += 1) base.update(1 / 60);
  await transition;
  assert.equal(rested, true);
});

test("cleanup removes synchronization and reopening starts with fresh ownership", (t) => {
  const { base, target } = createPair(t);
  const unlink = synchronizeCompareCameras(base, target);
  unlink();
  unlink();
  const targetPosition = target.camera.position.clone();
  void base.setLookAt(50, 30, 20, 0, 0, 0, true);
  base.update(1 / 60);
  assert.ok(target.camera.position.distanceTo(targetPosition) < 1e-8);

  t.after(synchronizeCompareCameras(base, target));
  assertSameView(base, target);
  void target.dollyTo(10, true);
  target.update(1 / 60);
  assertSameView(base, target);
});
