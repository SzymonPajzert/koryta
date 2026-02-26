import type { NodeTypeMap, NodeType } from "~~/shared/model";

import { useAuthState } from "@/composables/auth";
import { useEntityFiltering } from "./useEntityFiltering";

export function useEntity<N extends NodeType>(nodeType: N) {
  const { authFetch } = useAuthState();

  const { data: response } = authFetch<{
    entities: Record<string, NodeTypeMap[N]>;
  }>(`/api/nodes/${nodeType}`);

  const entitiesRaw = computed(() => response?.value?.entities ?? {});
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
