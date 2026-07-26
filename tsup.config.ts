import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "corey-mcp": "src/mcp/cli.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node22",
  outDir: "dist/mcp",
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/.*/],
  external: ["web-ifc"],
  outExtension: () => ({ js: ".cjs" }),
});
