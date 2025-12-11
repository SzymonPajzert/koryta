import { describe, it, expect, vi } from 'vitest';

// Stub defineEventHandler global from Nuxt
vi.stubGlobal('defineEventHandler', (handler: any) => handler);

// Mock the server fetch utils
// We use a virtual mock or rely on alias resolution. 
// Since we are monitoring 'server/utils/fetch', we can try to mock it by path.
// Note: Vitest handling of aliases in `vi.mock` can be tricky.
// We will try absolute path or alias if supported.
vi.mock('~~/server/utils/fetch', () => ({
    fetchNodes: vi.fn(),
    fetchEdges: vi.fn()
}));

// Since it's a server route, it uses `~~`.
// import handler from '../../../server/api/graph/index.get';
import { fetchNodes, fetchEdges } from '~~/server/utils/fetch';

describe('Graph API', () => {
    it('assembles graph correctly', async () => {
        // Setup mocks
        (fetchNodes as any).mockImplementation((type: string) => {
            if (type === 'person') return Promise.resolve({ 'p1': { name: 'Person 1', parties: ['PiS'] } });
            if (type === 'place') return Promise.resolve({ 'c1': { name: 'Company 1' } });
            if (type === 'article') return Promise.resolve({});
            return Promise.resolve({});
        });
        
        (fetchEdges as any).mockResolvedValue([
            { from: 'p1', to: 'c1', type: 'work' }
        ]);

        const handlerModule = await import('../../../server/api/graph/index.get');
        const result = await handlerModule.default({} as any);

        expect(result).toHaveProperty('nodes');
        expect(result).toHaveProperty('edges');
        expect(result).toHaveProperty('nodeGroups');
        
        // Basic check on logic
        expect(result.nodes['p1']).toBeDefined();
        // Check if stats were calculated (logic from shared/graph/util)
        // We trust util works, we verify integration of data flow.
        expect(fetchNodes).toHaveBeenCalledTimes(3);
        expect(fetchEdges).toHaveBeenCalledTimes(1);
    });
});
