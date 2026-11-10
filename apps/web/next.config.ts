import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  // The shared contract package ships TypeScript source.
  transpilePackages: ["@ai-scouting/scouting"],
};

export default config;
