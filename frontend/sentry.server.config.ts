import * as Sentry from "@sentry/nuxt";
import type { Event } from "@sentry/nuxt";

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

/** Requests whose body never goes to Sentry with an error.
 *
 * The SDK attaches up to 10 kB of a request body to every error event by
 * default. These bodies are crops of named people's birth dates in their own
 * hand, and the dates readers typed off them: personal data that is kept out of
 * everything but its own closed collections. */
const PRIVATE_BODIES = /\/api\/(?:ingest\/declarations|declarations\/)/;

/** Request headers that never go to Sentry, beside the cookies and addresses
 * the SDK leaves out by itself.
 *
 * A reader without an account sends their browser's reader id as
 * `X-Reader-Id` with every request to /api/declarations/, and the id is all
 * it takes to claim that browser's readings for an account (`claimAnswers`).
 * The SDK copies every other header into an error event as it came, and in a
 * sampled transaction it hides only names that look like credentials - auth,
 * token, key, session - which this one does not. */
const PRIVATE_HEADERS = ["x-reader-id"];

/** An error event or a transaction without `PRIVATE_HEADERS`: gone from the
 * request it carries, and from its spans' `http.request.header.*`
 * attributes, where the SDK writes a header's dashes as underscores. */
export function withoutPrivateHeaders<T extends Event>(event: T): T {
  const attributes = PRIVATE_HEADERS.map(
    (name) => `http.request.header.${name.replace(/-/g, "_")}`,
  );
  if (event.request?.headers) {
    event.request.headers = Object.fromEntries(
      Object.entries(event.request.headers).filter(
        ([name]) => !PRIVATE_HEADERS.includes(name.toLowerCase()),
      ),
    );
  }
  for (const span of [event.contexts?.trace, ...(event.spans ?? [])]) {
    if (!span?.data) continue;
    span.data = Object.fromEntries(
      Object.entries(span.data).filter(([key]) => !attributes.includes(key)),
    );
  }
  return event;
}

Sentry.init({
  enabled,
  environment,

  dsn: "https://bd99c377832328230cfd5519914b9984@o4510028768870400.ingest.de.sentry.io/4510028773392464",

  tracesSampleRate,

  integrations: [
    Sentry.httpIntegration({
      ignoreIncomingRequestBody: (url) => PRIVATE_BODIES.test(url),
    }),
  ],

  beforeSend: (event) => withoutPrivateHeaders(event),
  beforeSendTransaction: (event) => withoutPrivateHeaders(event),

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Setting this option to true will print useful information to the console while you're setting up Sentry.
  debug: false,
});
