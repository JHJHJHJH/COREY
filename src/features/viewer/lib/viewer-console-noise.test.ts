import assert from "node:assert/strict";
import test from "node:test";

import {
  installViewerConsoleNoiseFilter,
  shouldSuppressViewerConsoleMessage,
} from "./viewer-console-noise.ts";

test("shouldSuppressViewerConsoleMessage suppresses known dependency noise only", () => {
  assert.equal(
    shouldSuppressViewerConsoleMessage(["Fragments: Zero length geometry: 2046"]),
    true,
  );
  assert.equal(
    shouldSuppressViewerConsoleMessage([
      "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.",
    ]),
    true,
  );
  assert.equal(
    shouldSuppressViewerConsoleMessage([
      "You have set a custom wheel sensitivity. This is app-controlled and should not be filtered.",
    ]),
    false,
  );
  assert.equal(
    shouldSuppressViewerConsoleMessage(["Failed to load selection details", new Error("boom")]),
    false,
  );
});

test("installViewerConsoleNoiseFilter drops noisy dependency messages and preserves real logs", () => {
  const capturedLogs: unknown[][] = [];
  const capturedWarns: unknown[][] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;

  console.log = (...args: unknown[]) => {
    capturedLogs.push(args);
  };
  console.warn = (...args: unknown[]) => {
    capturedWarns.push(args);
  };

  try {
    const cleanup = installViewerConsoleNoiseFilter();
    console.log("Fragments: Zero length geometry: 2046");
    console.warn("THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.");
    console.warn("Loaded IFC model has an empty bounding box; skipping automatic framing.");
    cleanup();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }

  assert.deepEqual(capturedLogs, []);
  assert.deepEqual(capturedWarns, [["Loaded IFC model has an empty bounding box; skipping automatic framing."]]);
});
