import * as Sentry from "@sentry/nuxt";

/** Attributes server-side events to the build that produced them.
 *
 * sentry.server.config.ts runs before Nuxt exists, so it can only read the
 * Cloud Run environment - it never sees the release or the build time, which
 * are baked in at build time and reach us through runtime config. By the time
 * Nitro plugins run both are available, so we stamp them onto every event from
 * here. Without this, a server error tells you something broke but not which
 * deploy broke it, which is the whole question after a rollout.
 */
export default defineNitroPlugin(() => {
  const { appEnv, release, buildTime } = useRuntimeConfig().public.buildInfo;

  const scope = Sentry.getGlobalScope();
  scope.setTag("buildTime", buildTime);
  scope.addEventProcessor((event) => {
    // Set rather than defaulted, so an event and /api/health always agree on
    // which build is answering.
    event.release = release;
    event.environment = appEnv;
    return event;
  });
});
