import { useCurrentUser } from "vuefire";
import { authFetch } from "~/composables/auth";
import type { RegionRuns } from "~~/shared/electionLists";
import type { GovernmentView } from "~~/shared/regionAuthorities";

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

/** A region's „Władze” (`/api/nodes/[id]/authorities`): its head and its
 * councils, each person linked where this reader may open their page.
 *
 * `latest` for a signed in reader, for the reason `useRegionElectionRuns`
 * gives; with it the `?revisionId=` of a proposal being previewed, so the
 * section shows the change the way the rest of the page does. The revision is
 * read through a computed of its own: a string, which a navigation that keeps
 * it leaves alone, where reading `route.query` in the query itself would
 * fetch again on every hash link and Back. */
export function useRegionGovernment(regionId: string) {
  const route = useRoute();
  const user = useCurrentUser();
  const revisionId = computed(() =>
    typeof route.query.revisionId === "string"
      ? route.query.revisionId
      : undefined,
  );
  const query = computed(() =>
    user.value
      ? {
          latest: true,
          ...(revisionId.value ? { revisionId: revisionId.value } : {}),
        }
      : {},
  );
  return authFetch<GovernmentView | null>(
    `/api/nodes/${regionId}/authorities`,
    { query, key: `region-authorities-${regionId}` },
  );
}
