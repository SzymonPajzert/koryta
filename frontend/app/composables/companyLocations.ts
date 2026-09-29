import { computed } from "vue";
import { useAuthState } from "@/composables/auth";
import { regionsByPlaceId } from "~/utils/companyLocation";

/** Where every company sits, keyed by its node id.
 *
 * A company's seat is an `owns` edge from a region, which no view has to hand -
 * `/api/graph/local` centred on a person reaches the companies but stops one
 * hop short of the regions above them. So the answer comes from the region
 * collection instead, and this is the one place that fetches it.
 *
 * `useEntities` wraps `useFetch`, and a second call for the same key aborts the
 * first, so the explicit key matters: it is what lets a page ask for regions
 * here and in its own filters without the two requests cancelling each other.
 * Callers that need the region nodes themselves take `regions` from here rather
 * than fetching again.
 *
 * Client only. The collection is unpaginated and a page that renders the result
 * behind `<ClientOnly>` would ship every byte of it through __NUXT_DATA__ for
 * nothing.
 */
export function useCompanyLocations() {
  const { user } = useAuthState();

  const { entities: regions, pending } = useEntities(
    "region",
    {},
    { server: false, key: "company-locations-regions" },
  );

  /** The region each company sits in, scoped to what the reader may see: an
   * editor gets seats asserted by edges nobody has approved yet, everyone else
   * does not. */
  const companyRegions = computed(() =>
    regionsByPlaceId(regions.value ?? {}, user.value ? "all" : "approved"),
  );

  /** The same, for callers that only spell the region out and never draw it. */
  const companyLocations = computed(() => {
    const names: Record<string, string> = {};
    for (const [id, region] of Object.entries(companyRegions.value)) {
      names[id] = region.name;
    }
    return names;
  });

  /** `pending` is the region list's: until it lands every company reads as
   * seated nowhere, which a caller filtering by seat must not mistake for an
   * answer. */
  return { regions, companyRegions, companyLocations, pending };
}
