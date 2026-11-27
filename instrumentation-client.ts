import * as Sentry from "@sentry/nextjs";
import { scrubSecrets } from "@/lib/services/key-patterns";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV,

  // Capture 100% of traces in development and 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Scripts we don't ship. Their errors aren't actionable:
  // - Vercel Analytics / Speed Insights hashed paths (e.g. /abd9ec3b62d16918/script.js)
  // - Facebook's in-app browser, which injects app://browser_declutter and can throw
  //   SyntaxError: Unexpected end of input from that script (APPXPROMPT-B).
  denyUrls: [/\/[a-f0-9]{16}\/script\.js/, /^app:\/\/browser_declutter/],

  beforeSend: (event) => scrubSecrets(event),
  beforeSendTransaction: (event) => scrubSecrets(event),
  beforeBreadcrumb: (crumb) => scrubSecrets(crumb),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
