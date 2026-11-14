import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const rpc = process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

// Production-only CSP. The browser talks to this origin, the NEAR RPC (wallet
// selector reads account state) and the wallets' own origins.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${new URL(rpc).origin} https://rpc.testnet.near.org https://rpc.mainnet.near.org https://*.fastnear.com https://*.mynearwallet.com https://*.meteorwallet.app`,
  "frame-src https://*.mynearwallet.com https://*.meteorwallet.app",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(isProd
    ? [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        { key: "Content-Security-Policy", value: csp },
      ]
    : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  outputFileTracingIncludes: {
    "/api/**": ["./server/db/migrations/**", "./node_modules/@electric-sql/pglite/dist/**"],
  },
  // Runtime databases, testnet credentials and local environment files must
  // never travel with a standalone build prepared on a developer's machine.
  outputFileTracingExcludes: {
    "/*": ["./.data/**/*", "./.env", "./.env.*"],
  },
  async redirects() {
    // Old Algebra console routes → their Metabolic homes.
    return [
      { source: "/console/agent", destination: "/console/workspace", permanent: false },
      { source: "/console/vault", destination: "/console/treasury", permanent: false },
      { source: "/console/routing", destination: "/console/models", permanent: false },
      { source: "/console/providers/:path*", destination: "/console/models", permanent: false },
      { source: "/console/intelligence", destination: "/console/models", permanent: false },
      { source: "/console/executions/:path*", destination: "/console/decisions", permanent: false },
      { source: "/console/firewall", destination: "/console", permanent: false },
      { source: "/console/passes", destination: "/console", permanent: false },
      { source: "/console/projects", destination: "/console/developers", permanent: false },
      { source: "/console/quickstart", destination: "/console/developers", permanent: false },
      { source: "/onboarding", destination: "/console", permanent: false },
      { source: "/signup", destination: "/login", permanent: false },
      { source: "/pricing", destination: "/#pricing", permanent: false },
      { source: "/book-demo", destination: "/demo", permanent: false },
    ];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
