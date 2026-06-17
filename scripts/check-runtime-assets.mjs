import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();

const checks = [
  {
    source: "node_modules/@thatopen/fragments/dist/Worker/worker.mjs",
    target: "public/workers/thatopen-fragments-worker.mjs",
  },
  {
    source: "node_modules/web-ifc/web-ifc.wasm",
    target: "public/wasm/web-ifc.wasm",
  },
  {
    source: "node_modules/web-ifc/web-ifc-mt.wasm",
    target: "public/wasm/web-ifc-mt.wasm",
  },
];

async function digest(path) {
  const bytes = await readFile(resolve(root, path));
  return createHash("sha256").update(bytes).digest("hex");
}

let failed = false;

for (const check of checks) {
  const [sourceDigest, targetDigest] = await Promise.all([
    digest(check.source),
    digest(check.target),
  ]);

  if (sourceDigest !== targetDigest) {
    failed = true;
    console.error(
      [
        `Runtime asset mismatch: ${check.target}`,
        `  expected source: ${check.source}`,
        "  refresh the copied file after upgrading dependencies",
      ].join("\n"),
    );
  }
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log("Runtime assets match installed dependency files.");
}
