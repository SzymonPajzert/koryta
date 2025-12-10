import { describe, it, expect } from 'vitest';
import { useFirestore } from 'vuefire';
import { collection, getDocs } from 'firebase/firestore';

describe('Firestore Integration', () => {
    it('should connect to the emulator and fetch seeded data', async () => {
        // This relies on the fact that `seed-emulator.ts` runs before this or we manually seeded.
        // In the current setup, we might need to ensure the emulator is running and seeded.
        // For now, checks if we can connect.
        
        const db = useFirestore();
        // Check if we are pointing to emulator
        // @ts-ignore
        const setttings = db._settings;
        // This is hard to assert on internals, but we can try to read the seeded collection.
        
        const testCol = collection(db, 'nodes');
        const snapshot = await getDocs(testCol);
        
        // We expect some data from the seed script (Test Node 1, Test Node 2)
        const docs = snapshot.docs.map(d => d.data());
        expect(docs.length).toBeGreaterThan(0);
        expect(docs.some(d => d.name === 'Test Node 1')).toBe(true);
    });
});
