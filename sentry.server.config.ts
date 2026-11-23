import * as Sentry from "@sentry/nextjs";
import { scrubSecrets } from "@/lib/services/key-patterns";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV,

  // Capture 100% of traces in development and 10% in production.
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  beforeSend: (event) => scrubSecrets(event),
  beforeBreadcrumb: (crumb) => scrubSecrets(crumb),
});
