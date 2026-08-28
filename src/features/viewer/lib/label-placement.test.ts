import assert from "node:assert/strict";
import test from "node:test";
import { placeLabels, rotatedLabelBounds, type LabelCandidate } from "./label-placement";

function candidate(subject: string, x: number, priority: number): LabelCandidate<string> {
  return { subject, box: { x, y: 0, width: 100, height: 12 }, priority };
}

test("non-overlapping labels are all kept", () => {
  const placed = placeLabels([candidate("a", 0, 0), candidate("b", 200, 0), candidate("c", 400, 0)]);
  assert.deepEqual(
    placed.map((entry) => entry.subject),
    ["a", "b", "c"],
  );
});

test("a higher priority label wins a contested box", () => {
  // Same slot; the loser is dropped rather than drawn on top.
  const placed = placeLabels([candidate("low", 0, 1), candidate("high", 10, 9)]);
  assert.deepEqual(
    placed.map((entry) => entry.subject),
    ["high"],
  );
});

test("dropping a label does not block the ones behind it", () => {
  // "clash" loses to "winner", but "far" is clear and must still be placed.
  const placed = placeLabels([
    candidate("winner", 0, 9),
    candidate("clash", 10, 5),
    candidate("far", 500, 1),
  ]);
  assert.deepEqual(
    placed.map((entry) => entry.subject),
    ["winner", "far"],
  );
});

test("equal priorities keep their input order, so the picture does not flicker", () => {
  const first = placeLabels([candidate("a", 0, 3), candidate("b", 10, 3), candidate("c", 20, 3)]);
  const second = placeLabels([candidate("a", 0, 3), candidate("b", 10, 3), candidate("c", 20, 3)]);
  assert.deepEqual(first.map((entry) => entry.subject), ["a"]);
  assert.deepEqual(first.map((entry) => entry.subject), second.map((entry) => entry.subject));
});

test("padding rejects labels that merely come close", () => {
  const touching = [candidate("a", 0, 1), candidate("b", 101, 1)];
  assert.equal(placeLabels(touching).length, 2);
  assert.equal(placeLabels(touching, { padding: 4 }).length, 1);
});

test("the limit caps how many labels are drawn, keeping the highest priorities", () => {
  const placed = placeLabels(
    [candidate("a", 0, 1), candidate("b", 200, 5), candidate("c", 400, 9)],
    { limit: 2 },
  );
  assert.deepEqual(
    placed.map((entry) => entry.subject),
    ["c", "b"],
  );
});

test("a hub's worth of coincident labels collapses to one", () => {
  // The storey case: a hundred labels stacked on nearly the same spot.
  const crowded = Array.from({ length: 100 }, (_, index) => candidate(`n${index}`, index * 0.5, 0));
  assert.equal(placeLabels(crowded).length, 1);
});

test("no two placed labels overlap, whatever the input", () => {
  const scattered = Array.from({ length: 200 }, (_, index) =>
    candidate(`n${index}`, (index * 37) % 900, index % 5),
  );
  const placed = placeLabels(scattered);
  for (let i = 0; i < placed.length; i += 1) {
    for (let j = i + 1; j < placed.length; j += 1) {
      const a = placed[i].box;
      const b = placed[j].box;
      assert.ok(
        !(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height),
        `${placed[i].subject} overlaps ${placed[j].subject}`,
      );
    }
  }
  assert.ok(placed.length > 1);
});

test("an unrotated label keeps its own bounds", () => {
  const bounds = rotatedLabelBounds(100, 12, 0);
  assert.equal(Math.round(bounds.width), 100);
  assert.equal(Math.round(bounds.height), 12);
});

test("a quarter-turn label swaps width and height", () => {
  // The case the axis-aligned approximation got backwards: a vertical name is narrow and tall.
  const bounds = rotatedLabelBounds(100, 12, Math.PI / 2);
  assert.equal(Math.round(bounds.width), 12);
  assert.equal(Math.round(bounds.height), 100);
});

test("rotated bounds never shrink below the text and are symmetric in sign", () => {
  for (const angle of [0.3, 1.1, -0.3, -1.1, Math.PI - 0.4]) {
    const bounds = rotatedLabelBounds(100, 12, angle);
    const mirrored = rotatedLabelBounds(100, 12, -angle);
    assert.ok(bounds.width >= 12 && bounds.height >= 12, `degenerate at ${angle}`);
    assert.ok(Math.abs(bounds.width - mirrored.width) < 1e-9, `asymmetric at ${angle}`);
    assert.ok(Math.abs(bounds.height - mirrored.height) < 1e-9, `asymmetric at ${angle}`);
  }
});
