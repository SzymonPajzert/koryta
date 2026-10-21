/** Reload once when a lazy chunk has gone missing under the reader.
 *
 * A deploy gives every chunk a new hash and drops the old ones. Anyone who had
 * the site open across it is holding an entry chunk that names files the server
 * will no longer serve, so the next route change - the first click after a
 * release - fails its dynamic import and the navigation dies with nothing
 * rendered. It was the only unfixed production error in Sentry on 2026-08-31
 * (KORYTA-PL-1X, on koryta.pl and autopush both), and it always names a
 * different hash, so there is nothing to fix in the chunk itself.
 *
 * A reload is the whole repair: it fetches the current index and the current
 * hashes. `vite:preloadError` is Vite's own hook for this, and Nuxt re-emits
 * failed imports through it.
 */

/** Guards against a reload loop. If the fresh load fails the same way - the
 * asset really is gone rather than stale, say a half-finished deploy - reloading
 * again would spin. sessionStorage rather than a module variable, because the
 * reload is exactly what discards module state; and per-tab rather than
 * localStorage so one bad tab does not gag the reload in every other one. */
const GUARD = "chunk-reload:attempted";

export default defineNuxtPlugin(() => {
  window.addEventListener("vite:preloadError", (event) => {
    if (sessionStorage.getItem(GUARD)) return;
    sessionStorage.setItem(GUARD, "1");

    // Vite's default for this event is to rethrow, which is what surfaces it to
    // Sentry. We are handling it, so stop that and let the reload be the
    // outcome the reader sees.
    event.preventDefault();
    window.location.reload();
  });

  // Cleared once a page has loaded and stayed up long enough to be usable, so
  // that a deploy a week from now still gets its one reload. On the failure
  // path the reload happens well before this, so the guard survives to catch it.
  //
  // A page always has `sessionStorage`; a vitest file does not, once it has
  // ended. Its nuxt environment deletes the global at teardown, but this timer
  // is Node's and still fires, so a file that ended within ten seconds of
  // booting the app failed the run with "sessionStorage is not defined"
  // (AdminProcesy.test.ts, 2026-10-21).
  window.setTimeout(() => {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(GUARD);
  }, 10_000);
});
