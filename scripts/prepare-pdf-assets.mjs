import { cp, copyFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const destinationDir = resolve("public/pdfjs");

await rm(destinationDir, { recursive: true, force: true });
await mkdir(destinationDir, { recursive: true });
await copyFile(
  resolve(pdfjsRoot, "build/pdf.worker.min.mjs"),
  resolve(destinationDir, "pdf.worker.min.mjs"),
);
await Promise.all([
  cp(resolve(pdfjsRoot, "cmaps"), resolve(destinationDir, "cmaps"), { recursive: true }),
  cp(resolve(pdfjsRoot, "standard_fonts"), resolve(destinationDir, "standard_fonts"), {
    recursive: true,
  }),
  cp(resolve(pdfjsRoot, "wasm"), resolve(destinationDir, "wasm"), { recursive: true }),
]);
