import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Dev only: lets the app be opened through an ngrok tunnel (see JOBS_PUBLIC_URL).
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev"],
  // The sandbox runner reads this file at runtime, so the trace has to ship it with the route.
  outputFileTracingIncludes: {
    "/api/apps/[projectId]/server/[...path]": ["./sandbox-runtime/dist/server.mjs"],
  },
  async headers() {
    return [
      {
        source: "/media/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ]
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  org: "resynox",
  project: "appxprompt",
  // This org lives in the EU region.
  sentryUrl: "https://de.sentry.io",

  // Only print logs for uploading source maps in CI.
  silent: !process.env.CI,

  authToken: process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
});
