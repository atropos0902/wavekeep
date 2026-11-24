import type { NextConfig } from "next";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  // "use cache" without Cache Components mode, which needs a Suspense boundary around every dynamic body. See use-said.ts.
  experimental: { useCache: true },
  transpilePackages: ["@wavekeep/core", "@wavekeep/engines", "@wavekeep/service"],
  serverExternalPackages: ["pg", "pg-boss"],
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
      ],
    },
  ],
};
export default config;
