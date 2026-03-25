import type { NodeTypeMap, NodeType } from "~~/shared/model";

import { authFetch } from "@/composables/auth";
import { useEntityFiltering } from "./useEntityFiltering";

export type Filters = {
  party?: string;
  place?: string;
};

export function useEntity<N extends NodeType>(
  nodeType: N,
  filters: Filters | Ref<Filters> = {},
) {
  const { data: response } = authFetch<{
    nodes: Record<string, NodeTypeMap[N]>;
  }>(`/api/nodes?type=${nodeType}`, {
    query: filters,
  });

  const entitiesRaw = computed(() => response?.value?.nodes ?? {});
  const entities = useEntityFiltering(entitiesRaw);

  function submit<N extends NodeType>(
    _value: Partial<NodeTypeMap[N]>,
    _d: N,
    _editKey: string | undefined,
  ) {
    return { key: "0" };
  }

  return { entities, submit };
}
