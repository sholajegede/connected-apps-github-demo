import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The broker and every route that touches a token must run on the Node
  // runtime and must never be statically cached.
  poweredByHeader: false,
  agentRules: false,
};

export default nextConfig;
