import type { NodeTypeMap, NodeType } from "~~/shared/model";
import { computed, toValue, type Ref, type ComputedRef } from "vue";
import { useCurrentUser } from "vuefire";
import { authFetch, useAuthState } from "@/composables/auth";

export type Filters = {
  party?: string;
  place?: string;
  // TODO unify with the limit class used in other places
  limit?: number;
  page?: number;
  sortBy?: string;
  sortDesc?: string | boolean;
};

export type UseEntitiesOptions = {
  /** Set false where the result is only ever read behind a `<ClientOnly>`.
   *
   * `/api/nodes?type=` is unpaginated, so a collection fetched during SSR is
   * serialised into __NUXT_DATA__ in full - and on a page that renders no
   * markup on the server, every one of those bytes is shipped for nothing.
   */
  server?: boolean;
  /** Share one request between callers that want the same collection.
   *
   * `useFetch` keys on the url when nothing else is given, and a second call
   * for that key aborts the first - so two components asking for the same
   * collection cancel each other. Naming the key makes them one request
   * instead. */
  key?: string;
};

export function useEntities<N extends NodeType>(
  nodeType: N,
  filters: Filters | Ref<Filters> = {},
  options: UseEntitiesOptions = {},
) {
  const user = useCurrentUser();
  // `latest` said out loud for a signed in reader, as /tematy does, rather
  // than left to `authFetch`, whose hook adds it in the browser only. The
  // server's render is anonymous, and /api/nodes answers an anonymous caller
  // with published pages alone - so a list rendered there and never asked for
  // again would keep a signed in reader from the drafts they could always see:
  // the duplicate a new page's form warns about above all. The query changing
  // once auth resolves is what asks again, with the token.
  const query = computed(() => ({
    ...toValue(filters),
    ...(user.value ? { latest: true } : {}),
  }));
  const { data: response, refresh } = authFetch<{
    nodes: Record<string, NodeTypeMap[N]>;
    total?: number;
  }>(`/api/nodes?type=${nodeType}`, {
    query,
    ...options,
  });

  const entitiesRaw = computed(() => response?.value?.nodes ?? {});

  const entities = useEntitiesFiltering(entitiesRaw);

  /** How many rows the filters match, not how many this page holds - the whole
   * point of asking is to size a pager. Only the paginated path of /api/nodes
   * counts, so this is 0 for a caller that passed no `limit`, and it undercounts
   * for an anonymous reader by however many private rows the client then drops. */
  const total = computed(() => response?.value?.total ?? 0);

  return { entities, total, refresh };
}

export interface EntityWithVisibility {
  visibility?: boolean;
}

export function useEntitiesFiltering<
  T extends EntityWithVisibility,
  C extends T[] | Record<string, T>,
>(entities: Ref<C | undefined> | ComputedRef<C | undefined>) {
  const { user } = useAuthState();

  const filtered = computed(() => {
    const raw = entities.value;
    if (!raw) return raw as C | undefined;

    if (Array.isArray(raw)) {
      return (raw as T[]).filter((entity) => {
        if (user.value) return true;
        return entity.visibility !== false;
      }) as C;
    } else {
      return Object.fromEntries(
        Object.entries(raw as Record<string, T | undefined>).filter(
          ([_, entity]) => {
            if (!entity) return false;
            if (user.value) return true;
            return entity.visibility !== false;
          },
        ),
      ) as C;
    }
  });

  return filtered;
}
