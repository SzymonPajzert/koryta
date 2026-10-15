import { authFetch } from "~/composables/auth";

/** People per region, as the home page's map colours them
 * (/api/stats/regions).
 *
 * The map and the list of powiaty beside it both read this, under one key and
 * with one set of options, so they share one data ref and cannot show
 * different numbers for the same place. A second `authFetch` under the same
 * key with different options would make Nuxt warn and keep whichever ran
 * first, which is why the call lives here. */
export function useRegionCounts() {
  return authFetch("/api/stats/regions", {
    lazy: true,
    key: "polandmap-region-stats",
    default: () => [],
  });
}
