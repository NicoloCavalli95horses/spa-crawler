import type { NextConfig } from "next";

// Static export: server.js serves the output of `next build` directly (plus the API), so the
// whole test fixture starts with a single `node server.js`, no separate Next server process.
const nextConfig: NextConfig = {
  output: "export",
};

export default nextConfig;
