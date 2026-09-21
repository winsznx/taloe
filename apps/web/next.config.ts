import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source rather than a build artifact, so
  // there is no build step between changing a router rule and seeing it here.
  transpilePackages: [
    "@taloe/binance-web3",
    "@taloe/evidence",
    "@taloe/execution",
    "@taloe/router-core",
    "@taloe/session-mark",
    "@taloe/shared",
  ],
  typedRoutes: true,
};

export default config;
