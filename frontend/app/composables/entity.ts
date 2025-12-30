import type { NodeTypeMap, NodeType } from "~~/shared/model";

import { useAuthState } from "@/composables/auth";

export function useEntity<N extends NodeType>(nodeType: N) {
  const { idToken } = useAuthState();

  const headers = computed(() => {
    const h: Record<string, string> = {};
    if (idToken.value) {
      h.Authorization = `Bearer ${idToken.value}`;
    }
    return h;
  });

  const { data: response } = useFetch<{
    entities: Record<string, NodeTypeMap[N]>;
  }>(`/api/nodes/${nodeType}`, {
    key: `nodes-${nodeType}-${idToken.value ? "auth" : "anon"}`,
    headers,
    watch: [headers],
  });
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
