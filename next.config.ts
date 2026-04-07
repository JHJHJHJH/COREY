import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Keep Turbopack scoped to this app instead of the parent home directory.
    root: resolve(__dirname),
  },
};

export default nextConfig;
