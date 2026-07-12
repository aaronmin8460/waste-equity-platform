import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a minimal standalone server (.next/standalone/server.js) so the
  // production Docker image ships only the required runtime files — no dev
  // dependencies, no full node_modules. `public` and `.next/static` are copied
  // in manually by the Dockerfile.
  output: "standalone",
  // Pin the workspace root: stray lockfiles above the repo otherwise make
  // Turbopack infer the wrong root, breaking file watching and resolution.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
