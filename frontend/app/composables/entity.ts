import type { NodeTypeMap, NodeType } from "~~/shared/model";

import { useAuthState } from "@/composables/auth";

export function useEntity<N extends NodeType>(nodeType: N) {
  const { authFetch } = useAuthState();

  const { data: response } = authFetch<{
    entities: Record<string, NodeTypeMap[N]>;
  }>(`/api/nodes/${nodeType}`);
  const entities = computed(() => response?.value?.entities ?? {});

  function submit<N extends NodeType>(
    _value: Partial<NodeTypeMap[N]>,
    _d: N,
    _editKey: string | undefined,
  ) {
    return { key: "0" };
  }

  return { entities, submit };
}
