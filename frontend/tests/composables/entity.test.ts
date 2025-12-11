import { describe, it, expect, vi, afterEach } from 'vitest';
import { useEntity } from '../../app/composables/entity';
import { ref } from 'vue';

// Mock useFetch globally
const mockFetchResponse = ref({});
const mockUseFetch = vi.fn().mockReturnValue({ data: mockFetchResponse });
vi.stubGlobal('useFetch', mockUseFetch);
vi.stubGlobal('computed', (fn: () => unknown) => {
    // Return a getter that calls the function always, to ensure fresh value reading
    return {
        get value() {
            return fn();
        }
    }
});

// We need to fetch the actual computed from vue to make it reactive if we want proper testing,
// OR just stub it as a function that returns { value: ... } which is enough for basic verification.

import * as vue from 'vue';
vi.stubGlobal('computed', vue.computed);
vi.stubGlobal('ref', vue.ref); // useFetch mock usages might need it? No, I imported ref in test.

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

        const { entities } = await useEntity('person');

        // expect(mockUseFetch).toHaveBeenCalledWith('/api/nodes/person');
        expect(entities.value).toEqual({
            'id1': { name: 'Entity 1' }
        });
    });

    it('returns empty object if fetch fails/returns null', async () => {
         const mockFetchResponse = ref(null);
        const mockFetcher = vi.fn().mockReturnValue({ data: mockFetchResponse });

         const { entities } = await useEntity('party', mockFetcher);

        // @ts-ignore
        mockFetchResponse.value = null;

        const { entities } = await useEntity('party');

        expect(entities.value).toEqual({});
    });

    const { entities } = await useEntity("party");

    expect(entities.value).toEqual({});
  });
});
