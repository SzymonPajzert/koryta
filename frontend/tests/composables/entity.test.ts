import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEntity } from '../../app/composables/entity';
import { ref } from 'vue';

// Mock useFetch globally
const mockFetchResponse = ref({});


// We need to fetch the actual computed from vue to make it reactive if we want proper testing, 
// OR just stub it as a function that returns { value: ... } which is enough for basic verification.

import * as vue from 'vue';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useEntity', () => {
    it('fetches entities correctly', async () => {
        const mockFetchResponse = ref({
            entities: {
                'id1': { name: 'Entity 1' }
            }
        });
        const mockFetcher = vi.fn().mockReturnValue({ data: mockFetchResponse });

        const { entities } = await useEntity('person', mockFetcher);

        expect(mockFetcher).toHaveBeenCalledWith('/api/nodes/person');
        // Check internal reference if available or verify behavior
        // If equality fails due to proxy/ref wrapping, check properties
        expect(entities.value).toBeTruthy();
        expect(Object.keys(entities.value)).toContain('id1');
    });

    it('returns empty object if fetch fails/returns null', async () => {
        const mockFetchResponse = ref(null);
        const mockFetcher = vi.fn().mockReturnValue({ data: mockFetchResponse });
        
        const { entities } = await useEntity('party', mockFetcher);
        
        expect(entities.value).toEqual({});
    });
});
