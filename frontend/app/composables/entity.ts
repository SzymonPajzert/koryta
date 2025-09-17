import type { NodeTypeMap, NodeType } from "~~/shared/model";

export async function useEntity<N extends NodeType>(nodeType: N) {
  const { data: response } = await useFetch<{
    entities: Record<string, NodeTypeMap[N]>;
  }>(`/api/nodes/${nodeType}`);
  const entities = computed(() => response.value?.entities ?? {});

  function submit<N extends NodeType>(
    _value: NodeTypeMap[N],
    _d: N,
    _editKey: string | undefined,
  ) {
    return { key: "0" };
  }

  return { entities, submit };
}
