import type { NodeType, NodeTypeMap } from "~~/shared/model";
import { useFetch, type UseFetchOptions } from "#app";

// Generic response wrapper if needed, or just return data
type ApiResponse<T> = {
    entities: Record<string, T>;
};

class ApiService {
    fetchNodes<N extends NodeType>(nodeType: N, options?: UseFetchOptions<any>) {
        return useFetch<{ entities: Record<string, NodeTypeMap[N]> }>(
            `/api/nodes/${nodeType}`, 
            options
        ) as any; // Cast to any to avoid Promise inference issues in strict mode for now
    }

    // Add other API methods here as needed
}

export const api = new ApiService();
