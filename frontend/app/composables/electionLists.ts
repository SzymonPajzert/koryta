import { useCurrentUser } from "vuefire";
import { authFetch } from "~/composables/auth";
import type { RegionRuns } from "~~/shared/electionLists";
import type { RegionComposition } from "~~/shared/regionComposition";

/** Who stood for election in a region: the runs its page groups into lists
 * and the box at its top.
 *
 * `latest` is put in the query for the reason `usePersonSuccessions` gives:
 * `authFetch` adds it only in the browser, so the server's render would go out
 * anonymous and the signed in reader would keep the redacted answer. A
 * reactive query repeats the request once auth resolves.
 *
 * From the reader alone, never from the page's url: a `?latest` there cannot
 * show anybody drafts without a token, and would only send the server's
 * render past the cache. And nothing of the route in it, since `useFetch`
 * watches its options: a `#lista-…` link or Back on this same page would
 * fetch the lists again.
 *
 * Not awaited by its caller: Nuxt still settles it before it serialises the
 * page, and the graph request runs beside it. */
export function useRegionElectionRuns(regionId: string) {
  const user = useCurrentUser();
  const query = computed(() => (user.value ? { latest: true } : {}));
  return authFetch<RegionRuns>(`/api/nodes/${regionId}/election-lists`, {
    query,
    key: `region-election-lists-${regionId}`,
  });
}

/** PKW's whole 2024 result for a region page (shared/regionComposition.ts).
 * TEMP(wariant): asked only for the board round's preview, `?wladze=c`. */
export function useRegionComposition(
  regionId: string,
  wanted: MaybeRefOrGetter<boolean>,
) {
  const route = useRoute();
  return useAsyncData(
    `region-composition-${regionId}`,
    () =>
      toValue(wanted)
        ? $fetch<RegionComposition | null>(
            `/api/nodes/${regionId}/composition`,
            {
              query: route.query.nazwiska ? { nazwiska: "1" } : {},
            },
          ).catch(() => null)
        : Promise.resolve(null),
    { watch: [() => toValue(wanted)] },
  );
}
