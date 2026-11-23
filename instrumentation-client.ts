import * as Sentry from "@sentry/nextjs";
import { scrubSecrets } from "@/lib/services/key-patterns";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV,

  // Capture 100% of traces in development and 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Vercel Analytics / Speed Insights are served from hashed first-party paths
  // (e.g. /abd9ec3b62d16918/script.js); their errors on outdated bots/browsers aren't actionable.
  denyUrls: [/\/[a-f0-9]{16}\/script\.js/],

  beforeSend: (event) => scrubSecrets(event),
  beforeSendTransaction: (event) => scrubSecrets(event),
  beforeBreadcrumb: (crumb) => scrubSecrets(crumb),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
