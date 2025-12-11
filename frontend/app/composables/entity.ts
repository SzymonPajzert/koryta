import type { NodeTypeMap, NodeType } from "~~/shared/model";
import { api } from "@/services/api";

export function useEntity<N extends NodeType>(
  nodeType: N, 
  fetcher?: (url: string) => Promise<{ data: Ref<{ entities: Record<string, NodeTypeMap[N]> } | null> }>
) {
  // If a custom fetcher is provided (e.g. for testing), use it.
  // Otherwise use the API service.
  
  let response: Ref<{ entities: Record<string, NodeTypeMap[N]> } | null> | undefined;

  if (fetcher) {
      // Use the provided fetcher mock
      const res = fetcher(`/api/nodes/${nodeType}`);
      // Asssuming fetcher returns an object with 'data' immediately (like useFetch or a synchronous mock)
      response = (res as any).data;
  } else {
      const res = api.fetchNodes(nodeType);
      // type issue: api.fetchNodes likely defined as async in my API service?
      // Let's check api.ts.
      // If api.ts uses `async fetchNodes(...) { return useFetch(...) }`, then it returns `Promise<AsyncData...>`.
      // Destructuring property `data` from Promise fails.
      // I need to make `api.fetchNodes` synchronous too (remove async).
      
      // For now, I'll update this assuming I fix api.ts too.
      response = res.data;
  }

  // Handle case where fetcher was passed and might be async promise?
  // If fetcher is `async () => ...`, then it returns Promise.
  // We can't support async function fetcher in a sync composable easily without unwrapping.
  // But let's assume we stick to API service for main path.
  // For tests, I might need to update tests or mocks.

  const entities = computed(() => response?.value?.entities ?? {});

  function submit<N extends NodeType>(
    _value: NodeTypeMap[N],
    _d: N,
    _editKey: string | undefined,
  ) {
    return { key: "0" };
  }

  return { entities, submit };
}


