import { qaReleaseRecord } from "~~/server/utils/qaReleases";

// Dates the changelog entries this build is the first to serve, as it starts
// rather than when somebody next opens /aktywnosc: prod scales to zero, so an
// evening rollout nobody looked at would otherwise be dated by whichever
// instance woke up the next morning. Not awaited - nothing waits on it - and a
// failure only means the feed tries again when it is next asked.
//
// After firebase.server.ts, which nitro loads first by filename, so there is
// an app to get the database from.
export default defineNitroPlugin(() => {
  // `nuxt build` starts a server of its own to prerender the content dump, on
  // the builder, before anything has rolled out: it has no K_SERVICE to be
  // told apart by, and whatever it wrote would be the build's hour under a
  // backend named "local".
  if (import.meta.prerender) return;

  qaReleaseRecord().catch((error: unknown) => {
    console.error("[qaReleases] could not record this build's entries", error);
  });
});
