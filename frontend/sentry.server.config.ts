import * as Sentry from "@sentry/nuxt";

/** Only a deployed nitro server reports.
 *
 * The client half can read the hostname; here there is no request yet, so the
 * signal has to come from the environment. `SENTRY_ENABLED` is set for both
 * backends in apphosting.yaml and is the one that is meant to be read;
 * `K_SERVICE` is Cloud Run's own marker, kept as a fallback so a backend that
 * has not picked up the new config still reports.
 *
 * Neither is set by `npm run dev`, `nuxt preview` or vitest, which is the
 * point: those were reporting emulator connection refusals and stale-worktree
 * import failures into the same project as production. */
const enabled =
  process.env.SENTRY_ENABLED === "true" || !!process.env.K_SERVICE;

/** Which backend this is, as the client config tags it from the hostname.
 *
 * Both App Hosting backends are Cloud Run services, and `K_SERVICE` carries
 * the service name: `prod` and `autopush` in europe-west4. Untagged, the two
 * arrive as one undifferentiated stream and a staging error reads as a
 * production one - the mistake the client half already corrected. */
const environment =
  { prod: "production", autopush: "autopush" }[process.env.K_SERVICE ?? ""] ??
  (enabled ? "unknown-backend" : undefined);

/** How much of the traffic gets a performance transaction.
 *
 * Nothing has ever been sampled here, so this is sized against measured
 * volume rather than tuned in place: prod and autopush together served
 * 399,287 requests in the 30 days to 2026-09-18. At the inherited 1.0 the
 * first working deploy would have posted ~400k server transactions a month,
 * plus their child spans, into a project whose entire retained history is
 * 1.29M spans - the SDK would have started working and blown the quota in the
 * same release. 0.05 leaves prod ~13k transactions a month, enough to see a
 * p95 move. autopush has no readers, so it is sampled an order lower and
 * cannot crowd production out of the quota.
 *
 * This governs traces only. Errors are captured whatever it says, which is
 * the half that was actually missing. */
const tracesSampleRate = environment === "autopush" ? 0.005 : 0.05;

Sentry.init({
  enabled,
  environment,

  dsn: "https://bd99c377832328230cfd5519914b9984@o4510028768870400.ingest.de.sentry.io/4510028773392464",

  tracesSampleRate,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
