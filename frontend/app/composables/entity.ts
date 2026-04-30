import type { NodeTypeMap, NodeType } from "~~/shared/model";
import { computed, type Ref, type ComputedRef } from "vue";
import { authFetch, useAuthState } from "@/composables/auth";

export type Filters = {
  party?: string;
  place?: string;
  source?: string;
};

export function useEntities<N extends NodeType>(
  nodeType: N,
  filters: Filters | Ref<Filters> = {},
) {
  const { data: response } = authFetch<{
    nodes: Record<string, NodeTypeMap[N]>;
  }>(`/api/nodes?type=${nodeType}`, {
    query: filters,
  });

  const entitiesRaw = computed(() => response?.value?.nodes ?? {});

  const entities = useEntitiesFiltering(entitiesRaw);

  return { entities };
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
