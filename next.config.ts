import type { NextConfig } from "next";

const config: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      // The qpdf factory references Node's filesystem only outside the browser.
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:fs$/, (resource: { context: string; request: string }) => {
        if (resource.context.includes("qpdf-wasm")) resource.request = "fs";
      }));
      config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    }
    return config;
  },
};

export default config;
