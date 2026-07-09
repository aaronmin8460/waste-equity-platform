import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root: stray lockfiles above the repo otherwise make
  // Turbopack infer the wrong root, breaking file watching and resolution.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
