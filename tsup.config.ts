import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "corey-mcp-stdio": "src/mcp/cli.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node22",
  outDir: "dist/mcp",
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^(?!web-ifc(?:$|\/)).*/],
  external: ["web-ifc"],
  outExtension: () => ({ js: ".cjs" }),
});
