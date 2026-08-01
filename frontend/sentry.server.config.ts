import * as Sentry from "@sentry/nuxt";

// This file is loaded before Nuxt is, so useRuntimeConfig() is not available
// here - only the Cloud Run runtime environment is. APP_ENV comes from
// apphosting.<environment>.yaml; the release and build time are build-time
// facts, and server/plugins/sentry-release.ts stamps them on once Nitro is up.
const appEnv = process.env.APP_ENV || "local";

Sentry.init({
  dsn: "https://bd99c377832328230cfd5519914b9984@o4510028768870400.ingest.de.sentry.io/4510028773392464",

  environment: appEnv,

  // Prod carries the traffic, so it samples. Autopush carries almost none,
  // and there a full trace on every request is what makes a single manual
  // click worth looking at.
  tracesSampleRate: appEnv === "prod" ? 0.1 : 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
