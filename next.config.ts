import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    // Keep Turbopack scoped to this app instead of the parent home directory.
    root: resolve(__dirname),
  },
  // Keep native/server-only deps out of the bundler; they run only in route handlers.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "web-ifc"],
};

export default nextConfig;
