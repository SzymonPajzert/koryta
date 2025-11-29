import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-koryta-pl';

const app = initializeApp({
  projectId: 'demo-koryta-pl',
});

const db = getFirestore(app, "koryta-pl");

async function seed() {
  console.log('Seeding database...');

  const nodes = [
    {
      id: '1',
      name: 'Test Node 1',
      type: 'person',
      description: 'A test person',
    },
    {
      id: '2',
      name: 'Test Node 2',
      type: 'organization',
      description: 'A test organization',
    },
  ];

  const batch = db.batch();

  for (const node of nodes) {
    const ref = db.collection('nodes').doc(node.id);
    batch.set(ref, node);
  }

  await batch.commit();
  console.log('Database seeded successfully!');
}

seed().catch((err) => {
  console.error('Error seeding database:', err);
  process.exit(1);
});
