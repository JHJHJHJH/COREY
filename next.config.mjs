import { createMDX } from "fumadocs-mdx/next";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = fileURLToPath(new URL(".", import.meta.url));
const withMDX = createMDX();
const watchPollIntervalMs = Number(process.env.NEXT_WATCH_POLL_INTERVAL_MS);
const watchOptions =
  Number.isFinite(watchPollIntervalMs) && watchPollIntervalMs > 0
    ? { pollIntervalMs: watchPollIntervalMs }
    : undefined;

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  async redirects() {
    return [
      {
        source: "/rules",
        destination: "/clause",
        permanent: true,
      },
    ];
  },
  turbopack: {
    // Keep Turbopack scoped to this app instead of the parent home directory.
    root: resolve(appRoot),
  },
  ...(watchOptions ? { watchOptions } : {}),
  // Keep native/server-only deps out of the bundler; they run only in route handlers.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "web-ifc"],
  // web-ifc reads web-ifc-node.wasm at runtime from a computed path, which
  // output file tracing cannot see; without this the standalone (Docker) build
  // ships the JS but not the WASM, and writeback/compare routes fail ENOENT.
  outputFileTracingIncludes: {
    "/api/models/**": [
      // Direct dependency layouts (npm/yarn or pnpm's real package dir); the
      // copies hoisted under @thatopen peer-dep dirs are never resolved.
      "./node_modules/web-ifc/web-ifc-node.wasm",
      "./node_modules/.pnpm/web-ifc@*/node_modules/web-ifc/web-ifc-node.wasm",
    ],
    "/api/knowledge/documents/**": ["./docs/official-cx/*.pdf"],
  },
};

export default withMDX(nextConfig);
