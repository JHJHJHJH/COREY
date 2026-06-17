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
  turbopack: {
    // Keep Turbopack scoped to this app instead of the parent home directory.
    root: resolve(appRoot),
  },
  ...(watchOptions ? { watchOptions } : {}),
  // Keep native/server-only deps out of the bundler; they run only in route handlers.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "web-ifc"],
};

export default withMDX(nextConfig);
